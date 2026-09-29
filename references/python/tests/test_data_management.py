"""Veri yonetimi: dugum ekle / adlandir / tasi / sil.

Agac SUREC BELLEGINDE (shared/tree.py) ve yalnizca acilista kuruluyordu; her
degisiklikten sonra yeniden kurulmazsa ekran bayat kalir. Testlerin yarisi tam
bunu sabitliyor: veritabani degisti mi YETMEZ, TREE de degismis olmali.
"""
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from shared import db, nodes, service  # noqa: E402


@pytest.fixture(scope="module")
def client():
    from conftest import setup_database  # noqa: E402
    setup_database("datamanagement")
    import app  # noqa: E402
    with TestClient(app.app) as c:
        from conftest import csrf_attach  # noqa: E402
        csrf_attach(c)
        yield c


@pytest.fixture(autouse=True)
def _tree(client):
    """Her test tohum agaciyla baslasin."""
    yield
    # Desen PARAMETRE olarak gecer: satir ici yazilirsa psycopg '%'' yi kendi
    # yer tutucusu sanip "only '%s', '%b', '%t' are allowed" der.
    db.x("delete from nodes where name like %s", ("T-%",))
    service.rebuild_tree()


def _switch(client, user_id):
    """Kullanici degistir VE CSRF token'ini tazele — switch oturumu
    temizledigi icin eski token gecersiz kalir ve 403'u YETKI degil CSRF
    uretir."""
    from conftest import csrf_attach
    client.post(f"/switch/{user_id}", follow_redirects=False)
    csrf_attach(client)


def root_count():
    return len(service.TREE.roots)


# --- ekleme ---------------------------------------------------------------


def test_kok_dugum_eklenir(client):
    before = root_count()
    row = service.add_node("T-Maliye", "generic")
    assert row is not None
    assert row["parent_id"] is None
    # Veritabani DEGIL, bellekteki agac da bilmeli:
    assert root_count() == before + 1
    assert row["id"] in service.TREE.nodes
    assert row["id"] in service.TREE.roots


def test_alt_dugum_eklenir(client):
    parent = service.add_node("T-Ust", "generic")
    child = service.add_node("T-Alt", "step", parent_id=parent["id"])
    assert service.TREE.parent[child["id"]] == parent["id"]
    assert child["id"] in service.TREE.children[parent["id"]]
    assert service.TREE.depth[child["id"]] == service.TREE.depth[parent["id"]] + 1


def test_aciklama_kaydedilir(client):
    d = service.add_node("T-Aciklamali", "generic", description="  Bütçe ve ödemeler  ")
    assert d["description"] == "Bütçe ve ödemeler"      # kirpilir


def test_adsiz_dugum_reddedilir(client):
    assert service.add_node("   ", "generic") is None
    assert service.add_node("T-X", "  ") is None


def test_olmayan_ustun_altina_eklenmez(client):
    assert service.add_node("T-Yetim", "step",
                            parent_id="00000000-0000-0000-0000-000000000000") is None


def test_kardesler_sona_eklenir(client):
    parent = service.add_node("T-Sira", "generic")
    a = service.add_node("T-Bir", "step", parent_id=parent["id"])
    b = service.add_node("T-Iki", "step", parent_id=parent["id"])
    assert b["sort_order"] > a["sort_order"]
    assert service.TREE.children[parent["id"]] == [a["id"], b["id"]]


# --- guncelleme -----------------------------------------------------------


def test_ad_degisir_ve_agac_taze_kalir(client):
    d = service.add_node("T-Eski", "generic")
    assert service.update_node(d["id"], name="T-Yeni")
    assert service.TREE.name(d["id"]) == "T-Yeni"


def test_verilmeyen_alan_degismez(client):
    d = service.add_node("T-Kismi", "generic", description="kalsin")
    service.update_node(d["id"], name="T-Kismi2")
    row = db.q1("select * from nodes where id = %s", (d["id"],))
    assert row["description"] == "kalsin"
    assert row["node_type"] == "generic"


def test_bos_aciklama_temizler(client):
    d = service.add_node("T-Temiz", "generic", description="silinecek")
    service.update_node(d["id"], description="")
    assert db.q1("select description from nodes where id = %s", (d["id"],))["description"] is None


def test_bos_ad_reddedilir(client):
    d = service.add_node("T-Kalici", "generic")
    assert service.update_node(d["id"], name="  ") is False
    assert service.TREE.name(d["id"]) == "T-Kalici"


# --- tasima ---------------------------------------------------------------


