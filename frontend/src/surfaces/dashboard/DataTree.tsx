// Veri Yonetimi: referans veri agacinin duzenlendigi ekran (spec/74; once
// R2-F05, e02d71d `veri_yonetimi.html` + `fragments/agac.html` + dashboard.js).
//
// Duz liste + girinti: sunucu Euler sirasinda veriyor, ic ice bilesen yok.
// KATLAMA ve ARAMA ISTEMCIDE: butun satirlar zaten elde, her ok icin sunucuya
// gitmek ayni agaci ikinci kez kurmak olurdu. Acik dallar state'te — yazmadan
// sonra agac tazelenince kullanici yerini kaybetmez.
//
// Kokler YALNIZ gocle dogar: "kok ekle" yok, koke tasima yok. Kok ve
// operational slot (`locked`) yalniz ad/aciklama degistirir.
//
// Yetki ve yerlesim SUNUCUDA: `can_*` bayraklari ve dugum basina
// `child_types`/`child_fixed` yalniz dugme ve form gostermek icin; kok semasi
// (src/refdata.rs) burada yeniden yazilmaz (KNOW-241).

import { useEffect, useMemo, useState } from "react";
import { errorText } from "../../api/client";
import { useCreateNode, useDeleteNode, useNodeTree, usePatchNode } from "../../api/hooks";
import type { MetaTeam, NewNode, NodePatch, NodeType, Shape, TreeNode, TreeView, Uuid, WidgetType } from "../../api/types";
import { NODE_TYPE } from "../../lib/labels";
import { useLookup } from "../../lib/lookup";
import { Icon } from "../../ui/icons";
import { MarkdownField, MarkdownText } from "../../ui/MarkdownField";
import { Button, cx, Empty, Link, Loading, Picker, Req, Tag, ui, useToast } from "../../ui/ui";
import { ErrorScreen } from "../errors/ErrorScreen";
import s from "./dashboard.module.css";
import d from "./datatree.module.css";
import { WIDGET } from "./eventModel";
import { href } from "./routes";

/** Acik form: bir dugumun duzenleme ya da alt dugum paneli. */
type Panel = { id: Uuid; kind: "edit" | "add" } | null;

const TYPE_LABEL: Record<NodeType, string> = NODE_TYPE;

const SHAPE: Record<Shape, string> = { tree: "Ağaç", list: "Liste", leaf: "Yaprak" };

/** Sablonda secilebilen widget'lar (`record` sablonda yok: spec/73 §3). */
type TemplateWidget = Exclude<WidgetType, "record">;
const TEMPLATE_WIDGETS: TemplateWidget[] = ["otf", "supplies"];

/** Sunucunun reddetmeyen isaretleri (refdata.rs `warnings`). */
const WARNING: Readonly<Partial<Record<string, string>>> = {
  missing_slot: "Eksik bölüm: Adımlar ya da Widget'lar yok",
  late_checkpoint: "Etkinlikten 7 günden daha az önce — hazırlık en geç 7 gün önce bitmeli",
  unknown_widget: "Bilinmeyen widget türü",
  unknown_slot: "Tanınmayan bölüm",
  invalid_attrs: "Ayarları eksik ya da bozuk",
};

function offsetText(days: number): string {
  return days === 0 ? "0 gün" : `${days < 0 ? "−" : "+"}${Math.abs(days)} gün`;
}

/** Satirda okunacak ayar: checkpoint gun farki. (Widget'in adi zaten katalog adi: tekrarlanmaz.) */
function attrText(n: TreeNode): string | null {
  if (n.node_type === "checkpoint" && n.attrs.offset_days !== undefined) return offsetText(n.attrs.offset_days);
  return null;
}

