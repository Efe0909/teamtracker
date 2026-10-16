// Fatura onayi (spec/81 §6): kuyruk + ayrinti. Ayrinti Faturalarim'da da
// kullanilir; gonderen duzeltir/geri ceker, `review_purchases` karar verir.

import { useState } from "react";
import { errorText } from "../../api/client";
import { useInvoice, useInvoiceDecision, useInvoices } from "../../api/hooks";
import type { InvoiceStatus, InvoiceView } from "../../api/types";
import { InvoiceAttachments } from "../../features/finance/InvoiceAttachments";
import { InvoiceForm } from "../../features/finance/InvoiceForm";
import { profileHref } from "../../features/profile/tabs";
import { useLookup } from "../../lib/lookup";
import { money } from "../../lib/money";
import { navigate } from "../../lib/router";
import { Button, cx, Link, Loading, Segmented, ui, useToast } from "../../ui/ui";
import { fin, formatDay, INVOICE_STATUS, StatusTag } from "./Finance";
import s from "./fin.module.css";

type Filter = "pending" | "changes_requested" | "approved" | "all";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "pending", label: "Bekleyen" },
  { value: "changes_requested", label: "Düzeltmede" },
  { value: "approved", label: "Onaylı" },
  { value: "all", label: "Tümü" },
];

