"""Arama. FTS5 uzerinden; LIKE '%kelime%' yok (spec/10-kararlar).

Kayit aramasi veritabanindan, dugum aramasi bellekteki agactan gelir.
Iki sitenin de kullanabilmesi icin burada; bugun mobil kullaniyor.
"""
from __future__ import annotations

from . import db, service


def fts_query(q: str) -> str | None:
    """Kullanici metnini FTS5 sorgusuna cevirir: her kelime onek eslesmesi.

    Ozel karakterler ayiklanir — MATCH ifadesi kullanici metniyle birlestirilmez.
    """
    words = [w for w in "".join(c if c.isalnum() else " " for c in q).split() if len(w) > 1]
    return " ".join(f'"{w}"*' for w in words) or None


def search_items(q: str, limit: int = 25) -> list[dict]:
    match = fts_query(q)
    if match is None:
        return []
    return db.q("select i.* from items_fts f join items i on i.rowid = f.rowid"
                " where items_fts match ? order by rank limit ?", (match, limit))



def search_nodes(q: str, limit: int = 10) -> list[dict]:
    """Agac bellekte (spec/10-kararlar.md 'Ağaç bellekte') — dugum aramasi SQL'e gitmez."""
    fold = str.maketrans("şğıöçüİ", "sgiocui")
    needle = q.lower().translate(fold)
    out = []
    for nid in service.TREE.nodes:
        if needle in service.TREE.name(nid).lower().translate(fold):
            out.append({"id": nid, "name": service.TREE.name(nid),
                        "path": " › ".join(service.TREE.name(n) for n in service.TREE.ancestors(nid)[:-1])})
        if len(out) == limit:
            break
    return out