/** Formdaki ayar alanlarindan attrs; ayarsiz tur icin undefined. */
function attrsFor(type: NodeType, offset: string, widget: TemplateWidget): TreeNode["attrs"] | undefined {
  if (type === "checkpoint") return { offset_days: Number(offset) };
  if (type === "widget") return { widget };
  return undefined;
}

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
  const L = useLookup();
  /** dugum -> orada calisan takimlar (sozlukteki team_nodes'un tersi). */
  const teamsAt = useMemo(() => {
    const m = new Map<Uuid, MetaTeam[]>();
    for (const t of L.meta.teams) for (const n of t.node_ids) m.set(n, [...(m.get(n) ?? []), t]);
    return m;
  }, [L.meta.teams]);
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
  const canWrite = tree.nodes.some((n) => n.can_edit);

  const setActive = (n: TreeNode) =>
    patch.mutate(
      { id: n.id, patch: { is_active: !n.is_active } },
      { onError: (e) => toast({ text: errorText(e), error: true }) },
    );

  return (
    <div className={s.page}>
      <div className={s.pageHead}>
        <h1>Veri Yönetimi</h1>
      </div>
      <p className={s.lead}>
        Kökler (Konular, Etkinlik Yönetimi) koddan gelir; yalnız adları ve açıklamaları değişir. Konular
        serbest bir ağaç: türü ve yapıyı sen seçersin. Etkinlik Yönetimi'nin altındaki Etkinlik Türleri,
        Etkinlik Yerleri ve Etkinlik Kazanımları yönetilen listeler: türü sistem atar, her etkinlik türünün
        Adımlar ve Widget'lar bölümleri kendiliğinden açılır. Adı koddan belli olan düğümlerin (Adımlar,
        Widget'lar, widget'lar) adı sabittir, açıklaması değişir. Değişiklik anında uygulanır.
      </p>
      {!canWrite && <p className={s.lead}>Yapıyı değiştirmek için editör yetkisi gerekiyor. Yöneticine söyle.</p>}

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
        <Empty title="Henüz düğüm yok.">Kökler göçle gelir — sunucu henüz kurulmamış olabilir.</Empty>
      ) : visible.length === 0 ? (
        <Empty title="Bu aramayla eşleşen düğüm yok." />
      ) : (
        <ul className={s.tree}>
          {visible.map((n) => {
            const isOpen = open.has(n.id);
            const editing = panel?.id === n.id && panel.kind === "edit";
            const adding = panel?.id === n.id && panel.kind === "add";
            const attr = attrText(n);
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
                  {n.locked !== null && (
                    <span
                      className={d.lock}
                      role="img"
                      aria-label={`${n.name}: kilitli`}
                      title={
                        n.locked === "root"
                          ? "Kök — koddan gelir; yalnız ad ve açıklama değişir"
                          : "Sistem bölümü — yalnız ad ve açıklama değişir"
                      }
                    >
                      <Icon name="lock" size={14} />
                    </span>
                  )}
                  <Tag tone="neutral">
                    {n.locked === "root" ? "Kök" : n.locked === "operational" ? "Bölüm" : TYPE_LABEL[n.node_type]}
                  </Tag>
                  {attr !== null && <span className={d.attr}>{attr}</span>}
                  {n.warnings.map((w) => {
                    const text = WARNING[w] ?? w;
                    return (
                      <span key={w} className={d.warn} role="img" aria-label={text} title={text}>
                        <Icon name="alert" size={16} />
                      </span>
                    );
                  })}
                  {/* Bu konuda calisan takimlar (team_nodes, spec/22). */}
                  {(teamsAt.get(n.id) ?? []).map((t) => (
                    <Link key={t.id} href={href({ name: "team", id: t.id })} className={s.tteam}>
                      <span className={s.teamDot} style={t.color !== null ? { background: t.color } : undefined} aria-hidden="true" />
                      {t.name}
                    </Link>
                  ))}
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
                      {/* Bos child_types = buraya eklenmez (yaprak, option'in kendisi, pasif...). */}
                      {n.child_types.length > 0 && (
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
                      )}
                      {/* Silmez, PASIFLESTIRIR: gundelik "bu artik kullanilmiyor" isinin
                          dogru araci — gecmis korunur, geri alinir. Kalici silme
                          duzenleme panelinin icinde (spec/72 §6). Kok/slot kapatilmaz. */}
                      {n.locked === null && (
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
                      )}
                    </span>
                  )}
                </div>
                {n.description !== null && <MarkdownText value={n.description} className={s.tdesc} />}
                {editing && <EditForm node={n} tree={tree} byId={byId} onClose={() => setPanel(null)} />}
                {adding && (
                  <AddForm
                    parent={n}
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

/** Ture bagli ayar alanlari: checkpoint gun farki, widget turu (koddaki liste). */
function AttrsFields(props: {
  type: NodeType;
  offset: string;
  setOffset: (v: string) => void;
  widget: TemplateWidget;
  setWidget: (v: TemplateWidget) => void;
}) {
  if (props.type === "checkpoint") {
    return (
      <label className={ui.field}>
        <span>Etkinlikten kaç gün önce/sonra<Req /></span>
        <input className={ui.input} type="number" step={1} min={-365} max={365} required value={props.offset}
          onChange={(e) => props.setOffset(e.target.value)} placeholder="ör. -7" />
        <span className={ui.fieldHint}>Eksi = etkinlikten önce (ör. -7). Hazırlık en geç 7 gün önce bitmeli.</span>
      </label>
    );
  }
  if (props.type === "widget") {
    return (
      <div className={ui.field}>
        <span>Widget</span>
        <Picker label="Widget" value={props.widget} onChange={props.setWidget}
          options={TEMPLATE_WIDGETS.map((w) => ({ value: w, label: WIDGET[w].label }))} />
      </div>
    );
  }
  return null;
}

function AddForm(props: { parent: TreeNode; onClose: (added: boolean) => void }) {
  const L = useLookup();
  const bypassQuality = L.can("bypass_text_quality");
  const m = useCreateNode();
  const { parent } = props;
  // Sabit kural: tur ve shape sunucudan, formda sorulmaz.
  const fixed = parent.child_fixed;
  const [name, setName] = useState("");
  const [type, setType] = useState<NodeType>(parent.child_types[0] ?? "generic");
  const [shape, setShape] = useState<Shape>("tree");
  const [desc, setDesc] = useState("");
  const [offset, setOffset] = useState("-7");
  const [widget, setWidget] = useState<TemplateWidget>("otf");
  const [err, setErr] = useState<string | null>(null);
  const nameLabel = fixed ? `${TYPE_LABEL[type]} adı` : "Alt düğüm adı";
  // Widget'in adi koddan (katalog): sorulmaz.
  const nameFixed = type === "widget";
  const nameValid = nameFixed || Array.from(name.trim()).length >= 5;
  const descValid = bypassQuality || desc.trim() === "" || Array.from(desc.trim()).length >= 30;

  return (
    <form
      className={cx(ui.formStack, s.tform)}
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        const body: NewNode = {
          name: nameFixed ? WIDGET[widget].label : name,
          parent_id: parent.id,
          description: desc.trim() === "" ? null : desc,
        };
        if (!fixed) {
          body.node_type = type;
          body.shape = shape;
        }
        const attrs = attrsFor(type, offset, widget);
        if (attrs !== undefined) body.attrs = attrs;
        m.mutate(body, { onSuccess: () => props.onClose(true), onError: (x) => setErr(errorText(x)) });
      }}
    >
      {err !== null && <p className={ui.error} role="alert">{err}</p>}
      <div className={ui.grid2}>
        {!nameFixed && (
          <label className={ui.field}>
            <span>{nameLabel}<Req /></span>
            <input className={ui.input} value={name} onChange={(e) => setName(e.target.value)} required maxLength={200}
              autoFocus placeholder={nameLabel.toLocaleLowerCase("tr")} />
            <small className={ui.fieldHint}>{Array.from(name.trim()).length}/5 karakter</small>
          </label>
        )}
        {!fixed && (
          <div className={ui.field}>
            <span>Tür</span>
            <Picker label="Tür" value={type} onChange={setType}
              options={parent.child_types.map((t) => ({ value: t, label: TYPE_LABEL[t] }))} />
          </div>
        )}
        {!fixed && (
          <div className={ui.field}>
            <span>Yapı</span>
            <Picker label="Yapı" value={shape} onChange={setShape}
              options={(["tree", "list", "leaf"] as const).map((x) => ({ value: x, label: SHAPE[x] }))} />
          </div>
        )}
        <AttrsFields type={type} offset={offset} setOffset={setOffset} widget={widget} setWidget={setWidget} />
      </div>
      <div className={ui.field}>
        <span>Açıklama</span>
        <MarkdownField value={desc} onChange={setDesc} label="Açıklama" rows={2}
          placeholder="açıklama (isteğe bağlı)" />
        <small className={ui.fieldHint}>{Array.from(desc.trim()).length}{bypassQuality ? " karakter" : "/30 karakter"} · isteğe bağlı</small>
      </div>
      <div className={ui.dact}>
        <Button onClick={() => props.onClose(false)}>Vazgeç</Button>
        <Button type="submit" variant="primary" aria-busy={m.isPending} disabled={m.isPending || !nameValid || !descValid}>
          {m.isPending ? "Ekleniyor…" : "Ekle"}
        </Button>
      </div>
    </form>
  );
}

function EditForm(props: { node: TreeNode; tree: TreeView; byId: ReadonlyMap<Uuid, TreeNode>; onClose: () => void }) {
  const { node, tree, byId, onClose } = props;
  const L = useLookup();
  const bypassQuality = L.can("bypass_text_quality");
  const m = usePatchNode();
  const del = useDeleteNode();
  const [name, setName] = useState(node.name);
  const [type, setType] = useState<NodeType>(node.node_type);
  const [shape, setShape] = useState<Shape>(node.shape);
  const [parent, setParent] = useState<Uuid>(node.parent_id ?? "");
  const [desc, setDesc] = useState(node.description ?? "");
  const [offset, setOffset] = useState(String(node.attrs.offset_days ?? -7));
  const initialWidget = node.attrs.widget;
  const [widget, setWidget] = useState<TemplateWidget>(
    initialWidget !== undefined && initialWidget !== "record" ? initialWidget : "otf",
  );
  const [err, setErr] = useState<string | null>(null);
  const onError = (x: unknown) => setErr(errorText(x));

  // Kok ve slot: yalniz ad/aciklama (spec/74 §4.1-4.2).
  const locked = node.locked !== null;
  // Adi koddan belli dugum (sablon slotu, widget): ad sabit, yalniz aciklama degisir.
  const nameFixed = node.node_type === "widget" || (node.node_type === "operational" && node.attrs.slot !== undefined);
  const nameValid = nameFixed || node.node_type === "operational" || Array.from(name.trim()).length >= 5 || name.trim() === node.name;
  const descValid = bypassQuality || desc.trim() === "" || Array.from(desc.trim()).length >= 30 || desc.trim() === (node.description ?? "");
  // Tur ve shape yalniz serbest kokte (Konular) secilir; sabit kurallarda sunucunun.
  const free = !locked && node.root_key === "units";
  const up = node.parent_id === null ? undefined : byId.get(node.parent_id);
  // Tur secenekleri ustun kuralindan (sunucu); ust yetkisizse yalniz mevcut tur.
  const types = up !== undefined && up.child_types.length > 0 ? up.child_types : [node.node_type];
  const isUnder = (x: TreeNode) => {
    for (let p = x.parent_id; p !== null; p = byId.get(p)?.parent_id ?? null) if (p === node.id) return true;
    return false;
  };
  // Tasima hedefi: ayni kok, kurali bu turu kabul eden, kendi alt agaci degil.
  // Yaklasik — son soz sunucuda (type_not_allowed, move_cycle).
  const targets = tree.nodes.filter(
    (x) =>
      x.id === node.parent_id ||
      (x.id !== node.id && (x.root_key ?? x.key) === node.root_key && x.child_types.includes(type) && !isUnder(x)),
  );

  const save = () => {
    // Yalniz degisen alanlar: verilmeyen alan sunucuda DEGISMEZ.
    const p: NodePatch = {};
    if (name !== node.name) p.name = name;
    const dsc = desc.trim() === "" ? null : desc.trim();
    if (dsc !== node.description) p.description = dsc;
    if (!locked) {
      if (type !== node.node_type) p.node_type = type;
      if (shape !== node.shape) p.shape = shape;
      if (parent !== "" && parent !== node.parent_id) p.parent_id = parent;
      const a = attrsFor(type, offset, widget);
      if (a !== undefined && JSON.stringify(a) !== JSON.stringify(node.attrs)) p.attrs = a;
    }
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
        `${c.records} kayıt, ${c.permissions} dal izni, ${c.teams} takım bağı. Bu geri alınamaz — kapatmak için ` +
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
      {locked && <p className={ui.fieldHint}>Kod tarafından yönetilir: yalnız ad ve açıklama değişir.</p>}
      <div className={ui.grid2}>
        {nameFixed ? (
          <div className={ui.field}>
            <span>Ad</span>
            <input className={ui.input} value={node.name} readOnly aria-readonly="true" />
            <small className={ui.fieldHint}>Ad koddan gelir, değişmez.</small>
          </div>
        ) : (
          <label className={ui.field}>
            <span>Ad<Req /></span>
            <input className={ui.input} value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} autoFocus />
            <small className={ui.fieldHint}>{Array.from(name.trim()).length}/5 karakter</small>
          </label>
        )}
        {free && (
          <div className={ui.field}>
            <span>Tür</span>
            <Picker label="Tür" value={type} onChange={setType} disabled={types.length <= 1}
              options={types.map((t) => ({ value: t, label: TYPE_LABEL[t] }))} />
          </div>
        )}
        {free && (
          <div className={ui.field}>
            <span>Yapı</span>
            <Picker label="Yapı" value={shape} onChange={setShape}
              options={(["tree", "list", "leaf"] as const).map((x) => ({ value: x, label: SHAPE[x] }))} />
          </div>
        )}
        {!locked && (
          <AttrsFields type={type} offset={offset} setOffset={setOffset} widget={widget} setWidget={setWidget} />
        )}
      </div>
      {!locked && (
        <div className={ui.field}>
          <span>Üst düğüm</span>
          <Picker label="Üst düğüm" value={parent} onChange={setParent} search
            options={targets.map((x) => ({ value: x.id, label: x.name, depth: x.depth }))} />
        </div>
      )}
      <div className={ui.field}>
        <span>Açıklama</span>
        <MarkdownField value={desc} onChange={setDesc} label="Açıklama" rows={2}
          placeholder="açıklama — bu düğüm ne kapsıyor?" />
        <small className={ui.fieldHint}>{Array.from(desc.trim()).length}{bypassQuality ? " karakter" : "/30 karakter"} · isteğe bağlı</small>
      </div>
      <div className={ui.dact}>
        {node.can_hard_delete && !locked && (
          <Button variant="danger" className={s.tdelete} onClick={hardDelete} disabled={del.isPending}>
            Kalıcı sil
          </Button>
        )}
        <Button onClick={onClose}>Vazgeç</Button>
        <Button type="submit" variant="primary" aria-busy={m.isPending} disabled={m.isPending || !nameValid || !descValid}>
          {m.isPending ? "Kaydediliyor…" : "Kaydet"}
        </Button>
      </div>
    </form>
  );
}
