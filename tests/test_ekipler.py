"""Ekipler modulu (spec/60-kaynak-uyarlama.md 2.5, sema spec/20-sema.md §2a).

Sinanan davranislar: liste ve detay ekranlari, duvarin AYRI bir tablo degil
events uzerinden yurumesi (goc 003), duvara yazmanin uyelik/admin istemesi ve
"bu takima kayit ac" kisayolunun normal kayit acma yolundan gecmesi.
"""
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from shared import db  # noqa: E402


@pytest.fixture(scope="module")
def client():
    from conftest import test_veritabani  # noqa: E402
    test_veritabani("ekipler")
    import app  # noqa: E402
    with TestClient(app.app) as c:
        from conftest import csrf_tak  # noqa: E402
        csrf_tak(c)
        yield c


def takim(ad: str):
    return db.q1("select * from teams where name = %s", (ad,))


def kullanici(ad: str):
    return db.q1("select * from users where name = %s", (ad,))


def duvar_sayisi(team_id) -> int:
    return db.q1("select count(*) c from events where subject_type='team'"
                 " and subject_id=%s", (team_id,))["c"]


# --- liste ---------------------------------------------------------------

def test_ekipler_iskele_degil_gercek_sayfa(client):
    """Modul hazir: /ekipler artik 'Yakinda' iskelesi degil."""
    r = client.get("/ekipler")
    assert r.status_code == 200
    assert "Yakında" not in r.text
    assert "Maliye" in r.text and "Tasarım" in r.text and "Satın Alım" in r.text


def test_ana_sayfa_ekipleri_hazir_gosterir(client):
    r = client.get("/")
    assert r.status_code == 200
    assert 'href="/ekipler"' in r.text
    assert "3 takım" in r.text                     # kart altindaki sayi, kendi biriminde


def test_liste_uye_ve_is_sayilarini_verir(client):
    """Sayilar SQL'de: uye sayisi, acik kayit, acik eylem (N+1 yok)."""
    r = client.get("/ekipler").text
    assert "2 üye" in r                            # Maliye: Selin + Efe
    assert "üyesiyim" in r                         # Efe: Tasarim/Satin Alim/Maliye uyesi
    assert "Bütçe, onay akışları ve ödemeler." in r


# --- detay ---------------------------------------------------------------

def uyeler_bolumu(sayfa: str) -> str:
    """Yalnizca uyeler parcasi — rayda kullanici degistirme listesi de var."""
    return sayfa.split('data-fragment="takim_uyeler"')[1].split('data-fragment=')[0]


def test_takim_sayfasi_uyeleri_rolleriyle_listeler(client):
    t = takim("Tasarım")
    r = client.get(f"/ekipler/{t['id']}")
    assert r.status_code == 200
    bolum = uyeler_bolumu(r.text)
    assert "Efe" in bolum and "Lider" in bolum
    assert "Selin" in bolum and "Mentor" in bolum
    assert "Deniz" not in bolum                              # uye degil


def test_takim_sayfasi_acik_kayitlari_ve_tablo_kisayolunu_verir(client):
    t = takim("Maliye")
    r = client.get(f"/ekipler/{t['id']}").text
    assert "Bütçe onayı 6 gündür bekliyor" in r
    assert "Onay akışına vekalet mekanizması ekle" in r
    assert "Sevkiyat tarihi etkinlikten sonraya düşüyor" not in r      # Satin Alim
    assert f'href="/gorevler?takim={t["id"]}"' in r                    # tamami tabloda


def test_uye_uzerindeki_acik_eylem_sayisi_gorunur(client):
    """"Kime ne dusuyor": eylem KISIYE atanir, sayim takimin isinden gelir."""
    t = takim("Maliye")
    r = client.get(f"/ekipler/{t['id']}").text
    assert "⚡1" in r                       # Efe'nin fiyat kilidi eylemi (devam)


def test_bilinmeyen_takim_404(client):
    assert client.get("/ekipler/yok").status_code == 404
    assert client.get("/ekipler/2f1c0a5e-0000-4000-8000-000000000000").status_code == 404


# --- duvar ---------------------------------------------------------------

def test_duvar_tohum_mesajlarini_gosterir(client):
    t = takim("Satın Alım")
    r = client.get(f"/ekipler/{t['id']}").text
    assert "Alternatif kargo tekliflerini bugün topluyorum" in r


