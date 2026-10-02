import { expect, it } from "vitest";
import type { PersonUse } from "../api/types";
import { matrix, MATRIX_WEEKS, monthLabels, sortPeople, stats, type PersonRow } from "./usage";

const day = (d: string, minutes: number, messages = 0, changes = 0) => ({ day: d, requests: 0, minutes, messages, changes });
const today = new Date(2026, 9, 1); // 1 Ekim 2026, Persembe
const base: PersonUse = { user_id: "u", last_login_at: null, last_seen_at: null, days: [] };

it("matris: hafta sutunlari, gelecek bos, kademe en KATKILI gune gore", () => {
  const u = { ...base, days: [day("2026-09-01", 10, 6, 2), day("2026-10-01", 5, 2, 2)] };
  const m = matrix(u, today);
  expect(m).toHaveLength(MATRIX_WEEKS);
  expect(m.every((c) => c.length === 7)).toBe(true);
  const last = m[MATRIX_WEEKS - 1] ?? [];
  expect(last[3]).toMatchObject({ day: "2026-10-01", contrib: 4, level: 2 }); // Per = satir 3; 4/8
  expect(last[4]).toBeNull(); // Cuma henuz yok
  // ilk sutun 8 Haz haftasi, Tem etiketi 6 Tem sutununda (indeks 4) → ilk sutuna yer var
  const labels = monthLabels(m);
  expect(labels.filter((l) => l !== null)).toEqual(["Jun", "Jul", "Aug", "Sep"]);
  expect(labels[0]).toBe("Jun");
});

it("istatistik: katki kirilimi, en katkili gun, seri (5 dk'dan fazlasi, bugun dolmadiysa dunden)", () => {
  const u = {
    ...base,
    days: [
      day("2026-08-20", 40, 9, 9), // 30 gunun disinda ama en katkili gun
      day("2026-09-10", 30), day("2026-09-11", 6), day("2026-09-12", 5), // 5 dk seri kirar
      day("2026-09-28", 9, 1, 0), day("2026-09-29", 9, 0, 2), day("2026-09-30", 9), day("2026-10-01", 2, 3, 1),
    ],
  };
  const st = stats(u, today);
  expect(st).toMatchObject({
    contrib30: 7, messages30: 4, changes30: 3, contrib7: 7,
    activeDays30: 7, bestDay: { day: "2026-08-20", contrib: 18 },
    minutesToday: 2, minutes7: 29, longest: 3, current: 3,
  });
  // yalniz katkisi olan gun (dakikasiz) ortalamaya girmez
  const v = stats({ ...base, days: [day("2026-09-30", 0, 2), day("2026-10-01", 10)] }, today);
  expect(v.perActiveDay).toBe(10);
});

it("siralama: azalan/artan, ad alfanumerik, girisi olmayan hep sonda", () => {
  const row = (name: string, login: string | null, contrib30: number): PersonRow =>
    ({ id: name, name, login, seen: null, activeDays30: 0, minutes7: 0, contrib30 });
  const rows = [row("Ekip 10", "2026-09-01", 5), row("Ekip 2", null, 9), row("ayşe", "2026-09-30", 5)];
  expect(sortPeople(rows, "name", "asc").map((r) => r.name)).toEqual(["ayşe", "Ekip 2", "Ekip 10"]);
  expect(sortPeople(rows, "name", "desc").map((r) => r.name)).toEqual(["Ekip 10", "Ekip 2", "ayşe"]);
  expect(sortPeople(rows, "login", "desc").map((r) => r.name)).toEqual(["ayşe", "Ekip 10", "Ekip 2"]);
  expect(sortPeople(rows, "login", "asc").map((r) => r.name)).toEqual(["Ekip 10", "ayşe", "Ekip 2"]);
  // esitlikte ada gore
  expect(sortPeople(rows, "contrib30", "desc").map((r) => r.name)).toEqual(["Ekip 2", "ayşe", "Ekip 10"]);
});
