// Kucuk yonlendirici: History API + useSyncExternalStore. Rotalarin TIPI
// yuzlerin routes.ts'inde (spec/16 §3.2); burasi yalniz adres cubugu.
//
// Iki gecis turu (KNOW-234):
//   navigate(href)          gercek gezinme — pushState, geri tusu doner
//   navigate(href, replace) filtre/arama — replaceState, gecmise kayit yok

import { useSyncExternalStore } from "react";

const EVENT = "ekiptakip:navigate";

function subscribe(cb: () => void): () => void {
  window.addEventListener("popstate", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("popstate", cb);
    window.removeEventListener(EVENT, cb);
  };
}

function snapshot(): string {
  return location.pathname + location.search;
}

/** Guncel yol + sorgu. Degisince bilesen yeniden cizilir. */
export function useLocation(): URL {
  const s = useSyncExternalStore(subscribe, snapshot);
  return new URL(s, location.origin);
}

export function navigate(href: string, opts: { replace?: boolean } = {}): void {
  if (href === snapshot()) return;
  if (opts.replace === true) history.replaceState(null, "", href);
  else history.pushState(null, "", href);
  window.dispatchEvent(new Event(EVENT));
  if (opts.replace !== true) window.scrollTo(0, 0);
}

/** Sol tik ve degistiricisiz: SPA gecisi. Ctrl/cmd/orta tik tarayiciya kalir. */
export function onLinkClick(e: React.MouseEvent<HTMLAnchorElement>, href: string): void {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  navigate(href);
}
