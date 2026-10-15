// Kulup kasasi (spec/81 §3.7): bankadan elle tutulan, DEGISMEZ defter. Satir
// silinmez; yanlis satir ters kayitla duzeltilir (D-13). Mutabakat: bankadaki
// bakiye girilir, fark gosterilir.

import { useState } from "react";
import { errorText } from "../../api/client";
import { useLedger, useLedgerWrite } from "../../api/hooks";
import type { LedgerKind } from "../../api/types";
import { useLookup } from "../../lib/lookup";
import { money, parseAmount } from "../../lib/money";
import { Button, cx, Loading, Picker, ui, useToast } from "../../ui/ui";
import { formatDay, StatusTag } from "./Finance";
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
  const fail = (e: unknown) => toast({ text: errorText(e), error: true });
  if (q.error !== null) return <p role="alert">{errorText(q.error)}</p>;
  if (q.data === undefined) return <Loading />;
  const v = q.data;
  const categories = L.meta.nodes.filter((n) => n.node_type === "category" && n.is_active);
  const hasOpening = v.entries.some((e) => e.kind === "opening");

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
        <div className={s.pos}>
          <div>
            <span className={s.lbl}><span className={cx(s.dot, s.dotAcc)} />Defter bakiyesi</span>
            <span className={s.val}>{money(v.balance)}</span>
            <span className={s.meta}>
              {v.last_check === null ? "Mutabakat yapılmadı"
                : `Son mutabakat ${formatDay(v.last_check.checked_on)} · ${v.last_check.diff === 0 ? "banka ile aynı" : `fark ${money(v.last_check.diff)}`}`}
            </span>
          </div>
          <div>
            <span className={s.lbl}>Bu ay giren</span>
            <span className={cx(s.val, s.in)}>{money(v.month_in)}</span>
          </div>
          <div>
            <span className={s.lbl}>Bu ay çıkan</span>
            <span className={s.val}>{money(v.month_out)}</span>
          </div>
        </div>
      </div>

      <div className={s.panel}>
        <div className={s.ph}>
          <h2>Defter</h2>
          <span className={s.sub}>son 500 satır</span>
          <span className={s.grow} />
          {v.can_write && (
            <>
              <Button size="sm" onClick={() => { setForm("check"); setAmount(""); setOn(todayIso()); }}>Banka bakiyesini gir</Button>
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
        <div className={cx(s.thead, s.rLed)}>
          <span>Tarih</span><span>Açıklama</span><span>Tür</span><span className={s.num}>Tutar</span><span className={s.num}>Bakiye</span><span />
        </div>
        {v.entries.length === 0 ? (
          <div className={s.empty}>Defter boş. İlk satır bankadaki açılış bakiyesi olmalı.</div>
        ) : (
          <div className={s.list}>
            {v.entries.map((e) => (
              <div key={e.id} className={cx(s.row, s.rLed)}>
                <span className={s.date}>{formatDay(e.occurred_on)}</span>
                <span className={s.t}>
                  <b className={e.reversed ? s.struck : undefined}>{e.description}</b>
                  <span>
                    {e.payee_user_id !== null && `${L.user(e.payee_user_id)?.name ?? "?"} · `}
                    {e.category_id !== null && `${L.meta.nodes.find((n) => n.id === e.category_id)?.name ?? ""} · `}
                    {L.user(e.created_by ?? "")?.name ?? ""}
                  </span>
                </span>
                <span><StatusTag {...KIND[e.kind]} /></span>
                <span className={cx(s.num, e.amount > 0 && s.in, e.reversed && s.struck)}>{e.amount > 0 ? "+" : ""}{money(e.amount)}</span>
                <span className={s.num}>{money(e.balance)}</span>
                {v.can_write && !e.reversed && e.kind !== "reversal" ? (
                  <Button size="sm" variant="ghost" disabled={w.isPending} title="Satır silinmez; karşıt kayıtla düzeltilir"
                    onClick={() => {
                      const note = window.prompt("Ters kayıt nedeni (isteğe bağlı):", "");
                      if (note === null) return;
                      w.mutate({ op: "reverse", id: e.id, ...(note.trim() !== "" ? { note: note.trim() } : {}) }, {
                        onSuccess: () => toast({ text: "Ters kayıt yazıldı", error: false }), onError: fail,
                      });
                    }}>Ters kayıt</Button>
                ) : <span />}
              </div>
            ))}
          </div>
        )}
      </div>
      <p className={s.sub}>Satırlar bankadan elle girilir. Satır silinmez ya da düzenlenmez; yanlış satır ters kayıtla düzeltilir.</p>
    </>
  );
}
