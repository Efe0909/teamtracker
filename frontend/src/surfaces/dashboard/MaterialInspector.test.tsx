import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { MatFull, Meta } from "../../api/types";
import { LookupProvider } from "../../lib/lookup";
import { MaterialInspector } from "./MaterialInspector";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const detail: MatFull = {
  event_id: "event-1", event_title: "Kahve Zinciri", event_date: "2026-10-24", category_id: null, needed_by: null, invoices: [],
  material: { id: "material-1", name: "Bardak", qty: 200, type: "consumable", priority: "medium", state: 3,
    notes: null, has_sponsor: false, owned: false, chosen_provider_id: "offer-2", sponsor_chosen: false,
    sponsor_qty: null, sponsor_date: null, in_sponsor_record: false, delivered: false, purchased: false,
    purchased_at: null, created_by: null, updated_at: "2026-10-16T12:00:00Z", budget: 300, overage_level: 1,
    providers: [{ id: "offer-1", contact: "05320000001", name: "Koli Market", price: 310, arrival_date: "2026-10-26", overage_level: 1 },
      { id: "offer-2", contact: "https://example.com", name: "Pazar Toptan", price: 355, arrival_date: "2026-10-20", overage_level: 1 }] },
};

function setup(purchased = false, scopes = ["manage_purchases", "review_purchases"]) {
  const posted: { url: string; body: unknown }[] = [];
  const data = { ...detail, material: { ...detail.material, purchased } };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: { method: string; body?: string }) => {
    if (init.method !== "GET") posted.push({ url, body: JSON.parse(init.body ?? "null") });
    return { ok: true, status: 200, json: async () => data };
  }));
  const meta: Meta = { me: { id: "me", is_admin: false, scopes, team_ids: [], profile_complete: true, favorite_nodes: [] },
    users: [], teams: [], pillars: [], nodes: [] };
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
    <LookupProvider meta={meta}><MaterialInspector id="material-1" onEdit={() => undefined} /></LookupProvider>
  </QueryClientProvider>);
  return posted;
}

it("distinguishes the lowest quote from the selected quote and selects through the existing API", async () => {
  const posted = setup();
  const lowest = await screen.findByRole("button", { name: /Koli Market/ });
  expect(lowest.getAttribute("aria-pressed")).toBe("false");
  expect(lowest.textContent).toContain("en düşük");
  expect(screen.getByRole("button", { name: /Pazar Toptan/ }).getAttribute("aria-pressed")).toBe("true");
  // Secili teklif toplam 355 TL; 200 adetle tekrar carpilmaz.
  expect(screen.getByText("Birim ₺1,78")).toBeTruthy();
  fireEvent.click(lowest);
  await waitFor(() => expect(posted).toContainEqual({ url: "/api/materials/material-1", body: { chosen: "offer-1" } }));
  expect(screen.getByRole("link", { name: "Faturaya bağla" }).getAttribute("href")).toBe("/finance/invoices/new?material=material-1");
});

it("locks quotes after purchase while retaining the permitted delivery action", async () => {
  const posted = setup(true);
  expect(await screen.findByRole("button", { name: /Koli Market/ })).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: /Pazar Toptan/ })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "Teslim edildi" }));
  await waitFor(() => expect(posted).toContainEqual({ url: "/api/materials/material-1", body: { delivered: true } }));
});

it("shows quote information without allowing procurement changes for a finance viewer", async () => {
  setup(false, ["manage_ledger"]);
  expect(await screen.findByRole("button", { name: /Koli Market/ })).toHaveProperty("disabled", true);
  expect(screen.queryByRole("button", { name: "Teslim edildi" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Satın alındı" })).toBeNull();
});
