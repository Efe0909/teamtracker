// Gorev Yoneticisi. Filtre = gezinme DEGIL (KNOW-234): URL'e replaceState
// ile yazilir, geri tusu sismez ama yenilemede ve paylasilan baglantida kalir.
// Filtreler tek satir cip: bos cip kesikli ("Durum"), etkin cip dolu
// ("Durum: Açık"). Suzme SUNUCUDA.

import { useEffect, useRef, useState } from "react";
import { useRecords, type RecordQuery } from "../../api/hooks";
import type { RecordSummary } from "../../api/types";
import { resolveWidths, clampWidth } from "../../lib/columns";
import { useSort } from "../../lib/sort";
import { useStored } from "../../lib/stored";
import { ago, isDone, KIND, PRIORITY, PRIORITY_ORDER, STATUS, STATUS_ORDER } from "../../lib/labels";
import { useLookup } from "../../lib/lookup";
import { navigate } from "../../lib/router";
import { Icon } from "../../ui/icons";
import { SortTh } from "../../ui/SortTh";
import {
  Avatar, Button, Dialog, Due, Empty, IconButton, KindTag, Link, Loading, Picker, PriorityTag, Segmented, Status, Tag, TeamName, ui, Who,
  type Option,
} from "../../ui/ui";
import { NodeTreePicker } from "../../features/nodes/NodePicker";
import { NewRecordForm } from "../../features/record/NewRecordForm";
import s from "./dashboard.module.css";
import { href } from "./routes";

const QUICK = [
  { value: "all", label: "Hepsi" },
  { value: "week", label: "Bu hafta" },
  { value: "my_actions", label: "Açık eylemim" },
  { value: "overdue", label: "Geciken" },
  { value: "unassigned", label: "Atanmamış" },
] as const;

type Key = keyof RecordQuery;

