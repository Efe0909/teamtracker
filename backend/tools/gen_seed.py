#!/usr/bin/env python3
"""references/python/shared/seed.py (Python, v1 semasi) -> backend/seed.sql (v2 semasi).

Tohumu ELLE cevirmek hata kaynagi: testler seed'deki BASLIKLARA bakiyor
("Bütçe onayı 6 gündür bekliyor"), bir harf kaysa test yesil gorunup yanlis
sey olculur. Uretec kaynak Python'u okuyup SQL basiyor.

Donusum, spec/21-sema-v2.md'ye gore:
  items            -> records  (node -> unit_id, assignee -> owner_id, +chat_id)
  events 'message' -> messages
  events 'system'  -> activity (verb='note', detail = ozgun metin)
  her kayit/takim  -> bir chats satiri

Kullanim:  python3 tools/gen_seed.py > seed.sql
"""
import datetime
import pathlib
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[2]
src = (ROOT / "references/python/shared/seed.py").read_text().splitlines()

ns = {"datetime": datetime.datetime, "timedelta": datetime.timedelta,
      "timezone": datetime.timezone}
# ago()/day() yardimcilarindan run()'a kadar: veri bloklari.
exec("\n".join(src[11:149]), ns)                                    # noqa: S102


def q(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, datetime.datetime):
        return "timestamptz '%s'" % v.isoformat()
    return "'" + str(v).replace("'", "''") + "'"


_ids = {}


def uid(kind, key):
    """Kararli uuid: ayni tohum her kosumda AYNI kimlikleri uretsin."""
    return _ids.setdefault((kind, key),
                           str(uuid.uuid5(uuid.NAMESPACE_OID, f"{kind}:{key}")))


P = print
P("-- OTOMATIK URETILDI: tools/gen_seed.py. ELLE DUZENLEME — kaynak")
P("-- shared/seed.py (Python tarafi). VAROLAN VERIYI SILER.\n")
P("truncate users, nodes, teams, team_members, team_nodes, pillars, chats, records,")
P("         record_participants, actions, cards, messages, activity")
P("  restart identity cascade;\n")

P("-- === kullanicilar ===")
for i, (key, email, name, color, admin, _a, _s) in enumerate(ns["USERS"]):
    P(f"insert into users (id,email,name,color,is_admin,created_at) values "
      f"({q(uid('u', key))},{q(email)},{q(name)},{q(color)},{q(bool(admin))},"
      f"now() - interval '{10 - i} day');")

P("\n-- === agac ===")
for i, (key, parent, name, ntype) in enumerate(ns["NODES"]):
    P(f"insert into nodes (id,parent_id,name,node_type,sort_order) values "
      f"({q(uid('n', key))},{q(uid('n', parent)) if parent else 'null'},"
      f"{q(name)},{q(ntype)},{i});")

# users.scope_node_id DUSTU (yetki dort katman, spec §11). Dal izni artik
# user_node_scopes: COK satir + alt agac mirasi, tek dugum degil.
P("\n-- === dal izinleri (v1: users.scope_node_id) ===")
_by_name = {n[2]: n[0] for n in ns["NODES"]}
for key, _e, _n, _c, admin, _a, scope in ns["USERS"]:
    if not scope or admin:
        continue                      # admin zaten her daldan gecer
    P(f"insert into user_node_scopes (user_id,node_id) values "
      f"({q(uid('u', key))},{q(uid('n', _by_name[scope]))});")
    # Dal izninin ise yaramasi icin `edit_nodes` kapsami da gerekli.
    P(f"insert into user_scopes (user_id,scope) values ({q(uid('u', key))},'edit_nodes');")

P("\n-- === takimlar (her birine bir chats satiri) ===")
for key, name, desc, color in ns["TEAMS"]:
    P(f"insert into chats (id) values ({q(uid('c-team', key))});")
    P(f"insert into teams (id,name,description,chat_id,color) values "
      f"({q(uid('t', key))},{q(name)},{q(desc)},{q(uid('c-team', key))},{q(color)});")
for team, user, role in ns["TEAM_MEMBERS"]:
    P(f"insert into team_members (team_id,user_id,role) values "
      f"({q(uid('t', team))},{q(uid('u', user))},{q(role)});")

# spec/22: takim <-> agac N:M ve pillar'lar v1 tohumunda YOKTU; burada sabit.
P("\n-- === takim <-> agac baglari (team_nodes, spec/22) ===")
_team_by_name = {t[1]: t[0] for t in ns["TEAMS"]}
for team_name, node_name in [("Maliye", "Bütçe Onayı"), ("Satın Alım", "Tedarikçi Seçimi"),
                             ("Satın Alım", "Sevkiyat & Teslim"),
                             ("Tasarım", "İletişim & Tanıtım")]:
    P(f"insert into team_nodes (team_id,node_id) values "
      f"({q(uid('t', _team_by_name[team_name]))},{q(uid('n', _by_name[node_name]))});")

