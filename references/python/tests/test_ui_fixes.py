"""UI duzeltmeleri paketinin sunucu tarafi (goc 013 ve cevresi).

Bu paketin cogu SABLON ve JS isi; buradaki testler yalnizca sunucunun
tuttugu sozlere bakiyor — cunku KNOW-241'in dersi tam tersi yondeydi:
yesil bir test paketi, spec'e aykiri bir sablonu gormeden gecirmisti. O
yuzden burada "ekranda su yaziyor" degil, DAVRANIS siniyor:

  - kart katilimi (card_signups): upsert, geri cekme, tur beyaz listesi
  - bildirim tercihi (users.notify_level): push suzmesi gercekten susturuyor mu
  - takim uyeligi: ekle/rol degistir/cikar + duvara dusen sistem olayi
  - kayit acarken sorumlu: alan gonderilmezse ESKI davranis korunuyor mu
  - dugum listesi: kapsam disi dal artik hic teklif edilmiyor
"""
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from shared import cards, db, push, service  # noqa: E402


@pytest.fixture(scope="module")
def client():
    from conftest import setup_database  # noqa: E402
    setup_database("uifixes")
    import app  # noqa: E402
    with TestClient(app.app) as c:
        from conftest import csrf_attach  # noqa: E402
        csrf_attach(c)
        yield c


def user(name: str):
    return db.q1("select * from users where name = %s", (name,))


def item_of(title_like: str):
    return db.q1("select * from items where title like %s limit 1", (f"%{title_like}%",))


def make_card(client, card_type: str):
    item = item_of("Bütçe onayı")
    r = client.post(f"/item/{item['id']}/card", data={"card_type": card_type})
    assert r.status_code == 200
    return db.q1("select * from item_cards where item_id = %s and card_type = %s"
                 " order by created_at desc limit 1", (item["id"], card_type))


# --- kart katilimi: toplanti yoklamasi + havuz karti ----------------------


def test_havuz_karti_acilabilir_bir_tur(client):
    """Yeni tur KODDA (CARD_TYPES) ve goc CHECK kisiti onu kabul ediyor."""
    card = make_card(client, "pool")
    assert card["card_type"] == "pool"


def test_katilim_yazilir_ve_ekranda_gorunur(client):
    card = make_card(client, "meeting")
    me = user("Efe")
    r = client.post(f"/card/{card['id']}/signup", data={"answer": "yes"})
    assert r.status_code == 200
    row = db.q1("select * from card_signups where card_id = %s and user_id = %s",
                (card["id"], me["id"]))
    assert row["answer"] == "yes"


def test_fikir_degistirmek_IKINCI_SATIR_ACMAZ(client):
    """Upsert: "belki" deyip sonra "geliyorum" demek tek satirdir. Iki satir
    olsaydi kartta iki cevap gorunur, hangisinin gecerli oldugu belirsizdi."""
    card = make_card(client, "meeting")
    me = user("Efe")
    client.post(f"/card/{card['id']}/signup", data={"answer": "maybe"})
    client.post(f"/card/{card['id']}/signup", data={"answer": "yes"})
    rows = db.q("select * from card_signups where card_id = %s and user_id = %s",
                (card["id"], me["id"]))
    assert len(rows) == 1
    assert rows[0]["answer"] == "yes"


def test_bos_cevap_katilimi_geri_ceker(client):
    """Geri cekmenin yolu ayri bir uc degil, bos deger."""
    card = make_card(client, "meeting")
    me = user("Efe")
    client.post(f"/card/{card['id']}/signup", data={"answer": "yes"})
    client.post(f"/card/{card['id']}/signup", data={"answer": ""})
    assert db.q1("select 1 from card_signups where card_id = %s and user_id = %s",
                 (card["id"], me["id"])) is None


def test_havuz_kartinda_belki_YOK(client):
    """Beyaz liste TURDEN geliyor: is ya alinir ya alinmaz.

    Bu satir olmasaydi jsonb'deki gibi serbest bir cop kutusu olurdu —
    card_signups'in CHECK kisiti 'maybe'i tablo duzeyinde kabul ediyor.
    """
    card = make_card(client, "pool")
    r = client.post(f"/card/{card['id']}/signup", data={"answer": "maybe"})
    assert r.status_code == 400


