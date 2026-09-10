"""Medya ekleri: yukleme, servis, silme (sozlesme §6-8).

GERCEK kimlik modunda kosar (test_real_identity.py ile ayni gerekce): sahte
kimlikte `current_user` asla None donmuyor, yani "oturum yok -> 401" hic
sinanamaz. Oturumlar burada gercek Google girisine cikmadan, imzali cerez
elle uretilerek acilir; CSRF token'i da AYNI cerezin icine gomulur, boylece
sayfa yuklemeden token okuma derdi olmaz.

Ikili sabit dosya COMMIT EDILMEDI: her ornek goruntu Pillow ile testin
icinde uretiliyor (tests/test_media.py ile ayni desen).
"""
import base64
import io
import json
import sys
from pathlib import Path

import itsdangerous
import pytest
from fastapi.testclient import TestClient
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from shared import attachments, config, db, media, scope  # noqa: E402

CSRF_TOKEN = "test-csrf-token"


@pytest.fixture(scope="module")
def client():
    """AUTH_MODE'u 'google' yapar: sahte kimlik yok, /media/* kapisi gercekten sinanir."""
    from conftest import setup_database  # noqa: E402
    setup_database("attachments")
    import app as app_mod  # noqa: E402
    previous = (config.AUTH_MODE, config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET)
    config.AUTH_MODE = "google"
    config.GOOGLE_CLIENT_ID = config.GOOGLE_CLIENT_ID or "test-istemci"
    config.GOOGLE_CLIENT_SECRET = config.GOOGLE_CLIENT_SECRET or "test-sir"
    with TestClient(app_mod.app) as c:
        c.headers["X-CSRF-Token"] = CSRF_TOKEN
        yield c
    (config.AUTH_MODE, config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET) = previous


@pytest.fixture(autouse=True)
def _media_root(tmp_path, monkeypatch):
    """Her testte config.MEDIA_ROOT gecici bir dizine yamanir. Depoya hicbir sey yazilmaz.

    Etkin birim (storage_volumes) HEMEN o dizine senkronlanir: aksi halde
    'default' etiketli birim, ilk sync_volume() (uygulama lifespan'i, client
    fixture'i kurulurken) hangi MEDIA_ROOT'u gordüyse onu tasimaya devam eder
    ve her testin KENDI tmp_path'i eski birimin mount_path'iyle uyusmaz —
    dosyalar diske dogru yazilir ama /media/* onlari BULAMAZ.
    """
    monkeypatch.setattr(config, "MEDIA_ROOT", str(tmp_path))
    attachments.sync_volume()
    yield


def _session_cookie(data: dict) -> str:
    """SessionMiddleware'in yazdigi bicimde GECERLI bir oturum cerezi uretir."""
    signer = itsdangerous.TimestampSigner(str(config.SECRET_KEY))
    raw = base64.b64encode(json.dumps(data).encode())
    return signer.sign(raw).decode()


def login(client, user_name: str = "Efe") -> dict:
    """Gercek OAuth'a cikmadan 'giris yapmis kullanici' kurar; CSRF token'i cerezin icinde."""
    u = db.q1("select * from users where name = %s", (user_name,))
    client.cookies.clear()
    client.cookies.set(config.cookie_name(),
                        _session_cookie({"uid": str(u["id"]), "sid": "test", "csrf": CSRF_TOKEN}))
    return u


def logout(client) -> None:
    client.cookies.clear()


def item_by_title(title: str) -> dict:
    return db.q1("select * from items where title = %s", (title,))


def team_by_name(name: str) -> dict:
    return db.q1("select * from teams where name = %s", (name,))


def last_event(subject_type: str, subject_id) -> dict | None:
    return db.q1("select * from events where subject_type=%s and subject_id=%s"
                 " order by created_at desc limit 1", (subject_type, subject_id))


def attachment_of(event_id) -> dict | None:
    """attachments.for_owners uzerinden — 'owner_type=event' varsayimi burada
    TEKRARLANMAZ, gercek genel arayuz cagrilir (CONTRACT-V2.md §9)."""
    rows = attachments.for_owners("event", [event_id]).get(db.uid(event_id), [])
    return rows[0] if rows else None


