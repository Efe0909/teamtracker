import collections
from shared import db

NODE_TYPES = {
    "cell": "Bölüm / Hat",
    "machine": "Makine / Ünite",
    "pillar": "Pillar",
    "team": "Takım",
    "task": "Görev",
    "step": "Adım",
    "operational": "Etkinlik / Operasyon",
    "generic": "Genel Kırılım"
}

ROOT_ONLY = {"cell"}


def valid(node_type: str) -> bool:
    return node_type in NODE_TYPES


def label(node_type: str) -> str:
    return NODE_TYPES.get(node_type, node_type)


def counts_by_node() -> dict[str, dict[str, int]]:
    """Tek sorguyla tüm düğümlerin bağımlılık sayıları.

    UNION ALL ile her bağımlılık tablosundan id ve türü toplar, 
    sonra Python'da gruplar. events tablosu dahil edilmez çünkü
    subject_id FK değildir ve olay varlığı silmeyi engellememelidir.
    """
    rows = db.q('''
        select parent_id as nid, 'children' as dep from nodes where parent_id is not null
        union all
        select node_id as nid, 'records' as dep from items
        union all
        select node_id as nid, 'teams' as dep from teams where node_id is not null
        union all
        select node_id as nid, 'permissions' as dep from user_node_scopes
        union all
        select scope_node_id as nid, 'user_scopes' as dep from users where scope_node_id is not null
    ''')
    
    out = collections.defaultdict(lambda: {"children": 0, "records": 0, "teams": 0, "permissions": 0, "user_scopes": 0})
    for r in rows:
        nid = r["nid"]
        out[nid][r["dep"]] += 1
    
    return dict(out)


def is_virgin(node_id: str, counts: dict | None = None) -> bool:
    """Sert silme için 5 bağımlılığın hepsi sıfır mı?"""
    if counts is None:
        counts = counts_by_node()
    
    c = counts.get(db.uid(node_id))
    if not c:
        return True
        
    return c["children"] == 0 and c["records"] == 0 and c["teams"] == 0 and \
           c["permissions"] == 0 and c["user_scopes"] == 0


def has_projection(node_id: str, counts: dict | None = None) -> bool:
    """Tür kilidi için projeksiyon (teams) var mı?"""
    if counts is None:
        counts = counts_by_node()
        
    c = counts.get(db.uid(node_id))
    return bool(c and c["teams"] > 0)
