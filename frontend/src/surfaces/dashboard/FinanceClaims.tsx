// SEB iadeleri (spec/81 §3.6): aylik dosyalar onayla kendiliginden acilir,
// etkinlik dosyasi elle. Durum sirayla ilerler; "Iade geldi" kasaya gelir yazar.

import { useState } from "react";
import { errorText } from "../../api/client";
import { useClaim, useClaimSlots, useClaimWrite, useEvents } from "../../api/hooks";
import type { ClaimRow, ClaimSlot, ClaimStatus } from "../../api/types";
import { useLookup } from "../../lib/lookup";
import { money, parseAmount } from "../../lib/money";
import { navigate } from "../../lib/router";
import { Button, cx, Dialog, Link, Loading, Picker, ui, useToast } from "../../ui/ui";
import { CLAIM_STATUS, fin, formatDay, INVOICE_STATUS, StatusTag } from "./Finance";
import { inFinancePeriod, useFinancePeriod } from "./FinancePeriod";
import p from "./financePages.module.css";
import s from "./fin.module.css";

const STEPS: ClaimStatus[] = ["draft", "sent", "office_approved", "paid"];
const STEP_LABEL: Record<ClaimStatus, string> = { draft: "Hazırlandı", sent: "SEB'e gitti", office_approved: "Ofis onayladı", paid: "İade geldi" };
const NEXT_LABEL: Partial<Record<ClaimStatus, string>> = {
  draft: "SEB'e gönderildi olarak işaretle", sent: "Ofis onayladı olarak işaretle", office_approved: "İade geldi, kasaya al",
};

function monthTitle(month: string | null): string {
  if (month === null) return "Aylık";
  const [y, m] = month.split("-").map(Number);
  return new Date(y ?? 2000, (m ?? 1) - 1, 1).toLocaleDateString("tr-TR", { month: "long", year: "numeric" });
}

export function claimTitle(c: Pick<ClaimRow, "kind" | "event_title" | "month">): string {
  return c.kind === "event" ? c.event_title ?? "Etkinlik" : monthTitle(c.month);
}

/** Dosya olmayan ya da olan her ay ve etkinlik satir olarak gorunur; acilmamis satira
 *  tiklaninca dosya acilir ve ayrinti gelir; yeni dosya dugmesi elle acmayi da saglar. */
export function FinanceClaims({ id }: { id: string | null }) {
  const L = useLookup();
  const q = useClaimSlots();
  const w = useClaimWrite();
  const toast = useToast();
  const period = useFinancePeriod();
  const [creating, setCreating] = useState(false);
  const canWrite = L.can("review_purchases");
  const open = (c: ClaimSlot) => {
    const body = c.kind === "monthly" && c.month !== null
      ? ({ op: "create", kind: "monthly", month: c.month } as const)
      : c.event_id !== null ? ({ op: "create", kind: "event", event_id: c.event_id } as const) : null;
    if (body === null) return;
    w.mutate(body, {
      onSuccess: (d) => navigate(fin("claims", d.claim.id)),
      onError: (x) => toast({ text: errorText(x), error: true }),
    });
  };
  const rows = (q.data ?? []).filter((c) => {
    if (c.claim_id === id && id !== null) return true;
    if (c.kind === "monthly" && c.month !== null && period !== null) {
      const lastDay = new Date(`${c.month}T12:00:00`);
      lastDay.setMonth(lastDay.getMonth() + 1, 0);
      return c.month <= period.to && lastDay.toLocaleDateString("en-CA") >= period.from;
    }
    return inFinancePeriod(c.event_date, period);
  });
  const selectedId = id ?? rows.find((c) => c.claim_id !== null)?.claim_id ?? null;
  return (
    <div className={p.claimsLayout}>
      <div className={s.panel}>
        <div className={s.ph}>
          <h2>İade dosyaları</h2><span className={s.grow} />
          {canWrite && <Button size="sm" onClick={() => setCreating(true)}>Yeni dosya</Button>}
        </div>
        {q.error !== null ? <div role="alert" className={s.empty}>{errorText(q.error)}</div> : q.data === undefined ? <Loading /> : rows.length === 0 ? (
          <div className={s.empty}>{(q.data?.length ?? 0) > 0 ? "Seçili dönemde iade dosyası yok."
            : "Henüz SEB fonlu onaylı fatura yok. İlk fatura onaylanınca ayın ve etkinliğin satırı burada görünür."}</div>
        ) : (
            <div className={s.list}>
              {rows.map((c) => {
                const title = claimTitle(c);
                const meta = `${c.kind === "monthly" ? "Aylık" : "Etkinlik bazlı"} · ${c.invoice_count} fatura`;
                if (c.claim_id !== null) {
                  return (
                    <Link key={c.claim_id} href={fin("claims", c.claim_id)} className={cx(s.row, s.rInv, p.fileRow)}
                      aria-current={c.claim_id === selectedId ? "page" : undefined}>
                      <span className={s.t}><b>{title}</b><span>{meta}</span></span>
                      {c.status !== null && <StatusTag {...CLAIM_STATUS[c.status]} />}
                      <span className={s.num}>{money(c.seb_total)}</span>
                    </Link>
                  );
                }
                return (
                  <button key={`${c.kind}-${c.month ?? c.event_id ?? ""}`} type="button" className={cx(s.row, s.rInv, p.fileRow)}
                    disabled={!canWrite || w.isPending} onClick={() => open(c)}
                    title={canWrite ? "Dosyayı aç" : "Dosya açmak için “Satın alımları incele” yetkisi gerekir"}>
                    <span className={s.t}><b>{title}</b><span>{meta}</span></span>
                    <StatusTag label="Dosya açılmadı" tone="" />
                    <span className={s.num}>{money(c.seb_total)}</span>
                  </button>
                );
              })}
            </div>
        )}
      </div>
      {selectedId !== null ? <ClaimPanel key={selectedId} id={selectedId} /> : (
        <div className={s.panel}><div className={s.empty}>Ayrıntı için bir satır seç; “Dosya açılmadı” satırına tıklayınca dosya açılır.</div></div>
      )}
      <Dialog open={creating} onClose={() => setCreating(false)} title="Yeni iade dosyası">
        <NewClaim rows={q.data ?? []} onClose={() => setCreating(false)} />
      </Dialog>
    </div>
  );
}

