// Kisisel arayuz tercihi (collapse, sutun genisligi): cihaza ozel, localStorage.
// Sunucuya gitmez. Ozel pencerede yazilamaz — bellekte kalir, sayfa calismaya devam eder.

import { useCallback, useState } from "react";

const PREFIX = "ekiptakip.ui.";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function useStored<T>(key: string, fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => read(key, fallback));
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(PREFIX + key, JSON.stringify(v));
      } catch {
        // ozel pencere
      }
    },
    [key],
  );
  return [value, set];
}
