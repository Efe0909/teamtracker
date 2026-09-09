"""Roller: bir scope demeti, sığ (goc 008, spec/71-yonetim-paneli.md §5).

Ana kural test edilen: flatten YOK. active_scopes() rol scope'larini OKUMA
ANINDA birlestirir, hicbir yerde materialize etmez — bu yuzden rol
düzenlemesi mevcut sahiplerine otomatik yansir, rol silmek yalniz o roldeki
scope'lari alir, ayrica tek tek verilmis olani ETKILEMEZ.
"""
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from shared import db, scope, users  # noqa: E402


@pytest.fixture(scope="module")
def client():
    from conftest import setup_database  # noqa: E402
    setup_database("roles")
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


def person(name):
    return db.q1("select * from users where name = %s", (name,))


# --- rol = scope demeti, sığ ------------------------------------------


def test_rol_tutmak_scope_verir(client):
    u = person("Deniz")
    rid = scope.create_role("Koordinatör", {"edit_nodes", "manage_teams"})
    scope.assign_role(u["id"], rid)
    assert scope.active_scopes(u) == {"edit_nodes", "manage_teams"}


def test_rolun_tum_scopelarina_sahip_olmak_rolu_tutmak_degildir(client):
    """Kullanici ayni scope'lari tek tek almis olsa da user_roles'ta
    satiri yoksa rolu TUTMUYOR — iki ayri gercek."""
    u = person("Deniz")
    rid = scope.create_role("Koordinatör", {"edit_nodes"})
    scope.grant_scope(u["id"], "edit_nodes")
    assert scope.active_scopes(u) == {"edit_nodes"}
    assert scope.user_roles(u["id"]) == []          # rolu tutmuyor
    assert rid not in {r["id"] for r in scope.user_roles(u["id"])}


def test_rol_duzenlemesi_mevcut_sahiplerine_yansir(client):
    """Flatten yok: role_scopes'a scope eklemek, o rolu tutan herkese
    AYRI bir 'yayinla' adimi olmadan yansir — çünkü hiçbir yerde
    materialize edilmiyor, active_scopes okuma aninda birleştiriyor."""
    u = person("Deniz")
    rid = scope.create_role("Koordinatör", {"edit_nodes"})
    scope.assign_role(u["id"], rid)
    assert scope.active_scopes(u) == {"edit_nodes"}

    scope.set_role_scopes(rid, {"edit_nodes", "manage_teams"})
    assert scope.active_scopes(u) == {"edit_nodes", "manage_teams"}

    scope.set_role_scopes(rid, {"manage_teams"})
    assert scope.active_scopes(u) == {"manage_teams"}


def test_rol_silinince_tuttugu_scope_biter_ama_dogrudan_verilen_kalir(client):
    """Ayşe her iki yoldan da manage_teams alır: rolden VE doğrudan. Rol
    silinince rolden gelen gider, doğrudan verilen KALIR — iki kaynak
    birbirinden bağımsız (spec §5 madde 1)."""
    u = person("Deniz")
    rid = scope.create_role("Koordinatör", {"edit_nodes", "manage_teams"})
    scope.assign_role(u["id"], rid)
    scope.grant_scope(u["id"], "manage_teams")      # AYRICA doğrudan da verildi
    assert scope.active_scopes(u) == {"edit_nodes", "manage_teams"}

    scope.delete_role(rid)
    assert scope.active_scopes(u) == {"manage_teams"}   # doğrudan olan durur


def test_iki_rol_ortusen_scope_paylasir(client):
    """İki rolde de edit_nodes varsa, birini kaldırmak diğerinden geleni
    silmez — union hâlâ doğru sonucu verir."""
    u = person("Deniz")
    a = scope.create_role("A", {"edit_nodes", "manage_teams"})
    b = scope.create_role("B", {"edit_nodes"})
    scope.assign_role(u["id"], a)
    scope.assign_role(u["id"], b)
    scope.unassign_role(u["id"], b)
    assert scope.active_scopes(u) == {"edit_nodes", "manage_teams"}   # hâlâ A'dan geliyor


def test_gecersiz_scope_ile_rol_olusturulamaz(client):
    with pytest.raises(ValueError):
        scope.create_role("Kötü", {"uydurma"})


def test_list_roles_uye_sayisini_dogru_sayar(client):
    u1, u2 = person("Deniz"), person("Selin")
    rid = scope.create_role("Koordinatör", {"edit_nodes"})
    scope.assign_role(u1["id"], rid)
    scope.assign_role(u2["id"], rid)
    row = next(r for r in scope.list_roles() if r["id"] == rid)
    assert row["member_count"] == 2
    assert row["scopes"] == {"edit_nodes"}


def test_scope_sources_kaynagini_ayirir(client):
    u = person("Deniz")
    rid = scope.create_role("Koordinatör", {"edit_nodes"})
    scope.assign_role(u["id"], rid)
    scope.grant_scope(u["id"], "manage_teams")
    src = scope.scope_sources(u)
    assert src["edit_nodes"] == ["Koordinatör"]
    assert src["manage_teams"] == ["direct"]


# --- kilitlenme koruması (shared/users.py) -----------------------------


def test_kendi_adminligini_kapatamaz(client):
    selin = person("Selin")   # tohumda admin
    with pytest.raises(users.UserError):
        users.set_admin(selin["id"], False, actor_id=selin["id"])
    assert db.q1("select is_admin from users where id = %s", (selin["id"],))["is_admin"]


def test_son_admin_demote_edilemez(client):
    selin = person("Selin")
    deniz = person("Deniz")
    # Deniz'i baska bir aktorden admin yapmiyoruz — Selin tek admin kalsin.
    with pytest.raises(users.UserError):
        users.set_admin(selin["id"], False, actor_id=deniz["id"])
    assert db.q1("select is_admin from users where id = %s", (selin["id"],))["is_admin"]


def test_ikinci_admin_varken_demote_edilebilir(client):
    selin = person("Selin")
    deniz = person("Deniz")
    users.set_admin(deniz["id"], True, actor_id=selin["id"])
    users.set_admin(selin["id"], False, actor_id=deniz["id"])
    assert not db.q1("select is_admin from users where id = %s", (selin["id"],))["is_admin"]
    # temizle
    users.set_admin(selin["id"], True, actor_id=deniz["id"])
    users.set_admin(deniz["id"], False, actor_id=selin["id"])


def test_son_aktif_admin_kapatilamaz(client):
    selin = person("Selin")
    with pytest.raises(users.UserError):
        users.set_active(selin["id"], False)
    assert db.q1("select is_active from users where id = %s", (selin["id"],))["is_active"]
