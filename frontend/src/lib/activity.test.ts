// Olay cumleleri: pillar adi PILLARS sozlugunden (agactan degil, spec/22) ve
// takim yazmalarinin fiilleri.

import { describe, expect, it } from "vitest";
import type { FeedItem, Meta } from "../api/types";
import { describe as sentence } from "./activity";
import type { Lookup } from "./lookup";

const meta: Meta = {
  me: { id: "u1", is_admin: false, scopes: [], team_ids: [] },
  users: [],
  teams: [],
  pillars: [{ id: "p1", name: "Kalite", description: null, color: null, team_id: "t9", is_active: true, sort_order: 0 }],
  nodes: [],
};
const L = {
  meta,
  pillar: (id: string | null | undefined) => meta.pillars.find((p) => p.id === id),
  node: () => undefined,
} as unknown as Lookup;

const item = (over: Partial<FeedItem>): FeedItem => ({
  kind: "activity", id: "a", created_at: "2026-10-01T10:00:00Z", actor_id: "u1", verb: null,
  subject_label: null, target_label: null, body: null, reply_to_id: null, edited_at: null, ...over,
});

describe("activity cumleleri", () => {
  it("pillar alani pillars sozlugunden adlandirilir", () => {
    const s = sentence(item({ verb: "field_changed", target_label: "pillar_id", body: '{"from":null,"to":"p1"}' }), L);
    expect(s).toBe("Pillar: — → Kalite");
  });

  it("takim yazma fiilleri ham kalmaz", () => {
    expect(sentence(item({ verb: "team_node_linked", subject_label: "Maliye", target_label: "Bütçe Onayı" }), L))
      .toBe("takımı “Bütçe Onayı” birimine bağladı");
    expect(sentence(item({ verb: "team_renamed", body: '{"from":"A","to":"B"}' }), L)).toBe("takımın adını değiştirdi: A → B");
  });
});
