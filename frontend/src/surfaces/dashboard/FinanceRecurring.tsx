// Maliye > Tekrarlayan giderler (spec/81 §3.8): aylik/yillik sabit odemeler. Genel'deki
// "yaklasan odemeler" `next_on`'dan beslenir. Kendiliginden defter satiri YAZILMAZ: odeme
// olunca kasa defterine gider girilir ve burada "Ödendi, ileri al" ile tarih ilerler.

import { useState } from "react";
import { errorText } from "../../api/client";
import { useRecurring, useRecurringWrite } from "../../api/hooks";
import type { IsoDate, RecurringExpense, Uuid } from "../../api/types";
import { toIsoDay } from "../../lib/labels";
import { useLookup } from "../../lib/lookup";
import { money, parseAmount } from "../../lib/money";
import { DateField } from "../../ui/DateField";
import { Button, cx, Loading, Picker, ui, useToast } from "../../ui/ui";
import { formatDay } from "./Finance";
import s from "./fin.module.css";

const SYMBOL: Record<string, string> = { TRY: "₺", USD: "$", EUR: "€" };

/** Ay sonu tasmasi: 31 Ocak + 1 ay = 28 Subat. */
function advance(iso: IsoDate, every: "month" | "year"): IsoDate {
  const [y = 2000, m = 1, d = 1] = iso.split("-").map(Number);
  const target = new Date(y + (every === "year" ? 1 : 0), m - 1 + (every === "month" ? 1 : 0), 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return toIsoDay(new Date(target.getFullYear(), target.getMonth(), Math.min(d, last)));
}

export function FinanceRecurring() {
  const L = useLookup();
  const toast = useToast();
  const q = useRecurring();
  const w = useRecurringWrite();
  const canWrite = L.can("manage_ledger");
  const cats = L.meta.nodes.filter((n) => n.node_type === "category" && n.is_active);
  const [adding, setAdding] = useState(false);
  const fail = (e: unknown) => toast({ text: errorText(e), error: true });
  const catName = (id: Uuid | null) => cats.find((c) => c.id === id)?.name ?? null;
  const patch = (r: RecurringExpense, p: Partial<Pick<RecurringExpense, "next_on" | "is_active">>) =>
    w.mutate({ op: "update", id: r.id, patch: p }, { onError: fail });

  return (
    <div className={s.panel}>
      <div className={s.ph}>
        <h2>Tekrarlayan giderler</h2>
        <span className={s.sub}>abonelik, alan adı, kira gibi sabit ödemeler</span>
        <span className={s.grow} />
        {canWrite && !adding && <Button size="sm" variant="primary" onClick={() => setAdding(true)}>Yeni gider</Button>}
      </div>
      {adding && <RecurringForm cats={cats.map((c) => ({ id: c.id, name: c.name }))} onClose={() => setAdding(false)} />}
      {q.data === undefined ? <Loading /> : q.data.length === 0 ? (
        <div className={s.empty}>Henüz tekrarlayan gider yok.{canWrite ? " “Yeni gider” ile ekle; tarihi geldiğinde Genel'deki yaklaşan ödemelerde görünür." : ""}</div>
      ) : (
        <div className={s.list}>
          {q.data.map((r) => (
            <div key={r.id} className={cx(s.row, s.rRec)} data-inactive={!r.is_active}>
              <span className={s.t}>
                <b>{r.name}</b>
                <span>
                  {r.every === "month" ? "Her ay" : "Her yıl"} · sıradaki {formatDay(r.next_on)}
                  {catName(r.category_id) !== null && ` · ${catName(r.category_id)}`}
                  {!r.is_active && " · durdu"}
                </span>
              </span>
              <span className={s.num}>{SYMBOL[r.currency] ?? r.currency} {r.amount.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}</span>
              {canWrite && (
                <span className={s.tags}>
                  <Button size="sm" variant="ghost" disabled={w.isPending}
                    onClick={() => patch(r, { next_on: advance(r.next_on, r.every) })}>Ödendi, ileri al</Button>
                  <Button size="sm" variant="ghost" disabled={w.isPending}
                    onClick={() => patch(r, { is_active: !r.is_active })}>{r.is_active ? "Durdur" : "Sürdür"}</Button>
                  <Button size="sm" variant="ghost" disabled={w.isPending}
                    onClick={() => w.mutate({ op: "delete", id: r.id }, { onError: fail })}>Sil</Button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {!canWrite && <p className={cx(s.sub, s.foot)}>Düzenlemek için “Kasa defteri” yetkisi gerekir.</p>}
      <p className={cx(s.sub, s.foot)}>
        {q.data !== undefined && q.data.length > 0 && `Aktif aylık yük: ${money(q.data.filter((r) => r.is_active && r.currency === "TRY").reduce((a, r) => a + (r.every === "month" ? r.amount : r.amount / 12), 0))} (yalnız ₺, yıllıklar 12'ye bölünür).`}
      </p>
    </div>
  );
}

function RecurringForm({ cats, onClose }: { cats: { id: Uuid; name: string }[]; onClose: () => void }) {
  const toast = useToast();
  const w = useRecurringWrite();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("TRY");
  const [every, setEvery] = useState<"month" | "year">("month");
  const [next, setNext] = useState<IsoDate | null>(null);
  const [cat, setCat] = useState<Uuid | "">("");
  return (
    <form className={s.inlineForm} onSubmit={(e) => {
      e.preventDefault();
      const n = parseAmount(amount);
      if (n === null || n <= 0) return toast({ text: "Tutarı sayı olarak yaz.", error: true });
      if (next === null) return toast({ text: "Sıradaki ödeme gününü seç.", error: true });
      w.mutate({ op: "create", name: name.trim(), amount: n, currency, every, next_on: next, category_id: cat === "" ? null : cat }, {
        onSuccess: onClose,
        onError: (x) => toast({ text: errorText(x), error: true }),
      });
    }}>
      <div className={s.formRow}>
        <label>Ad<input className={ui.input} value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required /></label>
        <label>Tutar<input className={ui.input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" required /></label>
        <label>Birim
          <Picker label="Para birimi" value={currency} onChange={setCurrency}
            options={["TRY", "USD", "EUR"].map((c) => ({ value: c, label: SYMBOL[c] ?? c }))} />
        </label>
      </div>
      <div className={s.formRow}>
        <label>Tekrar
          <Picker label="Tekrar" value={every} onChange={setEvery}
            options={[{ value: "month" as const, label: "Aylık" }, { value: "year" as const, label: "Yıllık" }]} />
        </label>
        <label>Sıradaki ödeme<DateField aria-label="Sıradaki ödeme" placeholder="Seç" value={next} onChange={setNext} /></label>
        <label>Kategori
          <Picker label="Kategori" value={cat} onChange={setCat}
            options={[{ value: "" as const, label: "Yok" }, ...cats.map((c) => ({ value: c.id, label: c.name }))]} />
        </label>
      </div>
      <div className={ui.dact}>
        <Button type="button" variant="ghost" onClick={onClose}>Vazgeç</Button>
        <Button type="submit" variant="primary" disabled={w.isPending}>Ekle</Button>
      </div>
    </form>
  );
}