export function Tasks({ query }: { query: RecordQuery }) {
  const L = useLookup();
  const [creating, setCreating] = useState(false);
  // Arama kutusu yerel; yazmayi 300ms bekleyip URL'e yazar.
  const [search, setSearch] = useState(query.search ?? "");
  const rows = useRecords(query);

  useEffect(() => {
    document.title = "Görevler — EkipTakip";
  }, []);
  useEffect(() => {
    if ((query.search ?? "") === search) return;
    const t = window.setTimeout(() => set({ search }), 300);
    return () => window.clearTimeout(t);
    // `set` her cizimde yeni; bagimlilik bilerek yalniz arama metni.
  }, [search]);

  function set(p: { [K in Key]?: string | undefined }) {
    const next: RecordQuery = { ...query };
    for (const [k, v] of Object.entries(p) as [Key, string | undefined][]) {
      if (v === undefined || v === "") delete next[k];
      else (next as Record<string, string>)[k] = v;
    }
    navigate(href({ name: "tasks", query: next }), { replace: true });
  }

  const data = rows.data ?? [];
  const open = data.filter((r) => !isDone(r.status)).length;
  const any = Object.keys(query).some((k) => k !== "quick");

  // Filtre cipi: bos deger "Hepsi"; secim varsa cip dolu ve degeri gosterir.
  const chip = (k: Key, label: string, options: Option<string>[]) => {
    const v = query[k] ?? "";
    const cur = options.find((o) => o.value === v);
    return (
      <Picker
        look="chip"
        label={label}
        active={v !== ""}
        value={v}
        options={[{ value: "", label: "Hepsi" }, ...options]}
        onChange={(x) => set({ [k]: x })}
      >
        {v === "" ? (
          <>
            <Icon name="plus" size={13} /> {label}
          </>
        ) : (
          <>
            {label}: <b>{cur?.label ?? "?"}</b>
          </>
        )}
      </Picker>
    );
  };

  return (
    <div className={s.page}>
      <div className={s.pageHead}>
        <div className={s.pageTitle}>
          <h1>
            Görevler<span className={s.count}>{data.length}</span>
          </h1>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Icon name="plus" size={15} /> Yeni kayıt
        </Button>
      </div>

      <div className={s.toolbar}>
        <Segmented label="Hızlı filtre" options={[...QUICK]} value={(query.quick ?? "all") as (typeof QUICK)[number]["value"]}
          onChange={(v) => set({ quick: v === "all" ? undefined : v })} />
        <label className={s.search}>
          <Icon name="search" size={15} />
          <span className="visually-hidden">Ara</span>
          <input className={ui.input} type="search" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Başlık veya açıklamada ara…" />
        </label>
      </div>

      <div className={s.filters}>
        <Icon name="filter" size={15} />
        {chip("status", "Durum", STATUS_ORDER.map((v) => ({ value: v, label: STATUS[v], render: <Status status={v} /> })))}
        {chip("person", "Sorumlu", [
          { value: "me", label: "Ben" },
          { value: "none", label: "Sorumlusuz" },
          ...L.meta.users.map((u) => ({ value: u.id, label: u.name, render: <Who user={u} /> })),
        ])}
        {chip("priority", "Öncelik", PRIORITY_ORDER.map((v) => ({ value: v, label: PRIORITY[v], render: <PriorityTag priority={v} bare /> })))}
        <NodeTreePicker rootKey="units" look="chip" label="Birim" value={query.node ?? null} onChange={(id) => set({ node: id })}>
          {query.node === undefined ? <><Icon name="plus" size={13} /> Birim</> : <>Birim: <b>{L.node(query.node)?.name ?? "?"}</b></>}
        </NodeTreePicker>
        {query.node !== undefined && <IconButton icon="x" label="Birim süzgecini kaldır" onClick={() => set({ node: undefined })} />}
        {chip("team", "Takım", L.plainTeams.map((t) => ({ value: t.id, label: t.name, render: <TeamName team={t} /> })))}
        {chip("kind", "Tür", [{ value: "issue", label: KIND.issue }, { value: "task", label: KIND.task }])}
        {L.pillars.length > 0 &&
          chip("pillar", "Pillar", [{ value: "none", label: "Pillar yok" }, ...L.pillars.map((n) => ({ value: n.id, label: n.name }))])}
        {any && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(""); navigate(href({ name: "tasks", query: {} }), { replace: true }); }}>
            Temizle
          </Button>
        )}
        <span className={s.summary} aria-live="polite">
          {rows.isFetching ? "yükleniyor · " : ""}
          {open} açık · {data.length - open} kapalı
        </span>
      </div>

      {rows.data === undefined ? <Loading /> : <RecordTable rows={data} />}

      <Dialog open={creating} onClose={() => setCreating(false)} title="Yeni kayıt" wide>
        <NewRecordForm
          onCancel={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            navigate(href({ name: "record", id }));
          }}
        />
      </Dialog>
    </div>
  );
}

/** Tablo: gorev listesi ve takim sayfasi AYNI satiri cizer. */
type ColKey = "title" | "status" | "priority" | "owner" | "due" | "unit" | "team" | "updated";
const COLS: { key: ColKey; label: string; width: number }[] = [
  { key: "title", label: "Kayıt", width: 340 },
  { key: "status", label: "Durum", width: 130 },
  { key: "priority", label: "Öncelik", width: 110 },
  { key: "owner", label: "Sorumlu", width: 150 },
  { key: "due", label: "Son tarih", width: 140 },
  { key: "unit", label: "Birim", width: 170 },
  { key: "team", label: "Takım", width: 130 },
  { key: "updated", label: "Hareket", width: 100 },
];
const DEFAULTS = Object.fromEntries(COLS.map((c) => [c.key, c.width])) as Record<ColKey, number>;

