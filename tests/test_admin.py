"""Yonetim Paneli rotalari (spec/71-yonetim-paneli.md). shared/scope.py ve
shared/users.py'nin kendi testleri (test_roles.py) mantigi test ediyor; burada
HTTP katmani: yetki kontrolu ucun ILK SATIRINDA mi (KNOW-99), panel gorunmeyen
yuzun arkasindaki her ucu ayrica kapatiyor mu.
"""
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from shared import db, scope  # noqa: E402


@pytest.fixture(scope="module")
def client():
    from conftest import setup_database  # noqa: E402
    setup_database("admin")
    import app  # noqa: E402
    with TestClient(app.app) as c:
        from conftest import csrf_attach  # noqa: E402
        csrf_attach(c)
        yield c


@pytest.fixture(autouse=True)
def clean(client):
    yield
    db.x("delete from user_roles")
    db.x("delete from role_scopes")
    db.x("delete from roles")
    db.x("delete from user_scopes")
    db.x("delete from users where email like %s", ("%@ornek.com",))


def uid(name):
    return str(db.q1("select id from users where name = %s", (name,))["id"])


def as_(client, name):
    client.cookies.set("uid", uid(name))


# --- erisim ---------------------------------------------------------------


def test_yetkisiz_kullanici_403_alir(client):
    as_(client, "Deniz")   # ne admin ne manage_users
    r = client.get("/admin")
    assert r.status_code == 403


def test_admin_admin_panelini_gorur(client):
    as_(client, "Selin")
    assert client.get("/admin").status_code == 200


def test_manage_users_scope_u_panele_erisir(client):
    scope.grant_scope(uid("Deniz"), "manage_users")
    as_(client, "Deniz")
    assert client.get("/admin").status_code == 200


# --- kullanici ekleme/kapatma ----------------------------------------------


def test_kullanici_ekle_ayni_mantigi_cagirir(client):
    as_(client, "Selin")
    r = client.post("/users", data={"email": "yeni@ornek.com", "name": "Yeni"})
    assert r.status_code == 200
    assert db.q1("select * from users where email = 'yeni@ornek.com'") is not None


def test_manage_users_olmayan_kullanici_ekleyemez(client):
    as_(client, "Deniz")
    r = client.post("/users", data={"email": "engelli@ornek.com", "name": "X"})
    assert r.status_code == 403
    assert db.q1("select * from users where email = 'engelli@ornek.com'") is None


def test_ac_kapat_ucu(client):
    as_(client, "Selin")
    target = uid("Deniz")
    r = client.patch(f"/users/{target}/active")
    assert r.status_code == 200
    assert db.q1("select is_active from users where id = %s", (target,))["is_active"] is False
    client.patch(f"/users/{target}/active")   # geri ac, sonraki testleri bozma
    assert db.q1("select is_active from users where id = %s", (target,))["is_active"] is True


# --- kilitlenme: HTTP katmaninda -------------------------------------------


def test_kendi_adminligini_http_ile_kapatamaz(client):
    as_(client, "Selin")
    r = client.patch(f"/users/{uid('Selin')}/admin")
    assert r.status_code == 400
    assert db.q1("select is_admin from users where id = %s", (uid("Selin"),))["is_admin"]


def test_admin_olmayan_admin_bayragini_degistiremez(client):
    as_(client, "Deniz")
    r = client.patch(f"/users/{uid('Efe')}/admin")
    assert r.status_code == 403


# --- scope ver/al -----------------------------------------------------------


def test_scope_ver_al_ucu(client):
    as_(client, "Selin")
    target = uid("Deniz")
    r = client.post(f"/users/{target}/scopes", data={"scope": "edit_nodes"})
    assert r.status_code == 200
    assert "edit_nodes" in scope.active_scopes({"id": target, "is_admin": False})
    r = client.delete(f"/users/{target}/scopes/edit_nodes")
    assert r.status_code == 200
    assert "edit_nodes" not in scope.active_scopes({"id": target, "is_admin": False})


def test_gecersiz_scope_reddedilir(client):
    as_(client, "Selin")
    r = client.post(f"/users/{uid('Deniz')}/scopes", data={"scope": "uydurma"})
    assert r.status_code == 400


# --- roller: yalniz admin ---------------------------------------------------


def test_manage_users_scope_u_rol_olusturamaz(client):
    scope.grant_scope(uid("Deniz"), "manage_users")
    as_(client, "Deniz")
    r = client.post("/roles", data={"name": "Kaçak", "scope": ["edit_nodes"]})
    assert r.status_code == 403
    assert db.q1("select * from roles where name = 'Kaçak'") is None


def test_admin_rol_olusturur_atar_siler(client):
    as_(client, "Selin")
    r = client.post("/roles", data={"name": "Koordinatör", "scope": ["edit_nodes", "manage_teams"]})
    assert r.status_code == 200
    role = db.q1("select * from roles where name = 'Koordinatör'")
    assert role is not None

    target = uid("Deniz")
    r = client.post(f"/users/{target}/roles", data={"role_id": str(role["id"])})
    assert r.status_code == 200
    assert {"edit_nodes", "manage_teams"} <= scope.active_scopes({"id": target, "is_admin": False})

    r = client.delete(f"/roles/{role['id']}")
    assert r.status_code == 200
    assert scope.active_scopes({"id": target, "is_admin": False}) == set()


def test_manage_users_scope_u_rolu_kullaniciya_atayabilir(client):
    """Verme/alma manage_users'a acik; oluşturma/silme degil (spec §4)."""
    role_id = scope.create_role("Rol X", {"edit_nodes"})
    scope.grant_scope(uid("Deniz"), "manage_users")
    as_(client, "Deniz")
    r = client.post(f"/users/{uid('Efe')}/roles", data={"role_id": str(role_id)})
    assert r.status_code == 200
    r = client.delete(f"/users/{uid('Efe')}/roles/{role_id}")
    assert r.status_code == 200
