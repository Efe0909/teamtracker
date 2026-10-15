// SEB iadeleri (spec/81 §3.6): aylik dosyalar onayla kendiliginden acilir,
// etkinlik dosyasi elle. Durum sirayla ilerler; "Iade geldi" kasaya gelir yazar.

import { useState } from "react";
import { errorText } from "../../api/client";
import { useClaim, useClaims, useClaimWrite, useEvents } from "../../api/hooks";
import type { ClaimRow, ClaimStatus } from "../../api/types";
import { useLookup } from "../../lib/lookup";
import { money, parseAmount } from "../../lib/money";
import { Button, cx, Link, Loading, Picker, ui, useToast } from "../../ui/ui";
import { CLAIM_STATUS, fin, formatDay, INVOICE_STATUS, StatusTag } from "./Finance";
import s from "./fin.module.css";

const STEPS: ClaimStatus[] = ["draft", "sent", "office_approved", "paid"];
const STEP_LABEL: Record<ClaimStatus, string> = { draft: "Hazırlandı", sent: "SEB'e gitti", office_approved: "Ofis onayladı", paid: "İade geldi" };
const NEXT_LABEL: Partial<Record<ClaimStatus, string>> = { draft: "SEB'e gönderildi", sent: "Ofis onayladı", office_approved: "İade geldi" };

export function claimTitle(c: ClaimRow): string {
  if (c.kind === "event") return c.event_title ?? "Etkinlik";
  if (c.month === null) return "Aylık";
  const [y, m] = c.month.split("-").map(Number);
  return new Date(y ?? 2000, (m ?? 1) - 1, 1).toLocaleDateString("tr-TR", { month: "long", year: "numeric" });
}

export function FinanceClaims({ id }: { id: string | null }) {
  const L = useLookup();
  const q = useClaims();
  const events = useEvents();
  const w = useClaimWrite();
  const toast = useToast();
  const [ev, setEv] = useState("");
  const canWrite = L.can("review_purchases");
  return (
    <div className={s.split}>
      <div className={s.panel}>
        <div className={s.ph}><h2>İade dosyaları</h2></div>
        {q.data === undefined ? <Loading /> : q.data.length === 0 ? (
          <div className={s.empty}>Henüz dosya yok. İlk SEB fonlu fatura onaylanınca ayın dosyası açılır.</div>
        ) : (
          <div className={s.list}>
            {q.data.map((c) => (
              <Link key={c.id} href={fin("claims", c.id)} className={cx(s.row, s.rInv)} aria-current={c.id === id ? "page" : undefined}>
                <span className={s.t}>
                  <b>{claimTitle(c)}</b>
                  <span>{c.kind === "monthly" ? "Aylık" : "Etkinlik bazlı"} · {c.invoice_count} fatura{c.people > 0 ? ` · ${c.people} kişiye iade` : ""}</span>
                </span>
                <StatusTag {...CLAIM_STATUS[c.status]} />
                <span className={s.num}>{money(c.seb_total)}</span>
              </Link>
            ))}
          </div>
        )}
        {canWrite && (
          <form className={s.inlineForm} onSubmit={(e) => {
            e.preventDefault();
            w.mutate({ op: "create", kind: "event", event_id: ev }, {
              onSuccess: () => { setEv(""); toast({ text: "Etkinlik dosyası açıldı", error: false }); },
              onError: (x) => toast({ text: errorText(x), error: true }),
            });
          }}>
            <span className={s.sub}>Etkinlik bazlı dosya: o etkinliğin faturaları aylık dosya yerine buraya taşınabilir.</span>
            <div className={s.formRow}>
              <Picker label="Etkinlik" value={ev} onChange={setEv}
                options={[{ value: "", label: "Etkinlik seç…" }, ...(events.data ?? []).map((e) => ({ value: e.id, label: e.title }))]} />
              <Button type="submit" disabled={ev === "" || w.isPending}>Dosya aç</Button>
            </div>
          </form>
        )}
      </div>
      {id !== null ? <ClaimPanel id={id} /> : (
        <div className={s.panel}><div className={s.empty}>Ayrıntı için bir dosya seç.</div></div>
      )}
    </div>
  );
}

