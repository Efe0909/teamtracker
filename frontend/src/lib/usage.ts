// Aktivite ozeti: son 30 gun toplamlari, kisi istatistikleri ve katki matrisi.
// "Dakika" = istek atilan dakika sayisi; bildirim yoklamasi dakikada bir oldugu
// icin pratikte SEKMENIN ACIK KALDIGI sure (bosta acik sekme dahil).

import type { PersonUse } from "../api/types";

export const MATRIX_WEEKS = 17;
/** Seri esigi: o gun en az bu kadar dakikadan FAZLA acik kalinmis olmali. */
export const STREAK_MIN = 5;

export interface Totals {
  requests: number;
  minutes: number;
  activeDays: number;
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const back = (today: Date, n: number) => {
  const d = new Date(today);
  d.setDate(d.getDate() - n);
  return iso(d);
};

export function totals30(u: PersonUse, today: Date): Totals {
  const start = back(today, 29);
  let requests = 0, minutes = 0, activeDays = 0;
  for (const d of u.days) {
    if (d.day < start) continue;
    requests += d.requests;
    minutes += d.minutes;
    activeDays += 1;
  }
  return { requests, minutes, activeDays };
}

/** Son `n` gunun (bugun dahil) dakika toplami. */
export function minutesSince(u: PersonUse, today: Date, n: number): number {
  const start = back(today, n - 1);
  return u.days.reduce((t, d) => (d.day >= start ? t + d.minutes : t), 0);
}

export interface Stats {
  today: number;
  week: number;
  month: number;
  /** Son 30 gunde aktif gun basina ortalama dakika. */
  perActiveDay: number;
  /** Veri penceresindeki (120 gun) en uzun seri: ardisik gun, gunde > STREAK_MIN dk. */
  longest: number;
  /** Bugune ya da dune kadar suren seri (bugun henuz dolmadiysa dunden sayilir). */
  current: number;
}

export function stats(u: PersonUse, today: Date): Stats {
  const t30 = totals30(u, today);
  const qualified = new Set(u.days.filter((d) => d.minutes > STREAK_MIN).map((d) => d.day));
  // En uzun seri: siralı gunlerde ardisiklik.
  let longest = 0, run = 0, prev: number | null = null;
  for (const day of [...qualified].sort()) {
    const [y, m, d] = day.split("-").map(Number);
    const t = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / 86_400_000;
    run = prev !== null && t - prev === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = t;
  }
  let current = 0;
  for (let i = qualified.has(back(today, 0)) ? 0 : 1; qualified.has(back(today, i)); i++) current++;
  return {
    today: minutesSince(u, today, 1),
    week: minutesSince(u, today, 7),
    month: t30.minutes,
    perActiveDay: t30.activeDays === 0 ? 0 : Math.round(t30.minutes / t30.activeDays),
    longest,
    current,
  };
}

export interface Cell {
  day: string;
  requests: number;
  minutes: number;
  /** 0 = bos, 1..4 = yogunluk kademesi (en yogun gune gore, DAKIKA uzerinden). */
  level: 0 | 1 | 2 | 3 | 4;
}

/** Haftalar sutun, gun satir (Pzt ust). Bugunun sonrasi bos birakilir (null). */
export function matrix(u: PersonUse, today: Date): (Cell | null)[][] {
  const byDay = new Map(u.days.map((d) => [d.day, d]));
  const max = Math.max(1, ...u.days.map((d) => d.minutes));
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
      const minutes = hit?.minutes ?? 0;
      const level = minutes === 0 ? 0 : (Math.min(4, Math.ceil((minutes / max) * 4)) as 1 | 2 | 3 | 4);
      col.push({ day: key, requests: hit?.requests ?? 0, minutes, level });
    }
    weeks.push(col);
  }
  return weeks;
}