def test_dugum_tasinir(client):
    a = service.add_node("T-A", "generic")
    b = service.add_node("T-B", "generic")
    child = service.add_node("T-Cocuk", "step", parent_id=a["id"])

    assert service.move_node(child["id"], b["id"])
    assert service.TREE.parent[child["id"]] == b["id"]
    assert child["id"] not in service.TREE.children[a["id"]]


def test_koke_cikarilir(client):
    parent = service.add_node("T-Ust2", "generic")
    child = service.add_node("T-Cocuk2", "step", parent_id=parent["id"])
    assert service.move_node(child["id"], None)
    assert child["id"] in service.TREE.roots


def test_kendi_altina_tasinamaz(client):
    """DONGU KORUMASI. Olmasaydi agac halkaya doner, Euler turu sonsuz donerdi."""
    parent = service.add_node("T-Dongu", "generic")
    child = service.add_node("T-DonguCocuk", "step", parent_id=parent["id"])
    grandchild = service.add_node("T-DonguTorun", "step", parent_id=child["id"])

    assert service.move_node(parent["id"], child["id"]) is False
    assert service.move_node(parent["id"], grandchild["id"]) is False, "torun da alt agacta"
    assert service.TREE.parent[parent["id"]] is None, "yapı bozulmamalı"


def test_kendisine_tasinamaz(client):
    d = service.add_node("T-Kendi", "generic")
    assert service.move_node(d["id"], d["id"]) is False


# --- silme ----------------------------------------------------------------


def test_alt_agac_da_silinir(client):
    parent = service.add_node("T-Sil", "generic")
    child = service.add_node("T-SilCocuk", "step", parent_id=parent["id"])

    assert service.delete_node(parent["id"])
    assert parent["id"] not in service.TREE.nodes
    assert child["id"] not in service.TREE.nodes, "cascade alt agaci da almali"


def test_kayit_sayilari_silmeden_once_gorunur(client):
    counts = nodes.counts_by_node()
    item = db.q1("select node_id from items limit 1")
    assert counts[item["node_id"]]["records"] > 0


# --- uclar ----------------------------------------------------------------


def test_sayfa_acilir(client):
    r = client.get("/outcome-tree")
    assert r.status_code == 200
    assert "Veri Yönetimi" in r.text


def test_htmx_yalnizca_agac_parcasini_doner(client):
    full = client.get("/outcome-tree").text
    fragment = client.get("/outcome-tree", headers={"HX-Request": "true"}).text
    assert fragment.lstrip().startswith("<div id=\"agac\"")
    assert "<!DOCTYPE" not in fragment
    assert len(fragment) < len(full)


def test_uctan_dugum_eklenir(client):
    r = client.post("/node", data={"name": "T-Uctan", "type": "generic", "description": "not"})
    assert r.status_code == 200
    assert "T-Uctan" in r.text
    assert db.q1("select 1 from nodes where name = %s", ("T-Uctan",)) is not None


def test_uctan_silinir(client):
    d = service.add_node("T-Silinecek", "generic")
    r = client.request("DELETE", f"/node/{d['id']}")
    assert r.status_code == 200
    assert d["id"] not in service.TREE.nodes


def test_yetkisiz_kullanici_yapiyi_degistiremez(client):
    """Editör olmayan 403 alır — panelin düğmeyi gizlemesi YETMEZ,
    kontrol ucun kendisinde (spec/70-guvenlik.md: yetki sunucuda)."""
    deniz = db.q1("select id from users where name = 'Deniz'")   # is_editor=false
    assert deniz, "tohumda yetkisiz kullanıcı olmalı"
    _switch(client, deniz["id"])
    try:
        assert client.post("/node", data={"name": "T-Yasak", "type": "X"}).status_code == 403
        assert db.q1("select 1 from nodes where name = %s", ("T-Yasak",)) is None
    finally:
        _switch(client, db.q1("select id from users where name = 'Efe'")["id"])


def test_yetkisiz_kullanici_sayfayi_gorur_ama_form_yok(client):
    """Yapıyı okumak herkese açık; değiştirmek değil."""
    deniz = db.q1("select id from users where name = 'Deniz'")
    _switch(client, deniz["id"])
    try:
        text = client.get("/outcome-tree").text
        assert "Veri Yönetimi" in text
        assert 'hx-post="/node"' not in text
        assert "editör yetkisi gerekiyor" in text
    finally:
        _switch(client, db.q1("select id from users where name = 'Efe'")["id"])


# --- tur dogrulama (spec/72 §3) -------------------------------------------