def event_count(subject_id) -> int:
    return db.q1("select count(*) c from events where subject_id=%s", (subject_id,))["c"]


def attachment_count() -> int:
    return db.q1("select count(*) c from attachments")["c"]


# --- ornek goruntu uretimi (ikili dosya commit edilmiyor) -------------------


def jpeg_bytes(size=(64, 48), color=(200, 50, 50)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="JPEG")
    return buf.getvalue()


def oversized_bytes() -> bytes:
    """Content-Length erken kontrolunu tetikleyecek kadar buyuk (govde HICBIR ZAMAN
    tamponlanmadan 413 donmeli)."""
    return b"0" * (media.MAX_BYTES + 2 * 1024 * 1024)


def not_an_image_bytes() -> bytes:
    return ("bu bir metin dosyasidir, gorsel degil\n" * 200).encode("utf-8")


def all_blob_files(tmp_path: Path) -> list:
    return [p for p in tmp_path.rglob("*") if p.is_file()]


# --- yukleme: metin + gorsel -------------------------------------------------


def test_upload_with_text_and_image_returns_bubble_and_persists(client, tmp_path):
    login(client, "Efe")
    it = item_by_title("Bütçe onayı 6 gündür bekliyor")
    r = client.post(f"/item/{it['id']}/message", data={"body": "görsel ekliyorum"},
                    files={"image": ("foto.jpg", jpeg_bytes(), "image/jpeg")},
                    headers={"HX-Request": "true"})
    assert r.status_code == 200 and "görsel ekliyorum" in r.text

    e = last_event("item", it["id"])
    assert e["event_type"] == "message" and e["body"] == "görsel ekliyorum"
    a = attachment_of(e["id"])
    assert a is not None
    assert a["mime"] == "image/jpeg" and a["deleted_at"] is None
    assert a["uploader_id"] == db.q1("select id from users where name='Efe'")["id"]
    assert (tmp_path / a["storage_key"]).is_file()
    assert (tmp_path / a["thumb_key"]).is_file()


def test_image_with_empty_body_is_accepted(client, tmp_path):
    login(client, "Efe")
    it = item_by_title("Bütçe onayı 6 gündür bekliyor")
    r = client.post(f"/item/{it['id']}/message", data={"body": ""},
                    files={"image": ("sadece-resim.png",
                                     io.BytesIO(_png_bytes()), "image/png")})
    assert r.status_code == 200

    e = last_event("item", it["id"])
    assert e["body"] == ""
    a = attachment_of(e["id"])
    assert a is not None and a["mime"] == "image/png"


def _png_bytes(size=(40, 30), color=(10, 200, 10)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="PNG")
    return buf.getvalue()


def test_text_only_message_still_works_without_attachment(client):
    login(client, "Efe")
    it = item_by_title("Bütçe onayı 6 gündür bekliyor")
    before = attachment_count()
    r = client.post(f"/item/{it['id']}/message", data={"body": "sadece metin"})
    assert r.status_code == 200 and "sadece metin" in r.text
    e = last_event("item", it["id"])
    assert e["body"] == "sadece metin"
    assert attachment_of(e["id"]) is None
    assert attachment_count() == before


def test_neither_text_nor_image_is_noop(client):
    login(client, "Efe")
    it = item_by_title("Bütçe onayı 6 gündür bekliyor")
    before = event_count(it["id"])
    r = client.post(f"/item/{it['id']}/message", data={"body": "   "})
    assert r.status_code == 200 and r.text == ""
    assert event_count(it["id"]) == before


# --- reddedilen yuklemeler ----------------------------------------------------


def test_oversized_upload_rejected_and_nothing_persists(client, tmp_path):
    login(client, "Efe")
    it = item_by_title("Bütçe onayı 6 gündür bekliyor")
    before_events, before_attachments = event_count(it["id"]), attachment_count()
    r = client.post(f"/item/{it['id']}/message", data={"body": "cok buyuk"},
                    files={"image": ("buyuk.jpg", oversized_bytes(), "image/jpeg")})
    assert r.status_code == 413
    assert event_count(it["id"]) == before_events
    assert attachment_count() == before_attachments
    assert all_blob_files(tmp_path) == []


