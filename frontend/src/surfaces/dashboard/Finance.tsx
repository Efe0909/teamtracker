// Maliye (spec/81 §10): ustte gruplu sekmeler + bolumler. Gormek "maliye" yetkisi
// ister (§4); digerleri yalniz "Fatura ekle" ve "Faturalarim"i gorur.

import { useEffect, useState } from "react";
import { errorText } from "../../api/client";
import { useFinanceSummary, useInvoices, useLedgerWrite } from "../../api/hooks";
import type { ClaimStatus, InvoiceStatus } from "../../api/types";
import { InvoiceForm } from "../../features/finance/InvoiceForm";
import { profileHref } from "../../features/profile/tabs";
import type { Lookup } from "../../lib/lookup";
import { useLookup } from "../../lib/lookup";
import { money } from "../../lib/money";
import { navigate } from "../../lib/router";
import { Button, cx, Link, Loading, ui, useToast } from "../../ui/ui";
import d from "./dashboard.module.css";
import { FinanceAnalysis } from "./FinanceAnalysis";
import { FinanceBudget } from "./FinanceBudget";
import { FinanceClaims } from "./FinanceClaims";
import { FinanceInvoices, InvoiceDetail } from "./FinanceInvoices";
import { FinanceLedger } from "./FinanceLedger";
import { FinanceMaterials, FinanceVendors, FinanceWall } from "./FinancePurchasing";
import { FinanceRecurring } from "./FinanceRecurring";
import { FinanceTemplates } from "./FinanceTemplates";
import s from "./fin.module.css";
import { href, type FinanceSection } from "./routes";

const VIEW_SCOPES = ["review_purchases", "manage_budgets", "manage_ledger", "manage_purchases"];

/** Maliye sayfasini gorebilen (spec/81 §4); uclar yine kendisi denetler. */
export function isFinanceViewer(L: Lookup): boolean {
  return L.meta.me.is_admin || VIEW_SCOPES.some((x) => L.can(x));
}

export const fin = (section: FinanceSection, id: string | null = null) => href({ name: "finance", section, id });

export const INVOICE_STATUS: Record<InvoiceStatus, { label: string; tone: string }> = {
  pending: { label: "Bekliyor", tone: s.tWarn ?? "" },
  changes_requested: { label: "Düzeltme istendi", tone: s.tErr ?? "" },
  approved: { label: "Onaylandı", tone: s.tOk ?? "" },
  rejected: { label: "Reddedildi", tone: s.tErr ?? "" },
  withdrawn: { label: "Geri çekildi", tone: "" },
  cancelled: { label: "İptal", tone: "" },
};

export const CLAIM_STATUS: Record<ClaimStatus, { label: string; tone: string }> = {
  draft: { label: "Hazırlanıyor", tone: s.tAcc ?? "" },
  sent: { label: "SEB'e gitti", tone: s.tInfo ?? "" },
  office_approved: { label: "Ofis onayladı", tone: s.tInfo ?? "" },
  paid: { label: "İade geldi", tone: s.tOk ?? "" },
};

export function StatusTag({ label, tone }: { label: string; tone: string }) {
  return <span className={cx(s.tag, tone)}>{label}</span>;
}

export function formatDay(iso: string | null): string {
  if (iso === null) return "—";
  const [y, m, day] = iso.slice(0, 10).split("-").map(Number);
  if (y === undefined || m === undefined || day === undefined) return iso;
  return new Date(y, m - 1, day).toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
}

const TITLES: Record<FinanceSection, string> = {
  home: "Genel", invoices: "Fatura onayı", new: "Fatura ekle", edit: "Faturayı düzelt", mine: "Faturalarım",
  claims: "SEB iadeleri", ledger: "Kulüp kasası", materials: "Malzemeler", wall: "Satın alım duvarı",
  vendors: "Tedarikçiler", budget: "Dönem bütçesi", analysis: "Analiz", recurring: "Tekrarlayan giderler",
  templates: "Mail şablonları",
};