export function FinanceInvoices({ id }: { id: string | null }) {
  const L = useLookup();
  const [filter, setFilter] = useState<Filter>("pending");
  const q = useInvoices(filter === "all" ? {} : { status: filter });
  return (
    <div className={s.split}>
      <div className={s.panel}>
        <div className={s.ph}>
          <h2>Gelen faturalar</h2>
          <span className={s.grow} />
          <Segmented<Filter> label="Fatura durumu" value={filter} onChange={setFilter} options={FILTERS} />
        </div>
        {q.data === undefined ? <Loading /> : q.data.length === 0 ? (
          <div className={s.empty}>Bu durumda fatura yok.</div>
        ) : (
          <div className={s.list}>
            {q.data.map((r) => (
              <Link key={r.id} href={fin("invoices", r.id)} className={cx(s.row, s.rInv)} aria-current={r.id === id ? "page" : undefined}>
                <span className={s.t}>
                  <b>{L.user(r.submitted_by)?.name ?? (r.paid_by === "club" ? "Kulüp kasası" : "?")} · {r.first_item ?? "Fatura"}{r.item_count > 1 ? ` +${r.item_count - 1}` : ""}</b>
                  <span>
                    {formatDay(r.purchased_on)}
                    {r.event_titles.length > 0 ? ` · ${r.event_titles.join(", ")}` : ""}
                    {` · ${r.attachment_count === 0 ? "Belge yok" : `${r.attachment_count} belge`}`}
                    {r.paid_by === "club" ? " · kasadan" : ""}
                  </span>
                </span>
                <StatusTag {...INVOICE_STATUS[r.status]} />
                <span className={s.num}>{money(r.total_try)}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
      {id !== null ? <InvoiceDetail id={id} /> : (
        <div className={s.panel}><div className={s.empty}>Ayrıntı için bir fatura seç.</div></div>
      )}
    </div>
  );
}

const ACTION_LABEL: Record<string, string> = {
  submit: "gönderdi", resubmit: "düzeltip yeniden gönderdi", approve: "onayladı", changes: "düzeltme istedi",
  reject: "reddetti", withdraw: "geri çekti", cancel: "iptal etti",
};

const DONE = {
  approve: "Fatura onaylandı", changes: "Düzeltme istendi", reject: "Fatura reddedildi",
  cancel: "Fatura iptal edildi", withdraw: "Fatura geri çekildi",
} as const;

const CALLOUT: Partial<Record<InvoiceStatus, string>> = {
  pending: "Onaylanınca kalemler satın alındı olur, SEB fonlu kısım ayın iade dosyasına girer; üye ödediyse ona borç doğar, kasadan ödendiyse gider yazılır.",
  changes_requested: "Gönderen düzeltip yeniden gönderince kuyruğa döner.",
};

export function InvoiceDetail({ id, editing = false }: { id: string; editing?: boolean }) {
  const L = useLookup();
  const q = useInvoice(id);
  const decide = useInvoiceDecision();
  const toast = useToast();
  const [noteFor, setNoteFor] = useState<"changes" | "reject" | "cancel" | null>(null);
  const [note, setNote] = useState("");
  if (q.error !== null) return <div className={s.panel}><div className={s.empty}>{errorText(q.error)}</div></div>;
  if (q.data === undefined) return <div className={s.panel}><Loading /></div>;
  const v: InvoiceView = q.data;
  const mine = v.submitted_by === L.me.id;

  if (editing) {
    return (
      <div className={s.panel}>
        <div className={s.ph}><h2>Faturayı düzelt</h2><span className={s.sub}>gönderince yeniden onaya düşer</span></div>
        <div className={s.pb}>
          {v.can_edit ? (
            <InvoiceForm initial={v}
              accountsHref={profileHref("accounts", fin("edit", v.id))}
              eventHref={(eventId) => `/events/${eventId}?focus=supplies&return=${encodeURIComponent(fin("edit", v.id))}`}
              onDone={(inv) => { toast({ text: "Fatura yeniden gönderildi", error: false }); navigate(fin("mine", inv.id)); }} />
          ) : <p>Bu fatura artık düzeltilemez.</p>}
        </div>
      </div>
    );
  }

  const act = (action: "approve" | "changes" | "reject" | "cancel" | "withdraw", n?: string) =>
    decide.mutate({ id: v.id, action, ...(n !== undefined ? { note: n } : {}) }, {
      onSuccess: () => {
        setNoteFor(null);
        setNote("");
        toast({ text: DONE[action], error: false });
      },
      onError: (e) => toast({ text: errorText(e), error: true }),
    });
  const who = L.user(v.submitted_by)?.name ?? "?";
  const tryOf = (amount: number) => (v.fx_rate === null ? amount : Math.round(amount * v.fx_rate * 100) / 100);

  return (
    <div className={s.panel}>
      <div className={s.ph}>
        <h2>{who} · {formatDay(v.purchased_on)}</h2>
        <span className={s.grow} />
        <StatusTag {...INVOICE_STATUS[v.status]} />
      </div>
      <div className={s.pb}>
        <section className={s.invoiceDocuments} aria-label="Fatura / fiş">
          <h3 className={s.sub}>Fatura / fiş</h3>
          {v.attachments.length === 0 ? <p className={s.missingDocument}>Bu faturaya fatura veya fiş dosyası eklenmemiş.</p>
            : <InvoiceAttachments files={v.attachments} />}
        </section>
        <div>
          <div className={s.sub} style={{ marginBottom: 6 }}>Bağlı kalemler</div>
          <div className={s.items}>
            {v.items.map((it) => {
              const tl = tryOf(it.amount);
              const over = it.budget !== null && tl > it.budget;
              return (
                <div key={it.material_id} className={s.item}>
                  <span className={s.t}>
                    <b>{it.name}</b>
                    <span>
                      {it.event_title ?? "Etkinliğe bağlı değil"}
                      {it.budget !== null && ` · bütçe ${money(it.budget)}`}
                      {it.funding !== null && ` · ${it.funding === "seb" ? "SEB" : "kasa"}`}
                    </span>
                  </span>
                  <span className={s.num}>
                    {money(it.amount, v.currency)}
                    {over && <> <StatusTag label="bütçe üstü" tone={s.tWarn ?? ""} /></>}
                  </span>
                </div>
              );
            })}
            <div className={s.itemSum}>
              <span>Toplam</span>
              <span className={s.num}>
                {money(v.total, v.currency)}
                {v.fx_rate !== null && ` · ${money(v.total_try)}`}
              </span>
            </div>
          </div>
        </div>
        <dl className={s.kv}>
          <dt>Etkinlikler</dt>
          <dd>{v.events.length === 0 ? "—" : v.events.map((e) => e.title).join(", ")} <span className={s.sub}>(kalemlerden)</span></dd>
          {v.fx_rate !== null && (
            <>
              <dt>Kur</dt>
              <dd className={s.num} style={{ textAlign: "left" }}>
                1 {v.currency} = {v.fx_rate.toLocaleString("tr-TR", { maximumFractionDigits: 6 })} ₺ · {formatDay(v.fx_on)} · {v.fx_source === "tcmb" ? "TCMB" : "elle"}
              </dd>
            </>
          )}
          <dt>Ödeme</dt>
          <dd>
            {v.paid_by === "club" ? "Kulüp kasasından ödendi" : "Üye ödedi · iade edilecek"}
            {v.payee !== null && (
              <><br /><span className={s.sub}>{v.payee.label} · {v.payee.holder_name} · <span className={s.num}>{v.payee.iban ?? `…${v.payee.iban_last4}`}</span></span></>
            )}
          </dd>
          {v.note !== null && (<><dt>Not</dt><dd>{v.note}</dd></>)}
          {v.claim_id !== null && (<><dt>İade dosyası</dt><dd><Link href={fin("claims", v.claim_id)}>Dosyayı aç</Link></dd></>)}
        </dl>
        <ul className={s.timeline}>
          {v.reviews.map((r, i) => (
            <li key={i}>
              <span className={s.date}>{formatDay(r.at)}</span>
              <span><b>{L.user(r.by_user ?? "")?.name ?? "?"}</b> {ACTION_LABEL[r.action] ?? r.action}{r.note !== null ? `: ${r.note}` : ""}</span>
            </li>
          ))}
        </ul>
        {CALLOUT[v.status] !== undefined && <div className={s.callout}>{CALLOUT[v.status]}</div>}
      </div>
      {noteFor !== null && (
        <form className={s.inlineForm} onSubmit={(e) => { e.preventDefault(); act(noteFor, note.trim()); }}>
          <label className={ui.field}>
            <span>{noteFor === "changes" ? "Neyin düzeltilmesi gerekiyor?" : noteFor === "reject" ? "Neden reddediliyor?" : "Neden iptal ediliyor?"}</span>
            <textarea className={ui.input} rows={2} required maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
          </label>
          <div className={ui.dact}>
            <Button type="button" variant="ghost" onClick={() => setNoteFor(null)}>Vazgeç</Button>
            <Button type="submit" variant={noteFor === "changes" ? "primary" : "danger"} disabled={decide.isPending || note.trim() === ""}>Gönder</Button>
          </div>
        </form>
      )}
      <div className={s.bar}>
        {v.can_review && v.status === "pending" && (
          <>
            <Button variant="primary" disabled={decide.isPending} onClick={() => act("approve")}>Onayla</Button>
            <Button onClick={() => setNoteFor("changes")}>Düzeltme iste</Button>
            <Button variant="danger" onClick={() => setNoteFor("reject")}>Reddet</Button>
          </>
        )}
        {v.can_review && v.status === "changes_requested" && (
          <Button variant="danger" onClick={() => setNoteFor("reject")}>Reddet</Button>
        )}
        {v.can_review && v.status === "approved" && (
          <Button variant="danger" onClick={() => setNoteFor("cancel")}>İptal et</Button>
        )}
        {mine && v.can_edit && (
          <>
            <Link href={fin("edit", v.id)} className={cx(ui.btn, ui["z-md"])}>Düzelt</Link>
            <Button variant="ghost" disabled={decide.isPending} onClick={() => {
              if (window.confirm("Fatura geri çekilecek. Tekrar göndermek için yeni fatura eklemen gerekir.")) act("withdraw");
            }}>Geri çek</Button>
          </>
        )}
      </div>
    </div>
  );
}
