import pytest
from shared import db, nodes, service

@pytest.fixture(scope="module")
def setup():
    from conftest import setup_database
    setup_database("nodes")


def person(name: str):
    return db.q1("select * from users where name = %s", (name,))


def node(name: str):
    return db.q1("select * from nodes where name = %s", (name,))


def test_yeni_node_virgindir(setup):
    u = person("Deniz")
    n = service.add_node("T-Virgin", "generic", created_by=u["id"])
    assert nodes.is_virgin(n["id"])


def test_gecmis_virginligi_bozmaz(setup):
    """events tablosundaki olaylar node'u kirli yapmaz.
    Aksi halde add_node() 'node eklendi' olayi yazdigi icin hicbir node virgin olmazdi."""
    u = person("Deniz")
    n = service.add_node("T-Olayli", "generic", created_by=u["id"])
    
    # event_type='node', subject_id=n["id"]
    event = db.q1("select * from events where subject_type='node' and subject_id=%s", (n["id"],))
    assert event is not None, "add_node olay yazmis olmali"
    
    assert nodes.is_virgin(n["id"]), "olay olmasina ragmen virgin kalmali"


def test_cocugu_olan_virgin_degildir(setup):
    u = person("Deniz")
    p = service.add_node("T-Ust-V", "generic", created_by=u["id"])
    service.add_node("T-Alt-V", "step", parent_id=p["id"], created_by=u["id"])
    assert not nodes.is_virgin(p["id"])


def test_kaydi_olan_virgin_degildir(setup):
    # Tohumdan gelen 'Bütçe Onayı' dugumunun kaydi var
    n = node("Bütçe Onayı")
    assert not nodes.is_virgin(n["id"])


def test_has_projection_sadece_teams_ile_ilgilidir(setup):
    u = person("Deniz")
    # Yeni dugum, teams yok
    n = service.add_node("T-Proj", "generic", created_by=u["id"])
    assert not nodes.has_projection(n["id"])
    
    # Alt dugum ekle, is_virgin bozulur ama has_projection bozulmaz
    service.add_node("T-Proj-Cocuk", "step", parent_id=n["id"], created_by=u["id"])
    assert not nodes.is_virgin(n["id"])
    assert not nodes.has_projection(n["id"])
    
    # Teams satiri ekle
    db.x("insert into teams (id, name, node_id, color) values (%s, %s, %s, '#000000')", 
         (db.new_id(), "T-Takim", n["id"]))
    
    # Simdi projection var
    assert nodes.has_projection(n["id"])
