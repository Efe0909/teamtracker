// Hesap numaralarim (spec/82 §3.2): fatura iadesinin gidecegi IBAN'lar.
// Tam IBAN yalniz sahibine gelir; ekranda yine maskeli (omuz uzerinden okunmasin).

import { useState } from "react";
import { errorText } from "../../api/client";
import { useBankAccounts, useBankAccountWrite } from "../../api/hooks";
import type { BankAccount } from "../../api/types";
import { useLookup } from "../../lib/lookup";
import { Button, Loading, Req, ui, useToast } from "../../ui/ui";
import s from "./profile.module.css";

/** "TR120006…" → "TR12 0006 •••• •••• •••• 8413 26": bas iki ve son iki grup acik. */
export function maskIban(iban: string | null, last4: string): string {
  if (iban === null) return `•••• ${last4}`;
  const g = iban.match(/.{1,4}/g) ?? [];
  return g.map((x, i) => (i < 2 || i >= g.length - 2 ? x : "••••")).join(" ");
}

/** Yazarken 4'lu gruplar, buyuk harf; sunucu bosluklari zaten atar. */
export function formatIban(v: string): string {
  return v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 34).replace(/(.{4})(?=.)/g, "$1 ");
}

export function BankAccounts() {
  const q = useBankAccounts();
  const w = useBankAccountWrite();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const fail = (e: unknown) => toast({ text: errorText(e), error: true });

  if (q.error !== null) return <p role="alert">{errorText(q.error)}</p>;
  if (q.data === undefined) return <Loading />;
  const list = q.data;
  return (
    <div className={ui.formStack}>
      {list.length === 0 ? (
        <p className={ui.fieldHint}>Henüz hesap numarası eklemedin. Faturanın iadesi bu hesaba gönderilir.</p>
      ) : (
        <ul className={s.accounts}>
          {list.map((a) => <Row key={a.id} a={a} busy={w.isPending}
            onDefault={() => w.mutate({ op: "edit", id: a.id, is_default: true }, { onError: fail })}
            onDelete={() => {
              if (!window.confirm(`${a.label} silinecek. Geçmiş iadelerde yalnız son dört hanesi kalır.`)) return;
              w.mutate({ op: "delete", id: a.id }, { onSuccess: () => toast({ text: "Hesap silindi", error: false }), onError: fail });
            }} />)}
        </ul>
      )}
      {adding ? (
        <AddForm onDone={() => setAdding(false)} />
      ) : list.length < 5 && (
        <div><Button variant="primary" onClick={() => setAdding(true)}>Hesap ekle</Button></div>
      )}
      <p className={ui.fieldHint}>
        Hesap numaraların yalnız sana yapılacak geri ödemeler için kullanılır. Görebilenler: sen, yöneticiler ve
        maliye yetkilisi (yalnız fatura ayrıntısında). E-posta ve mail şablonlarına tam IBAN yazılmaz.
      </p>
    </div>
  );
}

function Row({ a, busy, onDefault, onDelete }: { a: BankAccount; busy: boolean; onDefault: () => void; onDelete: () => void }) {
  return (
    <li className={s.account}>
      <span className={s.accountText}>
        <b>{a.label} · {a.holder_name}</b>
        <span className={s.iban}>{maskIban(a.iban, a.iban_last4)}</span>
      </span>
      {a.is_default ? <span className={s.defaultTag}>Varsayılan</span>
        : <Button size="sm" disabled={busy} onClick={onDefault}>Varsayılan yap</Button>}
      <Button size="sm" variant="ghost" disabled={busy} onClick={onDelete}>Sil</Button>
    </li>
  );
}

function AddForm({ onDone }: { onDone: () => void }) {
  const L = useLookup();
  const w = useBankAccountWrite();
  const toast = useToast();
  const [label, setLabel] = useState("");
  const [holder, setHolder] = useState(L.me.name);
  const [iban, setIban] = useState("TR");
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className={`${ui.formStack} ${s.addForm}`} onSubmit={(e) => {
      e.preventDefault();
      setErr(null);
      w.mutate({ op: "add", label, holder_name: holder, iban }, {
        onSuccess: () => { toast({ text: "Hesap eklendi", error: false }); onDone(); },
        onError: (x) => setErr(errorText(x)),
      });
    }}>
      {err !== null && <p className={ui.error} role="alert">{err}</p>}
      <label className={ui.field}>
        <span>Banka ya da etiket<Req /></span>
        <input className={ui.input} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60}
          placeholder="Ziraat" required />
      </label>
      <label className={ui.field}>
        <span>Hesap sahibi<Req /></span>
        <input className={ui.input} value={holder} onChange={(e) => setHolder(e.target.value)} maxLength={200} required />
      </label>
      <label className={ui.field}>
        <span>IBAN<Req /></span>
        <input className={`${ui.input} ${s.iban}`} value={iban} onChange={(e) => setIban(formatIban(e.target.value))}
          inputMode="text" autoComplete="off" spellCheck={false} placeholder="TR00 0000 0000 0000 0000 0000 00" required />
      </label>
      <div className={ui.dact}>
        <Button type="button" variant="ghost" onClick={onDone}>Vazgeç</Button>
        <Button type="submit" variant="primary" disabled={w.isPending}>Kaydet</Button>
      </div>
    </form>
  );
}