def test_non_image_upload_rejected_and_nothing_persists(client, tmp_path):
    login(client, "Efe")
    it = item_by_title("Bütçe onayı 6 gündür bekliyor")
    before_events, before_attachments = event_count(it["id"]), attachment_count()
    r = client.post(f"/item/{it['id']}/message", data={"body": ""},
                    files={"image": ("belge.jpg", not_an_image_bytes(), "image/jpeg")})
    assert r.status_code == 400
    assert event_count(it["id"]) == before_events
    assert attachment_count() == before_attachments
    assert all_blob_files(tmp_path) == []


def test_upload_without_csrf_header_is_403(client):
    """Multipart de CsrfGate'ten gecer: baslik yoksa da 403 (sozlesme §7)."""
    login(client, "Efe")
    it = item_by_title("Bütçe onayı 6 gündür bekliyor")
    before = event_count(it["id"])
    r = client.post(f"/item/{it['id']}/message", data={"body": "csrf'siz"},
                    files={"image": ("foto.jpg", jpeg_bytes(), "image/jpeg")},
                    headers={"X-CSRF-Token": ""})
    assert r.status_code == 403
    assert event_count(it["id"]) == before


def test_uneditable_card_rejects_upload_with_403(client):
    """Efe'nin kapsami disi bir kart: yukleme 403, medya.save() hic cagrilmaz."""
    login(client, "Efe")
    it = item_by_title("Kapak Ünitesi — tekrar eden kayıp")
    before_events, before_attachments = event_count(it["id"]), attachment_count()
    r = client.post(f"/item/{it['id']}/message", data={"body": "x"},
                    files={"image": ("foto.jpg", jpeg_bytes(), "image/jpeg")})
    assert r.status_code == 403
    assert event_count(it["id"]) == before_events
    assert attachment_count() == before_attachments


# --- takim duvari --------------------------------------------------------


def test_team_wall_upload_lands_on_subject_type_team(client, tmp_path):
    login(client, "Efe")                                  # Satın Alım üyesi
    t = team_by_name("Satın Alım")
    r = client.post(f"/team/{t['id']}/message", data={"body": "kargo fotoğrafı"},
                    files={"image": ("kargo.jpg", jpeg_bytes(), "image/jpeg")},
                    headers={"HX-Request": "true"})
    assert r.status_code == 200 and "kargo fotoğrafı" in r.text

    e = last_event("team", t["id"])
    assert e is not None and e["body"] == "kargo fotoğrafı"
    a = attachment_of(e["id"])
    assert a is not None
    assert (tmp_path / a["storage_key"]).is_file()


# --- servis: GET /media -----------------------------------------------------


def _upload_and_get_attachment(client, item, filename="foto.jpg") -> dict:
    r = client.post(f"/item/{item['id']}/message", data={"body": "ek"},
                    files={"image": (filename, jpeg_bytes(), "image/jpeg")})
    assert r.status_code == 200
    e = last_event("item", item["id"])
    return attachment_of(e["id"])


def test_get_media_requires_session(client, monkeypatch):
    """Anonim istek GERCEKTEN anonim olmali.

    conftest HER testte EKIPTAKIP_AUTH=sahte kurar; o modda auth.current_user
    cerezsiz istekte bile "ilk aktif kullanici"ya duser (config.fake_identity()),
    yani bir '401 bekle' iddiasi hicbir sey sinamadan GECERDI. `client` fixture'i
    modul boyunca AUTH_MODE='google' yapiyor zaten (dosya basi notu) — burada
    AYRICA monkeypatch'leyip fake_identity()'nin GERCEKTEN kapali oldugunu
    iddiadan ONCE dogruluyoruz; bu satir olmadan/AUTH_MODE 'sahte' kalsaydi asagidaki
    401 iddiasi SESSIZCE yanlis gecebilirdi (bkz. gorev raporu: kanit calistirmasi).
    """
    monkeypatch.setattr(config, "AUTH_MODE", "google")
    assert config.fake_identity() is False, (
        "sahte kimlik acikken 401 iddiasi hicbir sey sinamadan gecerdi")

    it = item_by_title("Bütçe onayı 6 gündür bekliyor")
    login(client, "Efe")
    a = _upload_and_get_attachment(client, it)

    logout(client)
    assert client.get(f"/media/{a['id']}").status_code == 401

    login(client, "Efe")
    r = client.get(f"/media/{a['id']}")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/jpeg"


