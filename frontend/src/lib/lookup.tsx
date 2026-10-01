// `/api/meta` sozlugunun kolay erisimi: kimlik -> ad, renk, yol. Yanitlar
// yalniz kimlik tasidigi icin her ekran bunu kullanir.

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Meta, MetaNode, MetaPillar, MetaTeam, MetaUser, Uuid } from "../api/types";

export interface Lookup {
  meta: Meta;
  me: MetaUser;
  user: (id: Uuid | null | undefined) => MetaUser | undefined;
  team: (id: Uuid | null | undefined) => MetaTeam | undefined;
  node: (id: Uuid | null | undefined) => MetaNode | undefined;
  /** Kokten dugume adlar, dugum dahil. */
  path: (id: Uuid) => string[];
  can: (scope: string) => boolean;
  pillar: (id: Uuid | null | undefined) => MetaPillar | undefined;
  /** Kayit acilabilecek birimler: aktif dugumler (agac yalniz yapi, spec/22). */
  units: MetaNode[];
  /** Secilebilir pillar'lar: aktif olanlar, sort_order sirasiyla. */
  pillars: MetaPillar[];
  /** Sıradan takimlar: bir pillar'in OZEL takimi olmayanlar. */
  plainTeams: MetaTeam[];
}

const Ctx = createContext<Lookup | null>(null);

export function LookupProvider({ meta, children }: { meta: Meta; children: ReactNode }) {
  const value = useMemo<Lookup>(() => {
    const users = new Map(meta.users.map((u) => [u.id, u]));
    const teams = new Map(meta.teams.map((t) => [t.id, t]));
    const nodes = new Map(meta.nodes.map((n) => [n.id, n]));
    const pillars = new Map(meta.pillars.map((p) => [p.id, p]));
    const me: MetaUser = users.get(meta.me.id) ?? {
      id: meta.me.id,
      name: "?",
      color: null,
      is_admin: meta.me.is_admin,
      last_seen_at: null,
    };
    const path = (id: Uuid): string[] => {
      const out: string[] = [];
      let cur = nodes.get(id);
      while (cur !== undefined) {
        out.unshift(cur.name);
        cur = cur.parent_id === null ? undefined : nodes.get(cur.parent_id);
      }
      return out;
    };
    return {
      meta,
      me,
      user: (id) => (id == null ? undefined : users.get(id)),
      team: (id) => (id == null ? undefined : teams.get(id)),
      node: (id) => (id == null ? undefined : nodes.get(id)),
      path,
      can: (scope) => meta.me.is_admin || meta.me.scopes.includes(scope),
      pillar: (id) => (id == null ? undefined : pillars.get(id)),
      units: meta.nodes.filter((n) => n.is_active),
      pillars: meta.pillars.filter((p) => p.is_active),
      plainTeams: meta.teams.filter((t) => t.pillar_id === null),
    };
  }, [meta]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLookup(): Lookup {
  const v = useContext(Ctx);
  if (v === null) throw new Error("LookupProvider yok");
  return v;
}