def test_serbest_metin_tur_reddedilir(client):
    """Tur artik enum: kodun bilmedigi bir ture davranis baglanamaz."""
    assert service.add_node("T-Uydurma", "Bölüm") is None
    assert service.add_node("T-Uydurma2", "machine ") is not None   # kirpilir, gecerli


def test_tur_degistirilebilir_ama_gecersize_degil(client):
    d = service.add_node("T-Tur", "generic")
    assert service.update_node(d["id"], node_type="task")
    assert service.TREE.nodes[d["id"]].node_type == "task"
    assert service.update_node(d["id"], node_type="Departman") is False
    assert service.TREE.nodes[d["id"]].node_type == "task", "reddedilen tür yazılmamalı"


# --- yerlesim: ROOT_ONLY (spec/72 §7) -------------------------------------


def test_cell_yalnizca_kokte(client):
    parent = service.add_node("T-Kok", "generic")
    assert service.add_node("T-CellAlt", "cell", parent_id=parent["id"]) is None
    assert service.add_node("T-CellKok", "cell") is not None


def test_cell_alta_tasinamaz(client):
    cell = service.add_node("T-TasinanCell", "cell")
    hedef = service.add_node("T-Hedef", "generic")
    assert service.move_node(cell["id"], hedef["id"]) is False
    assert service.TREE.parent[cell["id"]] is None


def test_machine_HERHANGI_bir_yere_girer(client):
    """ROOT_ONLY DISINDA KURAL YOK (spec/72 §11). Tohumun kendi sekli bunu
    gerektiriyor: Üretim Hattı A (cell) > Dolum Makinesi (machine) > Kapak
    Ünitesi (machine). Şablon buna aykırı bir kural uydurursa sunucuyla
    çelişir — o yüzden kural tek yerde, nodes.ROOT_ONLY'de."""
    cell = service.add_node("T-MCell", "cell")
    m1 = service.add_node("T-M1", "machine", parent_id=cell["id"])
    assert m1 is not None
    assert service.add_node("T-M2", "machine", parent_id=m1["id"]) is not None
    step = service.add_node("T-MStep", "step", parent_id=cell["id"])
    assert step is not None, "task/step icin machine ZORUNLU degil"


def test_tur_degisiminde_yerlesim_yeniden_bakilir(client):
    parent = service.add_node("T-YUst", "generic")
    child = service.add_node("T-YAlt", "step", parent_id=parent["id"])
    assert service.update_node(child["id"], node_type="cell") is False
    assert service.TREE.nodes[child["id"]].node_type == "step"


# --- tur kilidi (spec/72 §6.3) --------------------------------------------


def test_projeksiyonu_olan_dugumun_turu_degismez(client):
    # Takim node'u projeksiyonunu KENDILIGINDEN dogurur (goc 012, spec/72 §5) —
    # eskiden bu test teams.node_id'yi elle bagliyordu, artik gerekmiyor.
    d = service.add_node("T-Kilit", "team")
    assert db.q1("select 1 from teams where node_id = %s", (d["id"],)) is not None
    assert service.update_node(d["id"], node_type="generic") is False
    assert service.TREE.nodes[d["id"]].node_type == "team"
    # Ad DEGISEBILIR: kilit yalniz ture ait — ve takim karti da yeni adi alir.
    assert service.update_node(d["id"], name="T-KilitYeni")
    assert db.q1("select name from teams where node_id = %s", (d["id"],))["name"] == "T-KilitYeni"


def test_cocugu_olan_dugumun_turu_degisir(client):
    """is_virgin kullanilsaydi bu calismazdi — yuklemler AYRI."""
    parent = service.add_node("T-CUst", "generic")
    service.add_node("T-CAlt", "step", parent_id=parent["id"])
    assert service.update_node(parent["id"], node_type="operational")


# --- pasiflestirme (spec/72 §6) -------------------------------------------


def test_pasiflestirme_silmez_geri_alinir(client):
    d = service.add_node("T-Pasif", "generic")
    assert service.set_node_active(d["id"], False)
    assert service.TREE.nodes[d["id"]].is_active is False
    assert d["id"] in service.TREE.nodes, "agacta KALIR — gecmis kayitlarin yolu cizilebilsin"
    assert service.set_node_active(d["id"], True)
    assert service.TREE.nodes[d["id"]].is_active is True


def test_pasiflik_MIRAS_KALMAZ(client):
    """Bilincli tercih: her dugum kendi bayragini tasir, ata yuruyusu yok.
    Bilinen sonucu — kapali dalin altindaki acik dugum dropdown'da kalir;
    telafisi yonetim ekraninda soluk cizim (.tpasif)."""
    parent = service.add_node("T-MUst", "generic")
    child = service.add_node("T-MAlt", "step", parent_id=parent["id"])
    service.set_node_active(parent["id"], False)
    assert service.TREE.nodes[child["id"]].is_active is True


