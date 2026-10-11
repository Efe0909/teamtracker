// Kalite kapisi sorulari "Kalite kapisi" gorev sayfasinda (Yonetim > Veri isleme ve LLM >
// Modeller ve gorevler): admin esigi degistirip kaydeder, PUT taslagi tasir. Admin olmayana
// kilitli olmasi AdminLlm.test.tsx'te.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { LlmTaskView, Meta, QualityConfig, QualityView } from "../../api/types";
import { LookupProvider } from "../../lib/lookup";
import { AdminLlmTask } from "./AdminLlmTask";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const q = (min: number) => ({ instructions: "i", yes: "y", no: "n", min });
const cfg: QualityConfig = { questions: { specific: q(0.5), context: q(0.5), closing_justified: q(0.5) } };
const quality: QualityView = { config: cfg, defaults: cfg, customized: false, updated_at: null, updated_by: null, service_on: true };
const effective = {
  profile_id: "p2", profile_name: "Karar", model: "respan/span-01-lite", max_tokens: 0, temperature: null, timeout_ms: 3000,
  reasoning_off: true, batch: 9, enabled: true, store_bodies: false, prompt_version: 0,
};
const gate: LlmTaskView = {
  feature: "quality_gate", label: "Kalite kapısı", endpoint: "decisions", has_prompt: false, has_batch: false,
  profile: { id: "p2", name: "Karar", model: "respan/span-01-lite" }, batch: null, effective,
  updated_at: null, updated_by: null, service_on: true, sample_input: { kind: "entry", state: "x" },
};

function setup() {
  const meta: Meta = {
    me: { id: "a", is_admin: true, scopes: [], team_ids: [], profile_complete: true, favorite_nodes: [] },
    users: [], teams: [], pillars: [], nodes: [],
  };
  const reply = (url: string, init?: { method?: string; body?: string }): unknown => {
    if (url.startsWith("/api/admin/quality")) return { ...quality, config: init?.method === "PUT" ? JSON.parse(init.body ?? "{}") : cfg };
    if (url.startsWith("/api/admin/llm/tasks/")) return gate;
    if (url.startsWith("/api/admin/llm/tasks")) return [gate];
    if (url.startsWith("/api/admin/llm/profiles")) return [];
    return {};
  };
  const fetchMock = vi.fn(async (url: string, init?: { method?: string; body?: string }) => ({
    ok: true, status: 200, json: async () => reply(url, init),
  }));
  vi.stubGlobal("fetch", fetchMock);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LookupProvider meta={meta}><AdminLlmTask feature="quality_gate" /></LookupProvider>
    </QueryClientProvider>,
  );
  return fetchMock;
}

it("admin esigi degistirip kaydeder: PUT taslagi tasir", async () => {
  const fetchMock = setup();
  const inputs = await screen.findAllByRole("spinbutton");
  fireEvent.change(inputs[0]!, { target: { value: "0.35" } });
  const section = screen.getByRole("region", { name: "Kalite soruları" });
  const save = [...section.querySelectorAll("button")].find((b) => b.textContent === "Kaydet");
  fireEvent.click(save!);
  await waitFor(() => {
    const put = fetchMock.mock.calls.find(([url, init]) => init?.method === "PUT" && url === "/api/admin/quality");
    expect(put).toBeTruthy();
    expect(JSON.parse(put?.[1]?.body ?? "{}").questions.specific.min).toBe(0.35);
  });
});
