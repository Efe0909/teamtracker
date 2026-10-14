// app. rotalari — tipli birlik. Mobil yuz kendi alan adinda, KOKTE (yol
// oneki yok).

import type { Uuid } from "../../api/types";
import { profileHref, profileTab, safeReturn, type ProfileTab } from "../../features/profile/tabs";

export type Route =
  | { name: "actions" }
  | { name: "teams" }
  | { name: "chats" }
  | { name: "search"; q: string }
  | { name: "notifications" }
  | { name: "record"; id: Uuid }
  | { name: "team"; id: Uuid }
  | { name: "new" }
  | { name: "profile"; tab: ProfileTab; ret: string | null }
  | { name: "notFound" };

export function parse(url: URL): Route {
  const seg = url.pathname.split("/").filter(Boolean);
  const [a, b] = seg;
  if (seg.length === 0) return { name: "actions" };
  if (seg.length === 1) {
    if (a === "search") return { name: "search", q: url.searchParams.get("q") ?? "" };
    if (a === "actions") return { name: "actions" };
    if (a === "teams") return { name: "teams" };
    if (a === "chats") return { name: "chats" };
    if (a === "notifications") return { name: "notifications" };
    if (a === "new") return { name: "new" };
    if (a === "profile") {
      return { name: "profile", tab: profileTab(url.searchParams.get("tab")), ret: safeReturn(url.searchParams.get("return")) };
    }
  }
  if (seg.length === 2 && b !== undefined) {
    if (a === "record") return { name: "record", id: b };
    if (a === "team") return { name: "team", id: b };
  }
  return { name: "notFound" };
}

export function href(r: Route): string {
  switch (r.name) {
    case "actions":
      return "/";
    case "search":
      return r.q === "" ? "/search" : `/search?q=${encodeURIComponent(r.q)}`;
    case "teams":
      return "/teams";
    case "chats":
      return "/chats";
    case "notifications":
      return "/notifications";
    case "record":
      return `/record/${r.id}`;
    case "team":
      return `/team/${r.id}`;
    case "new":
      return "/new";
    case "profile":
      return profileHref(r.tab, r.ret);
    case "notFound":
      return "/";
  }
}