function NewClaim({ rows, onClose }: { rows: ClaimSlot[]; onClose: () => void }) {
  const events = useEvents();
  const write = useClaimWrite();
  const toast = useToast();
  const [kind, setKind] = useState<"monthly" | "event">("monthly");
  const [month, setMonth] = useState(new Date().toLocaleDateString("en-CA").slice(0, 7));
  const [eventId, setEventId] = useState("");
  const monthlyExists = rows.some((row) => row.kind === "monthly" && row.month === `${month}-01` && row.claim_id !== null);
  return (
    <form className={ui.formStack} onSubmit={(e) => {
      e.preventDefault();
      const body = kind === "monthly" ? { op: "create" as const, kind, month: `${month}-01` }
        : { op: "create" as const, kind, event_id: eventId };
      write.mutate(body, {
        onSuccess: (detail) => { onClose(); navigate(fin("claims", detail.claim.id)); },
        onError: (error) => toast({ text: errorText(error), error: true }),
      });
    }}>
      <label className={ui.field}><span>Dosya türü</span>
        <Picker label="Dosya türü" value={kind} onChange={setKind}
          options={[{ value: "monthly", label: "Aylık dosya" }, { value: "event", label: "Etkinlik dosyası" }]} />
      </label>
      {kind === "monthly" ? <label className={ui.field}><span>Ay</span>
        <input className={ui.input} type="month" value={month} required onChange={(e) => setMonth(e.target.value)} />
        {monthlyExists && <small className={s.sub}>Bu ay için bir dosya zaten var.</small>}
      </label> : <label className={ui.field}><span>Etkinlik</span>
        <Picker label="Etkinlik" value={eventId} onChange={setEventId} placeholder="Etkinlik seç" search
          options={(events.data ?? []).map((event) => ({ value: event.id, label: event.title,
            disabled: rows.some((row) => row.event_id === event.id && row.claim_id !== null) }))} />
      </label>}
      <div className={ui.dact}>
        <Button variant="ghost" onClick={onClose}>Vazgeç</Button>
        <Button type="submit" variant="primary" disabled={write.isPending || (kind === "event" ? eventId === "" : month === "" || monthlyExists)}>Dosyayı aç</Button>
      </div>
    </form>
  );
}