function ClaimPanel({ id }: { id: string }) {
  const L = useLookup();
  const q = useClaim(id);
  const w = useClaimWrite();
  const toast = useToast();
  const [received, setReceived] = useState("");
  const [paying, setPaying] = useState(false);
  if (q.error !== null) return <div className={s.panel}><div className={s.empty}>{errorText(q.error)}</div></div>;
  if (q.data === undefined) return <div className={s.panel}><Loading /></div>;
  const { claim: c, invoices, people } = q.data;
  const at = STEPS.indexOf(c.status);
  const next = STEPS[at + 1];
  const prev = at > 0 && c.status !== "paid" ? STEPS[at - 1] : undefined;
  const canWrite = L.can("review_purchases");
  const go = (status: ClaimStatus, amount?: number) =>
    w.mutate({ op: "status", id: c.id, status, ...(amount !== undefined ? { received_amount: amount } : {}) }, {
      onSuccess: () => { setPaying(false); toast({ text: `Dosya: ${STEP_LABEL[status]}`, error: false }); },
      onError: (x) => toast({ text: errorText(x), error: true }),
    });
  return (
    <div className={s.panel}>
      <div className={s.ph}>
        <h2>{claimTitle(c)} · {c.kind === "monthly" ? "aylık dosya" : "etkinlik dosyası"}</h2>
        <span className={s.grow} />
        <StatusTag {...CLAIM_STATUS[c.status]} />
      </div>
      <div className={s.pb}>
        <div className={s.steps}>
          {STEPS.map((x, i) => (
            <span key={x} className={cx(s.step, i < at || c.status === "paid" ? s.stepDone : i === at ? s.stepNow : undefined)}>
              <span className={s.dot} />{STEP_LABEL[x]}
            </span>
          ))}
        </div>
        <div>
          <div className={s.sub} style={{ marginBottom: 6 }}>Kime ne kadar iade edilecek (SEB fonlu kısım)</div>
          <div className={s.items}>
            {people.length === 0 && <div className={s.empty}>Dosyada SEB fonlu kalem yok.</div>}
            {people.map((p) => (
              <div key={p.user_id ?? "club"} className={s.item}>
                <span className={s.t}>
                  <b>{p.user_id === null ? "Kulüp kasası" : L.user(p.user_id)?.name ?? "?"}</b>
                  <span>{p.invoices} fatura{p.user_id === null ? " · kasadan ödendi, iade kasaya girer" : ""}</span>
                </span>
                <span className={s.num}>{money(p.amount)}</span>
              </div>
            ))}
            <div className={s.itemSum}><span>Talep edilen</span><span className={s.num}>{money(c.seb_total)}</span></div>
            {c.received_amount !== null && (
              <div className={s.itemSum}>
                <span>SEB'in yatırdığı</span>
                <span className={s.num}>{money(c.received_amount)}{c.received_amount !== c.seb_total ? ` · fark ${money(c.seb_total - c.received_amount)}` : ""}</span>
              </div>
            )}
          </div>
        </div>
        <div>
          <div className={s.sub} style={{ marginBottom: 6 }}>Faturalar</div>
          <div className={cx(s.list, s.items)}>
            {invoices.map((r) => (
              <Link key={r.id} href={fin("invoices", r.id)} className={cx(s.row, s.rInv)}>
                <span className={s.t}>
                  <b>{L.user(r.submitted_by)?.name ?? "?"} · {r.first_item ?? "Fatura"}{r.item_count > 1 ? ` +${r.item_count - 1}` : ""}</b>
                  <span>{formatDay(r.purchased_on)}{r.event_titles.length > 0 ? ` · ${r.event_titles.join(", ")}` : ""}</span>
                </span>
                <StatusTag {...INVOICE_STATUS[r.status]} />
                <span className={s.num}>{money(r.total_try)}</span>
              </Link>
            ))}
          </div>
        </div>
        {c.status === "office_approved" && (
          <div className={cx(s.callout, s.calloutWarn)}>
            Para bankaya girince “İade geldi” de: kasa defterine gelir satırı açılır, üyelerin payı ödenebilir borç olur.
          </div>
        )}
      </div>
      {paying && (
        <form className={s.inlineForm} onSubmit={(e) => {
          e.preventDefault();
          const v = parseAmount(received);
          if (v === null) return toast({ text: "Yatan tutarı yaz (hiç yatmadıysa 0).", error: true });
          go("paid", v);
        }}>
          <label className={ui.field}>
            <span>SEB'in hesaba yatırdığı tutar</span>
            <input className={ui.input} inputMode="decimal" value={received} onChange={(e) => setReceived(e.target.value)}
              placeholder={money(c.seb_total)} autoFocus />
          </label>
          <div className={ui.dact}>
            <Button type="button" variant="ghost" onClick={() => setPaying(false)}>Vazgeç</Button>
            <Button type="submit" variant="primary" disabled={w.isPending}>Kasaya al</Button>
          </div>
        </form>
      )}
      {canWrite && (next !== undefined || prev !== undefined) && (
        <div className={s.bar}>
          {next !== undefined && (
            <Button variant="primary" disabled={w.isPending || (next === "sent" && invoices.length === 0)}
              onClick={() => (next === "paid" ? (setReceived(String(c.seb_total).replace(".", ",")), setPaying(true)) : go(next))}>
              {NEXT_LABEL[c.status]}
            </Button>
          )}
          {prev !== undefined && (
            <Button variant="ghost" disabled={w.isPending} onClick={() => go(prev)}>Bir adım geri</Button>
          )}
        </div>
      )}
    </div>
  );
}
