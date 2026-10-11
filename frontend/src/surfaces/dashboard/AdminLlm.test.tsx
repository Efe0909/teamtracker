// Yonetim > Veri isleme ve LLM (spec/79 §11.7): iki kapsam, ayri sekmeler. manage_llm yalniz
// LLM sekmesini acar (kisi paneli istenmez), manage_users LLM'i kilitli gorur. Modeller ve
// gorevler: profil ve gorev kartlari ayrinti sayfasina baglanir. Profil sayfasinda limit
// formu ozel pencereyi dakikaya cevirip profile yollar; gorev sayfasi yalniz ayni turdeki
// profilleri sunar ve kalite sorularini admin olmayana kilitler.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { AdminView, LlmProfileView, LlmStatusView, LlmTaskView, LlmUsageView, Meta } from "../../api/types";
import { LookupProvider } from "../../lib/lookup";
import { Admin } from "./Admin";
import { AdminLlmProfile } from "./AdminLlmProfile";
import { AdminLlmTask } from "./AdminLlmTask";

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
const eff = (model: string, profile_id: string, profile_name: string, timeout_ms: number) => ({
  profile_id, profile_name, model, max_tokens: 1500, temperature: null, timeout_ms, reasoning_off: true, batch: 9,
  enabled: true, store_bodies: false, prompt_version: 0,
});
const profile = (id: string, name: string, endpoint: "chat" | "decisions", model: string, used_by: LlmProfileView["used_by"]): LlmProfileView => ({
  id, name, endpoint, model, params: {}, effective: eff(model, id, name, endpoint === "chat" ? 30000 : 3000),
  tested_at: null, created_at: "2026-10-10T00:00:00Z", updated_at: "2026-10-10T00:00:00Z", updated_by: null,
  used_by, limits: [], service_on: true,
});
const PROFILES = [
  profile("p1", "Genel amaçlı", "chat", "deepseek/deepseek-v4.1-flash", ["material_suggestions"]),
  profile("p2", "Karar", "decisions", "respan/span-01-lite", ["quality_gate"]),
  profile("p3", "Tasarım", "chat", "stub/design", []),
];
const task = (feature: LlmTaskView["feature"], label: string, p: LlmProfileView): LlmTaskView => ({
  feature, label, endpoint: p.endpoint, has_prompt: feature === "material_suggestions", has_batch: feature === "material_suggestions",
  profile: { id: p.id, name: p.name, model: p.model }, batch: null, effective: p.effective,
  updated_at: null, updated_by: null, service_on: true, sample_input: { brief: {} },
});
const TASKS = [task("material_suggestions", "Malzeme önerisi", PROFILES[0]!), task("quality_gate", "Kalite kapısı", PROFILES[1]!)];

function setup(scopes: string[], ui: ReactNode, is_admin = false) {
  const posted: { url: string; body: unknown }[] = [];
  const reply = (url: string, init?: { method?: string; body?: string }): unknown => {
    if (init?.method === "POST" || init?.method === "PUT") posted.push({ url, body: JSON.parse(init.body ?? "null") });
    if (url.startsWith("/api/admin/llm/status")) return status;
    if (url.startsWith("/api/admin/llm/usage")) return usage;
    if (url.startsWith("/api/admin/llm/key")) return { off: true, error: false, fetched_at: null, data: null };
    if (url.startsWith("/api/admin/llm/limits")) return [];
    if (url.startsWith("/api/admin/llm/profiles/p1")) return PROFILES[0];
    if (url.startsWith("/api/admin/llm/profiles")) return PROFILES;
    if (url.startsWith("/api/admin/llm/tasks/")) return TASKS.find((t) => url.endsWith(t.feature));
    if (url.startsWith("/api/admin/llm/tasks")) return TASKS;
    if (url.startsWith("/api/admin/llm/models")) return { error: false, fetched_at: null, models: [] };
    if (url.startsWith("/api/admin/llm/prompts")) return { feature: "material_suggestions", active: 0, code_default: "istem", versions: [] };
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
      <LookupProvider meta={meta}>{ui}</LookupProvider>
    </QueryClientProvider>,
  );
  return { fetchMock, posted };
}

