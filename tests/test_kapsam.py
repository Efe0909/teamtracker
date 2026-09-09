"""Yetki kapsamlari ve dugum bazli izinler (goc 007, shared/kapsam.py).

Model iki parcali:
  KAPSAM      — ne yapabilir ("dugum_duzenle")
  DUGUM IZNI  — hangi dalda; ALT AGACA MIRAS KALIR

Testlerin cogu mirasi ve dal sinirlarini sabitliyor: bir dala yetkili olan
komsu dala karisamamali, ama kendi dalinin derinliklerine inebilmeli.
"""
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from shared import db, kapsam, service  # noqa: E402


@pytest.fixture(scope="module")
def client():
    from conftest import test_veritabani  # noqa: E402
    test_veritabani("kapsam")
    import app  # noqa: E402
    with TestClient(app.app) as c:
        from conftest import csrf_tak  # noqa: E402
        csrf_tak(c)
        yield c


@pytest.fixture(autouse=True)
def temiz(client):
    yield
    db.x("delete from user_scopes")
    db.x("delete from user_node_scopes")
    db.x("delete from nodes where name like %s", ("K-%",))
    service.rebuild_tree()


def kisi(ad):
    return db.q1("select * from users where name = %s", (ad,))


def dugum(ad):
    return db.q1("select * from nodes where name = %s", (ad,))


def _gec(client, user_id):
    """Kullanici degistir VE CSRF token'ini tazele.

    oturum_ac() oturumu tamamen temizliyor (sabitleme ve token mirasi
    riskine karsi), yani switch sonrasi istemcideki baslik BAYAT kalir ve
    sonraki POST 403 doner. O 403 yetkiden degil CSRF'ten gelir — testin
    olcmek istedigi seyi gizler.
    """
    from conftest import csrf_tak
    client.post(f"/switch/{user_id}", follow_redirects=False)
    csrf_tak(client)


# --- kapsam --------------------------------------------------------------


def test_kapsam_verilir_ve_okunur(client):
    u = kisi("Deniz")
    assert kapsam.kapsam_ver(u["id"], "dugum_duzenle")
    assert kapsam.var_mi(u, "dugum_duzenle")


def test_uydurma_kapsam_kabul_edilmez(client):
    """Yonetim panelindeki yazim hatasi sessizce yetki vermesin."""
    u = kisi("Deniz")
    assert kapsam.kapsam_ver(u["id"], "her_seyi_yap") is False
    assert "her_seyi_yap" not in kapsam.etkin_kapsamlar(u)


def test_veritabanindaki_tanimsiz_kapsam_elenir(client):
    """Satir elle yazilmis olsa bile uygulama tanimayani yok sayar."""
    u = kisi("Deniz")
    db.x("insert into user_scopes (user_id, scope) values (%s,%s)", (u["id"], "uydurma"))
    assert "uydurma" not in kapsam.etkin_kapsamlar(u)


def test_admin_tum_kapsamlara_sahiptir(client):
    """Yetkilendirmenin tepesi tek yerde; her kontrol ayrica admin sormasin."""
    assert kapsam.etkin_kapsamlar(kisi("Selin")) == set(kapsam.KAPSAMLAR)


def test_kapsam_geri_alinir(client):
    u = kisi("Deniz")
    kapsam.kapsam_ver(u["id"], "dugum_duzenle")
    kapsam.kapsam_al(u["id"], "dugum_duzenle")
    assert not kapsam.var_mi(u, "dugum_duzenle")


def test_ayni_kapsam_iki_kez_verilebilir(client):
    u = kisi("Deniz")
    assert kapsam.kapsam_ver(u["id"], "dugum_duzenle")
    assert kapsam.kapsam_ver(u["id"], "dugum_duzenle")     # cakisma degil


# --- dugum izni ve miras --------------------------------------------------


def test_izin_alt_agaca_miras_kalir(client):
    """Asil kural: bir dugume izin = tum altina izin. Tek tek satir yok."""
    u = kisi("Deniz")
    kapsam.kapsam_ver(u["id"], "dugum_duzenle")
    kapsam.dugum_izni_ver(u["id"], dugum("Malzeme Temini")["id"])

    assert kapsam.dugumde_yetkili(u, dugum("Malzeme Temini")["id"])
    assert kapsam.dugumde_yetkili(u, dugum("Bütçe Onayı")["id"]), "cocuk"
    assert kapsam.dugumde_yetkili(u, dugum("Tedarikçi Seçimi")["id"]), "kardes cocuk"


def test_miras_yeni_eklenen_torunu_da_kapsar(client):
    u = kisi("Deniz")
    kapsam.kapsam_ver(u["id"], "dugum_duzenle")
    kapsam.dugum_izni_ver(u["id"], dugum("Malzeme Temini")["id"])

    yeni = service.dugum_ekle("K-Torun", "Adım", parent_id=dugum("Bütçe Onayı")["id"])
    assert kapsam.dugumde_yetkili(u, yeni["id"]), "sonradan eklenen de kapsanmali"


def test_komsu_dala_karisamaz(client):
    u = kisi("Deniz")
    kapsam.kapsam_ver(u["id"], "dugum_duzenle")
    kapsam.dugum_izni_ver(u["id"], dugum("Malzeme Temini")["id"])
    assert kapsam.dugumde_yetkili(u, dugum("Mekan & Lojistik")["id"]) is False


def test_ustune_cikamaz(client):
    """Cocuga izin, ebeveyni duzenleme hakki VERMEZ."""
    u = kisi("Deniz")
    kapsam.kapsam_ver(u["id"], "dugum_duzenle")
    kapsam.dugum_izni_ver(u["id"], dugum("Bütçe Onayı")["id"])
    assert kapsam.dugumde_yetkili(u, dugum("Malzeme Temini")["id"]) is False


