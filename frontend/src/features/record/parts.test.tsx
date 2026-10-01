// R1-F08: kayit basliginda "Acan: X · tarih" satiri (spec/90). Python'da
// yalniz masaustundeydi; RecordHead iki yuzde de kullanildigi icin burada da
// gorunur olmasi kullanici karariydi (spec/90-geri-tasima.md).

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Meta, RecordDetail } from "../../api/types";
import { LookupProvider } from "../../lib/lookup";
import { ToastProvider } from "../../ui/ui";
import { RecordHead } from "./parts";

const META: Meta = {
  me: { id: "u-me", is_admin: false, scopes: [], team_ids: [], profile_complete: true },
  users: [{ id: "u-selin", name: "Selin", color: null, is_admin: false, last_seen_at: null, nickname: null, phone: null, avatar_id: null, birth_day: null, birth_month: null, birth_year: null }],
  teams: [],
  pillars: [],
  nodes: [],
};

function detail(createdBy: string): RecordDetail {
  return {
    record: {
      id: "r1",
      unit_id: "n1",
      pillar_id: null,
      team_id: null,
      chat_id: "c1",
      kind: "task",
      title: "Bütçe onayı",
      description: null,
      status: "open",
      priority: "medium",
      owner_id: null,
      created_by: createdBy,
      due_date: null,
      created_at: new Date(Date.now() - 5 * 60_000).toISOString(),
      updated_at: new Date().toISOString(),
    },
    actions: [],
    participants: [],
    pinned: false,
    cards: [],
    access: { can_edit: false, can_edit_deadline: false },
  };
}

function renderHead(createdBy: string) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <LookupProvider meta={META}>
          <RecordHead d={detail(createdBy)} />
        </LookupProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("RecordHead — 'X açtı · tarih' satırı (R1-F08)", () => {
  it("kaydı açanın adını gösterir", () => {
    const { container } = renderHead("u-selin");
    expect(container.textContent).toMatch(/Selin açtı/);
  });

  it("açan kullanıcı sözlükte yoksa satırı hiç çizmez", () => {
    const { container } = renderHead("u-bilinmeyen");
    expect(container.textContent).not.toMatch(/açtı/);
  });
});
