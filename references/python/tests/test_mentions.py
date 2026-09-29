"""Sohbette anma: @kisi, @all, @here, @team (shared/mentions.py).

Sinanan sey KIME GITTIGI: grup anmalari sohbetin katilimci kumesinin disina
cikmamali. Kume kart sohbetinde `item_participants`, takim duvarinda
`team_members`.

Push gonderimi burada SINANMIYOR: VAPID anahtari yok, `push.enabled()` False,
`notify()` sessizce sifir doner. Sinanan hedef kumesinin dogrulugu — push'un
kendisi tests/test_push.py'nin isi.
"""
import sys
from datetime import timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from shared import db, mentions, service  # noqa: E402


@pytest.fixture(scope="module")
def client():
    from conftest import setup_database  # noqa: E402
    setup_database("mentions")
    import app  # noqa: E402
    with TestClient(app.app) as c:
        from conftest import csrf_attach  # noqa: E402
        csrf_attach(c)
        yield c


def user(name: str):
    return db.q1("select * from users where name = %s", (name,))


def item_of(title_like: str):
    return db.q1("select * from items where title like %s limit 1", (f"%{title_like}%",))


def seen(u, ago_minutes: float) -> None:
    db.x("update users set last_seen_at = %s where id = %s",
         (db.now() - timedelta(minutes=ago_minutes), u["id"]))


def participants(item_id) -> set:
    return {r["user_id"] for r in db.q(
        "select user_id from item_participants where item_id = %s", (item_id,))}


# --- anahtar ayristirma ---------------------------------------------------


def test_anahtarlar_okunur_ve_katlanir(client):
    assert mentions.tokens("@all bakar mısınız @Efe ve @AYSE?") == ["all", "efe", "ayse"]
    assert mentions.tokens("e-posta a@b.com gibi degil") == ["b-com"]   # ad eslesmezse yutulur
    assert mentions.tokens("tekrar @efe @efe") == ["efe"]


def test_turkce_i_katlamasi(client):
    """attachments.slugify ile ayni katlama: 'İ'/'I'/'ı'/'i' tek harf sayilir."""
    assert mentions.handle("İlker Işık") == mentions.handle("ilker isik")


# --- kart sohbeti: katilimci kumesi --------------------------------------


def test_yazan_kendiliginden_katilimci_olur(client):
    """Kume buyumezse @all/@here ilk gunden anlamsiz kalirdi."""
    item = item_of("Kapak Ünitesi")                      # tohumda yalniz Deniz katilimci
    selin = user("Selin")
    assert selin["id"] not in participants(item["id"])
    service.add_message(selin, item, "buraya bakıyorum")
    assert selin["id"] in participants(item["id"])


def test_all_yalniz_katilimcilara_gider(client):
    item = item_of("Bütçe onayı")
    efe, selin, deniz = user("Efe"), user("Selin"), user("Deniz")
    mentions.join(item["id"], selin["id"])
    db.x("delete from item_participants where item_id = %s and user_id = %s",
         (item["id"], deniz["id"]))
    herkes = participants(item["id"])
    assert deniz["id"] not in herkes                     # kume disinda

    hedef = mentions.resolve("item", item["id"], "@all bakalım", efe, item=item)
    assert selin["id"] in hedef
    assert deniz["id"] not in hedef                      # DISARI CIKMAZ
    assert efe["id"] not in hedef                        # yazanin kendisi elenir


def test_here_yalniz_son_10_dakikada_gorulenlere(client):
    item = item_of("Tedarikçi teklifleri")
    efe, selin, deniz = user("Efe"), user("Selin"), user("Deniz")
    for u in (selin, deniz):
        mentions.join(item["id"], u["id"])
    seen(selin, 3)                                       # pencerede
    seen(deniz, 45)                                      # disarida

    hedef = mentions.resolve("item", item["id"], "@here kim müsait?", efe, item=item)
    assert selin["id"] in hedef and deniz["id"] not in hedef


def test_kume_disindaki_kisi_anilinca_KATILIMCI_OLUR(client):
    """`@kisi` acik niyet: davet sayilir. Kumeye girmenin baska yolu yok."""
    item = item_of("Sevkiyat tarihi")
    efe, deniz = user("Efe"), user("Deniz")
    db.x("delete from item_participants where item_id = %s and user_id = %s",
         (item["id"], deniz["id"]))
    hedef = mentions.resolve("item", item["id"], "@Deniz bunu sen alır mısın?", efe, item=item)
    assert deniz["id"] in hedef
    assert deniz["id"] in participants(item["id"])


def test_bulunmayan_ad_sessizce_metinde_kalir(client):
    item = item_of("Bütçe onayı")
    assert mentions.resolve("item", item["id"], "@yokboyle biri", user("Efe"), item=item) == set()


def test_team_anmasi_kartin_takimiyla_sinirli(client):
    """`@team` = kartin takiminin uyeleri ∩ katilimci kumesi."""
    item = item_of("Bütçe onayı")                        # takim: Maliye (Selin lead, Efe uye)
    selin, deniz = user("Selin"), user("Deniz")
    for u in (selin, deniz):
        mentions.join(item["id"], u["id"])
    hedef = mentions.resolve("item", item["id"], "@team toplanalım", user("Efe"), item=item)
    assert selin["id"] in hedef                          # Maliye uyesi
    assert deniz["id"] not in hedef                      # katilimci ama takimda degil


# --- takim duvari ---------------------------------------------------------


def test_duvarda_kume_team_members(client):
    takim = db.q1("select * from teams where name = 'Tasarım'")   # Efe lead, Selin mentor
    hedef = mentions.resolve("team", takim["id"], "@all", user("Efe"))
    assert hedef == {user("Selin")["id"]}


def test_duvarda_uye_olmayan_anilsa_da_uye_yazilmaz(client):
    """Takim uyeligi ayri bir yonetim isi — bir mesaj onu genisletmemeli."""
    takim = db.q1("select * from teams where name = 'Tasarım'")
    deniz = user("Deniz")
    hedef = mentions.resolve("team", takim["id"], "@Deniz bak", user("Efe"))
    assert deniz["id"] not in hedef
    assert db.q1("select 1 from team_members where team_id = %s and user_id = %s",
                 (takim["id"], deniz["id"])) is None


# --- ekranda ---------------------------------------------------------------


def test_anma_balonda_vurgulanir_ve_kacilir(client):
    from shared.render import mention_html
    cikti = str(mention_html('@efe bak <script>alert(1)</script>'))
    assert '<span class="mention">@efe</span>' in cikti
    assert "<script>" not in cikti                        # kacis korunur
    assert '<span class="mention grp">@all</span>' in str(mention_html("@all"))


def test_kompozer_anma_ipucunu_gosterir(client):
    item = item_of("Bütçe onayı")
    assert "@kişi" in client.get(f"/tasks/{item['id']}").text
