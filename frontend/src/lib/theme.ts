// Tema secimi: light (varsayilan) · dark · system. <html data-theme> tek
// anahtar; renkler tokens.css'te light-dark() ile. Secim kisisel kolaylik —
// localStorage'da, sunucuya gitmez. Ilk boyamadan once index.html'deki satir
// ici betik ayni anahtari okur (yanip sonme olmasin).

import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark" | "system";
export const THEMES: Theme[] = ["light", "dark", "system"];
const KEY = "ekiptakip.theme";

function read(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === "dark" || v === "system" ? v : "light";
  } catch {
    return "light";
  }
}

const subs = new Set<() => void>();

export function setTheme(t: Theme): void {
  document.documentElement.dataset["theme"] = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // ozel pencere: bu oturumluk kalir
  }
  subs.forEach((f) => f());
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    read,
    () => "light",
  );
}