def test_get_media_bad_uuid_is_404(client):
    login(client, "Efe")
    assert client.get("/media/degil-bir-uuid").status_code == 404


def test_get_media_traversal_shaped_id_is_404(client):
    from urllib.parse import quote

    login(client, "Efe")
    r = client.get("/media/" + quote("../../etc/passwd", safe=""))
    assert r.status_code == 404


def test_thumb_endpoint_returns_webp(client):
    login(client, "Efe")
    it = item_by_title("Bütçe onayı 6 gündür bekliyor")
    a = _upload_and_get_attachment(client, it)
    r = client.get(f"/media/{a['id']}/thumb")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/webp"


def test_thumb_falls_back_to_full_when_thumb_key_null(client, tmp_path):
    """thumb_key NULL olan (varsayimsal eski) bir satir tam goruntuye duser."""
    login(client, "Efe")
    it = item_by_title("Bütçe onayı 6 gündür bekliyor")
    a = _upload_and_get_attachment(client, it)
    db.x("update attachments set thumb_key = null where id = %s", (a["id"],))
    r = client.get(f"/media/{a['id']}/thumb")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/jpeg"       # dususte GERCEK mime


def test_content_disposition_filename_is_sanitised(client):
    login(client, "Efe")
    it = item_by_title("Bütçe onayı 6 gündür bekliyor")
    a = _upload_and_get_attachment(client, it, filename='tuhaf".jpg')
    r = client.get(f"/media/{a['id']}")
    cd = r.headers["content-disposition"]
    assert "\r" not in cd and "\n" not in cd
    ascii_part = cd.split("filename*=")[0]
    assert ascii_part.count('"') == 2                       # yalnizca degeri saran ciftler


# --- silme -------------------------------------------------------------


def test_delete_by_uploader_soft_deletes_and_removes_blob(client, tmp_path):
    login(client, "Efe")
    it = item_by_title("Bütçe onayı 6 gündür bekliyor")
    a = _upload_and_get_attachment(client, it)
    full_path = tmp_path / a["storage_key"]
    thumb_path = tmp_path / a["thumb_key"]
    assert full_path.is_file() and thumb_path.is_file()

    r = client.delete(f"/media/{a['id']}")
    assert r.status_code == 200

    row = db.q1("select * from attachments where id = %s", (a["id"],))
    assert row["deleted_at"] is not None and row["deleted_by"] is not None
    assert not full_path.exists() and not thumb_path.exists()
    # events satiri ve metni KALIR
    assert db.q1("select count(*) c from events where id = %s", (a["owner_id"],))["c"] == 1

    assert client.get(f"/media/{a['id']}").status_code == 404


def test_delete_by_other_non_admin_is_403(client):
    login(client, "Efe")
    it = item_by_title("Bütçe onayı 6 gündür bekliyor")
    a = _upload_and_get_attachment(client, it)

    login(client, "Deniz")                                # yukleyen degil, admin degil
    r = client.delete(f"/media/{a['id']}")
    assert r.status_code == 403
    assert db.q1("select deleted_at from attachments where id = %s", (a["id"],))["deleted_at"] is None


def test_delete_by_admin_is_allowed(client):
    login(client, "Efe")
    it = item_by_title("Bütçe onayı 6 gündür bekliyor")
    a = _upload_and_get_attachment(client, it)

    login(client, "Selin")                                # admin, yukleyen degil
    r = client.delete(f"/media/{a['id']}")
    assert r.status_code == 200
    assert db.q1("select deleted_at from attachments where id = %s", (a["id"],))["deleted_at"] is not None


