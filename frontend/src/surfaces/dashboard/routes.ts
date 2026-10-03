// dashboard. rotalari — TIPLI birlik (spec/16 §3.2). Yeni rota eklenip
// Dashboard.tsx'teki switch'e yazilmazsa `never` denetimi derlemeyi dusurur.
// Baglanti metni elle yazilmaz: href(route).

import type { RecordQuery } from "../../api/hooks";
import type { Uuid } from "../../api/types";

export type Route =
  | { name: "home" }
  | { name: "tasks"; query: RecordQuery }
  | { name: "record"; id: Uuid }
  | { name: "events"; query: EventQuery }
  | { name: "event"; id: string }
  | { name: "people" }
  | { name: "teams" }
  | { name: "team"; id: Uuid }
  | { name: "pillars" }
  | { name: "pillar"; id: Uuid }
  | { name: "tree" }
  | { name: "admin" }
  | { name: "notFound" };

export const QUERY_KEYS = [
  "kind", "status", "priority", "team", "person", "node", "pillar", "search", "quick",
] as const satisfies readonly (keyof RecordQuery)[];

/** Etkinlik listesi filtreleri — gorevlerdeki gibi URL'de (KNOW-234). */
export const EVENT_KEYS = ["tab", "kind", "priority", "person", "search"] as const;
export type EventQuery = { [K in (typeof EVENT_KEYS)[number]]?: string };

function pick<K extends string>(url: URL, keys: readonly K[]): { [P in K]?: string } {
  const q: { [P in K]?: string } = {};
  for (const k of keys) {
    const v = url.searchParams.get(k);
    if (v !== null && v !== "") q[k] = v;
  }
  return q;
}

function query<K extends string>(path: string, keys: readonly K[], q: { [P in K]?: string }): string {
  const u = new URLSearchParams();
  for (const k of keys) {
    const v = q[k];
    if (v !== undefined && v !== "") u.set(k, v);
  }
  const s = u.toString();
  return s === "" ? path : `${path}?${s}`;
}

export function parse(url: URL): Route {
  const seg = url.pathname.split("/").filter(Boolean);
  const [a, b] = seg;
  if (seg.length === 0) return { name: "home" };
  if (a === "tasks" && seg.length === 1) return { name: "tasks", query: pick(url, QUERY_KEYS) };
  if (a === "events" && seg.length === 1) return { name: "events", query: pick(url, EVENT_KEYS) };
  if (a === "events" && b !== undefined && seg.length === 2) return { name: "event", id: b };
  if (a === "tasks" && b !== undefined && seg.length === 2) return { name: "record", id: b };
  if (a === "people" && seg.length === 1) return { name: "people" };
  if (a === "teams" && seg.length === 1) return { name: "teams" };
  if (a === "teams" && b !== undefined && seg.length === 2) return { name: "team", id: b };
  if (a === "pillars" && seg.length === 1) return { name: "pillars" };
  if (a === "pillars" && b !== undefined && seg.length === 2) return { name: "pillar", id: b };
  if (a === "outcome-tree" && seg.length === 1) return { name: "tree" };
  if (a === "admin" && seg.length === 1) return { name: "admin" };
  return { name: "notFound" };
}

export function href(r: Route): string {
  switch (r.name) {
    case "home":
    case "notFound":
      return "/";
    case "tasks":
      return query("/tasks", QUERY_KEYS, r.query);
    case "record":
      return `/tasks/${r.id}`;
    case "events":
      return query("/events", EVENT_KEYS, r.query);
    case "event":
      return `/events/${r.id}`;
    case "teams":
      return "/teams";
    case "team":
      return `/teams/${r.id}`;
    case "pillars":
      return "/pillars";
    case "pillar":
      return `/pillars/${r.id}`;
    case "tree":
      // Python'daki adres ve modul/pin kimligi (`models/module.rs`) ayni.
      return "/outcome-tree";
    case "people":
      return "/people";
    case "admin":
      return "/admin";
  }
}
