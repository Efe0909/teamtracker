// Kisisel arayuz tercihi (collapse, sutun genisligi, widget sirasi): cihaza ozel,
// localStorage. Sunucuya gitmez. Ozel pencerede yazilamaz — bellekte kalir, sayfa
// calismaya devam eder. Ayni anahtari okuyan butun bilesenler AYNI degeri gorur:
// iki kart ayri kopya tutup birbirinin collapse listesini ezmesin.

import { useCallback, useSyncExternalStore } from "react";

const PREFIX = "ekiptakip.ui.";
// Son okunan ham metin + cozulmus deger: ham metin degismedikce AYNI nesne
// doner (useSyncExternalStore kararli anlik goruntu ister). localStorage
// yazilamiyorsa (ozel pencere) deger yalniz burada yasar.
const cache = new Map<string, { raw: string | null; value: unknown }>();
const listeners = new Map<string, Set<() => void>>();

function read<T>(key: string, fallback: T): T {
  let raw: string | null;
  try {
    raw = localStorage.getItem(PREFIX + key);
  } catch {
    const hit = cache.get(key);
    return hit === undefined ? fallback : (hit.value as T);
  }
  const hit = cache.get(key);
  if (hit !== undefined && hit.raw === raw) return hit.value as T;
  let value: T = fallback;
  try {
    if (raw !== null) value = JSON.parse(raw) as T;
  } catch {
    // bozuk JSON: varsayilan
  }
  cache.set(key, { raw, value });
  return value;
}

export function useStored<T>(key: string, fallback: T): [T, (v: T) => void] {
  const subscribe = useCallback(
    (fn: () => void) => {
      const set = listeners.get(key) ?? new Set();
      listeners.set(key, set);
      set.add(fn);
      return () => set.delete(fn);
    },
    [key],
  );
  const value = useSyncExternalStore(subscribe, () => read(key, fallback));
  const set = useCallback(
    (v: T) => {
      const raw = JSON.stringify(v);
      cache.set(key, { raw, value: v });
      try {
        localStorage.setItem(PREFIX + key, raw);
      } catch {
        // ozel pencere: deger cache'te kalir
      }
      listeners.get(key)?.forEach((fn) => fn());
    },
    [key],
  );
  return [value, set];
}