export function Finance({ section, id }: { section: FinanceSection; id: string | null }) {
  const L = useLookup();
  const viewer = isFinanceViewer(L);
  // Maliye disi: Genel yerine Faturalarim.
  const effective: FinanceSection = !viewer && !["new", "edit", "mine"].includes(section) ? "mine" : section;
  useEffect(() => {
    document.title = `${TITLES[effective]} · Maliye — EkipTakip`;
  }, [effective]);
  return (
    <div className={d.page}>
      <div className={d.pageHead}>
        <div className={d.pageTitle}>
          <h1>Maliye</h1>
          <p className={d.pageSub}>{TITLES[effective]}</p>
        </div>
      </div>
      <FinanceNav section={effective} viewer={viewer} />
      <div className={s.main}>
        {effective === "home" && <Home />}
        {effective === "invoices" && <FinanceInvoices id={id} />}
        {effective === "claims" && <FinanceClaims id={id} />}
        {effective === "ledger" && <FinanceLedger />}
        {effective === "materials" && <FinanceMaterials />}
        {effective === "wall" && <FinanceWall />}
        {effective === "vendors" && <FinanceVendors id={id} />}
        {effective === "budget" && <FinanceBudget />}
        {effective === "analysis" && <FinanceAnalysis />}
        {effective === "recurring" && <FinanceRecurring />}
        {effective === "templates" && <FinanceTemplates id={id} />}
        {effective === "mine" && <Mine id={id} />}
        {effective === "new" && <NewInvoice />}
        {effective === "edit" && id !== null && <EditInvoice id={id} />}
      </div>
    </div>
  );
}

/** Bolum gezinmesi. Yeni bolum icin yalniz bu diziye satir eklenir. */
const NAV_GROUPS: { label: string; viewerOnly: boolean; items: { section: FinanceSection; label: string }[] }[] = [
  { label: "Takip", viewerOnly: true, items: [
    { section: "home", label: "Genel" },
    { section: "invoices", label: "Fatura onayı" },
    { section: "claims", label: "SEB iadeleri" },
    { section: "ledger", label: "Kulüp kasası" },
    { section: "budget", label: "Dönem bütçesi" },
    { section: "analysis", label: "Analiz" },
  ] },
  { label: "Satın alım", viewerOnly: true, items: [
    { section: "materials", label: "Malzemeler" },
    { section: "wall", label: "Satın alım duvarı" },
    { section: "vendors", label: "Tedarikçiler" },
  ] },
  { label: "Kayıtlar", viewerOnly: true, items: [
    { section: "recurring", label: "Tekrarlayan giderler" },
    { section: "templates", label: "Mail şablonları" },
  ] },
  { label: "Gönder", viewerOnly: false, items: [
    { section: "new", label: "Fatura ekle" },
    { section: "mine", label: "Faturalarım" },
  ] },
];

