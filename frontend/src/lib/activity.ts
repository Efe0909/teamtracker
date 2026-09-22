// Sistem olayini cumleye cevirir. API yapilandirilmis olgu doner
// (`verb`, `target_label`=alan, `body`={"from","to"}); metin burada.

import type { FeedItem, Notice } from "../api/types";
import { ACTION_STATUS, formatDay, PRIORITY, STATUS } from "./labels";
import type { Lookup } from "./lookup";

const FIELD: Record<string, string> = {
  status: "Durum",
  priority: "Öncelik",
  owner_id: "Sorumlu",
  team_id: "Takım",
  pillar_id: "Pillar",
  unit_id: "Birim",
  due_date: "Son tarih",
  title: "Başlık",
  description: "Açıklama",
};

function parseChange(body: string | null): { from: unknown; to: unknown } | null {
  if (body === null) return null;
  try {
    const v: unknown = JSON.parse(body);
    if (typeof v === "object" && v !== null && "from" in v && "to" in v) return { from: v.from, to: v.to };
  } catch {
    /* duz metin detay (tohum verisindeki "note") */
  }
  return null;
}

function valueText(field: string, v: unknown, L: Lookup, action: boolean): string {
  if (v === null || v === undefined || v === "") return "—";
  const s = String(v);
  switch (field) {
    case "status":
      return action ? (ACTION_STATUS[s as keyof typeof ACTION_STATUS] ?? s) : (STATUS[s as keyof typeof STATUS] ?? s);
    case "priority":
      return PRIORITY[s as keyof typeof PRIORITY] ?? s;
    case "owner_id":
      return L.user(s)?.name ?? "silinmiş kişi";
    case "team_id":
      return L.team(s)?.name ?? "silinmiş takım";
    case "pillar_id":
    case "unit_id":
      return L.node(s)?.name ?? "silinmiş düğüm";
    case "due_date":
      return formatDay(s);
    default:
      return s.length > 60 ? `${s.slice(0, 60)}…` : s;
  }
}

/** Aktor adi haric cumle: "Durum: Açık → Devam". */
export function describe(item: FeedItem | Notice, L: Lookup): string {
  const field = item.target_label ?? "";
  const ch = parseChange(item.body);
  switch (item.verb) {
    case "created":
      return "kaydı açtı";
    case "field_changed":
      return ch === null
        ? `${FIELD[field] ?? field} alanını değiştirdi`
        : `${FIELD[field] ?? field}: ${valueText(field, ch.from, L, false)} → ${valueText(field, ch.to, L, false)}`;
    case "action_added": {
      const owner = ch !== null && ch.to !== null ? ` (${valueText("owner_id", ch.to, L, true)})` : "";
      return `eylem ekledi: “${item.subject_label ?? ""}”${owner}`;
    }
    case "action_changed":
      return ch === null
        ? `“${item.subject_label ?? ""}” eylemini değiştirdi`
        : `“${item.subject_label ?? ""}” · ${FIELD[field] ?? field}: ${valueText(field, ch.from, L, true)} → ${valueText(field, ch.to, L, true)}`;
    default:
      // "note" ve bilinmeyen fiiller: detay duz metin.
      return item.body ?? item.verb ?? "";
  }
}
