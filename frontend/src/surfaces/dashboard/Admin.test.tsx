// R3-F02/F04: manage_users sahibi (admin degil) panelde admin'e ozel
// dugmeleri gormez. Uc zaten 403 doner; bu test ekranin dugme SUNMADIGINI
// dogruluyor (Kapat'a basip 403 yemek kotu arayuz).

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AdminView, Meta } from "../../api/types";
import { LookupProvider } from "../../lib/lookup";
import { Admin } from "./Admin";

const person = (id: string, name: string, is_admin: boolean): AdminView["people"][number] => ({
  id, name, email: `${name}@x`, color: null, is_admin, is_active: true, last_seen_at: null,
  scopes: [], role_ids: [], node_ids: [],
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("manage_users admin dugmelerini ve rol tanimini gormez", async () => {
  const view: AdminView = {
    is_admin: false,
    scopes: ["manage_users"],
    roles: [{ id: "r1", name: "Yapıcı", scopes: [] }],
    people: [person("a", "Selin", true), person("b", "Efe", false)],
  };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => view }));
  const meta: Meta = {
    me: { id: "b", is_admin: false, scopes: ["manage_users"], team_ids: [] },
    users: [], teams: [], nodes: [],
  };
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LookupProvider meta={meta}>
        <Admin />
      </LookupProvider>
    </QueryClientProvider>,
  );
  expect(await screen.findByText("Yönetici bütün kapsamlara sahip.")).toBeTruthy();
  expect(screen.queryByText("Yönetici yap")).toBeNull();
  expect(screen.getAllByRole("button", { name: "Kapat" })).toHaveLength(1); // yalniz Efe
  expect(screen.queryByText("Yeni rol")).toBeNull();
});
