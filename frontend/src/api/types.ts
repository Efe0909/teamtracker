// Rust yanitlarinin tipleri (backend/src/api/*). ELLE — uc sayisi buyuyunce
// OpenAPI'den uretilecek (spec/15 "Acik"). Degisiklik iki yerde: Rust struct'i
// ve burasi. Alan adlari Rust'takiyle BIREBIR.

export type Uuid = string;
/** "2026-09-23" */
export type IsoDate = string;
/** RFC 3339 zaman damgasi */
export type IsoTime = string;

export type RecordKind = "issue" | "task";
export type RecordStatus = "open" | "in_progress" | "pending" | "closed" | "cancelled";
export type ActionStatus = "open" | "in_progress" | "closed" | "cancelled";
export type Priority = "critical" | "high" | "medium" | "low";
export type NodeType = "cell" | "machine" | "pillar" | "team" | "task" | "step" | "operational" | "generic";
export type TeamRole = "lead" | "mentor" | "member";

// --- /api/meta -------------------------------------------------------------

export interface MetaUser {
  id: Uuid;
  name: string;
  color: string | null;
  is_admin: boolean;
  last_seen_at: IsoTime | null;
}

export interface MetaTeam {
  id: Uuid;
  name: string;
  description: string | null;
  color: string | null;
  node_id: Uuid | null;
  chat_id: Uuid;
}

export interface MetaNode {
  id: Uuid;
  parent_id: Uuid | null;
  name: string;
  node_type: NodeType;
  is_active: boolean;
  depth: number;
}

export interface Meta {
  me: {
    id: Uuid;
    is_admin: boolean;
    scopes: string[];
    team_ids: Uuid[];
    /** Kayit acabilecegi birimler (dal izni). Sunucu ayni kurali POST'ta zorlar. */
    creatable_unit_ids: Uuid[];
  };
  users: MetaUser[];
  teams: MetaTeam[];
  nodes: MetaNode[];
}

// --- kayitlar --------------------------------------------------------------

export interface RecordSummary {
  id: Uuid;
  kind: RecordKind;
  title: string;
  status: RecordStatus;
  priority: Priority;
  unit_id: Uuid;
  pillar_id: Uuid | null;
  team_id: Uuid | null;
  owner_id: Uuid | null;
  due_date: IsoDate | null;
  created_at: IsoTime;
  updated_at: IsoTime;
  open_actions: number;
  action_overdue: boolean;
  messages: number;
}

export interface RecordFull {
  id: Uuid;
  unit_id: Uuid;
  pillar_id: Uuid | null;
  team_id: Uuid | null;
  chat_id: Uuid;
  kind: RecordKind;
  title: string;
  description: string | null;
  status: RecordStatus;
  priority: Priority;
  owner_id: Uuid | null;
  created_by: Uuid;
  due_date: IsoDate | null;
  created_at: IsoTime;
  updated_at: IsoTime;
}

export interface Action {
  id: Uuid;
  title: string;
  status: ActionStatus;
  owner_id: Uuid | null;
  due_date: IsoDate | null;
  created_at: IsoTime;
  resolved_at: IsoTime | null;
}

export interface RecordDetail {
  record: RecordFull;
  actions: Action[];
  participants: Uuid[];
  access: { can_edit: boolean; can_edit_deadline: boolean };
}

/** PATCH /api/records/{id} — Rust `RecordPatch`, alan basina deger tipi. */
export type RecordPatch =
  | { field: "status"; value: RecordStatus }
  | { field: "priority"; value: Priority }
  | { field: "owner_id"; value: Uuid | null }
  | { field: "team_id"; value: Uuid | null }
  | { field: "pillar_id"; value: Uuid | null }
  | { field: "unit_id"; value: Uuid }
  | { field: "due_date"; value: IsoDate | null }
  | { field: "title"; value: string }
  | { field: "description"; value: string | null };

export type ActionPatch =
  | { field: "status"; value: ActionStatus }
  | { field: "owner_id"; value: Uuid | null }
  | { field: "due_date"; value: IsoDate | null }
  | { field: "title"; value: string };

export interface NewRecord {
  kind: RecordKind;
  title: string;
  description: string | null;
  unit_id: Uuid;
  team_id: Uuid | null;
  pillar_id: Uuid | null;
  owner_id: Uuid | null;
  priority: Priority;
}

export interface NewAction {
  title: string;
  owner_id: Uuid | null;
  due_date: IsoDate | null;
}

export interface MyAction {
  id: Uuid;
  title: string;
  status: ActionStatus;
  due_date: IsoDate | null;
  record_id: Uuid;
  record_title: string;
}

// --- sohbet ----------------------------------------------------------------

export interface FeedItem {
  kind: "message" | "activity";
  id: Uuid;
  created_at: IsoTime;
  actor_id: Uuid | null;
  verb: string | null;
  subject_label: string | null;
  target_label: string | null;
  body: string | null;
  reply_to_id: Uuid | null;
  edited_at: IsoTime | null;
}

export interface Feed {
  items: FeedItem[];
  quotes: { id: Uuid; author_id: Uuid | null; body: string }[];
}

// --- ana sayfa, takimlar, bildirimler ---------------------------------------

export interface Home {
  counts: { my_open_actions: number; open_records: number; overdue_records: number; unassigned: number };
  pins: string[];
}

export interface TeamView {
  id: Uuid;
  members: { user_id: Uuid; role: TeamRole }[];
  open_records: number;
}

export interface Notice {
  kind: "message" | "activity";
  id: Uuid;
  created_at: IsoTime;
  actor_id: Uuid | null;
  verb: string | null;
  subject_label: string | null;
  target_label: string | null;
  body: string | null;
  record_id: Uuid | null;
  team_id: Uuid | null;
  title: string;
}
