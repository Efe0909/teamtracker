import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { financeKeys } from "../../api/hooks";
import type { Attachment, Meta, Purchasable } from "../../api/types";
import { LookupProvider } from "../../lib/lookup";
import { InvoiceForm } from "./InvoiceForm";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); sessionStorage.clear(); });

const selected: Purchasable = { id: "selected", name: "Bardak", qty: 200, price: 1250.5, category_id: null,
  purchased: false, event_id: "event-1", event_title: "Kahve Zinciri", event_date: "2026-10-24" };

function saveDraft(patch: Record<string, unknown> = {}) {
  sessionStorage.setItem("ekiptakip.invoiceDraft", JSON.stringify({ files: [], purchasedOn: "2026-10-15", currency: "TRY",
    total: "700", rate: "", rateOn: null, rateSource: "tcmb", picked: { previous: "200" },
    paidBy: "member", accountId: null, note: "Önceki taslak notu", ...patch }));
}

function setup(materials: Purchasable[] = [selected]) {
  let response = materials;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url !== "/api/finance/purchasable" && url !== "/api/me/bank-accounts") throw new Error(`Unexpected request: ${url}`);
    return { ok: true, status: 200, json: async () => url === "/api/finance/purchasable" ? response : [] };
  }));
  const meta: Meta = { me: { id: "me", is_admin: false, scopes: [], team_ids: [], profile_complete: true, favorite_nodes: [] },
    users: [], teams: [], pillars: [], nodes: [] };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={client}>
    <LookupProvider meta={meta}><InvoiceForm initialMaterialId="selected" accountsHref="/profile" onDone={() => undefined} /></LookupProvider>
  </QueryClientProvider>);
  return { refresh: async (next = response) => {
    response = next;
    await act(async () => { await client.refetchQueries({ queryKey: financeKeys.purchasable }); });
  } };
}

it("prefills the material and invoice total from the offer after the list loads, without multiplying by quantity", async () => {
  setup();
  expect(await screen.findByLabelText("Bardak tutarı")).toHaveProperty("value", "1250,50");
  expect(screen.getByLabelText("Tutar")).toHaveProperty("value", "1250,50");
  expect(screen.getByText("Tutarlar tamam")).toBeTruthy();
  expect(screen.getByText(/İlişkili etkinlikler \(kalemlerden\): Kahve Zinciri\./)).toBeTruthy();
});

it("adds the material from the inspector without replacing an existing invoice draft", async () => {
  saveDraft();
  setup([{ ...selected, price: 200 }, { ...selected, id: "previous", name: "Kahve" }]);
  expect(await screen.findByLabelText("Bardak tutarı")).toHaveProperty("value", "200,00");
  expect(screen.getByLabelText("Kahve tutarı")).toHaveProperty("value", "200");
  expect(screen.getByLabelText("Tutar")).toHaveProperty("value", "700");
  expect(screen.getByDisplayValue("Önceki taslak notu")).toBeTruthy();
});

it("preserves an amount already entered for the linked material", async () => {
  saveDraft({ picked: { selected: "450" } });
  setup();
  expect(await screen.findByLabelText("Bardak tutarı")).toHaveProperty("value", "450");
  expect(screen.getByLabelText("Tutar")).toHaveProperty("value", "700");
});

it("keeps later edits and removals when the material query refreshes", async () => {
  const { refresh } = setup();
  const amount = await screen.findByLabelText("Bardak tutarı");
  fireEvent.change(amount, { target: { value: "1300" } });
  fireEvent.change(screen.getByLabelText("Tutar"), { target: { value: "1300" } });
  await refresh([{ ...selected, price: 1600 }]);
  expect(amount).toHaveProperty("value", "1300");
  expect(screen.getByLabelText("Tutar")).toHaveProperty("value", "1300");
  fireEvent.click(screen.getByRole("button", { name: "Bardak kalemini çıkar" }));
  await refresh();
  expect(screen.queryByLabelText("Bardak tutarı")).toBeNull();
});

it("leaves unpriced material amounts empty for the user to enter", async () => {
  setup([{ ...selected, price: null }]);
  expect(await screen.findByLabelText("Bardak tutarı")).toHaveProperty("value", "");
  expect(screen.getByLabelText("Tutar")).toHaveProperty("value", "");
});

it("uses the remaining invoice amount for a foreign currency draft instead of copying a TRY quote", async () => {
  saveDraft({ currency: "USD", total: "40", rate: "40", rateOn: "2026-10-15", rateSource: "manual", picked: { previous: "10" } });
  setup([selected, { ...selected, id: "previous", name: "Kahve" }]);
  await waitFor(() => expect(screen.getByLabelText("Bardak tutarı")).toHaveProperty("value", "30,00"));
  expect(screen.getByLabelText("Tutar")).toHaveProperty("value", "40");
  expect(screen.getByRole("button", { name: "Para birimi: $" })).toBeTruthy();
});

it("collapses the catalog and individual event groups without losing selected materials or entered amounts", async () => {
  setup([selected, { ...selected, id: "napkins", name: "Peçete", price: 100 },
    { ...selected, id: "stand", name: "Stant", event_id: "event-2", event_title: "Bilim Şenliği" }]);
  const amount = await screen.findByLabelText("Bardak tutarı");
  fireEvent.change(amount, { target: { value: "1300" } });
  const catalog = screen.getByRole("button", { name: /Başka kalem ekle/ });
  expect(catalog.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(catalog);
  const group = screen.getByRole("button", { name: /Kahve Zinciri/ });
  fireEvent.click(group);
  expect(group.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("option", { name: /Peçete/ })).toBeNull();
  expect(screen.getByRole("option", { name: /Stant/ })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Kalem ara"), { target: { value: "Peçete" } });
  expect(screen.getByRole("option", { name: /Peçete/ })).toBeTruthy();
  fireEvent.click(catalog);
  expect(screen.queryByLabelText("Kalem ara")).toBeNull();
  expect(amount).toHaveProperty("value", "1300");
});

it("shows attachments next to payment fields and removes only the chosen file from the invoice", async () => {
  const photo: Attachment = { id: "photo", mime: "image/jpeg", kind: "image", byte_size: 1500, width: 600, height: 800,
    original_name: "fiş.jpg", deleted: false, can_delete: true, can_tag: false, tags: [] };
  const sheet: Attachment = { ...photo, id: "sheet", kind: "document", mime: "text/csv", original_name: "kalemler.csv" };
  saveDraft({ files: [photo, sheet] });
  setup();
  await screen.findByLabelText("Bardak tutarı");
  const sidebar = screen.getByRole("complementary", { name: "Önizleme ve ödeme" });
  expect(within(sidebar).getByRole("img", { name: "fiş.jpg" }).getAttribute("src")).toBe("/api/attachments/photo/thumb");
  expect(within(sidebar).getByRole("radio", { name: "Ben ödedim, bana iade edilsin" })).toBeTruthy();
  fireEvent.click(within(sidebar).getByRole("button", { name: "fiş.jpg çıkar" }));
  expect(within(sidebar).queryByRole("img", { name: "fiş.jpg" })).toBeNull();
  expect(within(sidebar).getByRole("link", { name: "kalemler.csv" }).getAttribute("href")).toBe("/api/attachments/sheet");
  expect(screen.getByLabelText("Tutar")).toHaveProperty("value", "700");
});
