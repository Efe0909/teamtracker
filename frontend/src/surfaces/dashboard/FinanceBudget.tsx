// Maliye > Butce (spec/81 §8): donem > kategori > etkinlik plani ve gerceklesen.
// Harcanan = onayli faturalar + kasadan gider; taahhut = onayli ama alinmamis kalemler.
// Yazmak `manage_budgets`; gormek maliye. Etkinlik payi kategorinin altinda ayri satir.

import { useState } from "react";
import { errorText } from "../../api/client";
import { useBudget, useBudgetLine, useEvents, usePeriods, usePeriodWrite } from "../../api/hooks";
import type { BudgetRow, FinancePeriod, MetaNode, Uuid } from "../../api/types";
import { useLookup } from "../../lib/lookup";
import { money, parseAmount } from "../../lib/money";
import { DateField } from "../../ui/DateField";
import { Button, cx, Loading, Picker, ui, useToast } from "../../ui/ui";
import { formatDay } from "./Finance";
import s from "./fin.module.css";

const GROUPS: { ledger: "seb" | "general"; title: string }[] = [
  { ledger: "seb", title: "SEB bütçesi" },
  { ledger: "general", title: "Kulüp kasası (genel)" },
];

function sum(rows: BudgetRow[], k: "planned" | "spent" | "committed"): number {
  return rows.reduce((a, r) => a + r[k], 0);
}

/** Dolu = harcanan, acik ton = taahhut; plani asarsa kirmizi. */
function Bar({ planned, spent, committed }: { planned: number; spent: number; committed: number }) {
  const base = Math.max(planned, spent + committed, 1);
  const over = planned > 0 && spent > planned;
  return (
    <span className={s.budBar} role="img"
      aria-label={`Plan ${money(planned)}, harcanan ${money(spent)}, taahhüt ${money(committed)}`}>
      <span className={cx(s.budSpent, over && s.budOver)} style={{ width: `${Math.min(100, (spent / base) * 100)}%` }} />
      <span className={s.budCommit} style={{ width: `${Math.min(100 - Math.min(100, (spent / base) * 100), (committed / base) * 100)}%` }} />
    </span>
  );
}

/** Plan hucresi: odak kaybinda yazar; bos = satiri siler. */
function PlanInput({ value, label, disabled, onSave }: {
  value: number; label: string; disabled: boolean; onSave: (amount: number | null) => void;
}) {
  const [v, setV] = useState(value === 0 ? "" : String(value).replace(".", ","));
  const [seen, setSeen] = useState(value);
  // Sunucudan yeni deger geldiyse (baska kullanici / yenileme) yerel metni esitle.
  if (seen !== value) {
    setSeen(value);
    setV(value === 0 ? "" : String(value).replace(".", ","));
  }
  return (
    <input className={cx(ui.input, s.planInput)} inputMode="decimal" value={v} placeholder="—" disabled={disabled}
      aria-label={label} onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const t = v.trim();
        if (t === "") return value === 0 ? undefined : onSave(null);
        const n = parseAmount(t);
        if (n === null) { setV(value === 0 ? "" : String(value).replace(".", ",")); return; }
        if (n !== value) onSave(n);
      }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
  );
}

