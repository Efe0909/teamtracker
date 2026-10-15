// app. yuzu: fatura gonder (/invoice/new) ve Faturalarim (/invoices) — spec/81 §10.
// Maliye'nin geri kalani masaustunde; burada yalniz gonderme ve kendi faturalarinin
// durumu. Form masaustuyle ayni bilesen (kamera: dosya secici telefonda kamerayi sunar).

import { useState } from "react";
import { useInvoices } from "../../api/hooks";
import { InvoiceForm } from "../../features/finance/InvoiceForm";
import { profileHref } from "../../features/profile/tabs";
import { daysFromToday } from "../../lib/labels";
import { money } from "../../lib/money";
import { navigate } from "../../lib/router";
import { Empty, Link, Loading, Tag, ui, useToast } from "../../ui/ui";
import type { InvoiceStatus } from "../../api/types";
import { TopBar } from "./MobileApp";
import s from "./app.module.css";

// Masaustu Finance.tsx'e baglanmaz (mobil paketine masaustu kodu girmesin).
const STATUS: Record<InvoiceStatus, { label: string; tone: "info" | "ok" | "neutral" | "critical" | "high" }> = {
  pending: { label: "Bekliyor", tone: "high" },
  changes_requested: { label: "Düzeltme istendi", tone: "critical" },
  approved: { label: "Onaylandı", tone: "ok" },
  rejected: { label: "Reddedildi", tone: "critical" },
  withdrawn: { label: "Geri çekildi", tone: "neutral" },
  cancelled: { label: "İptal", tone: "neutral" },
};

export function InvoiceNewPage() {
  const toast = useToast();
  const [done, setDone] = useState(false);
  return (
    <>
      <TopBar title="Fatura ekle" back />
      <main className={s.pad}>
        {!done && (
          <InvoiceForm
            accountsHref={profileHref("accounts", "/invoice/new")}
            onDone={() => {
              setDone(true);
              toast({ text: "Fatura onaya gönderildi", error: false });
              navigate("/invoices");
            }}
          />
        )}
      </main>
    </>
  );
}

export function InvoicesPage() {
  const q = useInvoices({ mine: true });
  return (
    <>
      <TopBar title="Faturalarım" back />
      <main className={s.pad}>
        <Link href="/invoice/new" className={ui.btn}>Fatura ekle</Link>
        {q.data === undefined ? <Loading /> : q.data.length === 0 ? (
          <Empty title="Henüz fatura göndermedin">Fişin ya da faturanın fotoğrafıyla “Fatura ekle”den gönderebilirsin.</Empty>
        ) : (
          <ul className={s.inv}>
            {q.data.map((r) => (
              <li key={r.id}>
                <span>
                  <b>{r.first_item ?? "Fatura"}{r.item_count > 1 ? ` +${r.item_count - 1}` : ""}</b>
                  <small>{daysFromToday(r.purchased_on) === 0 ? "bugün" : r.purchased_on}{r.event_titles.length > 0 ? ` · ${r.event_titles.join(", ")}` : ""}</small>
                </span>
                <Tag tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Tag>
                <span>{money(r.total, r.currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