# --- servis: X-Accel-Redirect (CONTRACT-V2.md §10, iki ayri kod yolu) --------


def test_media_accel_empty_returns_real_bytes(client):
    """MEDIA_ACCEL bos (varsayilan): FileResponse, govdede GERCEK baytlar."""
    assert config.MEDIA_ACCEL == ""
    login(client, "Efe")
    it = item_by_title("Bütçe onayı 6 gündür bekliyor")
    a = _upload_and_get_attachment(client, it)
    r = client.get(f"/media/{a['id']}")
    assert r.status_code == 200
    assert len(r.content) > 0
    assert "x-accel-redirect" not in {k.lower() for k in r.headers.keys()}


def test_media_accel_set_returns_empty_body_with_header(client, monkeypatch):
    """MEDIA_ACCEL dolu: govde BOS + dogru X-Accel-Redirect basligi; yetki
    HALA uygulamada (bayt itme nginx'e devroluyor, kontrol degil, sozlesme §10).
    """
    login(client, "Efe")
    it = item_by_title("Bütçe onayı 6 gündür bekliyor")
    a = _upload_and_get_attachment(client, it)
    monkeypatch.setattr(config, "MEDIA_ACCEL", "/_media")

    row = db.q1("select * from attachments where id = %s", (a["id"],))
    expected_rel = attachments.accel_relpath(row, thumb=False)

    r = client.get(f"/media/{a['id']}")
    assert r.status_code == 200
    assert r.content == b""
    assert r.headers["x-accel-redirect"] == f"/_media/{expected_rel}"
    assert r.headers["content-type"] == "image/jpeg"

    logout(client)
    assert client.get(f"/media/{a['id']}").status_code == 401     # yetki HALA uygulamada


def test_media_accel_set_applies_to_thumb_too(client, monkeypatch):
    login(client, "Efe")
    it = item_by_title("Bütçe onayı 6 gündür bekliyor")
    a = _upload_and_get_attachment(client, it)
    monkeypatch.setattr(config, "MEDIA_ACCEL", "/_media")

    row = db.q1("select * from attachments where id = %s", (a["id"],))
    expected_rel = attachments.accel_relpath(row, thumb=True)

    r = client.get(f"/media/{a['id']}/thumb")
    assert r.status_code == 200
    assert r.content == b""
    assert r.headers["x-accel-redirect"] == f"/_media/{expected_rel}"
    assert r.headers["content-type"] == "image/webp"


# --- etiket slug katlamasi (CONTRACT-V2.md §2-3: I/İ/ı/i ACIKCA) ------------


@pytest.mark.parametrize("letter", ["I", "İ", "ı", "i"])
def test_slugify_folds_all_four_turkish_i_variants_to_the_same_slug(letter):
    """Turkce I/i katlanmasi str.lower()'in varsaydigindan farkli: dordu de
    AYNI 'i'ye katlanmali (CONTRACT-V2.md §2-3)."""
    assert attachments.slugify(letter) == "i"


def test_slugify_folds_whole_words_with_all_four_variants_the_same():
    assert attachments.slugify("İstanbul") == "istanbul"
    assert attachments.slugify("Istanbul") == "istanbul"
    assert attachments.slugify("ıstanbul") == "istanbul"
    assert attachments.slugify("istanbul") == "istanbul"


def test_slugify_collapses_accents_spaces_and_symbols():
    assert attachments.slugify("  Çok   Önemli!! ") == "cok-onemli"


def test_slugify_empty_falls_back():
    assert attachments.slugify("") == "etiket"
    assert attachments.slugify("!!!") == "etiket"


# --- etiket uclari (CONTRACT-V2.md §5-6) ------------------------------------


def _grant(user_name: str, scope_name: str) -> None:
    scope.grant_scope(db.q1("select id from users where name = %s", (user_name,))["id"], scope_name)


