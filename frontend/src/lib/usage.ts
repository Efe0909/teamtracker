// Aktivite ozeti: kisi satirlari, istatistikler ve katki matrisi.
//
// Iki olcu, farkli sorular:
//   KATKI   = gonderilen mesaj + yazilan olay (kayit, alan, eylem, katilma,
//             takim). "Ne yapti" — matris ve siralama buna dayanir.
//   SURE    = istek atilan dakika. Bildirim yoklamasi dakikada bir oldugu icin
//             pratikte SEKMENIN ACIK KALDIGI sure (bosta acik sekme dahil).
//             "Ne kadar basinda durdu" — seri ve sure satirlari buna dayanir.

import type { PersonUse } from "../api/types";

export const MATRIX_WEEKS = 17;
/** Seri esigi: o gun en az bu kadar dakikadan FAZLA acik kalinmis olmali. */
export const STREAK_MIN = 5;
/** Sunucunun gonderdigi pencere (gun). */
export const WINDOW_DAYS = 120;

type Day = PersonUse["days"][number];
export const contrib = (d: Day) => d.messages + d.changes;

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const back = (today: Date, n: number) => {
  const d = new Date(today);
  d.setDate(d.getDate() - n);
  return iso(d);
};
/** Son `n` gunun (bugun dahil) gunleri. */
const since = (u: PersonUse, today: Date, n: number) => {
  const start = back(today, n - 1);
  return u.days.filter((d) => d.day >= start);
};
const sum = (ds: Day[], f: (d: Day) => number) => ds.reduce((t, d) => t + f(d), 0);

export interface Stats {
  /** Son 30 gun katki ve kirilimi. */
  contrib30: number;
  messages30: number;
  changes30: number;
  contrib7: number;
  /** Son 30 gunde kullanilan (kaydi olan) gun. */
  activeDays30: number;
  /** Penceredeki en cok katkili gun; hic katki yoksa null. */
  bestDay: { day: string; contrib: number } | null;
  minutesToday: number;
  minutes7: number;
  minutes30: number;
  /** Son 30 gunde, sure kaydi olan gun basina ortalama dakika. */
  perActiveDay: number;
  /** Penceredeki en uzun seri: ardisik gun, gunde > STREAK_MIN dk. */
  longest: number;
  /** Bugune ya da dune kadar suren seri (bugun henuz dolmadiysa dunden sayilir). */
  current: number;
}

export function stats(u: PersonUse, today: Date): Stats {
  const d30 = since(u, today, 30);
  const d7 = since(u, today, 7);
  const qualified = new Set(u.days.filter((d) => d.minutes > STREAK_MIN).map((d) => d.day));
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
  let bestDay: Stats["bestDay"] = null;
  for (const d of u.days) {
    const c = contrib(d);
    if (c > 0 && (bestDay === null || c > bestDay.contrib)) bestDay = { day: d.day, contrib: c };
  }
  const minutes30 = sum(d30, (d) => d.minutes);
  // Ortalama yalniz SURE kaydi olan gunlere bolunur; yalniz katkisi olan gun
  // (or. tohum mesaji) ortalamayi sulandirmasin.
  const timedDays = d30.filter((d) => d.minutes > 0).length;
  return {
    contrib30: sum(d30, contrib),
    messages30: sum(d30, (d) => d.messages),
    changes30: sum(d30, (d) => d.changes),
    contrib7: sum(d7, contrib),
    activeDays30: d30.length,
    bestDay,
    minutesToday: sum(since(u, today, 1), (d) => d.minutes),
    minutes7: sum(d7, (d) => d.minutes),
    minutes30,
    perActiveDay: timedDays === 0 ? 0 : Math.round(minutes30 / timedDays),
    longest,
    current,
  };
}

// --- kisi listesi ----------------------------------------------------------------

export interface PersonRow {
  id: string;
  name: string;
  login: string | null;
  seen: string | null;
  activeDays30: number;
  minutes7: number;
  contrib30: number;
}
export type SortKey = Exclude<keyof PersonRow, "id">;
export type SortDir = "desc" | "asc";

const nameCmp = new Intl.Collator("tr", { numeric: true, sensitivity: "base" });

/** Sutuna gore sirala. Ad alfanumerik ("Ekip 2" < "Ekip 10"); bos degerler
 *  (hic giris yok) yon ne olursa olsun SONDA. */
export function sortPeople(rows: PersonRow[], key: SortKey, dir: SortDir): PersonRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[key], y = b[key];
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    const c = typeof x === "number" && typeof y === "number" ? x - y : nameCmp.compare(String(x), String(y));
    return c * sign || nameCmp.compare(a.name, b.name);
  });
}

export function personRow(u: PersonUse, name: string, today: Date): PersonRow {
  const st = stats(u, today);
  return {
    id: u.user_id, name, login: u.last_login_at, seen: u.last_seen_at,
    activeDays30: st.activeDays30, minutes7: st.minutes7, contrib30: st.contrib30,
  };
}

// --- matris ------------------------------------------------------------------------

export interface Cell {
  day: string;
  contrib: number;
  minutes: number;
  /** 0 = katki yok, 1..4 = yogunluk kademesi (en katkili gune gore). */
  level: 0 | 1 | 2 | 3 | 4;
}

/** Haftalar sutun, gun satir (Pzt ust). Bugunun sonrasi bos birakilir (null). */
export function matrix(u: PersonUse, today: Date): (Cell | null)[][] {
  const byDay = new Map(u.days.map((d) => [d.day, d]));
  const max = Math.max(1, ...u.days.map(contrib));
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
      const c = hit === undefined ? 0 : contrib(hit);
      const level = c === 0 ? 0 : (Math.min(4, Math.ceil((c / max) * 4)) as 1 | 2 | 3 | 4);
      col.push({ day: key, contrib: c, minutes: hit?.minutes ?? 0, level });
    }
    weeks.push(col);
  }
  return weeks;
}
