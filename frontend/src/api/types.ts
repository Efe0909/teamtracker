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
/** Agac yalniz YAPI: takim ve pillar ayri tablolar (spec/22). */
export type NodeType = "cell" | "machine" | "task" | "step" | "operational" | "generic";
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
  chat_id: Uuid;
  /** Takimin calistigi agac dugumleri (team_nodes, N:M). */
  node_ids: Uuid[];
  /** Bu takim bir pillar'in OZEL takimiysa o pillar; sıradan takimda null. */
  pillar_id: Uuid | null;
}

/** Pillar: ozel takimi (`team_id`) uyeleri ve sohbeti tasir (spec/22). */
export interface MetaPillar {
  id: Uuid;
  name: string;
  description: string | null;
  color: string | null;
  team_id: Uuid;
  is_active: boolean;
  sort_order: number;
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
  me: { id: Uuid; is_admin: boolean; scopes: string[]; team_ids: Uuid[] };
  users: MetaUser[];
  teams: MetaTeam[];
  /** sort_order, sonra ad; pasifler de gelir. */
  pillars: MetaPillar[];
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
  cards: CardView[];
  access: { can_edit: boolean; can_edit_deadline: boolean };
}

// --- ekler ve kartlar (Rust api/attachments.rs, api/cards.rs) ---------------

export interface Attachment {
  id: Uuid;
  mime: string;
  width: number | null;
  height: number | null;
  original_name: string | null;
  /** Silinmis: mesajda mezar tasi. */
  deleted: boolean;
  can_delete: boolean;
  can_tag: boolean;
  tags: { id: Uuid; name: string }[];
}

export type SignupAnswer = "yes" | "maybe" | "no";

export interface CardView {
  id: Uuid;
  card_type: string;
  /** Kodda tanimli tur mu; degilse BOZUK cizilir (KNOW-280). */
  known: boolean;
  /** `title` + turun alanlari, hepsi metin. */
  data: Record<string, string | undefined>;
  signups: { user_id: Uuid; answer: SignupAnswer; note: string | null; at: IsoTime | null }[];
  attachments: Attachment[];
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
  /** Acilista bos kart bloklari (kart secici). */
  card_types: string[];
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
  /** mesaj kimligi -> ekleri */
  attachments: Partial<Record<Uuid, Attachment[]>>;
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

// --- veri yonetimi (/api/nodes) ---------------------------------------------

export interface TreeNode {
  id: Uuid;
  parent_id: Uuid | null;
  name: string;
  node_type: NodeType;
  description: string | null;
  is_active: boolean;
  depth: number;
  child_count: number;
  can_edit: boolean;
  can_retype: boolean;
  can_hard_delete: boolean;
  /** `teams`: kopacak takim baglari (team_nodes). Silmeyi engellemez. */
  delete_counts: { children: number; records: number; permissions: number; teams: number };
}

// --- /api/admin (yonetim paneli) -------------------------------------------

export interface AdminScopeRow {
  name: string;
  /** Dogrudan verildiyse panelden alinir; rolden geleni rol duzenlemesi goturur. */
  direct: boolean;
  via_roles: Uuid[];
}

export interface AdminPerson {
  id: Uuid;
  email: string;
  name: string;
  color: string | null;
  is_admin: boolean;
  is_active: boolean;
  last_seen_at: IsoTime | null;
  scopes: AdminScopeRow[];
  role_ids: Uuid[];
  node_ids: Uuid[];
}

export interface AdminRole {
  id: Uuid;
  name: string;
  scopes: string[];
}

export interface AdminView {
  is_admin: boolean;
  scopes: string[];
  roles: AdminRole[];
  people: AdminPerson[];
}

/** Rust `admin::UserOp`: kisi uzerinde tek islem. */
export type UserOp =
  | { op: "active" | "admin"; value: boolean }
  | { op: "grant_scope" | "revoke_scope"; value: string }
  | { op: "grant_role" | "revoke_role" | "grant_node" | "revoke_node"; value: Uuid };

export interface TreeView {
  can_add_root: boolean;
  /** Yerlesim kurali sunucuda (KNOW-241): form tur listesini buradan alir. */
  root_types: NodeType[];
  child_types: NodeType[];
  nodes: TreeNode[];
}

/** POST /api/teams ve /api/pillars ortak govde. */
export interface NewTeam {
  name: string;
  description: string | null;
  color: string | null;
}

/** Verilmeyen alan degismez; null = sil. */
export interface TeamPatch {
  name?: string;
  description?: string | null;
  color?: string | null;
}

export interface PillarPatch extends TeamPatch {
  is_active?: boolean;
  sort_order?: number;
}

export interface NewNode {
  name: string;
  node_type: NodeType;
  parent_id: Uuid | null;
  description: string | null;
}

/** Verilmeyen alan degismez; `description`/`parent_id` null = sil / koke. */
export interface NodePatch {
  name?: string;
  node_type?: NodeType;
  description?: string | null;
  parent_id?: Uuid | null;
  is_active?: boolean;
}
