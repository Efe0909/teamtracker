// Malzeme önerisi oturum durumu (spec/79 §9 madde 6-7): sunucu durumsuz, bekleyen parti
// ve reddedilenler tarayıcı OTURUMUNDA (sessionStorage, sekme kapanınca gider) etkinlik
// başına tutulur. Öneri güvenilmeyen gösterim verisidir: kabul normal malzeme ekleme
// ucundan geçer, burada hiçbir yetki kararı yok. Yazılamazsa (özel pencere) bellekte kalır.

import { useCallback, useState } from "react";
import type { MaterialSuggestion, Uuid } from "../api/types";

/** Aynı anda gösterilen öneri sayısı; üçü de kabul/retle bitmeden sıradaki üçlü gelmez. */
export const PAGE = 3;
/** Sunucu en çok bu kadar reddedileni kabul eder (en yenisi); biz de bu kadarını tutarız. */
export const REJECTED_MAX = 50;

export interface SuggestState {
  /** Henüz karara bağlanmamış öneriler, sırayla; ilk `PAGE` tanesi gösterilir. */
  pending: MaterialSuggestion[];
  /** Reddedilen adlar, eskiden yeniye. */
  rejected: string[];
}

export const EMPTY: SuggestState = { pending: [], rejected: [] };

const key = (eventId: Uuid) => `ekiptakip.suggest.${eventId}`;
const memory = new Map<string, SuggestState>();

/** Karşılaştırma anahtarı: büyük/küçük harf ve noktalama farkı yok sayılır. */
export const norm = (s: string) => s.toLocaleLowerCase("tr").replace(/[^\p{L}\p{N}]/gu, "");

function valid(v: unknown): v is SuggestState {
  if (typeof v !== "object" || v === null) return false;
  const o = v as { pending?: unknown; rejected?: unknown };
  return Array.isArray(o.rejected) && o.rejected.every((x) => typeof x === "string")
    && Array.isArray(o.pending)
    && o.pending.every((p) => typeof p === "object" && p !== null && typeof (p as MaterialSuggestion).name === "string"
      && typeof (p as MaterialSuggestion).description === "string");
}

export function load(eventId: Uuid): SuggestState {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(key(eventId));
  } catch {
    // depolama erişilemiyor (özel pencere): bellekteki kopya
    return memory.get(key(eventId)) ?? EMPTY;
  }
  try {
    const v: unknown = raw === null ? null : JSON.parse(raw);
    if (valid(v)) return v;
  } catch {
    // bozuk JSON: boş
  }
  return EMPTY;
}

export function save(eventId: Uuid, s: SuggestState): void {
  memory.set(key(eventId), s);
  try {
    sessionStorage.setItem(key(eventId), JSON.stringify(s));
  } catch {
    // özel pencere: yalnız bellekte
  }
}

/** Yeni parti: zaten listede ya da reddedilenlerde olanlar ve bekleyenlerle aynı adlılar elenir. */
export function withBatch(s: SuggestState, batch: MaterialSuggestion[]): SuggestState {
  const seen = new Set([...s.pending.map((p) => norm(p.name)), ...s.rejected.map(norm)]);
  const fresh = batch.filter((b) => {
    const k = norm(b.name);
    return k !== "" && !seen.has(k) && seen.add(k);
  });
  return { ...s, pending: [...s.pending, ...fresh] };
}

/** Kabul ya da ret sonrası öneri bekleyenlerden çıkar; ret ayrıca reddedilenlere eklenir. */
export function resolve(s: SuggestState, name: string, rejected: boolean): SuggestState {
  const k = norm(name);
  return {
    pending: s.pending.filter((p) => norm(p.name) !== k),
    rejected: rejected ? [...s.rejected, name].slice(-REJECTED_MAX) : s.rejected,
  };
}

/** Gösterilecek üçlü: bekleyenin başı, kalem listesinde artık olan adlar atlanır. */
export function visible(s: SuggestState, existing: string[]): MaterialSuggestion[] {
  const have = new Set(existing.map(norm));
  return s.pending.filter((p) => !have.has(norm(p.name))).slice(0, PAGE);
}

/** Etkinlik başına oturum durumu. */
export function useSuggestStore(eventId: Uuid): [SuggestState, (f: (s: SuggestState) => SuggestState) => void] {
  const [state, setState] = useState<SuggestState>(() => load(eventId));
  const update = useCallback((f: (s: SuggestState) => SuggestState) => {
    setState((cur) => {
      const next = f(cur);
      save(eventId, next);
      return next;
    });
  }, [eventId]);
  return [state, update];
}
