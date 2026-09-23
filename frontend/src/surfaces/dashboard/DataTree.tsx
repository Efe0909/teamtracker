// Veri Yonetimi: yapinin (agacin) duzenlendigi ekran (R2-F05). Kaynak:
// e02d71d `veri_yonetimi.html` + `fragments/agac.html` + dashboard.js.
//
// Duz liste + girinti: sunucu Euler sirasinda veriyor, ic ice bilesen yok.
// KATLAMA ve ARAMA ISTEMCIDE: butun satirlar zaten elde, her ok icin sunucuya
// gitmek ayni agaci ikinci kez kurmak olurdu. Acik dallar state'te — yazmadan
// sonra agac tazelenince kullanici yerini kaybetmez.
//
// Yetki SUNUCUDA: `can_*` bayraklari yalniz dugme gostermek icin, uc ayrica
// kontrol ediyor. Tur listeleri de sunucudan: yerlesim kurali (ROOT_ONLY)
// burada yeniden yazilmaz (KNOW-241).

import { useEffect, useMemo, useState } from "react";
import { errorText } from "../../api/client";
import { useCreateNode, useDeleteNode, useNodeTree, usePatchNode } from "../../api/hooks";
import type { NodePatch, NodeType, TreeNode, TreeView, Uuid } from "../../api/types";
import { NODE_TYPE } from "../../lib/labels";
import { Icon } from "../../ui/icons";
import { Button, cx, Empty, Loading, Tag, ui, useToast } from "../../ui/ui";
import { ErrorScreen } from "../errors/ErrorScreen";
import s from "./dashboard.module.css";

/** Acik form: bir dugumun duzenleme ya da alt dugum paneli; `id` null = kok ekleme. */
type Panel = { id: Uuid | null; kind: "edit" | "add" } | null;

export function DataTree() {
  const q = useNodeTree();
  useEffect(() => {
    document.title = "Veri Yönetimi — EkipTakip";
  }, []);
  if (q.error !== null) return <ErrorScreen code="network" />;
  if (q.data === undefined) return <Loading />;
  return <TreeScreen tree={q.data} />;
}

function haystack(n: TreeNode): string {
  return `${n.name} ${n.description ?? ""}`.toLocaleLowerCase("tr");
}

