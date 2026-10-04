// Kalite kapisi ayari: admin sekmeyi gorur, taslak kaydedilince PUT gider,
// manage_users sahibi (admin degil) sekmeyi hic gormez.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AdminView, Meta, QualityConfig, QualityView } from "../../api/types";
import { LookupProvider } from "../../lib/lookup";
import { Admin } from "./Admin";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const q = (min: number) => ({ instructions: "i", yes: "y", no: "n", min });
const cfg: QualityConfig = { questions: { specific: q(0.5), context: q(0.5), closing_justified: q(0.5) } };
const quality: QualityView = { config: cfg, defaults: cfg, customized: false, updated_at: null, updated_by: null, service_on: true };
const view = (is_admin: boolean): AdminView => ({ is_admin, scopes: [], roles: [], people: [] });
const meta: Meta = {
  me: { id: "a", is_admin: true, scopes: [], team_ids: [], profile_complete: true, favorite_nodes: [] },
  users: [], teams: [], pillars: [], nodes: [],
};

function setup(is_admin: boolean) {
  const fetchMock = vi.fn(async (url: string, init?: { method?: string; body?: string }) => ({
    ok: true, status: 200,
    json: async () => (url.includes("/quality") ? { ...quality, config: init?.method === "PUT" ? JSON.parse(init.body ?? "{}") : cfg } : view(is_admin)),
  }));
  vi.stubGlobal("fetch", fetchMock);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LookupProvider meta={meta}><Admin /></LookupProvider>
    </QueryClientProvider>,
  );
  return fetchMock;
}

it("admin olmayan Kalite kapisi sekmesini gormez", async () => {
  setup(false);
  await screen.findByText("Kişi ekle");
  expect(screen.queryByRole("tab", { name: "Kalite kapısı" })).toBeNull();
});

it("admin esigi degistirip kaydeder: PUT taslagi tasir", async () => {
  const fetchMock = setup(true);
  fireEvent.click(await screen.findByRole("tab", { name: "Kalite kapısı" }));
  const inputs = await screen.findAllByRole("spinbutton");
  fireEvent.change(inputs[0]!, { target: { value: "0.35" } });
  fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
  await waitFor(() => {
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(put).toBeTruthy();
    expect(JSON.parse(put?.[1]?.body ?? "{}").questions.specific.min).toBe(0.35);
  });
});
