"""Tohum veri — spec/referans/layout-a.html'deki ornek agac, kartlar ve akis.

Calistir: .venv/bin/python -m shared.seed   (varolan ekiptakip.db silinir)
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from . import db


def ago(days: float = 0, hours: float = 0, minutes: float = 0) -> datetime:
    """Tohum zamanlari 'simdi'ye gore uretilir — gruplama (Bugun/Bu hafta) anlamli kalsin."""
    t = datetime.now(timezone.utc) - timedelta(days=days, hours=hours, minutes=minutes)
    return t

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
    """Semayi kurar (goc) ve tablolari SIFIRDAN doldurur.

    Dosya silmek yerine truncate: veritabani bir sunucuda, dosya degil.
    """
    db.gocler()
    db.calistir("truncate table actions, events, item_participants, items,"
                " team_members, teams, nodes, guvenlik_olaylari, users"
                " restart identity cascade")
    now = db.now()

    uid = {k: db.new_id() for k, *_ in USERS}
    nid = {k: db.new_id() for k, *_ in NODES}
    tid = {k: db.new_id() for k, *_ in TEAMS}
    iid = {i["key"]: db.new_id() for i in ITEMS}

    # Sira: users.scope_node_id -> nodes, nodes.created_by -> users (dongusel).
    # Once kapsamsiz yazilir, dugumlerden sonra guncellenir.
    # created_at'ler AYRI: esit zamanda "ilk kullanici" secimi belirsiz kalirdi.
    for sira, (key, email, name, color, admin, editor, _s) in enumerate(USERS):
        db.x("insert into users (id,email,name,color,is_admin,is_editor,"
             "created_at,is_active) values (%s,%s,%s,%s,%s,%s,%s,true)",
             (uid[key], email, name, color, bool(admin), bool(editor),
              now + timedelta(seconds=sira)))

    for order, (key, parent, name, ntype) in enumerate(NODES):
        db.x(
             "insert into nodes (id,parent_id,name,node_type,sort_order,created_by,created_at)"
             " values (%s,%s,%s,%s,%s,%s,%s)",
             (nid[key], nid[parent] if parent else None, name, ntype, order,
              uid["selin"], now))

    for key, _e, _n, _c, _a, _ed, scope_name in USERS:
        if scope_name:
            db.x("update users set scope_node_id = %s where id = %s",
                 (nid[next(k for k, _p, n, _t in NODES if n == scope_name)], uid[key]))

    for key, name, desc, color in TEAMS:
        db.x("insert into teams (id,name,description,node_id,color,created_at)"
             " values (%s,%s,%s,null,%s,%s)", (tid[key], name, desc, color, now))
    for team, member, role in TEAM_MEMBERS:
        db.x("insert into team_members (team_id,user_id,role,added_at) values (%s,%s,%s,%s)",
             (tid[team], uid[member], role, now))

    for it in ITEMS:
        db.x(
            "insert into items (id,node_id,kind,title,description,status,priority,team_id,"
            "assignee_id,created_by,due_date,dms,pillar,escalated,created_at,updated_at)"
             " values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,false,%s,%s)",
            (iid[it["key"]], nid[it["node"]], it["kind"], it["title"], it["description"],
             it["status"], it["priority"], tid[it["team"]] if it["team"] else None,
             uid[it["assignee"]], uid[it["created_by"]],
             it["due"], it["dms"], it["pillar"], it["created"], it["updated"]))
        for p in it["parts"]:
            db.x("insert into item_participants (item_id,user_id,added_by,added_at)"
                 " values (%s,%s,%s,%s)",
                 (iid[it["key"]], uid[p], uid[it["created_by"]], it["created"]))

    for item_key, etype, author, body, created in EVENTS:
        db.x(
            "insert into events (id,subject_type,subject_id,event_type,author_id,body,created_at)"
            " values (%s,'item',%s,%s,%s,%s,%s)",
            (db.new_id(), iid[item_key], etype, uid[author] if author else None, body, created))

    for item_key, title, assignee, status, due, creator, created in ACTIONS:
        biten = status in ("kapandi", "iptal")
        db.x("insert into actions (id,item_id,title,assignee_id,status,due_date,"
            "created_by,resolved_by,resolved_at,created_at) values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (db.new_id(), iid[item_key], title, uid[assignee] if assignee else None,
             status, due, uid[creator], uid[assignee] if biten else None,
             created if biten else None, created))

    print(f"tohumlandi: {len(USERS)} kullanici, {len(TEAMS)} takim, {len(NODES)} dugum, "
          f"{len(ITEMS)} kayit, {len(ACTIONS)} eylem, {len(EVENTS)} olay")


if __name__ == "__main__":
    run()