function FinanceNav({ section, viewer }: { section: FinanceSection; viewer: boolean }) {
  const pending = useInvoices({ status: "pending" });
  return (
    <nav className={s.subnav} aria-label="Maliye bölümleri">
      {NAV_GROUPS.filter((g) => viewer || !g.viewerOnly).map((g) => (
        <div key={g.label} className={s.subGroup}>
          <span className={s.subGrp}>{g.label}</span>
          {g.items.map((it) => {
            const count = it.section === "invoices" ? pending.data?.length : undefined;
            return (
              <Link key={it.section} href={fin(it.section)} className={s.navItem}
                aria-current={section === it.section || (it.section === "invoices" && section === "edit") ? "page" : undefined}>
                <span>{it.label}</span>
                {count !== undefined && count > 0 && <span className={s.count}>{count}</span>}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

// --- Genel ---------------------------------------------------------------------

function Home() {
  const L = useLookup();
  const q = useFinanceSummary();
  const pay = useLedgerWrite();
  const toast = useToast();
  if (q.error !== null) return <p role="alert">{errorText(q.error)}</p>;
  if (q.data === undefined) return <Loading />;
  const v = q.data;
  const debt = v.member_debts.reduce((a, x) => a + x.outstanding, 0);
  const net = v.cash_balance + v.seb_receivable - debt;
  const canPay = L.can("manage_ledger");
  return (
    <>
      <div className={s.panel}>
        <div className={s.pos}>
          <Link href={fin("ledger")} className={cx(s.tile, s.tileLink)}>
            <span className={s.lbl}><span className={cx(s.dot, s.dotOk)} />Kulüp kasası</span>
            <span className={s.val}>{money(v.cash_balance)}</span>
            <span className={s.meta}>
              {v.last_check === null ? "Mutabakat yapılmadı"
                : `Son mutabakat ${formatDay(v.last_check.checked_on)} · ${v.last_check.diff === 0 ? "banka ile aynı" : `fark ${money(v.last_check.diff)}`}`}
            </span>
          </Link>
          <Link href={fin("claims")} className={cx(s.tile, s.tileLink)}>
            <span className={s.lbl}><span className={cx(s.dot, s.dotWarn)} />SEB'den alacak</span>
            <span className={s.val}>{money(v.seb_receivable)}</span>
            <span className={s.meta}>{v.claims_waiting} dosyada iade bekliyor</span>
          </Link>
          {/* Ayni sayfada asagidaki "Uyelere borc" paneline atlar (plain anchor: SPA yonlendirmesine girmez). */}
          <a href="#member-debts" className={cx(s.tile, s.tileLink)}>
            <span className={s.lbl}><span className={cx(s.dot, s.dotErr)} />Üyelere borç</span>
            <span className={cx(s.val, debt > 0 && s.neg)}>{debt > 0 ? `−${money(debt)}` : money(0)}</span>
            <span className={s.meta}>{v.member_debts.length} kişi</span>
          </a>
          <div className={s.tile}>
            <span className={s.lbl}>Net durum</span>
            <span className={s.val}>{money(net)}</span>
            <span className={s.meta}>Kasa + SEB alacağı − üyelere borç</span>
          </div>
        </div>
      </div>

      <div className={s.cols}>
        <div className={s.panel}>
          <div className={s.ph}><h2>Yaklaşan ödemeler</h2><span className={s.sub}>önümüzdeki 30 gün</span></div>
          <div className={s.list}>
            {v.upcoming.length === 0 && v.member_debts.every((x) => x.payable <= 0) && (
              <div className={s.empty}>Önümüzdeki 30 günde ödeme görünmüyor.</div>
            )}
            {v.member_debts.filter((x) => x.payable > 0).map((x) => (
              <div key={x.user_id} className={cx(s.row, s.rDue)}>
                <span className={s.date}>şimdi</span>
                <span className={s.t}><b>{L.user(x.user_id)?.name ?? "?"} için iade</b><span>Ödenebilir: SEB iadesi geldi ya da kasadan karşılanır</span></span>
                <StatusTag label="Üyeye borç" tone={s.tErr ?? ""} />
                <span className={s.num}>{money(x.payable)}</span>
              </div>
            ))}
            {v.upcoming.map((u) => (
              <div key={`${u.kind}-${u.id}`} className={cx(s.row, s.rDue)}>
                <span className={s.date}>{formatDay(u.due)}</span>
                <span className={s.t}>
                  <b>{u.label}</b>
                  <span>{u.kind === "material" ? `Onaylı, henüz alınmadı${u.event !== null && u.event !== undefined ? ` · ${u.event}` : ""}` : "Tekrarlayan gider"}</span>
                </span>
                <StatusTag label={u.kind === "material" ? "Alınmadı" : "Tekrarlayan"} tone={u.kind === "material" ? s.tWarn ?? "" : ""} />
                <span className={s.num}>{u.amount === null ? "—" : money(u.amount, u.currency ?? "TRY")}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={s.panel}>
          <div className={s.ph}><h2>Bekleyen işler</h2></div>
          <div className={s.list}>
            <Link href={fin("invoices")} className={cx(s.row, s.rInv)}>
              <span className={s.t}>
                <b>{v.pending_invoices === 0 ? "Onay bekleyen fatura yok" : `${v.pending_invoices} fatura onay bekliyor`}</b>
                <span>{v.oldest_pending === null ? "Kuyruk boş" : `En eskisi ${formatDay(v.oldest_pending)}`}</span>
              </span>
              <StatusTag label="Fatura onayı" tone={v.pending_invoices > 0 ? s.tWarn ?? "" : ""} />
              <span />
            </Link>
            {v.unclaimed > 0 && (
              <Link href={fin("claims")} className={cx(s.row, s.rInv)}>
                <span className={s.t}><b>{v.unclaimed} SEB faturası dosyasız</b><span>Ayın dosyası gönderilmişti; bir dosyaya taşı</span></span>
                <StatusTag label="SEB iadesi" tone={s.tInfo ?? ""} />
                <span />
              </Link>
            )}
            {v.last_check !== null && v.last_check.diff !== 0 && (
              <Link href={fin("ledger")} className={cx(s.row, s.rInv)}>
                <span className={s.t}><b>Kasa banka ile tutmuyor</b><span>Fark {money(v.last_check.diff)} · {formatDay(v.last_check.checked_on)}</span></span>
                <StatusTag label="Kasa" tone={s.tErr ?? ""} />
                <span />
              </Link>
            )}
          </div>
        </div>
      </div>

      {v.member_debts.length > 0 && (
        <div id="member-debts" className={s.panel}>
          <div className={s.ph}><h2>Üyelere borç</h2><span className={s.sub}>onaylı, üyenin ödediği faturalar − yapılan ödemeler</span></div>
          <div className={s.list}>
            {v.member_debts.map((x) => (
              <div key={x.user_id} className={cx(s.row, s.rPerson)}>
                <span className={s.t}>
                  <b>{L.user(x.user_id)?.name ?? "?"}</b>
                  <span>{x.payable > 0 ? `${money(x.payable)} ödenebilir` : "SEB iadesi bekleniyor"}</span>
                </span>
                <span className={s.num}>{money(x.outstanding)}</span>
                {canPay && x.payable > 0 ? (
                  <Button size="sm" disabled={pay.isPending} onClick={() => {
                    if (!window.confirm(`${L.user(x.user_id)?.name ?? "Üye"} için ${money(x.payable)} kasadan ödenmiş olarak yazılacak.`)) return;
                    pay.mutate({ op: "payout", user_id: x.user_id, amount: Math.round(x.payable * 100) / 100 }, {
                      onSuccess: () => toast({ text: "Ödeme kasaya yazıldı", error: false }),
                      onError: (e) => toast({ text: errorText(e), error: true }),
                    });
                  }}>Öde</Button>
                ) : <span />}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// --- Faturalarim ve form ----------------------------------------------------------

function Mine({ id }: { id: string | null }) {
  const q = useInvoices({ mine: true });
  return (
    <div className={s.split}>
      <div className={s.panel}>
        <div className={s.ph}>
          <h2>Faturalarım</h2>
          <span className={s.grow} />
          <Link href={fin("new")} className={cx(ui.btn, ui["z-sm"])}>Fatura ekle</Link>
        </div>
        {q.data === undefined ? <Loading /> : q.data.length === 0 ? (
          <div className={s.empty}>Henüz fatura göndermedin.</div>
        ) : (
          <div className={s.list}>
            {q.data.map((r) => (
              <Link key={r.id} href={fin("mine", r.id)} className={cx(s.row, s.rInv)} aria-current={r.id === id ? "page" : undefined}>
                <span className={s.t}>
                  <b>{r.first_item ?? "Fatura"}{r.item_count > 1 ? ` +${r.item_count - 1}` : ""}</b>
                  <span>{formatDay(r.purchased_on)}{r.event_titles.length > 0 ? ` · ${r.event_titles.join(", ")}` : ""}</span>
                </span>
                <StatusTag {...INVOICE_STATUS[r.status]} />
                <span className={s.num}>{money(r.total, r.currency)}</span>
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

function NewInvoice() {
  const toast = useToast();
  const [done, setDone] = useState(false);
  if (done) return null;
  return (
    <div className={s.panel}>
      <div className={s.ph}><h2>Fatura ekle</h2><span className={s.sub}>herkes gönderebilir · yönetici onaylar</span></div>
      <div className={s.pb}>
        <InvoiceForm
          accountsHref={profileHref("accounts", fin("new"))}
          eventHref={(eventId) => `/events/${eventId}?focus=supplies&return=${encodeURIComponent(fin("new"))}`}
          onDone={(inv) => {
            setDone(true);
            toast({ text: "Fatura onaya gönderildi", error: false });
            navigate(fin("mine", inv.id));
          }}
        />
      </div>
    </div>
  );
}

function EditInvoice({ id }: { id: string }) {
  return <InvoiceDetail id={id} editing />;
}