def test_katilim_yazma_yetkisi_ISTEMEZ(client):
    """Kaydi duzenleyemeyen de kendi adina "geliyorum" diyebilmeli; aksi halde
    toplanti yoklamasi yalniz kart sahiplerine sorulurdu.

    Kurulum ozenli: can_edit_item'in BES yolu var (admin, atanan/acan,
    katilimci, takim uyesi, kapsam). Hepsi kapali olmazsa test bir sey
    kanitlamaz — o yuzden yeni bir kayit acilip disarideki kisi temizleniyor.
    """
    from shared import auth
    db.x("update users set is_admin = true where id = %s", (user("Efe")["id"],))
    node = db.q1("select id from nodes where name = 'Bütçe Onayı'")
    item_id = service.new_item(user("Efe"), node["id"], "task", "Yoklama denemesi",
                               assignee_id="")
    r = client.post(f"/item/{item_id}/card", data={"card_type": "meeting"})
    assert r.status_code == 200
    card = db.q1("select * from item_cards where item_id = %s", (item_id,))

    disarideki = user("Deniz")
    db.x("update users set scope_node_id = null, is_admin = false, is_editor = false"
         " where id = %s", (disarideki["id"],))
    db.x("delete from item_participants where item_id = %s and user_id = %s",
         (item_id, disarideki["id"]))
    db.x("delete from team_members where user_id = %s", (disarideki["id"],))

    item = db.q1("select * from items where id = %s", (item_id,))
    assert not auth.can_edit_item(user("Deniz"), item, service.TREE)
    assert cards.sign(card["id"], disarideki["id"], "yes") is True


def test_toplanti_kartinda_baglanti_alani_var(client):
    """Alan listesi TEK KAYNAK (cards.FIELDS); sablon onu okuyor."""
    assert any(k == "link" for k, _lbl, _kind in cards.FIELDS["meeting"])
    card = make_card(client, "meeting")
    client.patch(f"/card/{card['id']}",
                 data={"title": "Toplantı", "link": "https://meet.example.com/x"})
    assert cards.get(card["id"])["data"]["link"] == "https://meet.example.com/x"


# --- bildirim tercihi (users.notify_level) --------------------------------


def test_tercih_yalniz_KENDI_uzerine_yazilir(client):
    """Hedef kimlik formdan degil oturumdan geliyor: baskasini susturmanin
    yolu yok."""
    me = user("Efe")
    r = client.post("/settings/notify", data={"level": "mentions"},
                    follow_redirects=False)
    assert r.status_code == 303
    assert db.q1("select notify_level from users where id = %s",
                 (me["id"],))["notify_level"] == "mentions"


def test_gecersiz_kademe_SESSIZCE_yutulmaz(client):
    r = client.post("/settings/notify", data={"level": "bazen"})
    assert r.status_code == 400


def test_none_diyen_kisiye_push_GITMEZ(client):
    """Asil sozlesme bu: ekranda "kapattim" yazarken bildirim gelmeye devam
    etmemeli. Suzme send()'in icinde, tek kapida."""
    me = user("Efe")
    db.x("update users set notify_level = 'none' where id = %s", (me["id"],))
    assert push._wants([me["id"]], "mention") == []
    db.x("update users set notify_level = 'all' where id = %s", (me["id"],))
    assert push._wants([me["id"]], "mention") == [me["id"]]


def test_yalniz_anildigimda_anma_disini_eler(client):
    me = user("Efe")
    db.x("update users set notify_level = 'mentions' where id = %s", (me["id"],))
    assert push._wants([me["id"]], "mention") == [me["id"]]
    assert push._wants([me["id"]], "digest") == []
    db.x("update users set notify_level = 'all' where id = %s", (me["id"],))


def test_bozuk_kademe_varsayilana_duser(client):
    """Elle bozulmus bir deger kimseyi SESSIZCE susturmasin."""
    assert push.notify_level({"notify_level": "yok-boyle-bir-sey"}) == "all"
    assert push.notify_level({"notify_level": None}) == "all"


