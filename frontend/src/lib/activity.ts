// Sistem olayini cumleye cevirir. API yapilandirilmis olgu doner
// (`verb`, `target_label`=alan, `body`={"from","to"}); metin burada.

import type { EventStatus, FeedItem, Notice } from "../api/types";
import { ACTION_STATUS, EVENT_STATUS, formatDay, PRIORITY, STATUS, TEAM_ROLE } from "./labels";
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
      return L.pillar(s)?.name ?? "silinmiş pillar";
    case "unit_id":
      return L.node(s)?.name ?? "silinmiş düğüm";
    case "due_date":
      return formatDay(s);
    default:
      return s.length > 60 ? `${s.slice(0, 60)}…` : s;
  }
}

const EVENT_FIELD: Record<string, string> = {
  status: "Durum",
  priority: "Önem",
  owner_id: "Sorumlu",
  date: "Tarih",
  start_time: "Saat",
  place: "Yer",
  attendees: "Katılım",
  description: "Açıklama",
};

const CHECKPOINT_ACTION: Record<string, string> = {
  done: "tamamlamak",
  undone: "tamamlanmadı olarak işaretlemek",
  delete: "kaldırmak",
};

function eventValue(field: string, v: unknown, L: Lookup): string {
  if (v === null || v === undefined || v === "") return "—";
  if (field === "status") return EVENT_STATUS[String(v) as EventStatus]?.label ?? String(v);
  if (field === "date") return formatDay(String(v));
  return valueText(field, v, L, false);
}

function roleText(v: unknown): string {
  return TEAM_ROLE[String(v) as keyof typeof TEAM_ROLE] ?? "—";
}

/** Aktor adi haric cumle: "Durum: Açık → Devam". */
export function describe(item: FeedItem | Notice, L: Lookup): string {
  const field = item.target_label ?? "";
  const ch = parseChange(item.body);
  switch (item.verb) {
    case "created":
      return "kaydı açtı";
    case "quality_override":
      return `kalite uyarısına rağmen ${field === "closing_note" ? "kapanış notunu" : "metni"} gönderdi`;
    case "closing_note":
      return field === "action"
        ? `${item.subject_label ?? "Eylem"} kapatıldı: ${item.body ?? ""}`
        : `Kapattı: ${item.body ?? ""}`;
    case "field_changed":
      return ch === null
        ? `${FIELD[field] ?? field} alanını değiştirdi`
        : `${FIELD[field] ?? field}: ${valueText(field, ch.from, L, false)} → ${valueText(field, ch.to, L, false)}`;
    // Etkinlik alanlari ikizin akisina yazilir (arsiv, spec/73 §3a).
    case "event_changed": {
      const label = EVENT_FIELD[field] ?? field;
      return ch === null
        ? `etkinliğin ${label.toLocaleLowerCase("tr")} alanını değiştirdi`
        : `Etkinlik · ${label}: ${eventValue(field, ch.from, L)} → ${eventValue(field, ch.to, L)}`;
    }
    // Adim onayi (spec/73 §6): subject = adim adi, target = eylem (done/undone/delete)
    case "checkpoint_requested":
      return `“${item.subject_label ?? ""}” adımını ${CHECKPOINT_ACTION[field] ?? "değiştirmek"} için onay istedi`;
    case "checkpoint_approved":
      return `“${item.subject_label ?? ""}” adımı için isteği onayladı`;
    case "checkpoint_denied":
      return `“${item.subject_label ?? ""}” adımı için isteği reddetti`;
    case "action_added": {
      const owner = ch !== null && ch.to !== null ? ` (${valueText("owner_id", ch.to, L, true)})` : "";
      return `eylem ekledi: “${item.subject_label ?? ""}”${owner}`;
    }
    case "action_changed":
      return ch === null
        ? `“${item.subject_label ?? ""}” eylemini değiştirdi`
        : `“${item.subject_label ?? ""}” · ${FIELD[field] ?? field}: ${valueText(field, ch.from, L, true)} → ${valueText(field, ch.to, L, true)}`;
    // takim yazmalari (spec/22): subject = takim adi, target = dugum adi
    case "joined":
      return "kayda katıldı";
    case "join_requested":
      return "katılma isteği gönderdi";
    case "join_approved":
      return `${item.subject_label ?? ""} kişisinin katılma isteğini onayladı`;
    case "team_created":
      return `“${item.subject_label ?? ""}” takımını kurdu`;
    case "team_renamed":
      return ch === null
        ? "takımın adını değiştirdi"
        : `takımın adını değiştirdi: ${String(ch.from)} → ${String(ch.to)}`;
    case "team_node_linked":
      return `takımı “${item.target_label ?? ""}” birimine bağladı`;
    case "team_node_unlinked":
      return `takımın “${item.target_label ?? ""}” birimiyle bağını kopardı`;
    case "member_added":
      return `${item.subject_label ?? ""} kişisini takıma ekledi (${roleText(ch?.to)})`;
    case "member_role":
      return `${item.subject_label ?? ""} rolünü ${roleText(ch?.from)} → ${roleText(ch?.to)} yaptı`;
    case "member_removed":
      return `${item.subject_label ?? ""} kişisini takımdan çıkardı`;
    default:
      // "note" ve bilinmeyen fiiller: detay duz metin.
      return item.body ?? item.verb ?? "";
  }
}
