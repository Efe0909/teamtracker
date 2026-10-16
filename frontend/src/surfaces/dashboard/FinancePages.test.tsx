import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { financeKeys } from "../../api/hooks";
import type { Attachment, ClaimDetail, ClaimSlot, InvoiceView, MailTemplate, Meta } from "../../api/types";
import { LookupProvider } from "../../lib/lookup";
import { FinanceClaims } from "./FinanceClaims";
import { InvoiceDetail } from "./FinanceInvoices";
import { FinanceTemplates, TemplatePreview } from "./FinanceTemplates";

// PDF motorunun tarayici/canvas yolu ayrica gercek dosyayla denetlenir.
vi.mock("../../features/media/PdfThumbnail", () => ({
  PdfThumbnail: ({ url, name }: { url: string; name: string }) => <span role="img" aria-label={`${name}, ilk sayfa`} data-url={url} />,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

const detail: ClaimDetail = {
  claim: { id: "claim-1", kind: "monthly", month: "2026-09-01", event_id: null, event_title: null,
    status: "sent", sent_at: "2026-10-01T12:00:00Z", approved_at: null, paid_at: null,
    received_amount: null, invoice_count: 1, seb_total: 1200, people: 2 },
  invoices: [{ id: "invoice-1", submitted_by: "member", purchased_on: "2026-09-20", currency: "TRY",
    total: 1700, total_try: 1700, paid_by: "member", status: "approved", claim_id: "claim-1",
    created_at: "2026-09-21T12:00:00Z", item_count: 2, first_item: "Atölye malzemeleri",
    event_titles: [], attachment_count: 0 }],
  people: [{ user_id: "member", amount: 800, invoices: 1 }, { user_id: null, amount: 400, invoices: 1 }],
};

function setup(child: ReactNode, reply: (url: string) => unknown) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => reply(url) })));
  const meta: Meta = {
    me: { id: "member", is_admin: true, scopes: [], team_ids: [], profile_complete: true, favorite_nodes: [] },
    users: [{ id: "member", name: "Ayşe", color: null, is_admin: true, last_seen_at: null, nickname: null,
      phone: null, avatar_id: null, birth_day: null, birth_month: null, birth_year: null, roles: [] }],
    teams: [], pillars: [], nodes: [],
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={client}><LookupProvider meta={meta}>{child}</LookupProvider></QueryClientProvider>);
  return client;
}

it("renders Markdown matrices as copyable tables with escaped cells and surrounding prose", () => {
  setup(<TemplatePreview
    body={"**Harcama bildirimi**\n\n{{items:matris(ad:metin, tutar:para)}}\n\nTeşekkürler, {{sender}}."}
    values={{ sender: "Ayşe" }} rows={{ items: [["<img src=x onerror=alert(1)>", "1250,5"]] }} currencies={{}} />,
  (url) => { throw new Error(`Unexpected request: ${url}`); });
  const table = screen.getByRole("table", { name: "items" });
  expect(within(table).getByRole("cell", { name: "1.250,50 ₺" })).toBeTruthy();
  expect(within(table).getByRole("cell", { name: "<img src=x onerror=alert(1)>" })).toBeTruthy();
  expect(document.querySelector("img")).toBeNull();
  expect(screen.getByText("Harcama bildirimi")).toBeTruthy();
  expect(screen.getByText("Teşekkürler, Ayşe.")).toBeTruthy();
});

it("prefills the SEB portion of a claim and retains manual edits when the claim refreshes", async () => {
  window.history.replaceState(null, "", "/finance/templates?claim=claim-1");
  const template: MailTemplate = { id: "template-1", name: "SEB bildirimi", format: "md",
    body: "{{period:tarih}} dönemi: **{{total:para}}**.\n\n{{sender_name}}", updated_at: "2026-10-01T12:00:00Z" };
  let response = detail;
  const client = setup(<FinanceTemplates id={null} />, (url) => {
    if (url === "/api/finance/templates") return [template];
    if (url === "/api/finance/claims") return [response.claim];
    if (url === "/api/finance/claims/claim-1") return response;
    throw new Error(`Unexpected request: ${url}`);
  });
  const total = await screen.findByLabelText(/total\s*para/);
  await waitFor(() => expect(total).toHaveProperty("value", "1200"));
  expect(screen.getByLabelText(/period\s*tarih/)).toHaveProperty("value", "2026-09");
  expect(within(screen.getByRole("region", { name: "Önizleme" })).getByText("1.200,00 ₺")).toBeTruthy();
  fireEvent.change(total, { target: { value: "1400" } });
  response = { ...detail, claim: { ...detail.claim, seb_total: 2000 } };
  await act(async () => { await client.refetchQueries({ queryKey: financeKeys.claim("claim-1") }); });
  expect(total).toHaveProperty("value", "1400");
  expect(within(screen.getByRole("region", { name: "Önizleme" })).getByText("1.400,00 ₺")).toBeTruthy();
});