/** Her durumda sıradaki adım: uygulamada tek düğme, uygulamanın dışında yapılacak iş bir cümle. */
const NEXT_HINT: Record<ClaimStatus, string> = {
  draft: "Harcama bildirimini ve faturaları SEB'e gönder, ardından “SEB'e gitti” olarak işaretle. Gönderilen dosyaya fatura eklenmez.",
  sent: "SEB ofisinin onayı bekleniyor. Onay yanıtı geldiğinde sonraki adımı işaretleyebilirsin.",
  office_approved: "Para bankaya girince “İade geldi” olarak işaretle. Kasa defterine gelir satırı açılır, üyelerin payı ödenebilir borç olarak listelenir.",
  paid: "Bu dosya tamamlandı: iade kasaya yazıldı, üyelerin payı ödenebilir borç oldu.",
};

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
      </div>
      <div className={p.claimBody}>
        <div className={cx(s.steps, p.progress)} aria-label="İade dosyasının durumu">
          {STEPS.map((x, i) => (
            <span key={x} aria-current={i === at ? "step" : undefined}
              className={cx(s.step, i < at || c.status === "paid" ? s.stepDone : i === at ? s.stepNow : undefined)}>
              <span className={s.dot} />{STEP_LABEL[x]}
            </span>
          ))}
        </div>
        <div>
          <h3 className={p.sectionTitle}>Kime ne kadar iade edilecek</h3>
          <div className={p.recipients}>
            {people.length === 0 && (
              <div className={s.empty}>Dosyada SEB fonlu kalem yok: faturalar genel kasa kalemleri olabilir ya da dosyaya henüz fatura girmedi.</div>
            )}
            {people.map((person) => (
              <div key={person.user_id ?? "club"} className={p.recipient}>
                <span className={s.t}>
                  <b>{person.user_id === null ? "Kulüp kasası" : L.user(person.user_id)?.name ?? "?"}</b>
                  <span>{person.invoices} fatura{person.user_id === null ? " · kasadan ödendi" : ""}</span>
                </span>
                <StatusTag label={person.user_id === null ? c.status === "paid" ? "Kasaya girdi" : "Kasaya girer"
                  : c.status === "paid" ? "Ödenebilir" : "Bekliyor"} tone={person.user_id === null ? s.tAcc : c.status === "paid" ? s.tOk : ""} />
                <span className={s.num}>{money(person.amount)}</span>
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
        <div className={cx(s.callout, s.calloutWarn, p.nextStep)}>
          <p>{NEXT_HINT[c.status]}</p>
          {c.status === "draft" && invoices.length === 0 && <p>Göndermeden önce dosyaya fatura eklenmeli.</p>}
          {canWrite && next !== undefined && (
            <Button disabled={w.isPending || (next === "sent" && invoices.length === 0) || (next === "paid" && !L.can("manage_ledger"))}
              title={next === "paid" && !L.can("manage_ledger") ? "Kasaya almak için kasa yönetme yetkisi gerekir" : undefined}
              onClick={() => next === "paid" ? (setReceived(String(c.seb_total).replace(".", ",")), setPaying(true)) : go(next)}>
              {NEXT_LABEL[c.status]}
            </Button>
          )}
        </div>
        <details className={p.invoiceDetails}>
          <summary>Faturalar · {invoices.length}</summary>
          <div className={cx(s.list, s.items)}>
            {invoices.length === 0 && (
              <div className={s.empty}>
                {c.kind === "monthly"
                  ? "Bu aya ait SEB fonlu bir fatura onaylanınca kendiliğinden buraya girer."
                  : "Bu etkinliğin SEB fonlu onaylı faturaları dosya açılırken buraya taşınır; sonradan onaylananlar için fatura sayfasından “dosyaya taşı” de."}
              </div>
            )}
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
        </details>
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
      <div className={p.claimFooter}>
        <a className={cx(ui.btn, ui["v-primary"], ui["z-sm"])} href={`/api/finance/claims/${c.id}/xlsx`}>Excel çıktısı al</a>
        <Link className={cx(ui.btn, ui["v-default"], ui["z-sm"])} href={`${fin("templates")}?claim=${encodeURIComponent(c.id)}`}>Mail taslağı</Link>
        <span className={s.grow} />
        {canWrite && prev !== undefined && <Button size="sm" variant="ghost" disabled={w.isPending} onClick={() => go(prev)}>Bir adım geri</Button>}
      </div>
    </div>
  );
}
