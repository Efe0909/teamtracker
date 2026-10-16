// Kulup kasasi (spec/81 §3.7): bankadan elle tutulan, DEGISMEZ defter. Satir
// silinmez; yanlis satir ters kayitla duzeltilir (D-13). Mutabakat: bankadaki
// bakiye girilir, fark gosterilir.

import { useState } from "react";
import { errorText } from "../../api/client";
import { useLedger, useLedgerWrite } from "../../api/hooks";
import type { LedgerKind } from "../../api/types";
import { useLookup } from "../../lib/lookup";
import { money, parseAmount } from "../../lib/money";
import { Icon } from "../../ui/icons";
import { Button, cx, Loading, Menu, MenuItem, Picker, ui, useToast } from "../../ui/ui";
import { formatDay, StatusTag } from "./Finance";
import { inFinancePeriod, useFinancePeriod } from "./FinancePeriod";
import p from "./financePages.module.css";
import s from "./fin.module.css";

const KIND: Record<LedgerKind, { label: string; tone: string }> = {
  income: { label: "Gelir", tone: s.tOk ?? "" },
  expense: { label: "Gider", tone: "" },
  purchase: { label: "Satın alım", tone: "" },
  seb_refund: { label: "SEB iadesi", tone: s.tOk ?? "" },
  member_payout: { label: "Üyeye iade", tone: s.tInfo ?? "" },
  reversal: { label: "Düzeltme", tone: s.tWarn ?? "" },
  opening: { label: "Açılış", tone: s.tAcc ?? "" },
};

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function FinanceLedger() {
  const L = useLookup();
  const q = useLedger();
  const w = useLedgerWrite();
  const toast = useToast();
  const [form, setForm] = useState<"entry" | "check" | null>(null);
  const [kind, setKind] = useState<"income" | "expense" | "opening">("income");
  const [on, setOn] = useState(todayIso());
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [category, setCategory] = useState("");
  const [month, setMonth] = useState(todayIso().slice(0, 7));
  const period = useFinancePeriod();
  const fail = (e: unknown) => toast({ text: errorText(e), error: true });
  if (q.error !== null) return <p role="alert">{errorText(q.error)}</p>;
  if (q.data === undefined) return <Loading />;
  const v = q.data;
  const categories = L.meta.nodes.filter((n) => n.node_type === "category" && n.is_active);
  const hasOpening = v.entries.some((e) => e.kind === "opening");
  const periodEntries = v.entries.filter((e) => inFinancePeriod(e.occurred_on, period));
  const months = [...new Set(periodEntries.map((e) => e.occurred_on.slice(0, 7)))].sort().reverse();
  const activeMonth = month === "all" || months.includes(month) ? month : months[0] ?? "all";
  const entries = periodEntries.filter((e) => activeMonth === "all" || e.occurred_on.startsWith(activeMonth));
  const currentMonth = activeMonth === todayIso().slice(0, 7);
  const incoming = currentMonth ? v.month_in : entries.reduce((sum, e) => sum + Math.max(0, e.amount), 0);
  const outgoing = currentMonth ? v.month_out : entries.reduce((sum, e) => sum + Math.min(0, e.amount), 0);
  const monthLabel = (value: string) => new Date(`${value}-01T12:00:00`).toLocaleDateString("tr-TR", { month: "long", year: "numeric" });

  const submitEntry = () => {
    const a = parseAmount(amount);
    if (a === null) return toast({ text: "Tutarı yaz.", error: true });
    w.mutate({
      op: "entry", occurred_on: on, amount: a, kind, description: desc.trim(),
      ...(category !== "" ? { category_id: category } : {}),
    }, {
      onSuccess: () => { setForm(null); setAmount(""); setDesc(""); toast({ text: "Kasaya yazıldı", error: false }); },
      onError: fail,
    });
  };
  const submitCheck = () => {
    const a = parseAmount(amount.replace(/^-/, "")) ?? (amount.trim() === "0" ? 0 : null);
    if (a === null) return toast({ text: "Bankadaki bakiyeyi yaz.", error: true });
    w.mutate({ op: "check", checked_on: on, bank_balance: amount.trim().startsWith("-") ? -a : a }, {
      onSuccess: (l) => {
        setForm(null);
        setAmount("");
        toast({ text: l.last_check?.diff === 0 ? "Kasa banka ile tutuyor" : `Fark var: ${money(l.last_check?.diff ?? 0)}`, error: false });
      },
      onError: fail,
    });
  };

  return (
    <>
      <div className={s.panel}>
        <div className={cx(s.pos, p.ledgerSummary)}>
          <div className={s.tile}>
            <span className={s.lbl}><span className={cx(s.dot, s.dotAcc)} />Defter bakiyesi</span>
            <span className={s.val}>{money(v.balance)}</span>
            <span className={s.meta}>
              {v.last_check === null ? "Mutabakat yapılmadı"
                : `Son mutabakat ${formatDay(v.last_check.checked_on)} · ${v.last_check.diff === 0 ? "banka ile aynı" : `fark ${money(v.last_check.diff)}`}`}
            </span>
          </div>
          <div className={s.tile}>
            <span className={s.lbl}>{currentMonth ? "Bu ay giren" : activeMonth === "all" ? "Görünen girişler" : "Seçili ayda giren"}</span>
            <span className={cx(s.val, s.in)}>{incoming > 0 ? "+" : ""}{money(incoming)}</span>
          </div>
          <div className={s.tile}>
            <span className={s.lbl}>{currentMonth ? "Bu ay çıkan" : activeMonth === "all" ? "Görünen çıkışlar" : "Seçili ayda çıkan"}</span>
            <span className={s.val}>{money(outgoing)}</span>
          </div>
        </div>
      </div>

      <div className={s.panel}>
        <div className={s.ph}>
          <h2>Defter</h2>
          <Picker look="bare" label="Defter ayı" value={activeMonth} onChange={setMonth}
            options={[{ value: "all", label: "Tüm hareketler" }, ...months.map((value) => ({ value, label: monthLabel(value) }))]} />
          <span className={s.grow} />
          {v.can_write && (
            <>
              <Button size="sm" variant="ghost" onClick={() => { setForm("check"); setAmount(""); setOn(todayIso()); }}>Mutabakat yap</Button>
              <Button size="sm" variant="primary" onClick={() => { setForm("entry"); setKind(hasOpening ? "income" : "opening"); setOn(todayIso()); }}>
                Satır ekle
              </Button>
            </>
          )}
        </div>
        {form === "entry" && (
          <form className={s.inlineForm} onSubmit={(e) => { e.preventDefault(); submitEntry(); }}>
            <div className={s.formRow}>
              <label>Tür
                <Picker label="Tür" value={kind} onChange={setKind}
                  options={[
                    { value: "income" as const, label: "Gelir" },
                    { value: "expense" as const, label: "Gider" },
                    ...(hasOpening ? [] : [{ value: "opening" as const, label: "Açılış bakiyesi" }]),
                  ]} />
              </label>
              <label>Tarih<input className={ui.input} type="date" value={on} max={todayIso()} onChange={(e) => setOn(e.target.value)} required /></label>
              <label>Tutar (₺)<input className={ui.input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" required /></label>
              {kind !== "opening" && (
                <label>Kategori
                  <Picker label="Kategori" value={category} onChange={setCategory}
                    options={[{ value: "", label: "—" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]} />
                </label>
              )}
            </div>
            <label className={ui.field}>
              <span>Açıklama</span>
              <input className={ui.input} value={desc} maxLength={300} required onChange={(e) => setDesc(e.target.value)}
                placeholder={kind === "income" ? "ör. Kampüs kahve satışı" : kind === "expense" ? "ör. Sahne depozitosu" : "Bankadaki ilk bakiye"} />
            </label>
            <div className={ui.dact}>
              <Button type="button" variant="ghost" onClick={() => setForm(null)}>Vazgeç</Button>
              <Button type="submit" variant="primary" disabled={w.isPending}>Kaydet</Button>
            </div>
          </form>
        )}
        {form === "check" && (
          <form className={s.inlineForm} onSubmit={(e) => { e.preventDefault(); submitCheck(); }}>
            <div className={s.formRow}>
              <label>Tarih<input className={ui.input} type="date" value={on} max={todayIso()} onChange={(e) => setOn(e.target.value)} required /></label>
              <label>Bankadaki bakiye (₺)<input className={ui.input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required /></label>
              <Button type="submit" variant="primary" disabled={w.isPending}>Karşılaştır</Button>
              <Button type="button" variant="ghost" onClick={() => setForm(null)}>Vazgeç</Button>
            </div>
          </form>
        )}
        <div className={p.tableScroll}>
          <table className={p.ledgerTable}>
            <caption className={s.srOnly}>Kulüp kasası hareketleri ve her hareketten sonraki bakiye</caption>
            <thead><tr>
              <th scope="col">Tarih</th><th scope="col">Açıklama</th><th scope="col">Kategori</th>
              <th scope="col">Tutar</th><th scope="col">Bakiye</th><th scope="col"><span className={s.srOnly}>İşlemler</span></th>
            </tr></thead>
            <tbody>
            {entries.length === 0 && <tr><td colSpan={6} className={s.empty}>
              {v.entries.length === 0 ? "Defter boş. İlk satır bankadaki açılış bakiyesi olmalı." : "Seçili dönemde hareket yok."}
            </td></tr>}
            {entries.map((e) => (
              <tr key={e.id}>
                <td className={s.date}>{formatDay(e.occurred_on)}</td>
                <td>
                  <b className={cx(p.entryTitle, e.reversed && s.struck)}>{e.description}</b>
                  <span className={p.entryNote}>
                    {e.invoice_id !== null ? "Faturaya bağlı · " : e.event_id !== null ? "Etkinliğe bağlı · " : ""}
                    {e.payee_user_id !== null && `${L.user(e.payee_user_id)?.name ?? "?"} · `}
                    {e.category_id !== null && `${L.meta.nodes.find((n) => n.id === e.category_id)?.name ?? ""} · `}
                    {L.user(e.created_by ?? "")?.name ?? ""}
                  </span>
                </td>
                <td><StatusTag {...KIND[e.kind]} /></td>
                <td className={cx(s.num, e.amount > 0 && s.in, e.reversed && s.struck)}>{e.amount > 0 ? "+" : ""}{money(e.amount)}</td>
                <td className={s.num}>{money(e.balance)}</td>
                <td>
                {v.can_write && !e.reversed && e.kind !== "reversal" ? (
                  <Menu align="end" trigger={<Button size="sm" variant="ghost" disabled={w.isPending}
                    aria-label={`${e.description} — işlemler`}><Icon name="more" size={16} /></Button>}>
                    <MenuItem icon="restore" onSelect={() => {
                      const note = window.prompt("Ters kayıt nedeni (isteğe bağlı):", "");
                      if (note === null) return;
                      w.mutate({ op: "reverse", id: e.id, ...(note.trim() !== "" ? { note: note.trim() } : {}) }, {
                        onSuccess: () => toast({ text: "Ters kayıt yazıldı", error: false }), onError: fail,
                      });
                    }}>Ters kayıt oluştur</MenuItem>
                  </Menu>
                ) : null}
                </td>
              </tr>
            ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className={s.sub}>Satırlar bankadan elle girilir. Satır silinmez; yanlış ters kayıtla düzeltilir. Son 500 hareket gösterilir.</p>
    </>
  );
}