it("shows received claims as payable to members without claiming members have been paid", async () => {
  const paid: ClaimDetail = { ...detail, claim: { ...detail.claim, status: "paid", received_amount: 1200 } };
  const slot: ClaimSlot = { kind: "monthly", month: paid.claim.month, event_id: null, event_title: null,
    event_date: null, claim_id: paid.claim.id, status: "paid", invoice_count: 1, seb_total: 1200 };
  setup(<FinanceClaims id={paid.claim.id} />, (url) => {
    if (url === "/api/finance/claim-slots") return [slot];
    if (url === "/api/finance/claims/claim-1") return paid;
    if (url.startsWith("/api/events")) return [];
    throw new Error(`Unexpected request: ${url}`);
  });
  expect(await screen.findByText("Ödenebilir")).toBeTruthy();
  expect(screen.getByText("Kasaya girdi")).toBeTruthy();
  expect(screen.queryByText("Ödendi")).toBeNull();
  expect(screen.getByRole("link", { name: "Mail taslağı" }).getAttribute("href")).toBe("/finance/templates?claim=claim-1");
});

const invoicePdf: Attachment = { id: "invoice-pdf", mime: "application/pdf", kind: "document", byte_size: 1200,
  width: null, height: null, original_name: "fatura.pdf", deleted: false, can_delete: true, can_tag: false, tags: [] };
const invoicePhoto: Attachment = { ...invoicePdf, id: "invoice-photo", mime: "image/jpeg", kind: "image", original_name: "fiş.jpg" };
const invoice: InvoiceView = { id: "invoice-1", submitted_by: "member", purchased_on: "2026-10-16", currency: "TRY",
  total: 720, fx_rate: null, fx_on: null, fx_source: null, total_try: 720, paid_by: "club", payee: null, vendor: null,
  note: null, status: "approved", claim_id: null, created_at: "2026-10-16T12:00:00Z", updated_at: "2026-10-16T12:00:00Z",
  items: [{ material_id: "material-1", name: "Tanıtım broşürleri", amount: 720, funding: "general", event_id: null,
    event_title: null, event_date: null, category_id: null, budget: 750, purchased: true }],
  events: [], attachments: [invoicePdf, invoicePhoto], reviews: [], can_review: false, can_edit: false };

it("shows PDF and receipt previews in invoice review without offering attachment removal", async () => {
  setup(<InvoiceDetail id={invoice.id} />, () => invoice);
  const documents = await screen.findByRole("region", { name: "Fatura / fiş" });
  expect(within(documents).getByRole("img", { name: "fatura.pdf, ilk sayfa" }).getAttribute("data-url"))
    .toBe("/api/attachments/invoice-pdf");
  expect(within(documents).getByRole("img", { name: "fiş.jpg" }).getAttribute("src"))
    .toBe("/api/attachments/invoice-photo/thumb");
  expect(within(documents).getByRole("link", { name: "fatura.pdf" }).getAttribute("download")).toBe("fatura.pdf");
  expect(within(documents).queryByRole("button")).toBeNull();
});

it("explains missing invoice documents instead of hiding the document section", async () => {
  setup(<InvoiceDetail id={invoice.id} />, () => ({ ...invoice, attachments: [] }));
  const documents = await screen.findByRole("region", { name: "Fatura / fiş" });
  expect(within(documents).getByText("Bu faturaya fatura veya fiş dosyası eklenmemiş.")).toBeTruthy();
  expect(within(documents).queryByRole("img")).toBeNull();
  expect(within(documents).queryByText(/PDF ve fotoğraf eklediğinde/)).toBeNull();
});

it("removes stale document previews when the invoice query updates", async () => {
  let response = invoice;
  const client = setup(<InvoiceDetail id={invoice.id} />, () => response);
  await screen.findByRole("img", { name: "fatura.pdf, ilk sayfa" });
  response = { ...invoice, attachments: [] };
  await act(async () => { await client.refetchQueries({ queryKey: financeKeys.invoice(invoice.id) }); });
  await waitFor(() => expect(screen.queryByRole("img", { name: "fatura.pdf, ilk sayfa" })).toBeNull());
  expect(screen.queryByRole("link", { name: "fatura.pdf" })).toBeNull();
  expect(screen.getByText("Bu faturaya fatura veya fiş dosyası eklenmemiş.")).toBeTruthy();
});
