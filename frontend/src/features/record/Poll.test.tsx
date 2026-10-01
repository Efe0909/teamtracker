import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
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
  me: { id: "a", is_admin: false, scopes: [], team_ids: [], profile_complete: true },
  users: [user("a", "Ayşe"), user("b", "Bora")], teams: [], pillars: [], nodes: [],
};
const poll: CardView = {
  id: "c", card_type: "poll", known: true, data: { title: "Yemek?" }, signups: [], attachments: [],
  options: [{ label: "Pide" }, { label: "Lahmacun" }], allow_other: true, closes_at: null, closed: false,
  votes: [{ user_id: "b", option: null, text: "Kebap", at: null }, { user_id: "a", option: 1, text: null, at: null }],
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