# --- takim uyeligi ---------------------------------------------------------


def team_of(name: str):
    return db.q1("select * from teams where name = %s", (name,))


def test_uye_eklenir_ve_duvara_iz_dusurur(client):
    """Uygulamadaki her degisim gorunur bir iz birakiyor; uyelik istisna
    olmasin — "beni kim ekledi" akista cevaplanmali."""
    team, kisi = team_of("Tasarım"), user("Deniz")
    assert service.set_team_member(team["id"], kisi["id"], "mentor",
                                   changed_by=user("Selin")["id"])
    row = db.q1("select role from team_members where team_id = %s and user_id = %s",
                (team["id"], kisi["id"]))
    assert row["role"] == "mentor"
    olay = db.q1("select body from events where subject_type = 'team' and subject_id = %s"
                 " order by created_at desc limit 1", (team["id"],))
    assert "Deniz" in olay["body"] and "ekledi" in olay["body"]


def test_ayni_kisiyi_tekrar_eklemek_ROL_DEGISTIRIR(client):
    """"Ekle" ile "rolu degistir" ayni hareket: ayri iki uc olsaydi arayuz
    once "uye mi" diye sormak zorunda kalirdi."""
    team, kisi = team_of("Tasarım"), user("Deniz")
    service.set_team_member(team["id"], kisi["id"], "member", changed_by=user("Selin")["id"])
    rows = db.q("select * from team_members where team_id = %s and user_id = %s",
                (team["id"], kisi["id"]))
    assert len(rows) == 1 and rows[0]["role"] == "member"


def test_uye_cikarilir(client):
    team, kisi = team_of("Tasarım"), user("Deniz")
    service.set_team_member(team["id"], kisi["id"], "member", changed_by=user("Selin")["id"])
    assert service.remove_team_member(team["id"], kisi["id"], changed_by=user("Selin")["id"])
    assert db.q1("select 1 from team_members where team_id = %s and user_id = %s",
                 (team["id"], kisi["id"])) is None
    # Ikinci cikarma False doner — uc 404 cevirir, sessiz basari degil.
    assert not service.remove_team_member(team["id"], kisi["id"])


def test_gecersiz_rol_yazilmaz(client):
    team, kisi = team_of("Tasarım"), user("Deniz")
    assert not service.set_team_member(team["id"], kisi["id"], "patron")


def test_uyelik_ucu_manage_teams_ISTER(client):
    """Sablon dugmeyi gizliyor; asil kapi ucta (KNOW-99'daki kural)."""
    me = user("Efe")
    db.x("update users set is_admin = false where id = %s", (me["id"],))
    db.x("delete from user_scopes where user_id = %s and scope = 'manage_teams'", (me["id"],))
    team = team_of("Tasarım")
    r = client.post(f"/team/{team['id']}/members",
                    data={"user_id": str(user("Deniz")["id"]), "role": "member"})
    assert r.status_code == 403


# --- kayit acarken sorumlu -------------------------------------------------


def test_sorumlu_alani_GONDERILMEZSE_eski_davranis_korunur(client):
    """Nobetci (_CREATOR) olmasaydi alani hic gondermeyen eski cagiranlar
    sessizce davranis degistirir, kayitlar bir anda sahipsiz dogardi."""
    me = user("Efe")
    db.x("update users set is_admin = true where id = %s", (me["id"],))
    node = db.q1("select id from nodes where name = 'Bütçe Onayı'")
    item_id = service.new_item(user("Efe"), node["id"], "task", "Nöbetçi denemesi")
    assert db.q1("select assignee_id from items where id = %s",
                 (item_id,))["assignee_id"] == me["id"]


def test_sorumlu_BOS_gonderilirse_kayit_sahipsiz_acilir(client):
    node = db.q1("select id from nodes where name = 'Bütçe Onayı'")
    item_id = service.new_item(user("Efe"), node["id"], "task", "Sahipsiz deneme",
                               assignee_id="")
    assert db.q1("select assignee_id from items where id = %s",
                 (item_id,))["assignee_id"] is None


