// Maliye > satin alimlar (spec/81 §7): Malzemeler (butun kalemler, kuyruklar),
// etkinlikten bagimsiz kalemlerin 3 sutunlu duvari ve tedarikciler. Etkinlik
// kalemi etkinlik sayfasindaki widget'ta yonetilir; burada izlenir ve
// "satin alindi" isaretlenir.

import { useEffect, useRef, useState, type DragEvent } from "react";
import { errorText } from "../../api/client";
import {
  useMaterialFull, useMaterialRun, useMaterialsQueue, usePurchaseWrite, useVendor, useVendors, useVendorWrite, useWall,
  type PurchaseOp,
} from "../../api/hooks";
import type { IsoDate, Ledger, MaterialType, MatQueue, MatRow, MetaNode, Uuid, VendorIn, VendorRow } from "../../api/types";
import { ago, daysFromToday, dueLabel, formatDay, toIsoDay } from "../../lib/labels";
import { useLookup } from "../../lib/lookup";
import { money, parseAmount } from "../../lib/money";
import { navigate } from "../../lib/router";
import { DateField } from "../../ui/DateField";
import { Button, cx, Link, Loading, Picker, Segmented, ui, useToast } from "../../ui/ui";
import { MATERIAL_STAGE, MATERIAL_TYPE } from "./eventModel";
import { fin, INVOICE_STATUS, StatusTag } from "./Finance";
import s from "./fin.module.css";
import { MaterialDetail } from "./MaterialDetail";
import type { Run } from "./purchaseParts";
import p from "./purchases.module.css";
import { href } from "./routes";

const LEDGER: Record<Ledger, { label: string; tone: string }> = {
  seb: { label: "SEB", tone: s.tInfo ?? "" },
  general: { label: "Genel", tone: s.tAcc ?? "" },
};

function useDebounced(v: string, ms = 250): string {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d.trim();
}

function useCategories(): MetaNode[] {
  const L = useLookup();
  return L.meta.nodes.filter((n) => n.node_type === "category" && n.is_active);
}

function CategoryTag({ id, cats }: { id: Uuid | null; cats: MetaNode[] }) {
  const c = cats.find((x) => x.id === id);
  if (c === undefined) return null;
  const l = c.attrs.ledger;
  return <span className={cx(s.tag, l === undefined ? "" : LEDGER[l].tone)} title={l === undefined ? undefined : LEDGER[l].label}>{c.name}</span>;
}

function stateTag(m: MatRow): { label: string; tone: string } {
  if (m.owned) return { label: "Zaten var", tone: "" };
  if (m.delivered) return { label: "Teslim edildi", tone: s.tOk ?? "" };
  if (m.purchased) return { label: "Satın alındı", tone: s.tInfo ?? "" };
  if (m.state === 3) return { label: "Onaylı", tone: s.tWarn ?? "" };
  return { label: MATERIAL_STAGE[m.state] ?? "", tone: "" };
}

function priceText(m: MatRow): string {
  if (m.owned) return "";
  if (m.sponsor_chosen) return "Sponsor";
  // Teklif fiyati kalemin toplami (etkinlik widget'iyla ayni), birim degil.
  return m.price === null ? "—" : money(m.price);
}

// --- Malzemeler -----------------------------------------------------------------

// Durum cipi (kuyruk) sade bir filtredir; hazir ayarlar yalniz GORUNEN cipleri doldurur
// (gizli sorgu yok), kullanici sonra tek tek degistirir.
const QUEUES: { value: MatQueue; label: string }[] = [
  { value: "review", label: "Alınacak" },
  { value: "ship", label: "Teslim bekliyor" },
  { value: "invoice", label: "Faturasız" },
  { value: "open", label: "Hazırlanıyor" },
  { value: "all", label: "Tümü" },
];

type EventFilter = { id: Uuid; title: string } | "none" | null;
type RangeKey = "" | "week" | "month" | "past" | "custom";
const RANGES_LABEL: Record<RangeKey, string> = {
  "": "Her tarih", week: "Önümüzdeki 7 gün", month: "Önümüzdeki 30 gün", past: "Geçmiş (geciken)", custom: "Aralık seç…",
};

function plusDays(n: number): IsoDate {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return toIsoDay(d);
}

function rangeDates(k: RangeKey, custom: { from: IsoDate | null; to: IsoDate | null }): { from?: IsoDate; to?: IsoDate } {
  switch (k) {
    case "week": return { from: plusDays(0), to: plusDays(7) };
    case "month": return { from: plusDays(0), to: plusDays(30) };
    case "past": return { to: plusDays(-1) };
    case "custom": return { ...(custom.from !== null ? { from: custom.from } : {}), ...(custom.to !== null ? { to: custom.to } : {}) };
    default: return {};
  }
}