export function FinanceBudget() {
  const L = useLookup();
  const toast = useToast();
  const periods = usePeriods();
  const [picked, setPicked] = useState<Uuid | null>(null);
  const q = useBudget(picked);
  const line = useBudgetLine();
  const events = useEvents();
  const [form, setForm] = useState<"new" | "edit" | null>(null);
  const cats = L.meta.nodes.filter((n) => n.node_type === "category" && n.is_active);

  if (periods.data === undefined || q.data === undefined) return q.error !== null ? <p role="alert">{errorText(q.error)}</p> : <Loading />;
  const view = q.data;
  const period = view.period;
  const canWrite = view.can_write;
  const fail = (e: unknown) => toast({ text: errorText(e), error: true });
  const save = (c: Uuid, e: Uuid | null, amount: number | null) => {
    if (period === null) return;
    line.mutate({ period_id: period.id, category_id: c, event_id: e, amount }, { onError: fail });
  };

  const catRows = (c: MetaNode) => view.rows.filter((r) => r.category_id === c.id);
  const plain = view.rows.filter((r) => r.category_id === null);
  const all = view.rows;

  return (
    <div className={s.panel}>
      <div className={s.ph}>
        <h2>Dönem bütçesi</h2>
        <Picker look="chip" label="Dönem" value={period?.id ?? ""} active={picked !== null} placeholder="Dönem yok"
          onChange={(v) => setPicked(v === "" ? null : v)}
          options={periods.data.map((p) => ({ value: p.id, label: `${p.name} · ${formatDay(p.from)} – ${formatDay(p.to)}` }))} />
        <span className={s.grow} />
        {period !== null && (
          <a className={cx(ui.btn, ui["v-default"], ui["z-sm"])} href={`/api/finance/budget.xlsx?period=${period.id}`}>Excel</a>
        )}
        {canWrite && period !== null && form === null && <Button size="sm" onClick={() => setForm("edit")}>Dönemi düzenle</Button>}
        {canWrite && form === null && <Button size="sm" variant="primary" onClick={() => setForm("new")}>Yeni dönem</Button>}
      </div>
      {form !== null && (
        <PeriodForm key={form} period={form === "edit" ? period : null} onClose={() => setForm(null)}
          onSaved={(p) => { setPicked(p.id); setForm(null); }} onDeleted={() => { setPicked(null); setForm(null); }} />
      )}
      {period === null ? (
        <div className={s.empty}>
          Henüz dönem yok.{canWrite ? " “Yeni dönem” ile akademik dönemi (ör. 2026 Güz) tanımla; bütçe satırları dönemin altına yazılır." : " Dönemi bütçe yetkisi olan biri tanımlar."}
        </div>
      ) : (
        <>
          <div className={s.budTotals}>
            <span><b>{money(sum(all, "planned"))}</b> plan</span>
            <span><b>{money(sum(all, "spent"))}</b> harcanan</span>
            <span><b>{money(sum(all, "committed"))}</b> taahhüt</span>
            <span className={sum(all, "planned") - sum(all, "spent") - sum(all, "committed") < 0 ? s.budNeg : undefined}>
              <b>{money(sum(all, "planned") - sum(all, "spent") - sum(all, "committed"))}</b> kalan
            </span>
          </div>
          {GROUPS.map((g) => {
            const gcats = cats.filter((c) => c.attrs.ledger === g.ledger);
            const grows = gcats.flatMap(catRows);
            return (
              <section key={g.ledger} aria-label={g.title}>
                <div className={s.budGroup}>
                  <b>{g.title}</b>
                  <span className={s.grow} />
                  <span className={s.num}>{money(sum(grows, "planned"))}</span>
                  <span className={cx(s.num, s.sub)}>{money(sum(grows, "spent"))}</span>
                </div>
                {gcats.map((c) => (
                  <CategoryBlock key={c.id} cat={c} rows={catRows(c)} canWrite={canWrite && !line.isPending}
                    events={(events.data ?? []).map((e) => ({ id: e.id, title: e.title }))} onSave={save} />
                ))}
              </section>
            );
          })}
          {plain.length > 0 && (
            <section aria-label="Kategorisiz">
              <div className={s.budGroup}><b>Kategorisiz</b><span className={s.grow} />
                <span className={s.sub}>Kategorisi olmayan kalem ve giderler; plan yazılamaz.</span></div>
              {plain.map((r) => (
                <div key={r.event_id ?? "x"} className={s.budRow}>
                  <span className={s.t}><b>{r.event_title ?? "Etkinliksiz"}</b></span>
                  <span /><span className={s.num}>{money(r.spent)}</span><span className={s.num}>{money(r.committed)}</span>
                </div>
              ))}
            </section>
          )}
          <p className={cx(s.sub, s.foot)}>
            Harcanan: dönem içindeki onaylı faturalar ve kasadan giderler. Taahhüt: dönemde gerekli, onaylı ama alınmamış kalemler.
          </p>
        </>
      )}
    </div>
  );
}