def test_sorumlu_secilirse_sohbetin_ICINE_alinir(client):
    """Atanan kisi katilimci degilse @all ona ulasmazdi."""
    node = db.q1("select id from nodes where name = 'Bütçe Onayı'")
    kisi = user("Deniz")
    item_id = service.new_item(user("Efe"), node["id"], "task", "Atamali deneme",
                               assignee_id=str(kisi["id"]))
    assert db.q1("select 1 from item_participants where item_id = %s and user_id = %s",
                 (item_id, kisi["id"])) is not None


def test_olmayan_sorumlu_400(client):
    node = db.q1("select id from nodes where name = 'Bütçe Onayı'")
    with pytest.raises(Exception):
        service.new_item(user("Efe"), node["id"], "task", "Hayalet",
                         assignee_id="00000000-0000-0000-0000-000000000000")


# --- dugum listesi kapsamla suzuluyor -------------------------------------


def test_kapsam_disi_dal_ARTIK_TEKLIF_EDILMIYOR(client):
    """Liste butun agaci veriyordu ama new_item kapsami zorluyordu: kullanici
    formu dolduruyor, gonderince 403 aliyor ve yazdigi her sey gidiyordu.
    Mobil form bu suzmeyi zaten yapiyordu — iki yuz ayni cevabi versin.
    """
    from sites.dashboard.routes import node_options
    efe = user("Efe")
    db.x("update users set is_admin = false, scope_node_id ="
         " (select id from nodes where name = 'Malzeme Temini') where id = %s", (efe["id"],))
    adlar = [n["name"] for n in node_options(user("Efe"))]
    assert "Malzeme Temini" in adlar
    assert "Üretim Hattı A" not in adlar          # baska kok, kapsam disi
    # Admin hepsini gorur.
    db.x("update users set is_admin = true where id = %s", (efe["id"],))
    assert "Üretim Hattı A" in [n["name"] for n in node_options(user("Efe"))]


# --- medya kartinin aciklamasi (goc 015) ----------------------------------


def test_aciklama_EKTE_DEGIL_KARTTA(client):
    """Ilk uygulama her EKE aciklama koymustu; yanlis katmandi.

    Ekin kendi anlatimi zaten ETIKET (goc 010) — ikinci bir serbest metin
    alani "bu ne hakkinda" sorusunu iki yerden cevaplatiyordu. Istenen sey
    blogun aciklamasiydi, tek tek gorsellerin degil.
    """
    assert [k for k, _l, _t in cards.FIELDS["media"]] == ["description"]
    assert "caption" not in db.q1(
        "select string_agg(column_name, ',') c from information_schema.columns"
        " where table_name = 'attachments'")["c"]


def test_kart_aciklamasi_jsonb_ye_yazilir_ve_ekranda_gorunur(client):
    card = make_card(client, "media")
    r = client.patch(f"/card/{card['id']}",
                     data={"title": "Medya eki", "description": "Sözleşme taslağı, 2. sayfa"})
    assert r.status_code == 200
    assert cards.get(card["id"])["data"]["description"] == "Sözleşme taslağı, 2. sayfa"
    sayfa = client.get(f"/tasks/{card['item_id']}").text
    assert "Sözleşme taslağı, 2. sayfa" in sayfa


def test_govde_metni_EKIN_ALTINDA_cizilir(client, tmp_path, monkeypatch):
    """Ekli mesajda metin ustte duruyorken balon "once bir cumle, sonra alakasiz
    bir resim" gibi okunuyordu; metin ekin ALTYAZISI (kullanici istegi)."""
    import io
    from PIL import Image
    from shared import attachments, config

    monkeypatch.setattr(config, "MEDIA_ROOT", str(tmp_path))
    attachments.sync_volume()
    buf = io.BytesIO()
    Image.new("RGB", (40, 30), (20, 160, 90)).save(buf, format="PNG")

    item = item_of("Bütçe onayı")
    r = client.post(f"/item/{item['id']}/message", data={"body": "bla bla bla"},
                    files={"image": ("logo.png", buf.getvalue(), "image/png")})
    assert r.status_code == 200
    # Sira: once ek kutusu (.bmedia), sonra govde (.bmetin).
    assert r.text.index("bmedia") < r.text.index("bmetin")