/** Hazir ayar: durum + tarih araligi + etkinlik cipini doldurur; baska hicbir sey yapmaz. */
const PRESETS: { key: string; label: string; queue: MatQueue; range: RangeKey; event: "none" | null }[] = [
  { key: "week", label: "Bu hafta alınacak", queue: "review", range: "week", event: null },
  { key: "late", label: "Geciken", queue: "review", range: "past", event: null },
  { key: "ship", label: "Teslim bekleyen", queue: "ship", range: "", event: null },
  { key: "invoice", label: "Faturası eksik", queue: "invoice", range: "", event: null },
  { key: "noevent", label: "Etkinliksiz", queue: "all", range: "", event: "none" },
];

type Group = { key: string; rows: MatRow[] };

/** Ayni (normalize) adli kalemler tek grup; sira ilk gorulen satira gore. */
function groupRows(rows: MatRow[]): Group[] {
  const map = new Map<string, Group>();
  for (const r of rows) {
    const key = r.group_key === "" ? r.id : r.group_key;
    const g = map.get(key);
    if (g === undefined) map.set(key, { key, rows: [r] });
    else g.rows.push(r);
  }
  return [...map.values()];
}

export function FinanceMaterials() {
  const L = useLookup();
  const cats = useCategories();
  const toast = useToast();
  const canBuy = L.can("review_purchases");
  const [queue, setQueue] = useState<MatQueue>("review");
  const [event, setEvent] = useState<EventFilter>(null);
  const [kind, setKind] = useState<MaterialType | "">("");
  const [category, setCategory] = useState<Uuid | "">("");
  const [range, setRange] = useState<RangeKey>("");
  const [custom, setCustom] = useState<{ from: IsoDate | null; to: IsoDate | null }>({ from: null, to: null });
  const [text, setText] = useState("");
  const q = useDebounced(text);
  const [picked, setPicked] = useState<ReadonlySet<Uuid>>(new Set());
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [detail, setDetail] = useState<Uuid | null>(null);
  const dates = rangeDates(range, custom);
  const list = useMaterialsQueue({
    queue,
    ...(event === "none" ? { event: "none" } : event !== null ? { event: event.id } : {}),
    ...(kind !== "" ? { kind } : {}),
    ...(category !== "" ? { category } : {}),
    ...(q !== "" ? { q } : {}),
    ...dates,
  });
  const w = usePurchaseWrite();
  const selectable = queue === "review" && canBuy;
  const rows = list.data?.rows ?? [];
  const sum = rows.reduce((a, m) => a + (m.owned ? 0 : m.price ?? 0), 0);
  const groups = groupRows(rows);

  // Etkinlik secenekleri: yuklu satirlardan (secili olan her zaman listede).
  const events = new Map<Uuid, string>();
  if (event !== null && event !== "none") events.set(event.id, event.title);
  for (const m of rows) if (m.event_id !== null) events.set(m.event_id, m.event_title ?? "Etkinlik");
  const eventValue = event === null ? "" : event === "none" ? "none" : event.id;

  const presetOn = (p: (typeof PRESETS)[number]) =>
    queue === p.queue && range === p.range && (event === "none" ? "none" : event === null ? null : "x") === p.event
    && kind === "" && category === "" && text === "";
  const applyPreset = (p: (typeof PRESETS)[number]) => {
    if (presetOn(p)) { setQueue("review"); setRange(""); setEvent(null); return; }
    setQueue(p.queue); setRange(p.range); setEvent(p.event); setKind(""); setCategory(""); setText("");
    setPicked(new Set());
  };

  const markBought = async () => {
    const ids = [...picked];
    const res = await Promise.allSettled(ids.map((id) => w.mutateAsync({ op: "purchased", id, purchased: true })));
    const failed = res.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    setPicked(new Set());
    if (failed.length === 0) toast({ text: `${ids.length} kalem satın alındı olarak işaretlendi`, error: false });
    else toast({ text: `${failed.length} kalem işaretlenemedi: ${errorText(failed[0]?.reason)}`, error: true });
  };

  const toggle = (ids: Uuid[], on: boolean) => {
    const next = new Set(picked);
    for (const id of ids) if (on) next.add(id); else next.delete(id);
    setPicked(next);
  };

  const item = (m: MatRow, nested: boolean) => {
    const st = stateTag(m);
    const due = m.event_date ?? m.needed_by;
    return (
      <div key={m.id} role="button" tabIndex={0} aria-label={`${m.name}, ayrıntıyı aç`}
        className={cx(s.row, s.clickRow, selectable ? s.rMatSel : s.rMat, nested && s.nested)}
        onClick={(e) => { if (!(e.target as HTMLElement).closest("a, input, button")) setDetail(m.id); }}
        onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setDetail(m.id); } }}>
        {selectable && (
          <input type="checkbox" aria-label={`${m.name} seç`} checked={picked.has(m.id)}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => toggle([m.id], e.target.checked)} />
        )}
        <span className={s.t}>
          <b>{m.name}{m.qty > 1 ? ` ×${m.qty}` : ""}</b>
          <span>
            {m.event_id !== null
              ? <Link href={href({ name: "event", id: m.event_id })}>{m.event_title}</Link>
              : "Etkinliksiz"}
            {due !== null && ` · ${formatDay(due)}`}
            {m.supplier !== null && ` · ${m.supplier}`}
            {m.eta !== null && ` · varış ${formatDay(m.eta)}`}
          </span>
        </span>
        <span className={s.tags}>
          <CategoryTag id={m.category_id} cats={cats} />
          <StatusTag {...st} />
          {m.purchased && <StatusTag label={m.invoiced ? "Faturalı" : "Faturasız"} tone={m.invoiced ? s.tOk ?? "" : s.tWarn ?? ""} />}
        </span>
        <span className={s.num}>{priceText(m)}</span>
      </div>
    );
  };

  const groupRow = (g: Group) => {
    if (g.rows.length === 1) return item(g.rows[0] as MatRow, false);
    const first = g.rows[0] as MatRow;
    const isOpen = open.has(g.key);
    const eventsN = new Set(g.rows.flatMap((r) => (r.event_id === null ? [] : [r.event_id]))).size;
    const free = g.rows.filter((r) => r.event_id === null).length;
    const suppliers = [...new Set(g.rows.flatMap((r) => (r.supplier === null ? [] : [r.supplier])))];
    const qty = g.rows.reduce((a, r) => a + r.qty, 0);
    const total = g.rows.reduce((a, r) => a + (r.owned ? 0 : r.price ?? 0), 0);
    const ids = g.rows.map((r) => r.id);
    const all = ids.every((id) => picked.has(id));
    return (
      <div key={g.key}>
        <div className={cx(s.row, selectable ? s.rMatSel : s.rMat, s.groupRow)}>
          {selectable && (
            <input type="checkbox" aria-label={`${first.name}: hepsini seç`} checked={all}
              onChange={(e) => toggle(ids, e.target.checked)} />
          )}
          <button type="button" className={s.groupBtn} aria-expanded={isOpen}
            onClick={() => { const n = new Set(open); if (isOpen) n.delete(g.key); else n.add(g.key); setOpen(n); }}>
            <span className={s.t}>
              <b>{first.name}{qty > 1 ? ` ×${qty}` : ""}</b>
              <span>
                {eventsN > 0 && `${eventsN} etkinlik`}
                {eventsN > 0 && free > 0 && " · "}
                {free > 0 && `${free} etkinliksiz`}
                {` · ${g.rows.length} kalem`}
                {suppliers.length > 0 && ` · ${suppliers.slice(0, 2).join(", ")}${suppliers.length > 2 ? ` +${suppliers.length - 2}` : ""}`}
              </span>
            </span>
          </button>
          <span className={s.tags}><span className={s.tag}>{isOpen ? "Daralt" : "Aç"}</span></span>
          <span className={s.num}>{total > 0 ? money(total) : "—"}</span>
        </div>
        {isOpen && g.rows.map((r) => item(r, true))}
      </div>
    );
  };

  return (
    <div className={s.panel}>
      <div className={s.ph}>
        <h2>Malzemeler</h2>
        <span className={s.sub}>{groups.length} ad · {rows.length} kalem · {money(sum)}</span>
        <span className={s.grow} />
      </div>
      <div className={s.filters}>
        <span className={s.chips} role="group" aria-label="Hazır ayarlar">
          {PRESETS.map((p) => (
            <button key={p.key} type="button" className={s.fchip} aria-pressed={presetOn(p)} onClick={() => applyPreset(p)}>
              {p.label}
            </button>
          ))}
        </span>
      </div>
      <div className={s.filters}>
        <input className={cx(ui.input, s.search)} type="search" value={text} onChange={(e) => setText(e.target.value)}
          placeholder="Kalem ya da tedarikçi ara" aria-label="Kalem ya da tedarikçi ara" />
        <Picker look="chip" label="Durum" value={queue} active={queue !== "review"}
          onChange={(v) => { setQueue(v); setPicked(new Set()); }}
          options={QUEUES.map((x) => ({ value: x.value, label: `${x.label} (${list.data?.counts[x.value] ?? 0})` }))} />
        <Picker look="chip" label="Tarih" value={range} active={range !== ""} onChange={setRange}
          options={(Object.keys(RANGES_LABEL) as RangeKey[]).map((k) => ({ value: k, label: RANGES_LABEL[k] }))} />
        {range === "custom" && (
          <>
            <DateField aria-label="Başlangıç" placeholder="Başlangıç" value={custom.from} clearable
              onChange={(v) => setCustom({ ...custom, from: v })} />
            <DateField aria-label="Bitiş" placeholder="Bitiş" value={custom.to} clearable
              onChange={(v) => setCustom({ ...custom, to: v })} />
          </>
        )}
        <Picker look="chip" label="Etkinlik" value={eventValue} active={event !== null}
          onChange={(v) => setEvent(v === "" ? null : v === "none" ? "none" : { id: v, title: events.get(v) ?? "Etkinlik" })}
          options={[
            { value: "", label: "Bütün etkinlikler" },
            { value: "none", label: "Etkinliksiz" },
            ...[...events].map(([id, title]) => ({ value: id, label: title })),
          ]} />
        <Picker look="chip" label="Tür" value={kind} active={kind !== ""} onChange={setKind}
          options={[{ value: "" as const, label: "Bütün türler" },
            ...(Object.keys(MATERIAL_TYPE) as MaterialType[]).map((k) => ({ value: k, label: MATERIAL_TYPE[k] }))]} />
        <Picker look="chip" label="Kategori" value={category} active={category !== ""} onChange={setCategory}
          options={[{ value: "", label: "Bütün kategoriler" }, ...cats.map((c) => ({ value: c.id, label: c.name }))]} />
      </div>
      {selectable && picked.size > 0 && (
        <div className={s.bulk}>
          <span>{picked.size} kalem seçili</span>
          <span className={s.grow} />
          <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>Seçimi kaldır</Button>
          <Button size="sm" variant="primary" disabled={w.isPending} onClick={() => void markBought()}>Satın alındı işaretle</Button>
        </div>
      )}
      {list.error !== null ? <p role="alert" className={s.empty}>{errorText(list.error)}</p>
        : list.data === undefined ? <Loading />
        : rows.length === 0 ? <div className={s.empty}>Bu süzgeçte kalem yok.</div>
        : <div className={s.list}>{groups.map(groupRow)}</div>}
      {queue === "review" && !canBuy && (
        <p className={cx(s.sub, s.foot)}>Satın alındı işaretlemek için “Satın alımları incele” yetkisi gerekir.</p>
      )}
      {detail !== null && <MaterialDetailHost id={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

/** Kalem ayrintisi (Malzemeler ve duvar ortak): etkinlik widget'inin ayni penceresi;
 *  etkinliksiz kalemde de calisir. Ek olarak etkinlik, kategori ve faturalar. */
function MaterialDetailHost({ id, onClose }: { id: Uuid; onClose: () => void }) {
  const L = useLookup();
  const cats = useCategories();
  const toast = useToast();
  const q = useMaterialFull(id);
  const w = useMaterialRun();
  const run: Run = (op, ok) =>
    w.mutate(op, { onSuccess: () => ok?.(), onError: (e) => toast({ text: errorText(e), error: true }) });
  useEffect(() => {
    if (q.error !== null) {
      toast({ text: errorText(q.error), error: true });
      onClose();
    }
  }, [q.error, toast, onClose]);
  const d = q.data;
  if (d === undefined) return null;
  const extra = (
    <div className={p.sec}>
      <div className={p.label}>Maliye</div>
      <p className={p.note}>
        {d.event_id !== null
          ? <>Etkinlik: <Link href={href({ name: "event", id: d.event_id })}>{d.event_title}</Link>{d.event_date !== null && ` · ${formatDay(d.event_date)}`}</>
          : <>Etkinliksiz{d.needed_by !== null && ` · gerektiği gün ${formatDay(d.needed_by)}`}</>}
        {d.category_id !== null && <> · <CategoryTag id={d.category_id} cats={cats} /></>}
      </p>
      {d.invoices.length === 0
        ? <p className={p.note}>Bu kaleme bağlı fatura yok.</p>
        : d.invoices.map((i) => (
          <Link key={i.id} href={fin("invoices", i.id)} className={p.note}>
            {formatDay(i.purchased_on)} · {INVOICE_STATUS[i.status].label} · {money(i.amount)}
          </Link>
        ))}
    </div>
  );
  return (
    <MaterialDetail m={d.material} eventDate={d.event_date} canEdit={L.can("manage_purchases")}
      canBudget={L.can("manage_budgets")} busy={w.isPending} run={run} onClose={onClose} extra={extra} />
  );
}

// --- Satin alim duvari -----------------------------------------------------------

type ColKey = "prep" | "tobuy" | "bought";
const COLS: { key: ColKey; name: string; empty: string }[] = [
  { key: "prep", name: "Hazırlanıyor", empty: "Onay bekleyen kalem yok." },
  { key: "tobuy", name: "Alınacak", empty: "Bu aralıkta alınacak kalem yok." },
  { key: "bought", name: "Alındı", empty: "Bu aralıkta alınan yok." },
];
const RANGES = [7, 30, 90, 0];
const PAGE = 50;

function colOf(m: MatRow): ColKey {
  return m.purchased ? "bought" : m.state === 3 ? "tobuy" : "prep";
}

function rangeOptions(current: number) {
  const all = RANGES.includes(current) ? RANGES : [...RANGES, current].sort((a, b) => (a || 1e9) - (b || 1e9));
  return all.map((n) => ({ value: n, label: n === 0 ? "tümü" : `${n} gün` }));
}

export function FinanceWall() {
  const L = useLookup();
  const cats = useCategories();
  const toast = useToast();
  const canEdit = L.can("manage_purchases");
  const canBuy = L.can("review_purchases");
  const [ahead, setAhead] = useState<number | null>(null);
  const [back, setBack] = useState<number | null>(null);
  const [ledger, setLedger] = useState<Ledger | "">("");
  const [category, setCategory] = useState<Uuid | "">("");
  const [text, setText] = useState("");
  const q = useDebounced(text);
  const [limits, setLimits] = useState<Record<ColKey, number>>({ prep: PAGE, tobuy: PAGE, bought: PAGE });
  const [over, setOver] = useState<ColKey | null>(null);
  const [detail, setDetail] = useState<Uuid | null>(null);
  const dragging = useRef<MatRow | null>(null);
  const wall = useWall({
    ...(ahead !== null ? { ahead } : {}),
    ...(back !== null ? { back } : {}),
    ...(ledger !== "" ? { ledger } : {}),
    ...(category !== "" ? { category } : {}),
    ...(q !== "" ? { q } : {}),
    limit_prep: limits.prep, limit_tobuy: limits.tobuy, limit_bought: limits.bought,
  });
  const w = usePurchaseWrite();
  const fail = (e: unknown) => toast({ text: errorText(e), error: true });

  /** Sutun degisimi: hazirlik <-> alinacak `state`, alinacak <-> alindi satin alma isareti. */
  const move = async (m: MatRow, to: ColKey) => {
    const from = colOf(m);
    if (from === to) return;
    if (from === "bought" && to === "prep") {
      toast({ text: "Satın alınmış kalem önce “Alınacak”a geri alınır.", error: true });
      return;
    }
    const ops: PurchaseOp[] = [];
    if (from === "bought") ops.push({ op: "purchased", id: m.id, purchased: false });
    if (to === "prep") ops.push({ op: "patch", id: m.id, state: 2 });
    if (from === "prep") ops.push({ op: "patch", id: m.id, state: 3 });
    if (to === "bought") ops.push({ op: "purchased", id: m.id, purchased: true });
    try {
      for (const op of ops) await w.mutateAsync(op);
    } catch (e) {
      fail(e);
    }
  };
  const allowed = (m: MatRow, to: ColKey): boolean => {
    const from = colOf(m);
    if (from === to || (from === "bought" && to === "prep")) return false;
    const needsEdit = from === "prep" || to === "prep";
    const needsBuy = from === "bought" || to === "bought";
    return (!needsEdit || canEdit) && (!needsBuy || canBuy);
  };

  const target = (key: ColKey) => ({
    onDragOver: (e: DragEvent) => {
      const m = dragging.current;
      if (m === null || !allowed(m, key)) return;
      e.preventDefault();
      setOver(key);
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === key ? null : o));
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      const m = dragging.current;
      dragging.current = null;
      setOver(null);
      if (m !== null && allowed(m, key)) void move(m, key);
    },
  });

  if (wall.error !== null) return <p role="alert">{errorText(wall.error)}</p>;
  if (wall.data === undefined) return <Loading />;
  const v = wall.data;
  const counts = v.categories;

  const card = (m: MatRow) => {
    const col = colOf(m);
    const late = col !== "bought" && m.needed_by !== null && daysFromToday(m.needed_by) < 0;
    const draggable = (["prep", "tobuy", "bought"] as const).some((k) => allowed(m, k));
    return (
      <div key={m.id} role="button" tabIndex={0} aria-label={`${m.name}, ayrıntıyı aç`}
        className={cx(p.mcard, late && p.mcardCrit)} draggable={draggable}
        onClick={() => setDetail(m.id)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDetail(m.id); } }}
        onDragStart={(e) => {
          dragging.current = m;
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", m.id);
          e.currentTarget.classList.add(p.dragging ?? "");
        }}
        onDragEnd={(e) => {
          dragging.current = null;
          setOver(null);
          e.currentTarget.classList.remove(p.dragging ?? "");
        }}>
        <div className={p.mcTop}>
          <span className={p.mcName}>{m.name}{m.qty > 1 ? ` ×${m.qty}` : ""}</span>
        </div>
        <div className={p.mcMeta}>
          <CategoryTag id={m.category_id} cats={cats} />
          {col === "bought"
            ? <>
                {m.purchased_at !== null && <span className={p.tag}>{ago(m.purchased_at)}</span>}
                <span className={cx(p.tag, m.invoiced ? p.tagOk : p.tagErr)}>{m.invoiced ? "Faturalı" : "Faturasız"}</span>
              </>
            : m.needed_by !== null && <span className={cx(p.tag, late && p.tagErr)}>{dueLabel(m.needed_by)}</span>}
          {col === "prep" && <span className={p.tag}>{MATERIAL_STAGE[m.state]}</span>}
          <span className={p.price}>{priceText(m)}</span>
        </div>
        {m.supplier !== null && <span className={s.cardSub}>{m.supplier}</span>}
      </div>
    );
  };

  return (
    <div className={s.panel}>
      <div className={s.ph}>
        <h2>Satın alım duvarı</h2>
        <span className={s.sub}>etkinlikten bağımsız kalemler</span>
        <span className={s.grow} />
        <span className={s.sub}>Alınacak: önümüzdeki</span>
        <Picker look="chip" label="Alınacak aralığı" value={ahead ?? v.ahead} onChange={(n) => setAhead(n)} options={rangeOptions(v.ahead)} />
        <span className={s.sub}>Alındı: son</span>
        <Picker look="chip" label="Alındı aralığı" value={back ?? v.back} onChange={(n) => setBack(n)} options={rangeOptions(v.back)} />
      </div>
      <div className={s.filters}>
        <input className={cx(ui.input, s.search)} type="search" value={text} onChange={(e) => setText(e.target.value)}
          placeholder="Kalem ara" aria-label="Kalem ara" />
        <Segmented label="Kaynak" value={ledger} onChange={setLedger}
          options={[{ value: "", label: "Tümü" }, { value: "seb", label: "SEB" }, { value: "general", label: "Genel" }]} />
        <span className={s.chips} role="group" aria-label="Kategori">
          {cats.filter((c) => ledger === "" || c.attrs.ledger === ledger).map((c) => (
            <button key={c.id} type="button" className={s.fchip} aria-pressed={category === c.id}
              onClick={() => setCategory(category === c.id ? "" : c.id)}>
              {c.name}<span className={s.count}>{counts[c.id] ?? 0}</span>
            </button>
          ))}
        </span>
      </div>
      <div className={s.pb}>
        <div className={p.board}>
          {COLS.map((c) => {
            const col = v[c.key];
            return (
              <section key={c.key} aria-label={c.name} className={cx(p.col, over === c.key && p.over)} {...target(c.key)}>
                <div className={p.colHead}>
                  <b>{c.name}</b><span className={p.colCount}>{col.total}</span>
                  <span className={p.colSum}>{col.sum > 0 ? money(col.sum) : ""}</span>
                </div>
                {col.hidden > 0 && <span className={s.cardSub}>+{col.hidden} aralık dışında</span>}
                {c.key === "prep" && canEdit && <NewItem cats={cats} />}
                {col.items.length === 0 ? <p className={p.empty}>{c.empty}</p> : col.items.map(card)}
                {col.items.length < col.total && (
                  <Button size="sm" variant="ghost" onClick={() => setLimits({ ...limits, [c.key]: limits[c.key] + PAGE })}>
                    {col.total - col.items.length} kalem daha
                  </Button>
                )}
              </section>
            );
          })}
        </div>
      </div>
      {detail !== null && <MaterialDetailHost id={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

/** Tek satir ad; yazinca kategori (zorunlu), tarih, adet, tedarikci ve fiyat acilir. */
function NewItem({ cats }: { cats: MetaNode[] }) {
  const toast = useToast();
  const w = usePurchaseWrite();
  const vendors = useVendors("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState<Uuid | "">("");
  const [due, setDue] = useState("");
  const [qty, setQty] = useState("1");
  const [vendor, setVendor] = useState("");
  const [price, setPrice] = useState("");
  const open = name.trim() !== "";
  const submit = () => {
    if (category === "") return toast({ text: "Bir bütçe kategorisi seç.", error: true });
    const n = Number(qty);
    const known = vendors.data?.find((x) => x.name.toLocaleLowerCase("tr") === vendor.trim().toLocaleLowerCase("tr"));
    const amount = price.trim() === "" ? null : parseAmount(price);
    if (price.trim() !== "" && amount === null) return toast({ text: "Fiyatı sayı olarak yaz.", error: true });
    w.mutate({
      op: "create", name: name.trim(), category_id: category,
      ...(due !== "" ? { needed_by: due } : {}),
      ...(Number.isInteger(n) && n > 1 ? { qty: n } : {}),
      ...(vendor.trim() !== "" ? {
        offer: { ...(known !== undefined ? { vendor_id: known.id } : { name: vendor.trim() }), ...(amount !== null ? { price: amount } : {}) },
      } : {}),
    }, {
      onSuccess: () => { setName(""); setDue(""); setQty("1"); setVendor(""); setPrice(""); },
      onError: (e) => toast({ text: errorText(e), error: true }),
    });
  };
  return (
    <form className={open ? s.addCard : p.addForm} onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <input className={open ? ui.input : undefined} value={name} onChange={(e) => setName(e.target.value)}
        placeholder="Kalem ekle" aria-label="Yeni kalem" maxLength={200} autoComplete="off" />
      {open && (
        <>
          <Picker label="Kategori" value={category} onChange={setCategory} placeholder="Kategori seç"
            options={[{ value: "", label: "Kategori seç" }, ...cats.map((c) => ({ value: c.id, label: c.name }))]} />
          <div className={s.formRow}>
            <label>Gerektiği gün<input className={ui.input} type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
            <label>Adet<input className={cx(ui.input, s.narrow)} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
          </div>
          <div className={s.formRow}>
            <label>Tedarikçi
              <input className={ui.input} list="wall-vendors" value={vendor} onChange={(e) => setVendor(e.target.value)} maxLength={200} />
            </label>
            <label>Fiyat (₺)<input className={cx(ui.input, s.narrow)} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0,00" /></label>
          </div>
          <datalist id="wall-vendors">
            {(vendors.data ?? []).map((x) => <option key={x.id} value={x.name} />)}
          </datalist>
          <div className={ui.dact}>
            <Button type="button" variant="ghost" size="sm" onClick={() => setName("")}>Vazgeç</Button>
            <Button type="submit" variant="primary" size="sm" disabled={w.isPending}>Ekle</Button>
          </div>
        </>
      )}
    </form>
  );
}

// --- Tedarikciler -----------------------------------------------------------------

export function FinanceVendors({ id }: { id: string | null }) {
  const L = useLookup();
  const canEdit = L.can("manage_purchases");
  const [text, setText] = useState("");
  const q = useDebounced(text);
  const list = useVendors(q);
  const [adding, setAdding] = useState(false);
  return (
    <div className={s.split}>
      <div className={s.panel}>
        <div className={s.ph}>
          <h2>Tedarikçiler</h2>
          {list.data !== undefined && <span className={s.sub}>{list.data.length}</span>}
          <span className={s.grow} />
          {canEdit && !adding && <Button size="sm" variant="primary" onClick={() => setAdding(true)}>Yeni tedarikçi</Button>}
        </div>
        {adding && <VendorForm vendor={null} onClose={() => setAdding(false)} />}
        <div className={s.filters}>
          <input className={cx(ui.input, s.search)} type="search" value={text} onChange={(e) => setText(e.target.value)}
            placeholder="Ad ya da eski ad ara" aria-label="Tedarikçi ara" />
        </div>
        {list.data === undefined ? <Loading /> : list.data.length === 0 ? (
          <div className={s.empty}>{q === "" ? "Henüz tedarikçi yok. Teklif ya da fatura girildikçe burada toplanır." : "Eşleşen tedarikçi yok."}</div>
        ) : (
          <div className={s.list}>
            {list.data.map((v) => (
              <Link key={v.id} href={fin("vendors", v.id)} className={cx(s.row, s.rInv)} aria-current={v.id === id ? "page" : undefined}>
                <span className={s.t}>
                  <b>{v.name}</b>
                  <span>{[v.contact, v.aliases.length > 0 ? `aynı: ${v.aliases.join(", ")}` : null].filter(Boolean).join(" · ") || "—"}</span>
                </span>
                <span className={s.sub}>{v.event_count > 0 && `${v.event_count} etkinlik · `}{v.offer_count} teklif</span>
                <span className={s.num}>{v.invoice_total > 0 ? money(v.invoice_total) : ""}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
      {id !== null ? <VendorPanel key={id} id={id} canEdit={canEdit} /> : (
        <div className={s.panel}><div className={s.empty}>Ayrıntı için bir tedarikçi seç.</div></div>
      )}
    </div>
  );
}

function VendorPanel({ id, canEdit }: { id: Uuid; canEdit: boolean }) {
  const q = useVendor(id);
  const [editing, setEditing] = useState(false);
  if (q.error !== null) return <div className={s.panel}><p role="alert" className={s.empty}>{errorText(q.error)}</p></div>;
  if (q.data === undefined) return <div className={s.panel}><Loading /></div>;
  const { vendor: v, merged_into, offers, invoices } = q.data;
  return (
    <div className={s.panel}>
      <div className={s.ph}>
        <h2>{v.name}</h2>
        <span className={s.grow} />
        {canEdit && merged_into === null && !editing && <Button size="sm" onClick={() => setEditing(true)}>Düzenle</Button>}
      </div>
      {merged_into !== null && (
        <div className={s.pb}>
          <div className={s.callout}>
            Bu kayıt başka bir tedarikçiyle birleştirildi. <Link href={fin("vendors", merged_into)}>Birleşen kayda git</Link>
          </div>
        </div>
      )}
      {editing ? <VendorForm vendor={v} onClose={() => setEditing(false)} /> : (
        <div className={s.pb}>
          <dl className={s.kv}>
            <dt>Yetkili</dt><dd>{v.contact ?? "—"}</dd>
            <dt>Telefon</dt><dd>{v.phone ?? "—"}</dd>
            <dt>E-posta</dt><dd>{v.email ?? "—"}</dd>
            <dt>Bağlantı</dt><dd>{v.url === null ? "—" : <a href={v.url} target="_blank" rel="noreferrer noopener">{v.url}</a>}</dd>
            <dt>Fatura keser mi</dt><dd>{v.issues_invoice === null ? "Bilinmiyor" : v.issues_invoice ? "Evet" : "Hayır"}</dd>
            {v.aliases.length > 0 && <><dt>Eski adlar</dt><dd>{v.aliases.join(", ")}</dd></>}
            {v.note !== null && <><dt>Not</dt><dd>{v.note}</dd></>}
          </dl>
        </div>
      )}
      <div className={s.ph}><h2>Teklifler</h2><span className={s.sub}>{offers.length}</span></div>
      {offers.length === 0 ? <div className={s.empty}>Bu tedarikçiden teklif yok.</div> : (
        <div className={s.list}>
          {offers.map((o) => (
            <div key={o.material_id} className={cx(s.row, s.rInv)}>
              <span className={s.t}><b>{o.material}</b><span>{o.event_title ?? "Etkinliksiz"} · {formatDay(o.at.slice(0, 10))}</span></span>
              <span className={s.tags}>
                {o.purchased ? <StatusTag label="Alındı" tone={s.tOk ?? ""} /> : o.chosen && <StatusTag label="Seçili" tone={s.tAcc ?? ""} />}
              </span>
              <span className={s.num}>{o.price === null ? "—" : money(o.price)}</span>
            </div>
          ))}
        </div>
      )}
      <div className={s.ph}><h2>Faturalar</h2><span className={s.sub}>{invoices.length}</span></div>
      {invoices.length === 0 ? <div className={s.empty}>Bu tedarikçiye bağlı fatura yok.</div> : (
        <div className={s.list}>
          {invoices.map((i) => (
            <Link key={i.id} href={fin("invoices", i.id)} className={cx(s.row, s.rInv)}>
              <span className={s.t}><b>{formatDay(i.purchased_on)}</b></span>
              <StatusTag {...INVOICE_STATUS[i.status]} />
              <span className={s.num}>{money(i.total_try)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

type Invoices = "" | "yes" | "no";

function VendorForm({ vendor, onClose }: { vendor: VendorRow | null; onClose: () => void }) {
  const toast = useToast();
  const w = useVendorWrite();
  const [name, setName] = useState(vendor?.name ?? "");
  const [contact, setContact] = useState(vendor?.contact ?? "");
  const [phone, setPhone] = useState(vendor?.phone ?? "");
  const [email, setEmail] = useState(vendor?.email ?? "");
  const [url, setUrl] = useState(vendor?.url ?? "");
  const [note, setNote] = useState(vendor?.note ?? "");
  const [invoices, setInvoices] = useState<Invoices>(
    vendor?.issues_invoice === true ? "yes" : vendor?.issues_invoice === false ? "no" : "");
  const opt = (x: string) => (x.trim() === "" ? null : x.trim());
  const submit = () => {
    const body: VendorIn = {
      name: name.trim(), contact: opt(contact), phone: opt(phone), email: opt(email), url: opt(url), note: opt(note),
      issues_invoice: invoices === "" ? null : invoices === "yes",
    };
    w.mutate(vendor === null ? { id: null, body } : { id: vendor.id, body }, {
      onSuccess: (r) => {
        onClose();
        if (vendor === null) {
          toast({ text: r.existing ? `“${r.vendor.name}” zaten kayıtlı; o kayda gidildi.` : "Tedarikçi eklendi", error: false });
          navigate(fin("vendors", r.vendor.id));
        } else {
          toast({ text: "Kaydedildi", error: false });
        }
      },
      onError: (e) => toast({ text: errorText(e), error: true }),
    });
  };
  return (
    <form className={s.inlineForm} onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <label className={ui.field}><span>Ad</span>
        <input className={ui.input} value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required />
      </label>
      <div className={s.formRow}>
        <label>Yetkili<input className={ui.input} value={contact} onChange={(e) => setContact(e.target.value)} maxLength={200} /></label>
        <label>Telefon<input className={ui.input} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} /></label>
        <label>E-posta<input className={ui.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} /></label>
      </div>
      <div className={s.formRow}>
        <label>Bağlantı<input className={ui.input} type="url" value={url} onChange={(e) => setUrl(e.target.value)} maxLength={500} placeholder="https://" /></label>
        <label>Fatura keser mi
          <Picker label="Fatura keser mi" value={invoices} onChange={setInvoices}
            options={[{ value: "" as const, label: "Bilinmiyor" }, { value: "yes" as const, label: "Evet" }, { value: "no" as const, label: "Hayır" }]} />
        </label>
      </div>
      <label className={ui.field}><span>Not</span>
        <input className={ui.input} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
      </label>
      <div className={ui.dact}>
        <Button type="button" variant="ghost" onClick={onClose}>Vazgeç</Button>
        <Button type="submit" variant="primary" disabled={w.isPending}>{vendor === null ? "Ekle" : "Kaydet"}</Button>
      </div>
    </form>
  );
}
