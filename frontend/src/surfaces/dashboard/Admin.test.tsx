// R3-F02/F04: manage_users sahibi (admin degil) panelde admin'e ozel
// dugmeleri gormez. Uc zaten 403 doner; bu test ekranin dugme SUNMADIGINI
// dogruluyor (Kapat'a basip 403 yemek kotu arayuz).

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AdminView, Meta } from "../../api/types";
import { LookupProvider } from "../../lib/lookup";
import { Admin } from "./Admin";

const person = (id: string, name: string, is_admin: boolean): AdminView["people"][number] => ({
  id, name, email: `${name}@x`, color: null, is_admin, is_active: true, last_seen_at: null,
  scopes: [], role_ids: [], node_ids: [],
  notify_level: "all", quiet_start: null, quiet_end: null, push_devices: 0, chat_overrides: 0,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("manage_users admin dugmelerini ve rol tanimini gormez", async () => {
  const view: AdminView = {
    is_admin: false,
    scopes: ["manage_users"],
    roles: [{ id: "r1", name: "Yapıcı", color: "#5b8cff", scopes: [], node_ids: [] }],
    people: [person("a", "Selin", true), person("b", "Efe", false)],
  };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => view }));
  const meta: Meta = {
    me: { id: "b", is_admin: false, scopes: ["manage_users"], team_ids: [], profile_complete: true, favorite_nodes: [] },
    users: [], teams: [], pillars: [], nodes: [],
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
  expect(screen.getAllByRole("button", { name: "Hesabı kapat" })).toHaveLength(1); // yalniz Efe
  expect(screen.queryByText("Yeni rol")).toBeNull();
});

it("kullanıcı özetinde rollerden gelen kapsamları tekrar göstermez", async () => {
  const view: AdminView = {
    is_admin: true,
    scopes: ["edit_nodes", "manage_teams"],
    roles: [{ id: "r1", name: "Yapıcı", color: "#5b8cff", scopes: ["edit_nodes"], node_ids: [] }],
    people: [{
      ...person("p", "Tester", false),
      role_ids: ["r1"],
      scopes: [
        { name: "edit_nodes", direct: true, via_roles: ["r1"] },
        { name: "manage_teams", direct: true, via_roles: [] },
      ],
    }],
  };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => view }));
  const meta: Meta = {
    me: { id: "admin", is_admin: true, scopes: [], team_ids: [], profile_complete: true, favorite_nodes: [] },
    users: [], teams: [], pillars: [], nodes: [],
  };
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LookupProvider meta={meta}><Admin /></LookupProvider>
    </QueryClientProvider>,
  );
  await screen.findByText("Tester");
  const summary = screen.getAllByText("manage_teams")[0]?.parentElement;
  expect(summary).not.toBeNull();
  expect(within(summary as HTMLElement).queryByText("edit_nodes")).toBeNull();
});

it("özet satırında rolü gösterir; değişiklik yokken Kaydet pasif", async () => {
  const view: AdminView = {
    is_admin: true,
    scopes: ["edit_nodes"],
    roles: [{ id: "r1", name: "Yapıcı", color: "#5b8cff", scopes: ["edit_nodes"], node_ids: [] }],
    people: [{ ...person("p", "Tester", false), role_ids: ["r1"] }],
  };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => view }));
  const meta: Meta = {
    me: { id: "admin", is_admin: true, scopes: [], team_ids: [], profile_complete: true, favorite_nodes: [] },
    users: [], teams: [], pillars: [], nodes: [],
  };
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LookupProvider meta={meta}><Admin /></LookupProvider>
    </QueryClientProvider>,
  );
  await screen.findByText("Tester");
  const summary = screen.getAllByText("Yapıcı")[0]?.parentElement;
  expect(summary).not.toBeNull();
  const row = screen.getByText("Tester").closest("li") as HTMLElement;
  const save = within(row).getByRole("button", { name: "Kaydet" }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
});
