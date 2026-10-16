// Profil sayfasinin bolumleri ve adres kurallari (spec/82 P2). Iki yuzun
// routes.ts'i buradan okur; bilesen kodu cekmesin diye ayri dosya.

import type { IconName } from "../../ui/icons";

export type ProfileTab = "info" | "accounts" | "notifications" | "appearance" | "privacy";

export const PROFILE_TABS: readonly { tab: ProfileTab; label: string; icon: IconName }[] = [
  { tab: "info", label: "Profilim", icon: "user" },
  { tab: "accounts", label: "Hesap numaralarım", icon: "wallet" },
  { tab: "notifications", label: "Bildirimler", icon: "bell" },
  { tab: "appearance", label: "Görünüm", icon: "sun" },
  { tab: "privacy", label: "Gizlilik ve veri", icon: "lock" },
];

export function profileTab(v: string | null): ProfileTab {
  return PROFILE_TABS.find((t) => t.tab === v)?.tab ?? "info";
}

/** `?return=` yalniz uygulama ici goreli yol olabilir: acik yonlendirme yok. */
export function safeReturn(v: string | null): string | null {
  return v !== null && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : null;
}

/** `/profile?tab=…&return=…`; varsayilan bolum adreste yazilmaz. */
export function profileHref(tab: ProfileTab, ret: string | null): string {
  const u = new URLSearchParams();
  if (tab !== "info") u.set("tab", tab);
  if (ret !== null) u.set("return", ret);
  const q = u.toString();
  return q === "" ? "/profile" : `/profile?${q}`;
}
