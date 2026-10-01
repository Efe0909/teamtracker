import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Meta, MetaUser } from "../../api/types";
import { LookupProvider } from "../../lib/lookup";
import { People } from "./People";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const now = new Date();
const user = (id: string, name: string, over: Partial<MetaUser> = {}): MetaUser => ({
  id, name, color: null, is_admin: false, last_seen_at: null, nickname: null, phone: null, avatar_id: null,
  birth_day: null, birth_month: null, birth_year: null, ...over,
});

it("kisi arar, telefon ve dogum gununu gosterir, bugun dogum gunu isaretlenir", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] }));
  const meta: Meta = {
    me: { id: "a", is_admin: false, scopes: [], team_ids: [], profile_complete: true },
    users: [
      user("a", "Ayşe", { phone: "0532 111 22 33" }),
      user("b", "Bora", { nickname: "Boro", birth_day: now.getDate(), birth_month: now.getMonth() + 1 }),
    ],
    teams: [], pillars: [], nodes: [],
  };
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LookupProvider meta={meta}><People /></LookupProvider>
    </QueryClientProvider>,
  );
  expect(screen.getByText("0532 111 22 33")).toBeTruthy();
  expect(screen.getByText(/bugün!/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Kişi ara"), { target: { value: "boro" } });
  expect(screen.queryByText("Ayşe")).toBeNull();
  expect(screen.getByText("Bora")).toBeTruthy();
});
