// Yonetim > Veri isleme ve LLM (spec/79 §11.7): iki kapsam, ayri sekmeler.
// manage_llm yalniz LLM sekmesini acar (kisi paneli istenmez), manage_users LLM'i
// kilitli gorur; limit formu ozel pencereyi dakikaya cevirip yollar.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AdminView, LlmFeatureView, LlmLimit, LlmStatusView, LlmUsageView, Meta } from "../../api/types";
import { LookupProvider } from "../../lib/lookup";
import { Admin } from "./Admin";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const status: LlmStatusView = {
  key_configured: true, external_off: [], calls: 3, bodies: 0, daily_rows: 0, oldest_call: null, size_bytes: 8192,
  retention_days: 180, body_ttl_days: 7, boundary: "2026-04-13",
  services: [{ feature: "material_suggestions", label: "Malzeme önerisi", service: "suggest", on: true, enabled: true }],
};
const usage: LlmUsageView = {
  from: "2026-09-11", to: "2026-10-10", boundary: "2026-04-13", by_user: [],
  rows: [{ day: "2026-10-10", feature: "material_suggestions", model: "deepseek/deepseek-v4.1-flash", calls: 3, errors: 1,
           limited: 0, prompt_tokens: 300, completion_tokens: 90, cost_usd: 0.0042, unpriced: 0, ms_total: 9000 }],
};
const feature: LlmFeatureView = {
  feature: "material_suggestions", label: "Malzeme önerisi", endpoint: "chat", has_prompt: true, has_batch: true,
  default_model: "deepseek/deepseek-v4.1-flash", params: {}, customized: false, tested_at: null, updated_at: null,
  updated_by: null, service_on: true, sample_input: { brief: {} },
  effective: { model: "deepseek/deepseek-v4.1-flash", max_tokens: 1500, temperature: null, timeout_ms: 30000,
               reasoning_off: true, batch: 9, enabled: true, store_bodies: false, prompt_version: 0 },
};

function setup(scopes: string[], is_admin = false) {
  const posted: { url: string; body: unknown }[] = [];
  const reply = (url: string, init?: { method?: string; body?: string }): unknown => {
    if (init?.method === "POST") posted.push({ url, body: JSON.parse(init.body ?? "null") });
    if (url.startsWith("/api/admin/llm/status")) return status;
    if (url.startsWith("/api/admin/llm/usage")) return usage;
    if (url.startsWith("/api/admin/llm/key")) return { off: false, error: false, fetched_at: null, data: { limit: null, limit_remaining: null, limit_reset: null, usage: 1, usage_daily: 0.1, usage_weekly: 0.5, usage_monthly: 1, is_free_tier: false } };
    if (url.startsWith("/api/admin/llm/limits")) return [] as LlmLimit[];
    if (url.startsWith("/api/admin/llm/features")) return [feature];
    if (url.startsWith("/api/admin/llm/models")) return { error: false, fetched_at: null, models: [] };
    if (url.startsWith("/api/admin")) return { is_admin, scopes, roles: [], people: [] } satisfies AdminView;
    return {};
  };
  const fetchMock = vi.fn(async (url: string, init?: { method?: string; body?: string }) => ({
    ok: true, status: 200, json: async () => reply(url, init),
  }));
  vi.stubGlobal("fetch", fetchMock);
  const meta: Meta = {
    me: { id: "a", is_admin, scopes, team_ids: [], profile_complete: true, favorite_nodes: [] },
    users: [], teams: [], pillars: [], nodes: [],
  };
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LookupProvider meta={meta}><Admin /></LookupProvider>
    </QueryClientProvider>,
  );
  return { fetchMock, posted };
}

it("manage_llm: LLM sekmesi acilir, kisi paneli kilitli ve hic istenmez", async () => {
  const { fetchMock } = setup(["manage_llm"]);
  expect(await screen.findByRole("region", { name: "Maliyet grafiği" })).toBeTruthy();
  expect(screen.getAllByText("$0,0042").length).toBeGreaterThan(0);
  expect(screen.getByRole("tab", { name: "Kişiler ve roller" })).toHaveProperty("disabled", true);
  expect(screen.getByRole("tab", { name: "Kalite kapısı" })).toHaveProperty("disabled", true);
  expect(fetchMock.mock.calls.some(([url]) => url === "/api/admin")).toBe(false);
});

it("manage_users: LLM sekmesi kilitli", async () => {
  setup(["manage_users"]);
  await screen.findByText("Kişi ekle");
  expect(screen.getByRole("tab", { name: "Veri işleme ve LLM" })).toHaveProperty("disabled", true);
  expect(screen.getByRole("tab", { name: "Aktivite" })).toHaveProperty("disabled", false);
});

it("limit: ozel pencere dakikaya cevrilip model ve tutarla gider", async () => {
  const { posted } = setup(["manage_llm"]);
  fireEvent.click(await screen.findByRole("tab", { name: "Limitler" }));
  fireEvent.change(await screen.findByLabelText("Pencere"), { target: { value: "custom" } });
  fireEvent.change(screen.getByLabelText("Süre"), { target: { value: "3" } });
  fireEvent.change(screen.getByLabelText("Birim"), { target: { value: "sa" } });
  fireEvent.change(screen.getByLabelText("Tavan (USD)"), { target: { value: "2,5" } });
  fireEvent.click(screen.getByRole("button", { name: "Ekle" }));
  await waitFor(() => expect(posted.find((p) => p.url === "/api/admin/llm/limits")?.body).toEqual(
    { model: "deepseek/deepseek-v4.1-flash", window_minutes: 180, usd: 2.5 }));
});
