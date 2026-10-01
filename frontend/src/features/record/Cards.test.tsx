// R4-F01 / KNOW-280: taninmayan kart turu BOZUK kutusu olarak cizilir (veri
// gitmez, sayfa dusmez); tanimli tur alanlarini ve katilim cevaplarini cizer.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { CardView, Meta, RecordDetail } from "../../api/types";
import { LookupProvider } from "../../lib/lookup";
import { Cards } from "./Cards";

afterEach(cleanup);

const card = (over: Partial<CardView>): CardView => ({
  id: "c", card_type: "meeting", known: true, data: {}, signups: [], options: [], allow_other: false, media_enabled: false, timer_enabled: false, closes_at: null, closed: false, votes: [], attachments: [], ...over,
});

it("bilinmeyen tur bozuk, toplanti alanlari ve cevaplari cizilir", () => {
  const d = {
    record: { id: "r" },
    cards: [
      card({ id: "a", card_type: "survey", known: false }),
      card({ id: "b", data: { title: "Planlama", place: "Kulüp odası" } }),
    ],
    access: { can_edit: false, can_edit_deadline: false },
    pinned: false,
    membership: { mode: "public", is_member: true, restricted: false, request: null, can_decide: false, requests: [] },
  } as unknown as RecordDetail;
  const meta: Meta = { me: { id: "u", is_admin: false, scopes: [], team_ids: [], profile_complete: true }, users: [], teams: [], pillars: [], nodes: [] };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LookupProvider meta={meta}>
        <Cards d={d} />
      </LookupProvider>
    </QueryClientProvider>,
  );
  expect(screen.getByText(/Bu kart türü tanınmıyor \(survey\)/)).toBeTruthy();
  expect(screen.getByText("Kulüp odası")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Belki" })).toBeTruthy();
  expect(screen.queryByText("Kart ekle…")).toBeNull();
});
