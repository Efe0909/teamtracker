import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { Meta, Membership, RecordDetail } from "../../api/types";
import { LookupProvider } from "../../lib/lookup";
import { ToastProvider } from "../../ui/ui";
import { JoinBanner } from "./Join";

afterEach(cleanup);

const user = (id: string, name: string) => ({ id, name, color: null, is_admin: false, last_seen_at: null,
  nickname: null, phone: null, avatar_id: null, birth_day: null, birth_month: null, birth_year: null });
const META: Meta = {
  me: { id: "me", is_admin: false, scopes: [], team_ids: [], profile_complete: true },
  users: [user("me", "Ben"), user("x", "Xenia")], teams: [], pillars: [], nodes: [],
};
const detail = (m: Partial<Membership>): RecordDetail => ({
  record: { id: "r", unit_id: "n", pillar_id: null, team_id: null, chat_id: "c", kind: "task", title: "T", description: null,
    status: "open", priority: "medium", owner_id: null, created_by: "o", due_date: null, created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z" },
  actions: [], participants: [], cards: [], access: { can_edit: false, can_edit_deadline: false }, pinned: false,
  membership: { mode: "public", is_member: false, restricted: false, request: null, can_decide: false, requests: [], ...m },
});
const view = (d: RecordDetail) => render(
  <QueryClientProvider client={new QueryClient()}><ToastProvider>
    <LookupProvider meta={META}><JoinBanner d={d} /></LookupProvider>
  </ToastProvider></QueryClientProvider>,
);

it("public: tek tikla katil", () => {
  view(detail({}));
  expect(screen.getByRole("button", { name: "Kayda katıl" })).toBeTruthy();
});

it("private: gizli aciklamasi + istek gonder; bekleyen istekte geri cek", () => {
  view(detail({ mode: "private", restricted: true }));
  expect(screen.getByText(/Bu kayıt gizli/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Katılma isteği gönder" })).toBeTruthy();
  cleanup();
  view(detail({ mode: "request", request: "pending" }));
  expect(screen.getByRole("button", { name: "Geri çek" })).toBeTruthy();
});

it("uye bandi gormez; sorumlu bekleyen istekleri onaylar", () => {
  view(detail({ is_member: true, can_decide: true, requests: [{ user_id: "x", created_at: "2026-01-01T00:00:00Z" }] }));
  expect(screen.queryByRole("button", { name: "Kayda katıl" })).toBeNull();
  expect(screen.getByRole("button", { name: "Onayla" })).toBeTruthy();
  expect(screen.getByText("Xenia")).toBeTruthy();
});