def test_new_tag_needs_tag_media_then_create_tags(client):
    """Var olmayan bir etiket: ONCE tag_media, SONRA (etiket YENI oldugu icin)
    AYRICA create_tags ister — ikisi ayri ayricalik (CONTRACT-V2.md §3, §5)."""
    it = item_by_title("Bütçe onayı 6 gündür bekliyor")     # efe/selin/deniz katilimci
    login(client, "Efe")
    a = _upload_and_get_attachment(client, it)

    r = client.post(f"/media/{a['id']}/tags", data={"name": "onemli"})
    assert r.status_code == 403                              # tag_media bile yok

    _grant("Efe", "tag_media")
    login(client, "Efe")
    r = client.post(f"/media/{a['id']}/tags", data={"name": "onemli"})
    assert r.status_code == 403                              # tag_media var, ama etiket YENI

    _grant("Efe", "create_tags")
    login(client, "Efe")
    r = client.post(f"/media/{a['id']}/tags", data={"name": "onemli"})
    assert r.status_code == 200

    tag = db.q1("select * from tags where slug = %s", (attachments.slugify("onemli"),))
    assert tag is not None
    assert db.q1("select 1 from attachment_tags where attachment_id=%s and tag_id=%s",
                 (a["id"], tag["id"])) is not None


def test_applying_existing_tag_does_not_need_create_tags(client):
    """Var olan bir etikete katilim: tag_media + katilim YETER."""
    it = item_by_title("Bütçe onayı 6 gündür bekliyor")
    login(client, "Selin")                                    # admin: ikisini de atlar
    a = _upload_and_get_attachment(client, it)
    assert client.post(f"/media/{a['id']}/tags", data={"name": "acil"}).status_code == 200

    _grant("Deniz", "tag_media")                              # create_tags YOK
    login(client, "Deniz")                                    # bu kaydin katilimcisi
    r = client.post(f"/media/{a['id']}/tags", data={"name": "ACİL"})   # ayni slug, farkli yazim
    assert r.status_code == 200
    assert db.q1("select count(*) c from tags where slug=%s",
                 (attachments.slugify("acil"),))["c"] == 1     # ikinci satir acilmadi


def test_tag_requires_participation_even_with_scope(client):
    """Kapsam TEK BASINA yetmez — 'katildigin sohbetlerdeki' kismi kullanicinin
    sarti (CONTRACT-V2.md §5)."""
    kapak = item_by_title("Kapak Ünitesi — tekrar eden kayıp")   # Efe'nin ne katilimi ne kapsami var
    login(client, "Deniz")                                       # kapak'in katilimcisi + yetkilisi
    a = _upload_and_get_attachment(client, kapak)

    _grant("Efe", "tag_media")
    login(client, "Efe")
    r = client.post(f"/media/{a['id']}/tags", data={"name": "x"})
    assert r.status_code == 403


def test_remove_tag(client):
    it = item_by_title("Bütçe onayı 6 gündür bekliyor")
    login(client, "Selin")
    a = _upload_and_get_attachment(client, it)
    assert client.post(f"/media/{a['id']}/tags", data={"name": "gecici"}).status_code == 200
    tag = db.q1("select * from tags where slug=%s", (attachments.slugify("gecici"),))

    r = client.delete(f"/media/{a['id']}/tags/{tag['id']}")
    assert r.status_code == 200
    assert db.q1("select 1 from attachment_tags where attachment_id=%s and tag_id=%s",
                 (a["id"], tag["id"])) is None


def test_list_tags_endpoint_returns_vocabulary(client):
    it = item_by_title("Bütçe onayı 6 gündür bekliyor")
    login(client, "Selin")
    a = _upload_and_get_attachment(client, it)
    client.post(f"/media/{a['id']}/tags", data={"name": "sozluk-testi"})

    r = client.get("/tags")
    assert r.status_code == 200
    names = [t["name"] for t in r.json()["tags"]]
    assert "sozluk-testi" in names


# --- etiket seridinin CIZILMESI (akista ve uc yanitinda) --------------------
#
# Yukaridakiler etiket MANTIGINI siniyor; bunlar seridin gercekten ekrana
# ciktigini. Ikisi ayri: uclar yesilken serit hic basilmiyor olabilirdi
# (feed sozlugunde tags/can_tag anahtarlari eksikse Jinja sessizce bos gecer).


