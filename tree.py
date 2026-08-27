"""Bellekte agac indeksi (00-BASLA.md Karar 2).

SQLite'ta adjacency list durur; okuma icin her istekte SQL'e gidilmez.
Yapi degistiginde indeks KOMPLE yeniden kurulur — kismi guncelleme yok.
Tek surec varsayimi: uvicorn --workers 1.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Node:
    id: str
    parent_id: str | None
    name: str
    node_type: str
    sort_order: int


@dataclass
class TreeIndex:
    nodes: dict[str, Node] = field(default_factory=dict)
    parent: dict[str, str | None] = field(default_factory=dict)
    children: dict[str, list[str]] = field(default_factory=dict)
    tin: dict[str, int] = field(default_factory=dict)
    tout: dict[str, int] = field(default_factory=dict)
    depth: dict[str, int] = field(default_factory=dict)
    roots: list[str] = field(default_factory=list)

    @classmethod
    def build(cls, rows) -> "TreeIndex":
        ix = cls()
        for r in rows:
            n = Node(r["id"], r["parent_id"], r["name"], r["node_type"], r["sort_order"])
            ix.nodes[n.id] = n
            ix.parent[n.id] = n.parent_id
            ix.children.setdefault(n.id, [])
        for n in ix.nodes.values():
            if n.parent_id and n.parent_id in ix.nodes:
                ix.children[n.parent_id].append(n.id)
            else:
                ix.roots.append(n.id)
        key = lambda i: (ix.nodes[i].sort_order, ix.nodes[i].name)  # noqa: E731
        ix.roots.sort(key=key)
        for kids in ix.children.values():
            kids.sort(key=key)

        counter = 0
        # Euler tour, yinelemesiz — derin agacta rekursiyon limitine takilmasin.
        for root in ix.roots:
            stack: list[tuple[str, bool]] = [(root, False)]
            while stack:
                nid, closing = stack.pop()
                if closing:
                    ix.tout[nid] = counter
                    counter += 1
                    continue
                ix.tin[nid] = counter
                counter += 1
                p = ix.parent.get(nid)
                ix.depth[nid] = 0 if p is None or p not in ix.nodes else ix.depth[p] + 1
                stack.append((nid, True))
                for kid in reversed(ix.children[nid]):
                    stack.append((kid, False))
        return ix

    # --- sorgular ---

    def is_descendant(self, node: str, ancestor: str) -> bool:
        """O(1) yetki kontrolu. Dugum kendi atasi sayilir."""
        if node not in self.tin or ancestor not in self.tin:
            return False
        return self.tin[ancestor] <= self.tin[node] and self.tout[node] <= self.tout[ancestor]

    def subtree(self, node: str) -> list[str]:
        if node not in self.nodes:
            return []
        out = [node]
        i = 0
        while i < len(out):
            out.extend(self.children.get(out[i], []))
            i += 1
        return out

    def ancestors(self, node: str) -> list[str]:
        """Kokten dugume kadar yol (dugum dahil)."""
        path: list[str] = []
        cur: str | None = node
        while cur and cur in self.nodes:
            path.append(cur)
            cur = self.parent.get(cur)
        return list(reversed(path))

    def name(self, node: str) -> str:
        n = self.nodes.get(node)
        return n.name if n else "?"
