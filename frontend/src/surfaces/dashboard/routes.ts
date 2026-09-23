// dashboard. rotalari — TIPLI birlik (spec/16 §3.2). Yeni rota eklenip
// Dashboard.tsx'teki switch'e yazilmazsa `never` denetimi derlemeyi dusurur.
// Baglanti metni elle yazilmaz: href(route).

import type { RecordQuery } from "../../api/hooks";
import type { Uuid } from "../../api/types";

export type Route =
  | { name: "home" }
  | { name: "tasks"; query: RecordQuery }
  | { name: "record"; id: Uuid }
  | { name: "teams" }
  | { name: "team"; id: Uuid }
  | { name: "tree" }
  | { name: "admin" }
  | { name: "notFound" };

export const QUERY_KEYS = [
  "kind", "status", "priority", "team", "person", "node", "pillar", "search", "quick", "sort",
] as const satisfies readonly (keyof RecordQuery)[];

export function parse(url: URL): Route {
  const seg = url.pathname.split("/").filter(Boolean);
  const [a, b] = seg;
  if (seg.length === 0) return { name: "home" };
  if (a === "tasks" && seg.length === 1) {
    const query: RecordQuery = {};
    for (const k of QUERY_KEYS) {
      const v = url.searchParams.get(k);
      if (v !== null && v !== "") query[k] = v;
    }
    return { name: "tasks", query };
  }
  if (a === "tasks" && b !== undefined && seg.length === 2) return { name: "record", id: b };
  if (a === "teams" && seg.length === 1) return { name: "teams" };
  if (a === "teams" && b !== undefined && seg.length === 2) return { name: "team", id: b };
  if (a === "outcome-tree" && seg.length === 1) return { name: "tree" };
  if (a === "admin" && seg.length === 1) return { name: "admin" };
  return { name: "notFound" };
}

export function href(r: Route): string {
  switch (r.name) {
    case "home":
    case "notFound":
      return "/";
    case "tasks": {
      const u = new URLSearchParams();
      for (const k of QUERY_KEYS) {
        const v = r.query[k];
        if (v !== undefined && v !== "") u.set(k, v);
      }
      const q = u.toString();
      return q === "" ? "/tasks" : `/tasks?${q}`;
    }
    case "record":
      return `/tasks/${r.id}`;
    case "teams":
      return "/teams";
    case "team":
      return `/teams/${r.id}`;
    case "tree":
      // Python'daki adres ve modul/pin kimligi (`models/module.rs`) ayni.
      return "/outcome-tree";
    case "admin":
      return "/admin";
  }
}