def test_feed_media_carries_tags_and_can_tag(client):
    """service.feed_of ekran sozluğüne tags + can_tag koyar.

    Anahtar eksik olsaydi sablon HATA VERMEZDI, sessizce bos cizerdi — bu
    yuzden varligi acikca sinaniyor."""
    from shared import service
    it = item_by_title("Bütçe onayı 6 gündür bekliyor")
    login(client, "Selin")                                   # admin
    a = _upload_and_get_attachment(client, it)
    client.post(f"/media/{a['id']}/tags", data={"name": "saha"})

    user = db.q1("select * from users where name = %s", ("Selin",))
    feed = service.feed_of("item", it["id"], user)
    # BU testin ekini bul: kart onceki testlerden kalan eklerle dolu, ilk
    # medyali olayi almak yanlis satiri secerdi.
    m = next(x for e in feed for x in e["media"] if x["id"] == a["id"])
    assert "tags" in m and "can_tag" in m
    assert m["can_tag"] is True
    assert [t["name"] for t in m["tags"]] == ["saha"]


def test_tag_endpoint_returns_rendered_strip(client):
    """POST /media/{id}/tags seridi SABLONDAN dondurur (elle kurulmus dizgi degil)."""
    it = item_by_title("Bütçe onayı 6 gündür bekliyor")
    login(client, "Selin")
    a = _upload_and_get_attachment(client, it)
    r = client.post(f"/media/{a['id']}/tags", data={"name": "kritik-nokta"})
    assert r.status_code == 200
    assert f'id="tag-strip-{a["id"]}"' in r.text
    assert "kritik-nokta" in r.text
    assert f'hx-delete="/media/{a["id"]}/tags/' in r.text      # kaldirma kontrolu basili


def test_tag_name_is_escaped_in_strip(client):
    """Etiket adi kullanici girdisi: Jinja kacisi acik olmali (XSS)."""
    it = item_by_title("Bütçe onayı 6 gündür bekliyor")
    login(client, "Selin")
    a = _upload_and_get_attachment(client, it)
    r = client.post(f"/media/{a['id']}/tags", data={"name": '<img src=x onerror=alert(1)>'})
    assert r.status_code == 200
    assert "<img src=x" not in r.text
    assert "&lt;img" in r.text


def test_bubble_renders_tag_chip_after_tagging(client):
    """Balonun kendisi (ortak/mesaj.html) seridi include ediyor mu."""
    it = item_by_title("Bütçe onayı 6 gündür bekliyor")
    login(client, "Selin")
    a = _upload_and_get_attachment(client, it)
    client.post(f"/media/{a['id']}/tags", data={"name": "montaj"})
    r = client.get(f"/tasks/{it['id']}")
    assert r.status_code == 200
    assert "montaj" in r.text
    assert f'id="tag-strip-{a["id"]}"' in r.text


def test_strip_renders_no_controls_when_can_tag_false():
    """can_tag False: kontroller HIC BASILMAZ (disabled degil, YOK).

    Sablon seviyesinde sinaniyor: tohum veride uc kullanicinin ucu de o kartin
    katilimcisi, yani "disaridan biri" HTTP uzerinden uretilemiyor. Iddia zaten
    sablonun iddiasi — dogrudan orada sinamak daha kesin.
    """
    from shared.render import site_templates, SHARED_DIR
    tpl = site_templates(SHARED_DIR).get_template("ortak/tag_strip.html")
    media = {"id": "11111111-1111-1111-1111-111111111111",
             "tags": [{"id": "22222222-2222-2222-2222-222222222222",
                       "name": "gorunur", "color": None}]}

    açık = tpl.render(media=dict(media, can_tag=True))
    assert "gorunur" in açık and "hx-delete" in açık and "tag-add" in açık

    kapalı = tpl.render(media=dict(media, can_tag=False))
    assert "gorunur" in kapalı              # etiket GORUNUR
    assert "hx-delete" not in kapalı        # ama kaldirilamaz
    assert "tag-add" not in kapalı          # ve yenisi eklenemez
    assert "disabled" not in kapalı         # kilitli degil: HIC YOK
