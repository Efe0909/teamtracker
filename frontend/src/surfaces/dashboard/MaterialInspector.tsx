// Malzemeler listesinin yaninda secili kalem: teklif kiyaslamasi ve maliye adimlari.
import { errorText } from "../../api/client";
import { eventOps, useMaterialFull, useMaterialRun, usePurchaseWrite } from "../../api/hooks";
import { formatDay, PRIORITY } from "../../lib/labels";
import { useLookup } from "../../lib/lookup";
import { money } from "../../lib/money";
import { Icon } from "../../ui/icons";
import { Button, cx, IconButton, Link, Loading, ui, useToast } from "../../ui/ui";
import { bestOffer, etaOf, isLate, isPhone, MATERIAL_TYPE, OVERAGE_MARK, overPct, priceOf, unitPrice } from "./eventModel";
import { fin, INVOICE_STATUS, StatusTag } from "./Finance";
import p from "./financePages.module.css";
import s from "./fin.module.css";
import { href } from "./routes";

export function MaterialInspector({ id, onEdit }: { id: string; onEdit: () => void }) {
  const L = useLookup();
  const q = useMaterialFull(id);
  const write = useMaterialRun();
  const purchase = usePurchaseWrite();
  const toast = useToast();
  const fail = (error: unknown) => toast({ text: errorText(error), error: true });
  if (q.error !== null) return <aside className={s.panel} aria-label="Malzeme ayrıntısı"><p role="alert" className={s.empty}>{errorText(q.error)}</p></aside>;
  if (q.data === undefined) return <aside className={s.panel} aria-label="Malzeme ayrıntısı"><Loading /></aside>;
  const d = q.data;
  const m = d.material;
  const price = priceOf(m);
  const unit = unitPrice(price, m.qty);
  const eta = etaOf(m);
  const pct = overPct(price, m.budget);
  const best = bestOffer(m).price;
  const busy = write.isPending || purchase.isPending;
  const canEdit = L.can("manage_purchases");
  const canChoose = canEdit && !m.purchased && !m.owned && !busy;
  const invoices = d.invoices.filter((invoice) => !["rejected", "cancelled", "withdrawn"].includes(invoice.status));
  const category = L.meta.nodes.find((node) => node.id === d.category_id);
  const choose = (chosen: string) => write.mutate(eventOps.material(id, { chosen }), { onError: fail });
  const steps = [
    { label: "Onaylandı", done: m.state === 3 },
    { label: "Satın alındı", done: m.purchased },
    { label: "Teslim edildi", done: m.delivered || m.owned },
    { label: "Fatura bağlandı", done: invoices.length > 0, warn: m.purchased && invoices.length === 0 },
  ];
  return (
    <aside className={cx(s.panel, p.materialInspector)} aria-label="Malzeme ayrıntısı">
      <div className={s.ph}>
        <h2>{m.name}{m.qty > 1 ? ` (${m.qty} adet)` : ""}</h2><span className={s.grow} />
        <StatusTag label={PRIORITY[m.priority]} tone="" />
        <IconButton icon="edit" label="Malzeme ayrıntılarını düzenle" onClick={onEdit} />
      </div>
      <div className={p.inspectorBody}>
        <dl className={p.materialFacts}>
          <dt>Etkinlik</dt><dd>{d.event_id === null ? "Etkinliksiz"
            : <Link href={href({ name: "event", id: d.event_id })}>{d.event_title}{d.event_date !== null && ` · ${formatDay(d.event_date)}`}</Link>}</dd>
          <dt>Adet ve tür</dt><dd>{m.qty} adet · {MATERIAL_TYPE[m.type]}</dd>
          <dt>Fiyat</dt><dd><span className={s.num}>{m.owned ? "Zaten var" : m.sponsor_chosen ? "Sponsor" : price === null ? "—" : money(price)}</span>
            {!m.owned && !m.sponsor_chosen && m.qty > 1 && unit !== null && <small>Birim {money(unit)}</small>}</dd>
          <dt>Bütçe</dt><dd><span className={s.num}>{m.budget === null ? "Girilmedi" : money(m.budget)}</span>
            {!m.owned && !m.sponsor_chosen && pct !== null && <small><StatusTag label={pct > 0 ? `${OVERAGE_MARK[m.overage_level ?? 1]} · %${pct} üstünde` : "Bütçe içinde"} tone={pct > 0 ? s.tWarn ?? "" : s.tOk ?? ""} /></small>}</dd>
          <dt>Teslim</dt><dd>{m.owned ? "Zaten var" : m.delivered ? <StatusTag label="Teslim edildi" tone={s.tOk ?? ""} />
            : eta === null ? "Tarih girilmedi" : <>{isLate(m, d.event_date) && <StatusTag label="Teslim geç" tone={s.tErr ?? ""} />} {formatDay(eta)}
              {isLate(m, d.event_date) && <small>Etkinlikten sonra</small>}</>}</dd>
          {category !== undefined && <><dt>Kategori</dt><dd>{category.name}</dd></>}
        </dl>
        {m.notes !== null && <p className={s.sub}>{m.notes}</p>}
        <section aria-label="Teklifler">
          <h3 className={p.sectionTitle}>Teklifler</h3>
          <div className={p.offerList}>
            {m.providers.length === 0 && !m.has_sponsor && <p className={s.sub}>Henüz teklif yok.</p>}
            {m.providers.map((offer) => <button key={offer.id} type="button" className={p.offerCard}
              aria-pressed={m.chosen_provider_id === offer.id} disabled={!canChoose}
              onClick={() => choose(offer.id)}>
              <span className={p.offerTop}><b>{offer.name ?? offer.contact.replace(/^https?:\/\/(www\.)?/, "")}</b>
                {offer.price !== null && offer.price === best && <StatusTag label="en düşük" tone={s.tOk ?? ""} />}</span>
              <span className={p.offerTop}>{m.chosen_provider_id === offer.id && <span className={p.chosenOffer}>seçili</span>}
                <span className={cx(s.num, p.offerPrice)}>{offer.price === null ? "Fiyat yok" : money(offer.price)}</span></span>
              <span className={s.sub}>{isPhone(offer.contact) ? "Telefon" : "Bağlantı"}{offer.arrival_date !== null && ` · ${formatDay(offer.arrival_date)}`}</span>
            </button>)}
            {m.has_sponsor && <button type="button" className={p.offerCard} aria-pressed={m.sponsor_chosen} disabled={!canChoose}
              onClick={() => choose("sponsor")}><span className={p.offerTop}><b>Sponsor</b>{m.sponsor_chosen && <span className={p.chosenOffer}>seçili</span>}</span>
              <span className={s.sub}>{m.sponsor_qty === null ? "Adet girilmedi" : `${m.sponsor_qty} adet`}{m.sponsor_date !== null && ` · ${formatDay(m.sponsor_date)}`}</span></button>}
          </div>
        </section>
        <ol className={p.materialProgress} aria-label="Malzemenin durumu">
          {steps.map((step) => <li key={step.label}><span className={cx(s.dot, step.done ? s.dotOk : step.warn ? s.dotWarn : undefined)} />{step.label}</li>)}
        </ol>
        {invoices.length > 0 && <div className={p.offerList}>{invoices.map((invoice) => <Link key={invoice.id} href={fin("invoices", invoice.id)} className={s.sub}>
          <Icon name="file" size={13} /> {formatDay(invoice.purchased_on)} · {INVOICE_STATUS[invoice.status].label} · {money(invoice.amount)}
        </Link>)}</div>}
      </div>
      <div className={p.claimFooter}>
        {!m.purchased && !m.owned && L.can("review_purchases") && <Button size="sm" variant="primary" disabled={busy || m.state !== 3}
          onClick={() => purchase.mutate({ op: "purchased", id, purchased: true }, { onError: fail })}>Satın alındı</Button>}
        {!m.owned && canEdit && <Button size="sm" disabled={busy || m.state !== 3}
          onClick={() => write.mutate(eventOps.material(id, { delivered: !m.delivered }), { onError: fail })}>
          {m.delivered ? "Teslimi geri al" : "Teslim edildi"}</Button>}
        {!m.owned && !m.sponsor_chosen && (m.state === 3
          ? <Link href={`${fin("new")}?material=${encodeURIComponent(id)}`} className={cx(ui.btn, ui["v-default"], ui["z-sm"])}>Faturaya bağla</Link>
          : <Button size="sm" disabled title="Önce kalem onaylanmalı">Faturaya bağla</Button>)}
      </div>
    </aside>
  );
}
