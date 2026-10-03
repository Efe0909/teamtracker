// Tablo siralama: istemcide, tablo basina bir durum, cihaza yazilir (useStored).
// Baslik tiklamasi: artan → azalan → kapali (sunucunun varsayilan sirasi).
// Metin Turkce harmanla (i/İ, ç, ş), sayi/tarih dogal sirayla; bos degerler yon
// ne olursa olsun SONDA.

import { useCallback, useMemo } from "react";
import { useStored } from "./stored";

export type SortDir = "asc" | "desc";
export interface SortState {
  key: string;
  dir: SortDir;
}
export type SortValue = string | number | null | undefined;

const collator = new Intl.Collator("tr", { numeric: true });

/** Artan/azalan/kapali dongusu: yeni sutun artan baslar. */
export function nextSort(cur: SortState | null, key: string): SortState | null {
  if (cur === null || cur.key !== key) return { key, dir: "asc" };
  return cur.dir === "asc" ? { key, dir: "desc" } : null;
}

/** Iki deger; bos (null/undefined) yon bagimsiz sonda. */
export function compareValues(a: SortValue, b: SortValue, dir: SortDir): number {
  const na = a === null || a === undefined;
  const nb = b === null || b === undefined;
  if (na || nb) return na === nb ? 0 : na ? 1 : -1;
  const c = typeof a === "number" && typeof b === "number" ? a - b : collator.compare(String(a), String(b));
  return dir === "asc" ? c : -c;
}

export type Accessors<T> = Record<string, (row: T) => SortValue>;

/** Durum kapaliysa ya da sutun taninmiyorsa satirlar oldugu gibi; esitlikte kararli (ilk sira). */
export function sortRows<T>(rows: T[], sort: SortState | null, accessors: Accessors<T>): T[] {
  const get = sort === null ? undefined : accessors[sort.key];
  if (sort === null || get === undefined) return rows;
  return [...rows].sort((a, b) => compareValues(get(a), get(b), sort.dir));
}

export interface Sorter<T> {
  rows: T[];
  sort: SortState | null;
  toggle: (key: string) => void;
}

export function useSort<T>(tableKey: string, rows: T[], accessors: Accessors<T>): Sorter<T> {
  const [sort, setSort] = useStored<SortState | null>(`sort.${tableKey}`, null);
  const toggle = useCallback((key: string) => setSort(nextSort(sort, key)), [sort, setSort]);
  // ponytail: erisimciler her cizimde yeni nesne olabilir; satir listesi kucuk, her cizimde siralamak yeter.
  const sorted = useMemo(() => sortRows(rows, sort, accessors), [rows, sort, accessors]);
  return { rows: sorted, sort, toggle };
}
