import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AdminPerson, AdminView, Meta } from "../../api/types";
import { LookupProvider } from "../../lib/lookup";
import { Admin } from "./Admin";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const person = (id: string, name: string, over: Partial<AdminPerson> = {}): AdminPerson => ({
  id, name, email: `${name}@x`, color: null, is_admin: false, is_active: true, last_seen_at: null,
  scopes: [], role_ids: [], node_ids: [],
  notify_level: "all", quiet_start: null, quiet_end: null, push_devices: 0, chat_overrides: 0, ...over,
});

it("bildirim ozeti gorunur, secilince toplu islem cubugu cikar", async () => {
  const view: AdminView = {
    is_admin: true, scopes: [], roles: [{ id: "r1", name: "Yapıcı", color: "#5b8cff", scopes: [], node_ids: [] }],
    people: [
      person("a", "Ayşe", { notify_level: "mentions", quiet_start: 22, quiet_end: 7, push_devices: 2, chat_overrides: 1 }),
      person("b", "Bora"),
    ],
  };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => view }));
  const meta: Meta = {
    me: { id: "a", is_admin: true, scopes: [], team_ids: [], profile_complete: true, favorite_nodes: [] },
    users: [], teams: [], pillars: [], nodes: [],
  };
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LookupProvider meta={meta}><Admin /></LookupProvider>
    </QueryClientProvider>,
  );
  expect(await screen.findByText("Bildirim: yalnız anmalar · sessiz 22:00–07:00 · 2 cihaz · 1 sohbet özel")).toBeTruthy();
  expect(screen.getByText("Bildirim: her hareket · anlık bildirim cihazı yok")).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Toplu işlemler" })).toBeNull();
  fireEvent.click(screen.getByLabelText("Bora seç"));
  expect(screen.getByRole("region", { name: "Toplu işlemler" })).toBeTruthy();
  expect(screen.getByText("1 kişi seçili")).toBeTruthy();
});
