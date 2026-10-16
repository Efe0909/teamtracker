// dashboard. rotalari — TIPLI birlik (spec/16 §3.2). Yeni rota eklenip
// Dashboard.tsx'teki switch'e yazilmazsa `never` denetimi derlemeyi dusurur.
// Baglanti metni elle yazilmaz: href(route).

import type { RecordQuery } from "../../api/hooks";
import type { Uuid } from "../../api/types";
import { profileHref, profileTab, safeReturn, type ProfileTab } from "../../features/profile/tabs";

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
  | { name: "notifications" }
  | { name: "admin" }
  // Yonetim > Veri isleme ve LLM: profil ve gorev ayrintisi tam sayfa (KNOW-112).
  | { name: "llmProfile"; id: Uuid }
  | { name: "llmTask"; feature: string }
  // Profil ve ayarlar (spec/82): bolum ve donus adresi URL'de.
  | { name: "profile"; tab: ProfileTab; ret: string | null }
  // Maliye (spec/81 §10): bolum + (fatura/dosya) kimligi; `edit` faturayi duzeltir.
  | { name: "finance"; section: FinanceSection; id: string | null }
  | { name: "notFound" };

export type FinanceSection =
  | "home" | "invoices" | "new" | "edit" | "mine" | "claims" | "ledger" | "materials" | "wall" | "vendors"
  | "budget" | "analysis" | "recurring" | "templates";

export const QUERY_KEYS = [
  "kind", "status", "done", "priority", "team", "person", "node", "pillar", "search", "quick",
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
  if (a === "notifications" && seg.length === 1) return { name: "notifications" };
  if (a === "admin" && seg.length === 1) return { name: "admin" };
  if (a === "finance") {
    const f = (section: FinanceSection, id: string | null = null): Route => ({ name: "finance", section, id });
    if (seg.length === 1) return f("home");
    if (b === "invoices" && seg.length === 2) return f("invoices");
    if (b === "invoices" && seg[2] === "new" && seg.length === 3) return f("new");
    if (b === "invoices" && seg[2] !== undefined && seg[3] === "edit" && seg.length === 4) return f("edit", seg[2]);
    if (b === "invoices" && seg[2] !== undefined && seg.length === 3) return f("invoices", seg[2]);
    if (b === "mine" && seg.length === 2) return f("mine");
    if (b === "mine" && seg[2] !== undefined && seg.length === 3) return f("mine", seg[2]);
    if (b === "claims" && seg.length === 2) return f("claims");
    if (b === "claims" && seg[2] !== undefined && seg.length === 3) return f("claims", seg[2]);
    if (b === "ledger" && seg.length === 2) return f("ledger");
    if (b === "materials" && seg.length === 2) return f("materials");
    if (b === "wall" && seg.length === 2) return f("wall");
    if (b === "vendors" && seg.length === 2) return f("vendors");
    if (b === "vendors" && seg[2] !== undefined && seg.length === 3) return f("vendors", seg[2]);
    if (b === "budget" && seg.length === 2) return f("budget");
    if (b === "analysis" && seg.length === 2) return f("analysis");
    if (b === "recurring" && seg.length === 2) return f("recurring");
    if (b === "templates" && seg.length === 2) return f("templates");
    if (b === "templates" && seg[2] !== undefined && seg.length === 3) return f("templates", seg[2]);
  }
  if (a === "profile" && seg.length === 1) {
    return { name: "profile", tab: profileTab(url.searchParams.get("tab")), ret: safeReturn(url.searchParams.get("return")) };
  }
  const [, , c, d] = seg;
  if (a === "admin" && b === "llm" && c === "profiles" && d !== undefined && seg.length === 4) return { name: "llmProfile", id: d };
  if (a === "admin" && b === "llm" && c === "tasks" && d !== undefined && seg.length === 4) return { name: "llmTask", feature: d };
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
    case "notifications":
      return "/notifications";
    case "admin":
      return "/admin";
    case "llmProfile":
      return `/admin/llm/profiles/${r.id}`;
    case "llmTask":
      return `/admin/llm/tasks/${r.feature}`;
    case "profile":
      return profileHref(r.tab, r.ret);
    case "finance":
      switch (r.section) {
        case "home":
          return "/finance";
        case "new":
          return "/finance/invoices/new";
        case "edit":
          return `/finance/invoices/${r.id ?? ""}/edit`;
        case "invoices":
        case "mine":
        case "claims":
        case "vendors":
        case "templates":
          return r.id === null ? `/finance/${r.section}` : `/finance/${r.section}/${r.id}`;
        case "ledger":
        case "materials":
        case "wall":
        case "budget":
        case "analysis":
        case "recurring":
          return `/finance/${r.section}`;
      }
  }
}
