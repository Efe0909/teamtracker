import { expect, it } from "vitest";
import type { PersonUse } from "../api/types";
import { matrix, MATRIX_WEEKS, stats, totals30 } from "./usage";

const u: PersonUse = {
  user_id: "u", last_login_at: null, last_seen_at: null,
  days: [{ day: "2026-09-01", requests: 100, minutes: 10 }, { day: "2026-10-01", requests: 50, minutes: 5 }],
};
const today = new Date(2026, 9, 1); // 1 Ekim 2026, Persembe

it("son 30 gun toplami eski gunu saymaz", () => {
  expect(totals30(u, today)).toEqual({ requests: 50, minutes: 5, activeDays: 1 });
});

it("matris: hafta sutunlari, gelecek bos, kademe en yogun gunun DAKIKASINA gore", () => {
  const m = matrix(u, today);
  expect(m).toHaveLength(MATRIX_WEEKS);
  expect(m.every((c) => c.length === 7)).toBe(true);
  const last = m[MATRIX_WEEKS - 1] ?? [];
  expect(last[3]).toMatchObject({ day: "2026-10-01", level: 2 }); // Per = satir 3; 5/10 dk
  expect(last[4]).toBeNull(); // Cuma henuz yok
});

it("seri: gunde 5 dk'dan fazlasi sayilir, ardisiklik ay sinirini gecer, bugun dolmadiysa dunden", () => {
  const days = (xs: [string, number][]) => xs.map(([day, minutes]) => ({ day, requests: 0, minutes }));
  const p: PersonUse = {
    ...u,
    days: days([
      ["2026-09-10", 30], ["2026-09-11", 6], ["2026-09-12", 5], // 5 dk seri kirar
      ["2026-09-28", 9], ["2026-09-29", 9], ["2026-09-30", 9], ["2026-10-01", 2],
    ]),
  };
  const st = stats(p, today);
  expect(st.longest).toBe(3); // 28-29-30 Eyl
  expect(st.current).toBe(3); // bugun 2 dk: dunden geriye
  expect(st.today).toBe(2);
  expect(st.week).toBe(29);
});
