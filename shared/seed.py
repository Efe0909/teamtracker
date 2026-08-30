"""Tohum veri — spec/referans/layout-a.html'deki ornek agac, kartlar ve akis.

Calistir: .venv/bin/python -m shared.seed   (varolan ekiptakip.db silinir)
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from . import db


def ago(days: float = 0, hours: float = 0, minutes: float = 0) -> str:
    """Tohum zamanlari 'simdi'ye gore uretilir — gruplama (Bugun/Bu hafta) anlamli kalsin."""
    t = datetime.now(timezone.utc) - timedelta(days=days, hours=hours, minutes=minutes)
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")

USERS = [
    # id anahtari sadece tohumda okunakli olsun diye; gercek id uuid4().hex
    ("efe",   "efe@ekiptakip.local",      "Efe",   "#5b8cff", 0, 1, "Malzeme Temini"),
    ("selin", "selin@ekiptakip.local",    "Selin", "#e5484d", 1, 1, None),
    ("deniz", "deniz@ekiptakip.local",    "Deniz", "#d99a2b", 0, 0, "Üretim Hattı A"),
]

TEAMS = [
    # (anahtar, ad, aciklama, renk)
    ("tasarim",   "Tasarım",   "Görsel üretim: afiş, sosyal medya, sahne tasarımı.", "#8e6bff"),
    ("maliye",    "Maliye",    "Bütçe, onay akışları ve ödemeler.",                  "#1c8a5b"),
    ("satinalim", "Satın Alım", "Tedarikçi seçimi, sözleşme ve sevkiyat takibi.",    "#b4501a"),
]

TEAM_MEMBERS = [
    # (takim, kullanici, rol)
    ("tasarim",   "efe",   "lider"),
    ("tasarim",   "selin", "mentor"),
    ("maliye",    "selin", "lider"),
    ("satinalim", "deniz", "uye"),
    ("satinalim", "efe",   "uye"),
]

NODES = [
    # (anahtar, ust anahtar, ad, tur)
    ("bayi",     None,     "Yıllık Bayi Toplantısı 2026", "Etkinlik"),
    ("malzeme",  "bayi",   "Malzeme Temini",              "Kazanım"),
    ("butce",    "malzeme", "Bütçe Onayı",                "Adım"),
    ("tedarik",  "malzeme", "Tedarikçi Seçimi",           "Adım"),
    ("sevkiyat", "malzeme", "Sevkiyat & Teslim",          "Adım"),
    ("mekan",    "bayi",   "Mekan & Lojistik",            "Kazanım"),
    ("salon",    "mekan",  "Salon Sözleşmesi",            "Adım"),
    ("ulasim",   "mekan",  "Ulaşım & Konaklama",          "Adım"),
    ("iletisim", "bayi",   "İletişim & Tanıtım",          "Kazanım"),
    ("hatta",    None,     "Üretim Hattı A",              "Hat"),
    ("dolum",    "hatta",  "Dolum Makinesi",              "Makine/Kol"),
    ("kapak",    "dolum",  "Kapak Ünitesi",               "Ünite"),
    ("etiket",   "dolum",  "Etiketleme Ünitesi",          "Ünite"),
]

ITEMS = [
    dict(key="butce_onay", node="butce", kind="hata", team="maliye",
         title="Bütçe onayı 6 gündür bekliyor",
         description="Finans departmanı onay vermeden tedarikçi ile sözleşme "
                     "imzalanamıyor. Zincirin tamamı bekliyor.",
         status="acik", priority="kritik", assignee="deniz", created_by="selin",
         due="2026-09-04", dms="DH", pillar="SN", parts=["deniz", "selin", "efe"],
         created=ago(days=12), updated=ago(minutes=20)),
    dict(key="sevkiyat_tarih", node="sevkiyat", kind="hata", team="satinalim",
         title="Sevkiyat tarihi etkinlikten sonraya düşüyor",
         description="Tedarikçi teslim tarihi 3 Eylül; etkinlik 28 Ağustos.",
         status="devam", priority="kritik", assignee="efe", created_by="efe",
         due="2026-09-10", dms=None, pillar="SN", parts=["efe", "selin"],
         created=ago(days=11), updated=ago(hours=3)),
    dict(key="kapak_kayip", node="kapak", kind="gorev", team=None,
         title="Kapak Ünitesi — tekrar eden kayıp",
         description="3 DMS kaydından açıldı. Tekrar eden duruş, LE'ye taşınması "
                     "değerlendiriliyor.",
         status="beklemede", priority="yuksek", assignee="deniz", created_by="selin",
         due=None, dms="LE", pillar=None, parts=["deniz"],
         created=ago(days=8), updated=ago(hours=5)),
    dict(key="vekalet", node="butce", kind="gorev", team="maliye",
         title="Onay akışına vekalet mekanizması ekle",
         description="CFO izindeyken onay zinciri duruyor; vekalet tanımı gerekiyor.",
         status="devam", priority="orta", assignee="efe", created_by="selin",
         due=None, dms="UPS", pillar=None, parts=["efe", "selin"],
         created=ago(days=6), updated=ago(days=1, hours=2)),
    dict(key="teklif", node="tedarik", kind="hata", team="satinalim",
         title="Tedarikçi teklifleri karşılaştırılamıyor",
         description="Üç teklif farklı formatta geldi; kıyas tablosu çıkarılamıyor.",
         status="acik", priority="orta", assignee="efe", created_by="efe",
         due=None, dms="IPS", pillar=None, parts=["efe"],
         created=ago(days=7), updated=ago(days=2)),
]

def gun(delta: int) -> str:
    """Bugune gore tarih (YYYY-AA-GG) — eylem son tarihleri icin."""
    return (datetime.now(timezone.utc).date() + timedelta(days=delta)).isoformat()


ACTIONS = [
    # (kayit, baslik, atanan, durum, son tarih, acan, olusturma)
    ("butce_onay", "CFO vekalet onayını IT üzerinden tamamlat",
     "deniz", "acik", gun(2), "selin", ago(days=11)),
    ("butce_onay", "Tedarikçiden fiyat kilidi uzatması iste",
     "efe", "devam", gun(-1), "selin", ago(days=10)),              # son tarihi gecti
    ("teklif", "Teklifleri tek şablona geçir",
     "efe", "kapandi", None, "efe", ago(days=6)),
    ("sevkiyat_tarih", "Alternatif kargo firmalarından süre al",
     None, "acik", gun(4), "efe", ago(days=2)),                    # havuzda, ustlenen yok
]

EVENTS = [
    ("butce_onay", "sistem", "selin", "Selin bu hatayı açtı ve Deniz'e atadı", ago(days=12)),
    ("butce_onay", "mesaj", "selin",
     "Deniz, finanstan dönüş var mı? Tedarikçi fiyat kilidi cuma bitiyor.", ago(days=12, minutes=-8)),
    ("butce_onay", "mesaj", "deniz",
     "CFO izinde, vekaleten onay için IT'den yetki devri istedim.", ago(days=11, hours=-3)),
    ("butce_onay", "sistem", None, "Durum \"Açık\" olarak kaldı — 3 gündür hareket yok",
     ago(days=9)),
    ("butce_onay", "mesaj", "efe",
     "Bu bir DH kaydı ama üçüncü tekrar. Kapak Ünitesi'ndeki gibi LE'ye taşıyalım mı?",
     ago(minutes=20)),
    ("sevkiyat_tarih", "sistem", "efe", "Efe bu hatayı açtı", ago(days=11)),
    ("sevkiyat_tarih", "mesaj", "efe", "Bu aslında bütçe onayının türevi; zinciri o tutuyor.",
     ago(hours=3)),
    ("kapak_kayip", "sistem", "selin", "Selin bu görevi açtı ve Deniz'e atadı",
     ago(days=8)),
    ("kapak_kayip", "mesaj", "deniz", "3 DMS kaydından açıldı, kök neden analizi bekliyor.",
     ago(hours=5)),
    ("vekalet", "mesaj", "selin", "Standart şablon hazırlıyorum.", ago(days=1, hours=2)),
    ("teklif", "mesaj", "efe", "Üç teklif farklı formatta geldi.", ago(days=2)),
]


def run() -> None:
    if db.DB_PATH.exists():
        db.DB_PATH.unlink()
    db.init()
    conn = db.connect()
    now = db.now()

    uid = {k: db.new_id() for k, *_ in USERS}
    nid = {k: db.new_id() for k, *_ in NODES}
    tid = {k: db.new_id() for k, *_ in TEAMS}
    iid = {i["key"]: db.new_id() for i in ITEMS}

    for key, email, name, color, admin, editor, scope_name in USERS:
        scope = next((nid[k] for k, _p, n, _t in NODES if n == scope_name), None)
        conn.execute(
            "insert into users (id,email,name,color,is_admin,is_editor,scope_node_id,"
            "created_at,is_active) values (?,?,?,?,?,?,?,?,1)",
            (uid[key], email, name, color, admin, editor, scope, now))

    for order, (key, parent, name, ntype) in enumerate(NODES):
        conn.execute(
            "insert into nodes (id,parent_id,name,node_type,sort_order,created_by,created_at)"
            " values (?,?,?,?,?,?,?)",
            (nid[key], nid[parent] if parent else None, name, ntype, order, uid["selin"], now))

    for key, name, desc, color in TEAMS:
        conn.execute(
            "insert into teams (id,name,description,node_id,color,created_at)"
            " values (?,?,?,null,?,?)", (tid[key], name, desc, color, now))
    for team, member, role in TEAM_MEMBERS:
        conn.execute(
            "insert into team_members (team_id,user_id,role,added_at) values (?,?,?,?)",
            (tid[team], uid[member], role, now))

    for it in ITEMS:
        conn.execute(
            "insert into items (id,node_id,kind,title,description,status,priority,team_id,"
            "assignee_id,created_by,due_date,dms,pillar,escalated,created_at,updated_at)"
            " values (?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)",
            (iid[it["key"]], nid[it["node"]], it["kind"], it["title"], it["description"],
             it["status"], it["priority"], tid[it["team"]] if it["team"] else None,
             uid[it["assignee"]], uid[it["created_by"]],
             it["due"], it["dms"], it["pillar"], it["created"], it["updated"]))
        for p in it["parts"]:
            conn.execute(
                "insert into item_participants (item_id,user_id,added_by,added_at)"
                " values (?,?,?,?)",
                (iid[it["key"]], uid[p], uid[it["created_by"]], it["created"]))

    for item_key, etype, author, body, created in EVENTS:
        conn.execute(
            "insert into events (id,subject_type,subject_id,event_type,author_id,body,created_at)"
            " values (?,'item',?,?,?,?,?)",
            (db.new_id(), iid[item_key], etype, uid[author] if author else None, body, created))

    for item_key, title, assignee, status, due, creator, created in ACTIONS:
        biten = status in ("kapandi", "iptal")
        conn.execute(
            "insert into actions (id,item_id,title,assignee_id,status,due_date,"
            "created_by,resolved_by,resolved_at,created_at) values (?,?,?,?,?,?,?,?,?,?)",
            (db.new_id(), iid[item_key], title, uid[assignee] if assignee else None,
             status, due, uid[creator], uid[assignee] if biten else None,
             created if biten else None, created))

    conn.commit()
    print(f"tohumlandi: {len(USERS)} kullanici, {len(TEAMS)} takim, {len(NODES)} dugum, "
          f"{len(ITEMS)} kayit, {len(ACTIONS)} eylem, {len(EVENTS)} olay -> {db.DB_PATH.name}")


if __name__ == "__main__":
    run()