it("manage_llm: LLM sekmesi acilir, kisi paneli kilitli ve hic istenmez", async () => {
  const { fetchMock } = setup(["manage_llm"], <Admin />);
  expect(await screen.findByRole("region", { name: "Maliyet grafiği" })).toBeTruthy();
  expect(screen.getAllByText("$0,0042").length).toBeGreaterThan(0);
  expect(screen.getByRole("tab", { name: "Kişiler ve roller" })).toHaveProperty("disabled", true);
  expect(fetchMock.mock.calls.some(([url]) => url === "/api/admin")).toBe(false);
});

it("manage_users: LLM sekmesi kilitli", async () => {
  setup(["manage_users"], <Admin />);
  await screen.findByText("Kişi ekle");
  expect(screen.getByRole("tab", { name: "Veri işleme ve LLM" })).toHaveProperty("disabled", true);
  expect(screen.getByRole("tab", { name: "Aktivite" })).toHaveProperty("disabled", false);
});

it("modeller ve gorevler: profil ve gorev kartlari ayrinti sayfasina baglanir", async () => {
  setup(["manage_llm"], <Admin />);
  fireEvent.click(await screen.findByRole("tab", { name: "Modeller ve görevler" }));
  const profileLink = await screen.findByRole("link", { name: /Tasarım/ });
  expect(profileLink.getAttribute("href")).toBe("/admin/llm/profiles/p3");
  expect(screen.getByRole("link", { name: /^Kalite kapısı/ }).getAttribute("href")).toBe("/admin/llm/tasks/quality_gate");
  expect(screen.queryByRole("tab", { name: "Limitler" })).toBeNull();
});

it("profil: ozel pencere dakikaya cevrilip profile yollanir", async () => {
  const { posted } = setup(["manage_llm"], <AdminLlmProfile id="p1" />);
  fireEvent.change(await screen.findByLabelText("Pencere"), { target: { value: "custom" } });
  fireEvent.change(screen.getByLabelText("Süre"), { target: { value: "3" } });
  fireEvent.change(screen.getByLabelText("Birim"), { target: { value: "sa" } });
  fireEvent.change(screen.getByLabelText("Tavan (USD)"), { target: { value: "2,5" } });
  fireEvent.click(screen.getByRole("button", { name: "Limit ekle" }));
  await waitFor(() => expect(posted.find((p) => p.url === "/api/admin/llm/profiles/p1/limits")?.body).toEqual(
    { window_minutes: 180, usd: 2.5 }));
  expect(screen.getByRole("button", { name: "Profili sil" })).toHaveProperty("disabled", true);
});

it("gorev: yalniz ayni turdeki profiller; kalite sorulari admin olmayana kilitli", async () => {
  setup(["manage_llm"], <AdminLlmTask feature="quality_gate" />);
  const select = await screen.findByRole("combobox", { name: /^Profil/ });
  await waitFor(() => expect(select.querySelectorAll("option")).toHaveLength(1));
  expect(select.textContent).toContain("Karar");
  expect(screen.getByText(/yalnız yönetici düzenler/)).toBeTruthy();
});

it("gorev: profil degisikligi PUT ile gider", async () => {
  const { posted } = setup(["manage_llm"], <AdminLlmTask feature="material_suggestions" />);
  const select = await screen.findByRole("combobox", { name: /^Profil/ });
  await waitFor(() => expect(select.querySelectorAll("option")).toHaveLength(2));
  fireEvent.change(select, { target: { value: "p3" } });
  fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
  await waitFor(() => expect(posted.find((p) => p.url === "/api/admin/llm/tasks/material_suggestions")?.body).toEqual(
    { profile_id: "p3", enabled: true, store_bodies: false }));
});