def test_eksiz_mesajda_govde_yine_cizilir(client):
    """Metin artik ayri bir kutuda; eksiz mesajda kaybolmamali."""
    item = item_of("Bütçe onayı")
    r = client.post(f"/item/{item['id']}/message", data={"body": "yalnız metin"})
    assert "bmetin" in r.text and "yalnız metin" in r.text


def test_kart_ekleri_de_ETIKETLENEBILIR(client, tmp_path, monkeypatch):
    """cards.of_item "can_tag": False SABIT yaziyordu: sohbetteki gorsel
    etiketlenebiliyor, AYNI kaydin kart blogundaki gorsel etiketlenemiyordu.
    Ekin nerede durdugu etiketlenip etiketlenemeyecegini belirlememeli —
    attachments._participates zaten owner_type='card' dalini tasiyor.
    """
    import io
    from PIL import Image
    from shared import attachments, config, db as _db

    monkeypatch.setattr(config, "MEDIA_ROOT", str(tmp_path))
    attachments.sync_volume()
    buf = io.BytesIO()
    Image.new("RGB", (40, 30), (20, 160, 90)).save(buf, format="PNG")

    me = user("Efe")
    _db.x("update users set is_admin = true where id = %s", (me["id"],))
    card = make_card(client, "media")
    r = client.post(f"/card/{card['id']}/media",
                    files={"image": ("k.png", buf.getvalue(), "image/png")})
    assert r.status_code == 200

    goruntu = cards.of_item(card["item_id"], user("Efe"))
    blok = next(c for c in goruntu if c["id"] == card["id"])
    assert blok["media"], "karta ek asilmadi"
    assert blok["media"][0]["can_tag"] is True
    assert blok["media"][0]["tags"] == []       # henuz etiket yok ama alan var


def test_sohbette_aciklama_kutusu_YOK(client):
    """Her balonun altina bir metin kutusu koymak akisi gurultulendiriyordu."""
    item = item_of("Bütçe onayı")
    sayfa = client.get(f"/tasks/{item['id']}").text
    assert "bacik-form" not in sayfa
    assert "/caption" not in sayfa


# --- alintili yanit (goc 014) ---------------------------------------------


def son_mesaj(item_id):
    return db.q1("select * from events where subject_type='item' and subject_id=%s"
                 " and event_type='message' order by created_at desc limit 1", (item_id,))


def test_yanit_ALINTI_tasir_anma_DEGIL(client):
    """Ilk uygulama "yanitla"yi anmanin kisayoli yapmisti: govdeye "@ad "
    yaziyordu. Istenen o degildi — yanitlanan mesajin KENDISI balonun icinde
    gorunmeli, kime cevap verildigi metinden degil YAPIDAN okunmali."""
    item = item_of("Bütçe onayı")
    client.post(f"/item/{item['id']}/message", data={"body": "asıl mesaj"})
    hedef = son_mesaj(item["id"])

    r = client.post(f"/item/{item['id']}/message",
                    data={"body": "cevabım", "reply_to": str(hedef["id"])})
    assert r.status_code == 200
    yanit = son_mesaj(item["id"])
    assert yanit["reply_to_id"] == hedef["id"]
    # Govdeye hicbir sey enjekte EDILMEDI.
    assert yanit["body"] == "cevabım"
    # Donen balon alintiyi zaten tasiyor (htmx onu dogrudan akisa ekliyor).
    assert "asıl mesaj" in r.text and "alinti" in r.text


def test_BASKA_konunun_mesaji_alintilanamaz(client):
    """Alinti, okuyanin gormeye yetkili olmadigi bir metni balonun icinde
    tasiyabilirdi — yetki konunun kendisinde kontrol ediliyor, alinti o kapiyi
    delmemeli. Gecersiz hedef sessizce duz mesaja duser."""
    a, b = item_of("Bütçe onayı"), item_of("Sevkiyat")
    client.post(f"/item/{a['id']}/message", data={"body": "A kaydındaki gizli satır"})
    yabanci = son_mesaj(a["id"])

    r = client.post(f"/item/{b['id']}/message",
                    data={"body": "sızdırma denemesi", "reply_to": str(yabanci["id"])})
    assert r.status_code == 200
    assert son_mesaj(b["id"])["reply_to_id"] is None
    assert "A kaydındaki gizli satır" not in r.text