P("\n-- === pillar'lar (her birinin OZEL takimi + sohbeti) ===")
PILLARS = [("guv", "Güvenlik", "İş güvenliği pillar'ı.", "#d13350", 0,
            [("deniz", "lead"), ("selin", "member")]),
           ("kal", "Kalite", "Kalite pillar'ı.", "#2c74ad", 1,
            [("efe", "lead"), ("deniz", "mentor")])]
for key, name, desc, color, order, _m in PILLARS:
    P(f"insert into chats (id) values ({q(uid('c-team', 'p-' + key))});")
    P(f"insert into teams (id,name,description,chat_id,color) values "
      f"({q(uid('t', 'p-' + key))},{q(name)},{q(desc)},{q(uid('c-team', 'p-' + key))},{q(color)});")
    P(f"insert into pillars (id,name,description,color,team_id,sort_order) values "
      f"({q(uid('p', key))},{q(name)},{q(desc)},{q(color)},{q(uid('t', 'p-' + key))},{order});")
for key, _n, _d, _c, _o, members in PILLARS:
    for user, role in members:
        P(f"insert into team_members (team_id,user_id,role) values "
          f"({q(uid('t', 'p-' + key))},{q(uid('u', user))},{q(role)});")

P("\n-- === kayitlar ===")
P("-- records.chat_id NOT NULL: sohbet kayitla AYNI islemde dogar.")
for it in ns["ITEMS"]:
    k = it["key"]
    P(f"insert into chats (id) values ({q(uid('c-rec', k))});")
    P(f"insert into records (id,unit_id,team_id,chat_id,kind,title,description,"
      f"status,priority,owner_id,created_by,due_date,created_at,updated_at) values ("
      f"{q(uid('r', k))},{q(uid('n', it['node']))},"
      f"{q(uid('t', it['team'])) if it.get('team') else 'null'},{q(uid('c-rec', k))},"
      f"{q(it['kind'])},{q(it['title'])},{q(it['description'])},{q(it['status'])},"
      f"{q(it['priority'])},"
      f"{q(uid('u', it['assignee'])) if it.get('assignee') else 'null'},"
      f"{q(uid('u', it['created_by']))},"
      f"{('date ' + q(it['due'])) if it.get('due') else 'null'},"
      f"{q(it['created'])},{q(it['updated'])});")
    for p in it.get("parts", []):
        P(f"insert into record_participants (record_id,user_id) values "
          f"({q(uid('r', k))},{q(uid('u', p))});")

P("\n-- === kayit <-> pillar (ortogonal) ===")
_pillar_of = {"Sevkiyat tarihi etkinlikten sonraya düşüyor": "guv",
              "Kapak Ünitesi — tekrar eden kayıp": "kal",
              "Tedarikçi teklifleri karşılaştırılamıyor": "kal"}
for it in ns["ITEMS"]:
    if it["title"] in _pillar_of:
        P(f"update records set pillar_id = {q(uid('p', _pillar_of[it['title']]))} "
          f"where id = {q(uid('r', it['key']))};")

P("\n-- === eylemler ===")
for rec, title, owner, status, due, by, created in ns["ACTIONS"]:
    P(f"insert into actions (record_id,title,owner_id,created_by,status,due_date,"
      f"created_at) values ({q(uid('r', rec))},{q(title)},"
      f"{q(uid('u', owner)) if owner else 'null'},{q(uid('u', by))},{q(status)},"
      f"{('date ' + q(due)) if due else 'null'},{q(created)});")

P("\n-- === sohbet ve gunluk ===")
P("-- events BOLUNDU: konusma -> messages, denetim -> activity (spec §5, §6).")
_titles = {it["key"]: it["title"] for it in ns["ITEMS"]}
_teams = {t[0]: t[1] for t in ns["TEAMS"]}


def emit_event(chat, author, etype, body, created, subject):
    a = q(uid("u", author)) if author else "null"
    if etype == "message":
        P(f"insert into messages (chat_id,author_id,body,created_at) values "
          f"({chat},{a},{q(body)},{q(created)});")
    else:
        P(f"insert into activity (chat_id,actor_id,verb,subject_label,detail,"
          f"created_at) values ({chat},{a},'note',{q(subject)},{q(body)},{q(created)});")


for rec, etype, author, body, created in ns["EVENTS"]:
    emit_event(q(uid("c-rec", rec)), author, etype, body, created, _titles[rec])
for team, etype, author, body, created in ns["TEAM_EVENTS"]:
    emit_event(q(uid("c-team", team)), author, etype, body, created, _teams[team])
