"""TreeIndex birim testleri (alt agac, atalar, is_descendant)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from shared.tree import TreeIndex  # noqa: E402

ROWS = [
    {"id": "a", "parent_id": None, "name": "A", "node_type": "t", "sort_order": 0},
    {"id": "b", "parent_id": "a", "name": "B", "node_type": "t", "sort_order": 0},
    {"id": "c", "parent_id": "a", "name": "C", "node_type": "t", "sort_order": 1},
    {"id": "d", "parent_id": "b", "name": "D", "node_type": "t", "sort_order": 0},
    {"id": "e", "parent_id": None, "name": "E", "node_type": "t", "sort_order": 1},
]


def ix():
    return TreeIndex.build(ROWS)


def test_children_sorted():
    assert ix().children["a"] == ["b", "c"]
    assert ix().roots == ["a", "e"]


def test_depth():
    t = ix()
    assert (t.depth["a"], t.depth["b"], t.depth["d"]) == (0, 1, 2)


def test_is_descendant():
    t = ix()
    assert t.is_descendant("d", "a")
    assert t.is_descendant("d", "b")
    assert t.is_descendant("a", "a")          # dugum kendi atasi
    assert not t.is_descendant("a", "d")
    assert not t.is_descendant("d", "c")
    assert not t.is_descendant("d", "e")      # ayri kok
    assert not t.is_descendant("d", "yok")


def test_subtree():
    assert sorted(ix().subtree("a")) == ["a", "b", "c", "d"]
    assert ix().subtree("e") == ["e"]
    assert ix().subtree("yok") == []


def test_ancestors():
    assert ix().ancestors("d") == ["a", "b", "d"]


def test_rebuild_is_cheap():
    import time
    rows = [{"id": str(i), "parent_id": str((i - 1) // 3) if i else None,
             "name": f"n{i}", "node_type": "t", "sort_order": i} for i in range(3000)]
    t0 = time.perf_counter()
    t = TreeIndex.build(rows)
    ms = (time.perf_counter() - t0) * 1000
    assert len(t.nodes) == 3000
    print(f"\n3000 dugum indeks kurulumu: {ms:.1f} ms")
