// Kalite kapisi ayari Yonetim > Veri isleme ve LLM'in alt sekmesi: admin gorur, taslak
// kaydedilince PUT gider; admin olmayan manage_llm sahibi alt sekmeyi KILITLI gorur
// (spec/79 §11.7).

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { LlmStatusView, LlmUsageView, Meta, QualityConfig, QualityView } from "../../api/types";
import { LookupProvider } from "../../lib/lookup";
import { Admin } from "./Admin";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const q = (min: number) => ({ instructions: "i", yes: "y", no: "n", min });
const cfg: QualityConfig = { questions: { specific: q(0.5), context: q(0.5), closing_justified: q(0.5) } };
const quality: QualityView = { config: cfg, defaults: cfg, customized: false, updated_at: null, updated_by: null, service_on: true };
const status: LlmStatusView = {
  key_configured: false, external_off: [], services: [], calls: 0, bodies: 0, daily_rows: 0, oldest_call: null,
  size_bytes: 0, retention_days: 180, body_ttl_days: 7, boundary: "2026-04-13",
};
const usage: LlmUsageView = { from: "2026-09-11", to: "2026-10-10", boundary: "2026-04-13", rows: [], by_user: [] };

function setup(is_admin: boolean) {
  const meta: Meta = {
    me: { id: "a", is_admin, scopes: is_admin ? [] : ["manage_llm"], team_ids: [], profile_complete: true, favorite_nodes: [] },
    users: [], teams: [], pillars: [], nodes: [],
  };
  const reply = (url: string, init?: { method?: string; body?: string }): unknown => {
    if (url.includes("/quality")) return { ...quality, config: init?.method === "PUT" ? JSON.parse(init.body ?? "{}") : cfg };
    if (url.startsWith("/api/admin/llm/status")) return status;
    if (url.startsWith("/api/admin/llm/usage")) return usage;
    if (url.startsWith("/api/admin/llm/key")) return { off: true, error: false, fetched_at: null, data: null };
    if (url.startsWith("/api/admin/llm/limits")) return [];
    return { is_admin, scopes: [], roles: [], people: [] };
  };
  const fetchMock = vi.fn(async (url: string, init?: { method?: string; body?: string }) => ({
    ok: true, status: 200, json: async () => reply(url, init),
  }));
  vi.stubGlobal("fetch", fetchMock);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LookupProvider meta={meta}><Admin /></LookupProvider>
    </QueryClientProvider>,
  );
  return fetchMock;
}

it("Kalite kapisi ust sekme degil, LLM'in alt sekmesi", async () => {
  setup(true);
  fireEvent.click(await screen.findByRole("tab", { name: "Veri işleme ve LLM" }));
  expect(screen.getAllByRole("tab", { name: "Kalite kapısı" })).toHaveLength(1);
  expect(screen.getByRole("tablist", { name: "LLM bölümü" }).textContent).toContain("Kalite kapısı");
});

it("admin olmayan manage_llm Kalite kapisi alt sekmesini kilitli gorur", async () => {
  setup(false);
  expect(await screen.findByRole("tab", { name: "Kalite kapısı" })).toHaveProperty("disabled", true);
  expect(screen.getByRole("tab", { name: "Genel" })).toHaveProperty("disabled", false);
});

it("admin esigi degistirip kaydeder: PUT taslagi tasir", async () => {
  const fetchMock = setup(true);
  fireEvent.click(await screen.findByRole("tab", { name: "Veri işleme ve LLM" }));
  fireEvent.click(await screen.findByRole("tab", { name: "Kalite kapısı" }));
  const inputs = await screen.findAllByRole("spinbutton");
  fireEvent.change(inputs[0]!, { target: { value: "0.35" } });
  fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
  await waitFor(() => {
    const put = fetchMock.mock.calls.find(([url, init]) => init?.method === "PUT" && url.includes("/quality"));
    expect(put).toBeTruthy();
    expect(JSON.parse(put?.[1]?.body ?? "{}").questions.specific.min).toBe(0.35);
  });
});