def test_kapsamsiz_izin_yetmez(client):
    """Dugum izni var ama 'dugum_duzenle' kapsami yok — ikisi birlikte gerekir."""
    u = kisi("Deniz")
    kapsam.dugum_izni_ver(u["id"], dugum("Malzeme Temini")["id"])
    assert kapsam.dugumde_yetkili(u, dugum("Malzeme Temini")["id"]) is False


def test_izinsiz_kapsam_yetmez(client):
    """Kapsam var ama hicbir dugume izin yok."""
    u = kisi("Deniz")
    kapsam.kapsam_ver(u["id"], "dugum_duzenle")
    assert kapsam.dugumde_yetkili(u, dugum("Malzeme Temini")["id"]) is False


def test_olmayan_dugume_izin_verilmez(client):
    u = kisi("Deniz")
    assert kapsam.dugum_izni_ver(u["id"], "00000000-0000-0000-0000-000000000000") is False


def test_dugum_silinince_izin_de_gider(client):
    """Cascade: olmayan dugume izin tasima."""
    u = kisi("Deniz")
    d = service.dugum_ekle("K-Gecici", "Bölüm")
    kapsam.dugum_izni_ver(u["id"], d["id"])
    service.dugum_sil(d["id"])
    assert kapsam.izinli_dugumler(u) == []


def test_kok_islemi_yalnizca_admin(client):
    """Dugum izni bir DALI kapsar; kok hicbir dala girmez. Aksi halde bir dala
    izinli kisi agacin yanina kendi agacini kurabilirdi."""
    u = kisi("Deniz")
    kapsam.kapsam_ver(u["id"], "dugum_duzenle")
    kapsam.dugum_izni_ver(u["id"], dugum("Malzeme Temini")["id"])
    assert kapsam.kok_islemi_yapabilir(u) is False
    assert kapsam.kok_islemi_yapabilir(kisi("Selin")) is True     # admin


# --- uclarda -------------------------------------------------------------


def test_uc_dal_sinirini_uygular(client):
    """Kontrol UCUN KENDISINDE — formu gizlemek yetmez."""
    u = kisi("Deniz")
    kapsam.kapsam_ver(u["id"], "dugum_duzenle")
    kapsam.dugum_izni_ver(u["id"], dugum("Malzeme Temini")["id"])
    _gec(client, u["id"])
    try:
        icinde = client.post("/dugum", data={
            "ad": "K-Icinde", "tur": "Adım", "ust": str(dugum("Bütçe Onayı")["id"])})
        assert icinde.status_code == 200, icinde.text[:200]

        disinda = client.post("/dugum", data={
            "ad": "K-Disinda", "tur": "Adım", "ust": str(dugum("Salon Sözleşmesi")["id"])})
        assert disinda.status_code == 403
        assert db.q1("select 1 from nodes where name = %s", ("K-Disinda",)) is None
    finally:
        _gec(client, kisi("Efe")["id"])


# --- agac gecmisi ---------------------------------------------------------


def test_ekleme_gecmise_yazilir(client):
    d = service.dugum_ekle("K-Gecmis", "Bölüm", created_by=kisi("Efe")["id"])
    olay = db.q1("select * from events where subject_type = 'node' and subject_id = %s"
                 " order by created_at desc limit 1", (d["id"],))
    assert olay is not None
    assert "K-Gecmis" in olay["body"]
    assert olay["author_id"] == kisi("Efe")["id"]


def test_silme_gecmisi_ADI_TASIR(client):
    """events.subject_id FK degil — satir kalir ama dugum gider. Ad body'de
    yazili olmazsa gecmis 'bir sey silindi' demekten oteye gitmez."""
    d = service.dugum_ekle("K-Silinen", "Bölüm")
    service.dugum_sil(d["id"], silen=kisi("Efe")["id"])

    olay = db.q1("select * from events where subject_type = 'node' and subject_id = %s"
                 " order by created_at desc limit 1", (d["id"],))
    assert olay is not None, "dugum gitti, gecmis kalmali"
    assert "K-Silinen" in olay["body"]
    assert "silindi" in olay["body"]


def test_silme_gecmisi_alt_agac_sayisini_yazar(client):
    ust = service.dugum_ekle("K-Ust", "Bölüm")
    service.dugum_ekle("K-Alt", "Adım", parent_id=ust["id"])
    service.dugum_sil(ust["id"])
    olay = db.q1("select body from events where subject_type = 'node' and subject_id = %s"
                 " order by created_at desc limit 1", (ust["id"],))
    assert "1 alt düğüm" in olay["body"]


def test_adlandirma_gecmisi_eski_ADI_TASIR(client):
    d = service.dugum_ekle("K-Once", "Bölüm")
    service.dugum_guncelle(d["id"], ad="K-Sonra", degistiren=kisi("Efe")["id"])
    olay = db.q1("select body from events where subject_type = 'node' and subject_id = %s"
                 " order by created_at desc limit 1", (d["id"],))
    assert "K-Once" in olay["body"] and "K-Sonra" in olay["body"]


def test_tasima_gecmise_yazilir(client):
    a = service.dugum_ekle("K-A", "Bölüm")
    b = service.dugum_ekle("K-B", "Bölüm")
    cocuk = service.dugum_ekle("K-Cocuk", "Adım", parent_id=a["id"])
    service.dugum_tasi(cocuk["id"], b["id"], tasiyan=kisi("Efe")["id"])
    olay = db.q1("select body from events where subject_type = 'node' and subject_id = %s"
                 " order by created_at desc limit 1", (cocuk["id"],))
    assert "taşındı" in olay["body"] and "K-B" in olay["body"]