function TreeScreen({ tree }: { tree: TreeView }) {
  const toast = useToast();
  const patch = usePatchNode();
  const [open, setOpen] = useState<ReadonlySet<Uuid>>(() => new Set());
  const [search, setSearch] = useState("");
  const [panel, setPanel] = useState<Panel>(null);

  const byId = useMemo(() => new Map(tree.nodes.map((n) => [n.id, n])), [tree.nodes]);
  /** Kokten bu dugume kadar butun ustleri — gorunurluk kararinin girdisi. */
  const ancestors = (n: TreeNode): Uuid[] => {
    const out: Uuid[] = [];
    for (let p = n.parent_id; p !== null; p = byId.get(p)?.parent_id ?? null) out.push(p);
    return out;
  };

  const needle = search.trim().toLocaleLowerCase("tr");
  // AKILLI ARAMA: eslesenler + onlarin butun ustleri. Bir dal yalniz icinde
  // eslesme varsa acilir; eslesenin kendi altindakiler eslesmedikce cikmaz.
  let shown: Set<Uuid> | null = null;
  if (needle !== "") {
    shown = new Set();
    for (const n of tree.nodes) {
      if (!haystack(n).includes(needle)) continue;
      shown.add(n.id);
      for (const a of ancestors(n)) shown.add(a);
    }
  }

  const onSearch = (v: string) => {
    setSearch(v);
    const n = v.trim().toLocaleLowerCase("tr");
    if (n === "") return;
    // Eslesmenin ustleri ACIK kalir: arama silinince kullanici buldugu yerde
    // durur, agac koke katlanmaz (Python dashboard.js ile ayni).
    setOpen((prev) => {
      const next = new Set(prev);
      for (const x of tree.nodes) if (haystack(x).includes(n)) for (const a of ancestors(x)) next.add(a);
      return next;
    });
  };

  const toggle = (id: Uuid) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Tek bir kapali ata altindaki her sey gizlenir, derinlik farketmez.
  const visible = tree.nodes.filter(
    (n) => ancestors(n).every((a) => open.has(a)) && (shown === null || shown.has(n.id)),
  );
  const canWrite = tree.can_add_root || tree.nodes.some((n) => n.can_edit);

  const setActive = (n: TreeNode) =>
    patch.mutate(
      { id: n.id, patch: { is_active: !n.is_active } },
      { onError: (e) => toast({ text: errorText(e), error: true }) },
    );

  return (
    <div className={s.page}>
      <div className={s.pageHead}>
        <h1>Veri Yönetimi</h1>
        {tree.can_add_root && (
          <Button
            variant="primary"
            aria-expanded={panel?.id === null}
            onClick={() => setPanel(panel?.id === null ? null : { id: null, kind: "add" })}
          >
            <Icon name="plus" size={18} /> Kök düğüm
          </Button>
        )}
      </div>
      <p className={s.lead}>
        Yapı burada düzenlenir: düğüm ekle, adlandır, açıklama yaz, taşı, pasifleştir. Değişiklik anında
        uygulanır ve ağaç yeniden kurulur.
      </p>
      {!canWrite && <p className={s.lead}>Yapıyı değiştirmek için editör yetkisi gerekiyor. Yöneticine söyle.</p>}

      {panel?.id === null && (
        <AddForm parent={null} types={tree.root_types} onClose={() => setPanel(null)} />
      )}

      <div className={s.treeBar}>
        <input
          className={cx(ui.input, s.treeSearch)}
          type="search"
          aria-label="Ağaçta ara"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Ağaçta ara — eşleşen dallar kendiliğinden açılır…"
          autoComplete="off"
        />
        <Button onClick={() => setOpen(new Set(tree.nodes.map((n) => n.id)))}>Hepsini aç</Button>
        <Button onClick={() => setOpen(new Set())}>Hepsini kapat</Button>
      </div>

      {tree.nodes.length === 0 ? (
        <Empty title="Henüz düğüm yok.">Yapının en üstünden başla — örneğin bir bölüm ya da etkinlik.</Empty>
      ) : visible.length === 0 ? (
        <Empty title="Bu aramayla eşleşen düğüm yok." />
      ) : (
        <ul className={s.tree}>
          {visible.map((n) => {
            const isOpen = open.has(n.id);
            const editing = panel?.id === n.id && panel.kind === "edit";
            const adding = panel?.id === n.id && panel.kind === "add";
            return (
              <li
                key={n.id}
                className={cx(s.tnode, !n.is_active && s.tInactive)}
                style={{ paddingInlineStart: `calc(var(--s-6) * ${n.depth})` }}
              >
                <div className={s.trow}>
                  {n.child_count > 0 ? (
                    // Ok GERCEK bir dugme (Python e74ca50: eskiden tiklanamayan
                    // soluk bir yaziydi, kullanici istegi).
                    <button
                      type="button"
                      className={s.fold}
                      aria-expanded={isOpen}
                      aria-label={`${n.name}: alt düğümleri ${isOpen ? "kapat" : "aç"}`}
                      title="Alt düğümleri aç / kapat"
                      onClick={() => toggle(n.id)}
                    >
                      <Icon name="chevron" size={16} />
                    </button>
                  ) : (
                    <span className={s.leaf} aria-hidden="true" />
                  )}
                  <span className={s.tname}>{n.name}</span>
                  <Tag tone="neutral">{NODE_TYPE[n.node_type]}</Tag>
                  {n.child_count > 0 && (
                    <span className={s.tcount} title="alt düğüm sayısı">
                      {n.child_count}
                    </span>
                  )}
                  {!n.is_active && (
                    <span className={s.tInactiveLabel} title="pasif — yeni kayıt ve dropdown'larda çıkmaz">
                      pasif
                    </span>
                  )}
                  {n.can_edit && (
                    <span className={s.tacts}>
                      <button
                        type="button"
                        className={ui.iconBtn}
                        aria-label={`${n.name}: düzenle`}
                        aria-expanded={editing}
                        title="Düzenle"
                        onClick={() => setPanel(editing ? null : { id: n.id, kind: "edit" })}
                      >
                        <Icon name="edit" size={18} />
                      </button>
                      <button
                        type="button"
                        className={ui.iconBtn}
                        aria-label={`${n.name}: alt düğüm ekle`}
                        aria-expanded={adding}
                        title="Alt düğüm ekle"
                        onClick={() => setPanel(adding ? null : { id: n.id, kind: "add" })}
                      >
                        <Icon name="plus" size={18} />
                      </button>
                      {/* Silmez, PASIFLESTIRIR: gundelik "bu artik kullanilmiyor" isinin
                          dogru araci — gecmis korunur, geri alinir. Kalici silme
                          duzenleme panelinin icinde (spec/72 §6). */}
                      <button
                        type="button"
                        className={ui.iconBtn}
                        aria-label={`${n.name}: ${n.is_active ? "pasifleştir" : "yeniden aç"}`}
                        title={n.is_active ? "Pasifleştir" : "Yeniden aç"}
                        disabled={patch.isPending}
                        onClick={() => setActive(n)}
                      >
                        <Icon name={n.is_active ? "off" : "restore"} size={18} />
                      </button>
                    </span>
                  )}
                </div>
                {n.description !== null && <div className={s.tdesc}>{n.description}</div>}
                {editing && <EditForm node={n} tree={tree} onClose={() => setPanel(null)} />}
                {adding && (
                  <AddForm
                    parent={n}
                    types={tree.child_types}
                    onClose={(added) => {
                      setPanel(null);
                      // Yeni dugum gorunsun: ustu acilir.
                      if (added) setOpen((prev) => new Set(prev).add(n.id));
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function AddForm(props: { parent: TreeNode | null; types: NodeType[]; onClose: (added: boolean) => void }) {
  const m = useCreateNode();
  const [name, setName] = useState("");
  const [type, setType] = useState<NodeType>(props.types[0] ?? "generic");
  const [desc, setDesc] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const child = props.parent !== null;

  return (
    <form
      className={cx(ui.formStack, s.tform)}
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        m.mutate(
          {
            name,
            node_type: type,
            parent_id: props.parent?.id ?? null,
            description: desc.trim() === "" ? null : desc,
          },
          { onSuccess: () => props.onClose(true), onError: (x) => setErr(errorText(x)) },
        );
      }}
    >
      {err !== null && <p className={ui.error} role="alert">{err}</p>}
      <div className={ui.grid2}>
        <label className={ui.field}>
          {child ? "Alt düğüm adı" : "Düğüm adı"}
          <input className={ui.input} value={name} onChange={(e) => setName(e.target.value)} required maxLength={200}
            autoFocus placeholder={child ? "alt düğüm adı" : "düğüm adı (ör. Maliye)"} />
        </label>
        <label className={ui.field}>
          Tür
          <select className={ui.input} value={type} onChange={(e) => setType(e.target.value as NodeType)}>
            {props.types.map((t) => (
              <option key={t} value={t}>{NODE_TYPE[t]}</option>
            ))}
          </select>
        </label>
      </div>
      <label className={ui.field}>
        Açıklama
        <textarea className={ui.input} rows={2} value={desc} onChange={(e) => setDesc(e.target.value)}
          placeholder={child ? "açıklama (isteğe bağlı)" : "açıklama — bu düğüm ne kapsıyor?"} />
      </label>
      <div className={ui.dact}>
        <Button onClick={() => props.onClose(false)}>Vazgeç</Button>
        <Button type="submit" variant="primary" disabled={m.isPending || name.trim() === ""}>Ekle</Button>
      </div>
    </form>
  );
}

function EditForm({ node, tree, onClose }: { node: TreeNode; tree: TreeView; onClose: () => void }) {
  const m = usePatchNode();
  const del = useDeleteNode();
  const [name, setName] = useState(node.name);
  const [type, setType] = useState<NodeType>(node.node_type);
  const [parent, setParent] = useState<string>(node.parent_id ?? "");
  const [desc, setDesc] = useState(node.description ?? "");
  const [err, setErr] = useState<string | null>(null);
  // Tur listesi dugumun bulundugu yere gore, sunucudan (Python `d.types`).
  const types = node.parent_id === null ? tree.root_types : tree.child_types;
  const onError = (x: unknown) => setErr(errorText(x));

  const save = () => {
    // Yalniz degisen alanlar: verilmeyen alan sunucuda DEGISMEZ.
    const p: NodePatch = {};
    if (name !== node.name) p.name = name;
    if (type !== node.node_type) p.node_type = type;
    const d = desc.trim() === "" ? null : desc.trim();
    if (d !== node.description) p.description = d;
    const target = parent === "" ? null : parent;
    if (target !== node.parent_id) p.parent_id = target;
    if (Object.keys(p).length === 0) {
      onClose();
      return;
    }
    m.mutate({ id: node.id, patch: p }, { onSuccess: onClose, onError });
  };

  const hardDelete = () => {
    const c = node.delete_counts;
    // Onay NE GOTURECEGINI sayar: kapsam yetkiyi verir, sayi karari
    // kullaniciya verdirir (spec/72 §6.2).
    const ok = window.confirm(
      `${node.name} KALICI olarak silinecek. Birlikte gidecekler: ${c.children} alt düğüm, ` +
        `${c.records} kayıt, ${c.permissions} dal izni. Bu geri alınamaz — kapatmak için ` +
        "pasifleştirmeyi kullan. Emin misin?",
    );
    if (ok) del.mutate(node.id, { onSuccess: onClose, onError });
  };

  return (
    <form
      className={cx(ui.formStack, s.tform)}
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        save();
      }}
    >
      {err !== null && <p className={ui.error} role="alert">{err}</p>}
      <div className={ui.grid2}>
        <label className={ui.field}>
          Ad
          <input className={ui.input} value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} autoFocus />
        </label>
        <label className={ui.field}>
          Tür
          {/* Kilitliyse DISABLED: tur gonderilmez, sunucu da reddeder (type_locked). */}
          <select className={ui.input} value={type} onChange={(e) => setType(e.target.value as NodeType)}
            disabled={!node.can_retype}
            title={node.can_retype ? undefined : "türe bağlı veri var (takım kartı) — önce o bağ çözülmeli"}>
            {types.map((t) => (
              <option key={t} value={t}>{NODE_TYPE[t]}</option>
            ))}
          </select>
        </label>
      </div>
      <label className={ui.field}>
        Üst düğüm
        <select className={ui.input} value={parent} onChange={(e) => setParent(e.target.value)}>
          {/* Koke cikarmak ve ustu duzenlenemeyen yere tasimak sunucuda reddedilir;
              burada yalniz sunucunun verdigi bayraklarla soluk cizilir. */}
          <option value="" disabled={!tree.can_add_root && node.parent_id !== null}>— kök —</option>
          {tree.nodes
            .filter((x) => x.id !== node.id)
            .map((x) => (
              <option key={x.id} value={x.id} disabled={!x.can_edit && x.id !== node.parent_id}>
                {"· ".repeat(x.depth)}
                {x.name}
              </option>
            ))}
        </select>
      </label>
      <label className={ui.field}>
        Açıklama
        <textarea className={ui.input} rows={2} value={desc} onChange={(e) => setDesc(e.target.value)}
          placeholder="açıklama — bu düğüm ne kapsıyor?" />
      </label>
      <div className={ui.dact}>
        {node.can_hard_delete && (
          <Button variant="danger" className={s.tdelete} onClick={hardDelete} disabled={del.isPending}>
            Kalıcı sil
          </Button>
        )}
        <Button onClick={onClose}>Vazgeç</Button>
        <Button type="submit" variant="primary" disabled={m.isPending || name.trim() === ""}>Kaydet</Button>
      </div>
    </form>
  );
}