def test_sistem_olayi_yanitlanamaz(client):
    """"Durum degisti" satirina cevap verilmiyor; arayuz de dugmeyi orada
    cizmiyor, uc de kabul etmiyor."""
    item = item_of("Bütçe onayı")
    sistem = db.q1("select * from events where subject_type='item' and subject_id=%s"
                   " and event_type='system' order by created_at limit 1", (item["id"],))
    assert sistem is not None
    client.post(f"/item/{item['id']}/message",
                data={"body": "sisteme cevap", "reply_to": str(sistem["id"])})
    assert son_mesaj(item["id"])["reply_to_id"] is None


def test_gecersiz_reply_to_400_DEGIL_sessizce_duz_mesaj(client):
    """Yanit hedefi bozuksa mesaj GITMELI: kullanicinin yazdigi metin bir
    kimlik hatasi yuzunden kaybolmamali."""
    item = item_of("Bütçe onayı")
    r = client.post(f"/item/{item['id']}/message",
                    data={"body": "bozuk hedef", "reply_to": "abc-not-a-uuid"})
    assert r.status_code == 200
    assert son_mesaj(item["id"])["body"] == "bozuk hedef"


def test_akista_alinti_EK_SORGU_OLMADAN_cozulur(client):
    """Hedef ayni konunun olayi olmak zorunda, yani feed_of'un zaten cektigi
    satirlarin icinde — ikinci bir select atmak elimizdekini tekrar istemek."""
    item = item_of("Bütçe onayı")
    client.post(f"/item/{item['id']}/message", data={"body": "kök mesaj"})
    hedef = son_mesaj(item["id"])
    client.post(f"/item/{item['id']}/message",
                data={"body": "dallanan cevap", "reply_to": str(hedef["id"])})

    akis = service.feed_of("item", item["id"], user("Efe"))
    yanit = next(m for m in akis if m["body"] == "dallanan cevap")
    assert yanit["reply"]["body"] == "kök mesaj"
    assert yanit["reply"]["id"] == hedef["id"]
    assert yanit["reply"]["author_name"]


def test_govdesiz_gorsel_mesaji_alintida_bos_kalmaz(client, tmp_path, monkeypatch):
    """Yalniz gorselli bir mesaj alintilaninca bos bir kutu gorunmemeli."""
    import io
    from PIL import Image
    from shared import attachments, config

    monkeypatch.setattr(config, "MEDIA_ROOT", str(tmp_path))
    attachments.sync_volume()
    buf = io.BytesIO()
    Image.new("RGB", (40, 30), (20, 160, 90)).save(buf, format="PNG")

    item = item_of("Bütçe onayı")
    client.post(f"/item/{item['id']}/message", data={"body": ""},
                files={"image": ("a.png", buf.getvalue(), "image/png")})
    gorselli = son_mesaj(item["id"])
    assert (gorselli["body"] or "") == ""

    client.post(f"/item/{item['id']}/message",
                data={"body": "görsele cevap", "reply_to": str(gorselli["id"])})
    akis = service.feed_of("item", item["id"], user("Efe"))
    yanit = next(m for m in akis if m["body"] == "görsele cevap")
    assert yanit["reply"]["body"] == "📷 Görsel"


def test_uzun_govde_alintida_kirpilir(client):
    item = item_of("Bütçe onayı")
    uzun = "x" * 400
    client.post(f"/item/{item['id']}/message", data={"body": uzun})
    hedef = son_mesaj(item["id"])
    client.post(f"/item/{item['id']}/message",
                data={"body": "kısa cevap", "reply_to": str(hedef["id"])})
    akis = service.feed_of("item", item["id"], user("Efe"))
    yanit = next(m for m in akis if m["body"] == "kısa cevap")
    assert len(yanit["reply"]["body"]) <= service.QUOTE_LIMIT
    assert yanit["reply"]["body"].endswith("…")
