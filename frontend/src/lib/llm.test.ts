import { describe, expect, it } from "vitest";
import type { LlmDayRow, LlmModelInfo } from "../api/types";
import { breakdown, buckets, compat, rangeDates, totals, usd, validWindow, windowLabel } from "./llm";

const row = (day: string, model: string, cost: number, calls = 1, errors = 0): LlmDayRow => ({
  day, feature: "material_suggestions", model, calls, errors, limited: 0, prompt_tokens: 100,
  completion_tokens: 40, cost_usd: cost, unpriced: 0, ms_total: 3000 * calls,
});

describe("usd", () => {
  it("kucuk tutari anlamli hanesiyle, buyugu iki haneyle gosterir", () => {
    expect(usd(0.0042)).toBe("$0,0042");
    expect(usd(0.00123)).toBe("$0,0012");
    expect(usd(12.345)).toBe("$12,35");
    expect(usd(1234.5)).toBe("$1.234,50");
    expect(usd(0)).toBe("$0");
    expect(usd(null)).toBe("—");
  });
});

describe("pencere", () => {
  it("hazir etiket, yoksa gun/saat/dakika", () => {
    expect(windowLabel(43200)).toBe("1 ay");
    expect(windowLabel(480)).toBe("8 sa");
    expect(windowLabel(2880)).toBe("2 gün");
    expect(windowLabel(180)).toBe("3 sa");
    expect(windowLabel(45)).toBe("45 dk");
  });
  it("15 dk - 31 gun", () => {
    expect(validWindow(15)).toBe(true);
    expect(validWindow(44640)).toBe(true);
    expect(validWindow(14)).toBe(false);
    expect(validWindow(44641)).toBe(false);
    expect(validWindow(20.5)).toBe(false);
  });
});

describe("toplama", () => {
  const rows = [row("2026-10-08", "a/b", 0.01, 2, 1), row("2026-10-10", "a/b", 0.02), row("2026-10-10", "c/d", 0.5)];
  it("toplam, basari orani, ortalama sure", () => {
    const t = totals(rows);
    expect([t.calls, t.errors, t.successRate, t.avgMs]).toEqual([4, 1, 0.75, 3000]);
    expect(t.cost).toBeCloseTo(0.53);
    expect(totals([]).successRate).toBeNull();
  });
  it("model kirilimi maliyete gore", () => {
    expect(breakdown(rows, "model").map((b) => [b.key, b.calls])).toEqual([["c/d", 1], ["a/b", 3]]);
  });
  it("gunluk kovalar bos gunleri de icerir", () => {
    const b = buckets(rows, "2026-10-08", "2026-10-10");
    expect(b.map((x) => x.label)).toEqual(["08.10", "09.10", "10.10"]);
    expect(b[1]?.total).toBe(0);
    expect(b[2]?.parts.map((p) => p.model)).toEqual(["a/b", "c/d"]);
  });
  it("uzun aralik ayliga doner, ilk veriden onceki aylar cizilmez", () => {
    const b = buckets(rows, "2020-01-01", "2026-10-10");
    expect(b.map((x) => x.key)).toEqual(["2026-10"]);
  });
});

it("aralik tarihleri yerel gunle", () => {
  const today = new Date(2026, 9, 10);
  expect(rangeDates("7d", today)).toEqual({ from: "2026-10-04", to: "2026-10-10" });
  expect(rangeDates("month", today)).toEqual({ from: "2026-10-01", to: "2026-10-10" });
});

describe("uyumluluk", () => {
  const m = (p: Partial<LlmModelInfo>): LlmModelInfo => ({
    id: "a/b", name: "a", context_length: 1000, prompt_per_m: 0.3, completion_per_m: 1.2,
    structured_outputs: true, response_format: true, reasoning: true, ...p,
  });
  it("json_schema yoksa kirmizi, dusunme parametresi yoksa sari", () => {
    expect(compat(m({}), "chat", true).level).toBe("ok");
    expect(compat(m({ structured_outputs: false }), "chat", true).level).toBe("bad");
    expect(compat(m({ reasoning: false }), "chat", true).level).toBe("warn");
    expect(compat(m({ reasoning: false }), "chat", false).level).toBe("ok");
    expect(compat(m({ prompt_per_m: null }), "decisions", true).level).toBe("warn");
    expect(compat(undefined, "chat", true).level).toBe("unknown");
  });
});