function CategoryBlock({ cat, rows, canWrite, events, onSave }: {
  cat: MetaNode; rows: BudgetRow[]; canWrite: boolean;
  events: { id: Uuid; title: string }[];
  onSave: (c: Uuid, e: Uuid | null, amount: number | null) => void;
}) {
  const general = rows.find((r) => r.event_id === null);
  const byEvent = rows.filter((r) => r.event_id !== null);
  const taken = new Set(byEvent.map((r) => r.event_id));
  const planned = sum(rows, "planned"), spent = sum(rows, "spent"), committed = sum(rows, "committed");
  return (
    <div className={s.budCat}>
      <div className={cx(s.budRow, s.budCatHead)}>
        <span className={s.t}><b>{cat.name}</b></span>
        <Bar planned={planned} spent={spent} committed={committed} />
        <span className={s.num}>{money(planned)}</span>
        <span className={s.num}>{money(spent)}</span>
      </div>
      <div className={s.budRow}>
        <span className={s.t}><span>Genel pay</span></span>
        <span />
        <PlanInput value={general?.planned ?? 0} label={`${cat.name} genel pay`} disabled={!canWrite} onSave={(a) => onSave(cat.id, null, a)} />
        <span className={s.num}>{money(general?.spent ?? 0)}</span>
      </div>
      {byEvent.map((r) => (
        <div key={r.event_id ?? ""} className={cx(s.budRow, s.budEvent)}>
          <span className={s.t}><span>{r.event_title ?? "Etkinlik"}</span></span>
          <Bar planned={r.planned} spent={r.spent} committed={r.committed} />
          <PlanInput value={r.planned} label={`${cat.name} · ${r.event_title ?? "etkinlik"} payı`} disabled={!canWrite}
            onSave={(a) => r.event_id !== null && onSave(cat.id, r.event_id, a)} />
          <span className={s.num}>{money(r.spent)}</span>
        </div>
      ))}
      {canWrite && (
        <div className={s.budAdd}>
          <Picker look="chip" label={`${cat.name}: etkinlik payı ekle`} value="" placeholder="Etkinlik payı ekle…"
            onChange={(v) => v !== "" && onSave(cat.id, v, 0)}
            options={[{ value: "", label: "Etkinlik payı ekle…" },
              ...events.filter((e) => !taken.has(e.id)).map((e) => ({ value: e.id, label: e.title }))]} />
        </div>
      )}
    </div>
  );
}

function PeriodForm({ period, onClose, onSaved, onDeleted }: {
  period: FinancePeriod | null; onClose: () => void; onSaved: (p: FinancePeriod) => void; onDeleted: () => void;
}) {
  const toast = useToast();
  const w = usePeriodWrite();
  const [name, setName] = useState(period?.name ?? "");
  const [from, setFrom] = useState<string | null>(period?.from ?? null);
  const [to, setTo] = useState<string | null>(period?.to ?? null);
  const [sure, setSure] = useState(false);
  const fail = (e: unknown) => toast({ text: errorText(e), error: true });
  return (
    <form className={s.inlineForm} onSubmit={(e) => {
      e.preventDefault();
      if (from === null || to === null) return toast({ text: "Dönemin başlangıç ve bitiş günlerini seç.", error: true });
      const body = { name: name.trim(), from, to };
      w.mutate(period === null ? { op: "create", ...body } : { op: "update", id: period.id, ...body },
        { onSuccess: (p) => onSaved(p as FinancePeriod), onError: fail });
    }}>
      <div className={s.formRow}>
        <label>Ad<input className={ui.input} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="2026 Güz" required /></label>
        <label>Başlangıç<DateField aria-label="Dönem başlangıcı" placeholder="Seç" value={from} onChange={setFrom} /></label>
        <label>Bitiş<DateField aria-label="Dönem bitişi" placeholder="Seç" value={to} onChange={setTo} /></label>
      </div>
      <div className={ui.dact}>
        {period !== null && (sure
          ? <Button type="button" variant="danger" disabled={w.isPending}
              onClick={() => w.mutate({ op: "delete", id: period.id }, { onSuccess: onDeleted, onError: fail })}>Evet, dönem ve satırları silinsin</Button>
          : <Button type="button" variant="ghost" onClick={() => setSure(true)}>Dönemi sil</Button>)}
        <span className={s.grow} />
        <Button type="button" variant="ghost" onClick={onClose}>Vazgeç</Button>
        <Button type="submit" variant="primary" disabled={w.isPending}>{period === null ? "Ekle" : "Kaydet"}</Button>
      </div>
    </form>
  );
}