def test_uye_duvara_yazar_ve_olay_team_olarak_duser(client):
    """Ayri mesajlasma altyapisi yok: mesaj events'e subject_type='team' ile yazilir."""
    t = takim("Tasarım")                                    # Efe lider
    once = duvar_sayisi(t["id"])
    r = client.post(f"/takim/{t['id']}/mesaj", data={"body": "afiş ölçüleri geldi"},
                    headers={"HX-Request": "true"})
    assert r.status_code == 200 and "afiş ölçüleri geldi" in r.text
    assert duvar_sayisi(t["id"]) == once + 1
    son = db.q1("select * from events where subject_type='team' and subject_id=%s"
                " order by created_at desc limit 1", (t["id"],))
    assert son["event_type"] == "mesaj" and son["author_id"] == kullanici("Efe")["id"]
    assert "afiş ölçüleri geldi" in client.get(f"/ekipler/{t['id']}").text


def test_bos_mesaj_olay_yazmaz(client):
    t = takim("Tasarım")
    once = duvar_sayisi(t["id"])
    assert client.post(f"/takim/{t['id']}/mesaj", data={"body": "   "}).status_code == 200
    assert duvar_sayisi(t["id"]) == once


def test_uye_olmayan_duvara_yazamaz(client):
    """Yetki sunucuda: arayuzde kutu kilitli, ucta 403 (spec/70-guvenlik.md)."""
    t = takim("Maliye")
    deniz = kullanici("Deniz")                              # Maliye uyesi degil, admin degil
    client.cookies.set("uid", str(deniz["id"]))
    sayfa = client.get(f"/ekipler/{t['id']}").text
    assert "üyesi değilsin" in sayfa                        # kutu kapali
    once = duvar_sayisi(t["id"])
    assert client.post(f"/takim/{t['id']}/mesaj", data={"body": "sızıntı"}).status_code == 403
    assert duvar_sayisi(t["id"]) == once
    client.cookies.delete("uid")


def test_admin_her_duvara_yazar(client):
    t = takim("Satın Alım")                                 # Selin uye degil ama admin
    selin = kullanici("Selin")
    assert selin["is_admin"]
    client.cookies.set("uid", str(selin["id"]))
    once = duvar_sayisi(t["id"])
    assert client.post(f"/takim/{t['id']}/mesaj", data={"body": "yönetici notu"},
                       headers={"HX-Request": "true"}).status_code == 200
    assert duvar_sayisi(t["id"]) == once + 1
    client.cookies.delete("uid")


def test_duvar_kart_akisina_karismaz(client):
    """subject_id ayni tabloda: takim olayi kartin akisinda gorunmemeli."""
    t = takim("Maliye")
    it = db.q1("select * from items where title = 'Bütçe onayı 6 gündür bekliyor'")
    assert "önceliğimiz bütçe onayı" in client.get(f"/ekipler/{t['id']}").text
    assert "önceliğimiz bütçe onayı" not in client.get(f"/gorevler/{it['id']}").text


# --- "bu takima kayit ac" -------------------------------------------------

def test_takima_kayit_ac_kisayolu(client):
    """Kisayol normal kayit acma yolundan gecer: takim onceden secili, kapsam kontrolu yerinde."""
    t = takim("Satın Alım")
    node = db.q1("select id from nodes where name = 'Bütçe Onayı'")     # Efe'nin kapsaminda
    r = client.post("/item", data={"title": "Kargo sözleşmesi taslağı", "node_id": node["id"],
                                   "team_id": str(t["id"])}, follow_redirects=False)
    assert r.status_code == 303
    yeni = db.q1("select * from items where title = 'Kargo sözleşmesi taslağı'")
    assert yeni["team_id"] == t["id"]
    assert "Kargo sözleşmesi taslağı" in client.get(f"/ekipler/{t['id']}").text


def test_uzun_liste_kirpilir_rozet_tami_soyler(client):
    """Takim sayfasi ikinci bir gorev tablosu degil: ilk 20 satir + "tamamı tabloda"."""
    t = takim("Tasarım")
    node = db.q1("select id from nodes where name = 'Bütçe Onayı'")
    efe = kullanici("Efe")
    for i in range(22):
        db.x("insert into items (node_id,kind,title,team_id,created_by) "
             "values (%s,'gorev',%s,%s,%s)",
             (node["id"], f"yığın kaydı {i}", t["id"], efe["id"]))
    r = client.get(f"/ekipler/{t['id']}").text
    assert r.count('class="tlink"') == 20                   # tablo 20 satirda duruyor
    assert "ilk 20, tamamı tabloda" in r
    assert '<span class="tb h0">22</span>' in r             # rozet gercek sayiyi verir


def test_kapsam_disi_dal_kisayoldan_da_gecmez(client):
    t = takim("Satın Alım")
    bad = db.q1("select id from nodes where name = 'Kapak Ünitesi'")    # Efe'nin kapsami disi
    assert client.post("/item", data={"title": "olmaz", "node_id": bad["id"],
                                      "team_id": str(t["id"])}).status_code == 403
