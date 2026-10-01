// Aktivite ozeti: son 30 gun toplamlari ve katki matrisi hucreleri.

import type { PersonUse } from "../api/types";

export const MATRIX_WEEKS = 17;

export interface Totals {
  requests: number;
  minutes: number;
  activeDays: number;
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function totals30(u: PersonUse, today: Date): Totals {
  const from = new Date(today);
  from.setDate(from.getDate() - 29);
  const start = iso(from);
  let requests = 0, minutes = 0, activeDays = 0;
  for (const d of u.days) {
    if (d.day < start) continue;
    requests += d.requests;
    minutes += d.minutes;
    activeDays += 1;
  }
  return { requests, minutes, activeDays };
}

export interface Cell {
  day: string;
  requests: number;
  minutes: number;
  /** 0 = bos, 1..4 = yogunluk kademesi (en yogun gune gore). */
  level: 0 | 1 | 2 | 3 | 4;
}

/** Haftalar sutun, gun satir (Pzt ust). Bugunun sonrasi bos birakilir (null). */
export function matrix(u: PersonUse, today: Date): (Cell | null)[][] {
  const byDay = new Map(u.days.map((d) => [d.day, d]));
  const max = Math.max(1, ...u.days.map((d) => d.requests));
  const dow = (today.getDay() + 6) % 7; // Pzt = 0
  const first = new Date(today);
  first.setDate(first.getDate() - dow - (MATRIX_WEEKS - 1) * 7);
  const weeks: (Cell | null)[][] = [];
  for (let w = 0; w < MATRIX_WEEKS; w++) {
    const col: (Cell | null)[] = [];
    for (let r = 0; r < 7; r++) {
      const d = new Date(first);
      d.setDate(first.getDate() + w * 7 + r);
      if (d > today) { col.push(null); continue; }
      const key = iso(d);
      const hit = byDay.get(key);
      const requests = hit?.requests ?? 0;
      const level = requests === 0 ? 0 : (Math.min(4, Math.ceil((requests / max) * 4)) as 1 | 2 | 3 | 4);
      col.push({ day: key, requests, minutes: hit?.minutes ?? 0, level });
    }
    weeks.push(col);
  }
  return weeks;
}
