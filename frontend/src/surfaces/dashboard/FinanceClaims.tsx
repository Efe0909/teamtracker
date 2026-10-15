// SEB iadeleri (spec/81 §3.6): aylik dosyalar onayla kendiliginden acilir,
// etkinlik dosyasi elle. Durum sirayla ilerler; "Iade geldi" kasaya gelir yazar.

import { useState } from "react";
import { errorText } from "../../api/client";
import { useClaim, useClaimSlots, useClaimWrite } from "../../api/hooks";
import type { ClaimRow, ClaimSlot, ClaimStatus } from "../../api/types";
import { useLookup } from "../../lib/lookup";
import { money, parseAmount } from "../../lib/money";
import { navigate } from "../../lib/router";
import { Button, cx, Link, Loading, ui, useToast } from "../../ui/ui";
import { CLAIM_STATUS, fin, formatDay, INVOICE_STATUS, StatusTag } from "./Finance";
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
 *  tiklaninca dosya acilir ve ayrinti gelir. "Dosya ac" formu yok. */
export function FinanceClaims({ id }: { id: string | null }) {
  const L = useLookup();
  const q = useClaimSlots();
  const w = useClaimWrite();
  const toast = useToast();
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
  const rows = q.data ?? [];
  const groups: { title: string; rows: ClaimSlot[] }[] = [
    { title: "Aylık dosyalar", rows: rows.filter((c) => c.kind === "monthly") },
    { title: "Etkinlikler", rows: rows.filter((c) => c.kind === "event") },
  ];
  return (
    <div className={s.split}>
      <div className={s.panel}>
        <div className={s.ph}><h2>İade dosyaları</h2></div>
        {q.data === undefined ? <Loading /> : rows.length === 0 ? (
          <div className={s.empty}>Henüz SEB fonlu onaylı fatura yok. İlk fatura onaylanınca ayın ve etkinliğin satırı burada görünür.</div>
        ) : groups.map((g) => g.rows.length > 0 && (
          <div key={g.title}>
            <div className={s.groupTitle}>{g.title}</div>
            <div className={s.list}>
              {g.rows.map((c) => {
                const title = claimTitle(c);
                const meta = `${c.invoice_count} fatura${c.kind === "event" && c.event_date !== null ? ` · ${formatDay(c.event_date)}` : ""}`;
                if (c.claim_id !== null) {
                  return (
                    <Link key={c.claim_id} href={fin("claims", c.claim_id)} className={cx(s.row, s.rInv)}
                      aria-current={c.claim_id === id ? "page" : undefined}>
                      <span className={s.t}><b>{title}</b><span>{meta}</span></span>
                      {c.status !== null && <StatusTag {...CLAIM_STATUS[c.status]} />}
                      <span className={s.num}>{money(c.seb_total)}</span>
                    </Link>
                  );
                }
                return (
                  <button key={`${c.kind}-${c.month ?? c.event_id ?? ""}`} type="button" className={cx(s.row, s.rInv)}
                    disabled={!canWrite || w.isPending} onClick={() => open(c)}
                    title={canWrite ? "Dosyayı aç" : "Dosya açmak için “Satın alımları incele” yetkisi gerekir"}>
                    <span className={s.t}><b>{title}</b><span>{meta}</span></span>
                    <StatusTag label="Dosya açılmadı" tone="" />
                    <span className={s.num}>{money(c.seb_total)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {id !== null ? <ClaimPanel id={id} /> : (
        <div className={s.panel}><div className={s.empty}>Ayrıntı için bir satır seç; “Dosya açılmadı” satırına tıklayınca dosya açılır.</div></div>
      )}
    </div>
  );
}

/** Her durumda sıradaki adım: uygulamada tek düğme, uygulamanın dışında yapılacak iş bir cümle. */
const NEXT_HINT: Record<ClaimStatus, string> = {
  draft: "Uygulama dışında: harcama bildirimi ve faturaları SEB'e e-postayla gönder, sonra buradan “SEB'e gitti” işaretle. İşaretlendikten sonra dosyaya fatura eklenmez.",
  sent: "Uygulama dışında: SEB ofisinin onayını bekle. Onay yanıtı gelince işaretle.",
  office_approved: "Uygulama dışında: iade bankaya girince gelen tutarı kontrol et, sonra “İade geldi”yi işaretle; tutar kasa defterine gelir yazılır.",
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
        <span className={s.grow} />
        <a className={cx(ui.btn, ui["v-default"], ui["z-sm"])} href={`/api/finance/claims/${c.id}/xlsx`}>Excel</a>
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
        <div className={s.callout}>
          <b>{c.status === "paid" ? "Tamamlandı" : "Sıradaki adım"}</b>
          <p style={{ margin: "4px 0 0" }}>{NEXT_HINT[c.status]}</p>
          {c.status === "draft" && invoices.length === 0 && (
            <p style={{ margin: "4px 0 0" }}>Önce dosyada fatura olmalı: aşağıdaki liste boş.</p>
          )}
          {canWrite && next !== undefined && (
            <div style={{ marginTop: 8 }}>
              <Button variant="primary" disabled={w.isPending || (next === "sent" && invoices.length === 0)}
                onClick={() => (next === "paid" ? (setReceived(String(c.seb_total).replace(".", ",")), setPaying(true)) : go(next))}>
                {NEXT_LABEL[c.status]}
              </Button>
            </div>
          )}
          {!canWrite && c.status !== "paid" && (
            <p style={{ margin: "4px 0 0" }}>Adımı işaretlemek için “Satın alımları incele” yetkisi gerekir.</p>
          )}
        </div>
        <div>
          <div className={s.sub} style={{ marginBottom: 6 }}>Kime ne kadar iade edilecek (SEB fonlu kısım)</div>
          <div className={s.items}>
            {people.length === 0 && (
              <div className={s.empty}>Dosyada SEB fonlu kalem yok: faturalar genel kasa kalemleri olabilir ya da dosyaya henüz fatura girmedi.</div>
            )}
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
          <div className={s.sub} style={{ marginBottom: 6 }}>Faturalar · {invoices.length}</div>
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
        </div>
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
      {canWrite && prev !== undefined && (
        <div className={s.bar}>
          <Button variant="ghost" disabled={w.isPending} onClick={() => go(prev)}>Bir adım geri</Button>
        </div>
      )}
    </div>
  );
}
