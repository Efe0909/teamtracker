import { expect, it } from "vitest";
import type { PersonUse } from "../api/types";
import { matrix, MATRIX_WEEKS, totals30 } from "./usage";

const u: PersonUse = {
  user_id: "u", last_login_at: null, last_seen_at: null,
  days: [{ day: "2026-09-01", requests: 100, minutes: 10 }, { day: "2026-10-01", requests: 50, minutes: 5 }],
};
const today = new Date(2026, 9, 1); // 1 Ekim 2026, Persembe

it("son 30 gun toplami eski gunu saymaz", () => {
  expect(totals30(u, today)).toEqual({ requests: 50, minutes: 5, activeDays: 1 });
});

it("matris: hafta sutunlari, gelecek bos, kademe en yogun gune gore", () => {
  const m = matrix(u, today);
  expect(m).toHaveLength(MATRIX_WEEKS);
  expect(m.every((c) => c.length === 7)).toBe(true);
  const last = m[MATRIX_WEEKS - 1] ?? [];
  expect(last[3]).toMatchObject({ day: "2026-10-01", level: 2 }); // Per = satir 3
  expect(last[4]).toBeNull(); // Cuma henuz yok
});