/** `sortKey`: siralama tablo basina saklanir; Gorevler ile takim sayfasi ayri hatirlar. */
export function RecordTable({ rows, showTeam = true, sortKey = "records" }: {
  rows: RecordSummary[]; showTeam?: boolean; sortKey?: string;
}) {
  const L = useLookup();
  const [saved, setSaved] = useStored<Record<string, number>>("table.cols", {});
  const widths = resolveWidths(DEFAULTS, saved);
  const drag = useRef<{ key: ColKey; x: number; w: number } | null>(null);
  const cols = COLS.filter((c) => showTeam || c.key !== "team");
  const sorter = useSort(sortKey, rows, {
    title: (r) => r.title,
    status: (r) => STATUS_ORDER.indexOf(r.status),
    priority: (r) => PRIORITY_ORDER.indexOf(r.priority),
    owner: (r) => L.user(r.owner_id)?.name,
    due: (r) => r.due_date,
    unit: (r) => L.path(r.unit_id).at(-1),
    team: (r) => L.team(r.team_id)?.name,
    updated: (r) => r.updated_at,
  });
  // Surukleme: imlec yakalanir, birakinca genislik cihaza yazilir.
  const start = (key: ColKey) => (e: React.PointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { key, x: e.clientX, w: widths[key] };
  };
  const move = (e: React.PointerEvent<HTMLSpanElement>) => {
    const d = drag.current;
    if (d !== null) setSaved({ ...saved, [d.key]: clampWidth(d.w + e.clientX - d.x) });
  };
  const end = () => { drag.current = null; };
  if (rows.length === 0) {
    return (
      <div className={s.tableWrap}>
        <Empty title="Kayıt yok" icon="search">Bu filtrelere uyan kayıt bulunamadı.</Empty>
      </div>
    );
  }
  return (
    <div className={s.tableWrap}>
      <table className={s.table} style={{ tableLayout: "fixed", width: cols.reduce((n, c) => n + widths[c.key], 0) }}>
        <colgroup>
          {cols.map((c) => <col key={c.key} style={{ width: widths[c.key] }} />)}
        </colgroup>
        <thead>
          <tr>
            {cols.map((c) => (
              <SortTh key={c.key} sorter={sorter} k={c.key} label={c.label}>
                <span className={s.colGrip} role="separator" aria-label={`${c.label} sütun genişliği`}
                  onPointerDown={start(c.key)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
                  onDoubleClick={() => setSaved(Object.fromEntries(Object.entries(saved).filter(([k]) => k !== c.key)))} />
              </SortTh>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorter.rows.map((r) => {
            const to = href({ name: "record", id: r.id });
            const path = L.path(r.unit_id);
            const owner = L.user(r.owner_id);
            return (
              // Satirin tamami tiklanir; klavye/ekran okuyucu icin baslik bir baglanti.
              <tr key={r.id} onClick={(e) => { if (!(e.target as HTMLElement).closest("a")) navigate(to); }}>
                <td>
                  <span className={s.rowTitle}>
                    <Link href={to}>{r.title}</Link>
                    <KindTag kind={r.kind} />
                    {/* Etkinligin ikiziyse etiket etkinlige goturur (spec/73 §3a). */}
                    {r.event_id !== null && (
                      <Link href={href({ name: "event", id: r.event_id })} className={s.evTag} title="Bu kayıt bir etkinliğin kaydı — etkinliğe git">
                        <Tag tone="neutral"><Icon name="calendar" size={12} /> Etkinlik</Tag>
                      </Link>
                    )}
                    {r.messages > 0 && (
                      <span className={s.msgs} title={`${r.messages} mesaj`}>
                        <Icon name="chat" size={13} /> {r.messages}
                      </span>
                    )}
                  </span>
                </td>
                <td><Status status={r.status} /></td>
                <td><PriorityTag priority={r.priority} bare /></td>
                <td>
                  {owner === undefined ? <span className={s.dim}>—</span> : (
                    <span title={owner.name} style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                      <Avatar user={owner} size={20} /> {owner.name}
                    </span>
                  )}
                </td>
                <td><Due date={r.due_date} done={isDone(r.status)} actionLate={r.action_overdue} /></td>
                <td className={s.unit} title={path.join(" › ")}>{path[path.length - 1] ?? "?"}</td>
                {showTeam && <td><TeamName team={L.team(r.team_id)} /></td>}
                <td className={s.nowrap}>{ago(r.updated_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