def test_pasif_dugum_YETKI_kaybettirmez(client):
    """Pasiflestirme bir yetki islemi DEGIL: dal izinleri yerinde kalir."""
    from shared import scope as scope_mod
    u = db.q1("select id from users where name = 'Deniz'")
    parent = service.add_node("T-YPasif", "generic")
    child = service.add_node("T-YPasifAlt", "step", parent_id=parent["id"])
    scope_mod.grant_node_permission(u["id"], parent["id"])
    scope_mod.grant_scope(u["id"], "edit_nodes")
    try:
        service.set_node_active(parent["id"], False)
        assert scope_mod.authorized_on_node(db.q1("select * from users where id=%s", (u["id"],)),
                                            child["id"]) is True
    finally:
        db.x("delete from user_node_scopes where user_id = %s", (u["id"],))
        db.x("delete from user_scopes where user_id = %s", (u["id"],))


def test_pasif_dugumun_altina_eklenmez(client):
    d = service.add_node("T-PasifUst", "generic")
    service.set_node_active(d["id"], False)
    assert service.add_node("T-PasifAlt", "step", parent_id=d["id"]) is None


def test_pasiflestirme_gecmise_yazilir(client):
    d = service.add_node("T-PGecmis", "generic")
    service.set_node_active(d["id"], False)
    event = db.q1("select body from events where subject_type='node' and subject_id=%s"
                  " order by created_at desc", (d["id"],))
    assert "pasifleştirildi" in event["body"]


def test_ayni_duruma_ikinci_kez_yazilmaz(client):
    d = service.add_node("T-Idempotent", "generic")
    before = db.q1("select count(*) c from events where subject_id=%s", (d["id"],))["c"]
    assert service.set_node_active(d["id"], True)          # zaten aktif
    assert db.q1("select count(*) c from events where subject_id=%s", (d["id"],))["c"] == before


# --- uclar: pasiflestirme ve tur secimi -----------------------------------


def test_uctan_pasiflestirilir(client):
    d = service.add_node("T-UcPasif", "generic")
    r = client.post(f"/node/{d['id']}/active", data={"active": "0"})
    assert r.status_code == 200
    assert service.TREE.nodes[d["id"]].is_active is False


def test_gecersiz_tur_ucta_400(client):
    """Donus degeri YUTULMUYOR: gecersiz girdi sessizce 200 donmemeli."""
    r = client.post("/node", data={"name": "T-Uc400", "type": "Bölüm"})
    assert r.status_code == 400
    assert db.q1("select 1 from nodes where name = %s", ("T-Uc400",)) is None


def test_tur_girdisi_SELECT_olarak_cizilir(client):
    """Serbest metin girilemez — ekranda da, sunucuda da."""
    text = client.get("/outcome-tree").text
    assert '<input name="type"' not in text
    assert '<select name="type"' in text
    for key, label in nodes.NODE_TYPES.items():
        assert f'value="{key}"' in text, key
        assert label in text


def test_kilitli_dugumun_tur_secimi_disabled(client):
    d = service.add_node("T-UcKilit", "team")       # projeksiyon kendiliginden dogar
    service.rebuild_tree()
    text = client.get("/outcome-tree").text
    form = text.split(f'hx-patch="/node/{d["id"]}"', 1)[1].split("</form>", 1)[0]
    assert "disabled" in form
    # Gizli bir type girdisiyle kilidi delmeye calisma:
    assert '<input type="hidden" name="type"' not in form


def test_pasif_dugum_agacta_soluk_cizilir(client):
    """Karsiligi CSS'te OLMALI — pasiflik miras kalmadigi icin gorsel ayrim
    o kararin uzerinde anlasilan telafisi."""
    d = service.add_node("T-Soluk", "generic")
    service.set_node_active(d["id"], False)
    assert "tpasif" in client.get("/outcome-tree").text
    css = (ROOT / "sites/dashboard/static/dashboard.css").read_text(encoding="utf-8")
    assert ".tpasif" in css, "sınıf şablonda var ama CSS'te yok — pasif düğüm ayırt edilemez"


def test_pasif_dugum_yeni_kayit_formunda_cikmaz(client):
    from sites.dashboard.routes import node_options
    d = service.add_node("T-Dropdown", "generic")
    assert any(n["id"] == d["id"] for n in node_options())
    service.set_node_active(d["id"], False)
    assert not any(n["id"] == d["id"] for n in node_options())
