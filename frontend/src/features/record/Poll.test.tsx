import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { CardView, Meta } from "../../api/types";
import { LookupProvider } from "../../lib/lookup";
import { ToastProvider } from "../../ui/ui";
import { PollBody, remaining } from "./Poll";

afterEach(cleanup);

it("geri sayim: kalan sure ve kapandi", () => {
  const now = Date.parse("2026-10-01T10:00:00+03:00");
  expect(remaining("2026-10-01T12:10", now)).toBe("2 sa 10 dk kaldı");
  expect(remaining("2026-10-03T12:00", now)).toBe("2 gün 2 sa kaldı");
  expect(remaining("2026-10-01T09:59", now)).toBe("Kapandı");
});

const user = (id: string, name: string) => ({ id, name, color: null, is_admin: false, last_seen_at: null,
  nickname: null, phone: null, avatar_id: null, birth_day: null, birth_month: null, birth_year: null });
const META: Meta = {
  me: { id: "a", is_admin: false, scopes: [], team_ids: [], profile_complete: true, favorite_nodes: [] },
  users: [user("a", "Ayşe"), user("b", "Bora")], teams: [], pillars: [], nodes: [],
};
const poll: CardView = {
  id: "c", card_type: "poll", known: true, data: { title: "Yemek?" }, signups: [], attachments: [],
  options: [{ label: "Pide" }, { label: "Lahmacun" }], allow_other: true, media_enabled: false, timer_enabled: false, closes_at: null, closed: false,
  multiple_choice: false,
  votes: [{ user_id: "b", options: [], text: "Kebap", at: null }, { user_id: "a", options: [1], text: null, at: null }],
};

it("diger cevaplar ayri sekmede", () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <LookupProvider meta={META}><PollBody c={poll} /></LookupProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
  expect(screen.getByText("Lahmacun")).toBeTruthy();
  expect(screen.queryByText("Kebap")).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: /Diğer cevaplar · 1/ }));
  expect(screen.getByText("Kebap")).toBeTruthy();
});

it("coklu secimde isaretliler korunur, digeri eklenir", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  vi.stubGlobal("fetch", fetch);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <LookupProvider meta={META}><PollBody c={{ ...poll, multiple_choice: true }} /></LookupProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
  expect(screen.getByText("Birden çok seçenek işaretleyebilirsin.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Pide/ }));
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  const init = fetch.mock.calls[0]?.[1] as RequestInit;
  expect(JSON.parse(String(init.body))).toEqual({ options: [1, 0] });
  vi.unstubAllGlobals();
});
