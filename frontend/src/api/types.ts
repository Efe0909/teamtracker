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
  /** Istege bagli takma ad; sohbette adin altinda gorunur. */
  nickname: string | null;
  phone: string | null;
  /** Profil fotografi (ek kimligi); yoksa bas harf. */
  avatar_id: Uuid | null;
  birth_day: number | null;
  birth_month: number | null;
  birth_year: number | null;
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
  /** Banner fotografi (ek kimligi); pillar sayfasi ozel takiminkini gosterir. */
  banner_id: Uuid | null;
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
  me: { id: Uuid; is_admin: boolean; scopes: string[]; team_ids: Uuid[]; profile_complete: boolean };
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
  /** Etkinligin ikiz kaydiysa etkinlik (spec/73 §3a). */
  event_id: Uuid | null;
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
  /** Bu kisi kaydi sabitlemis mi (Panolar widget'i). */
  pinned: boolean;
  membership: Membership;
  /** Etkinligin ikiz kaydiysa etkinlik: Etkinlik | Kayit anahtari buradan. */
  event_id: Uuid | null;
}

// --- etkinlikler (Rust api/events.rs, spec/73) --------------------------------

export type EventKind = "meeting" | "training" | "social" | "visit" | "conference";
export type EventStatus = "idea" | "planning" | "confirmed" | "done" | "cancelled";
/** Yalniz alanlari TANIMLI widget turleri. `record` tek kayitlik, digerleri tekil. */
export type WidgetType = "supplies" | "record" | "otf";
export type MaterialType = "consumable" | "equipment" | "service";

/** Liste ve ayrintinin ortak satiri. `record_ids` = kayit widget'larinin kayitlari (ikiz haric). */
export interface EventSummary {
  id: Uuid;
  /** Ikiz kayit: sohbet + arsiv. */
  record_id: Uuid;
  title: string;
  kind: EventKind;
  status: EventStatus;
  priority: Priority;
  owner_id: Uuid | null;
  date: IsoDate | null;
  /** "HH:MM" */
  start_time: string | null;
  place: string | null;
  attendees: number | null;
  description: string | null;
  created_by: Uuid | null;
  created_at: IsoTime;
  updated_at: IsoTime;
  record_ids: Uuid[];
}

export interface EventWidget {
  id: Uuid;
  type: WidgetType;
  record_id: Uuid | null;
}

export interface Checkpoint {
  id: Uuid;
  label: string;
  date: IsoDate | null;
  done: boolean;
}

export type CheckpointAction = "done" | "undone" | "delete";

/** Bekleyen onay istegi (onaylayici olmayan duzenleyen ister). */
export interface CheckpointRequest {
  id: Uuid;
  checkpoint_id: Uuid;
  user_id: Uuid;
  action: CheckpointAction;
  created_at: IsoTime;
}

export interface MaterialProvider {
  id: Uuid;
  contact: string;
  price: number | null;
  arrival_date: IsoDate | null;
}

export interface Material {
  id: Uuid;
  name: string;
  notes: string | null;
  type: MaterialType;
  priority: Priority;
  /** Tamamlanan adim sayisi. */
  state: number;
  has_sponsor: boolean;
  /** "Zaten var": surece girmez. */
  owned: boolean;
  updated_at: IsoTime;
  providers: MaterialProvider[];
}

export interface EventDetail extends EventSummary {
  participants: { user_id: Uuid; role: string | null }[];
  team_ids: Uuid[];
  checkpoints: Checkpoint[];
  widgets: EventWidget[];
  materials: Material[];
  /** Ikiz kaydi duzenleyebilir ya da `manage_events`. Diger scope'lar meta'dan. */
  can_edit: boolean;
  /** `manage_events`: checkpoint ekle/son tarih. */
  can_manage: boolean;
  /** Etkinlik sorumlusu ya da `manage_events`: adimi dogrudan isaretler/kaldirir, istekleri yanitlar. */
  can_approve: boolean;
  /** Bekleyen istekler: onaylayiciya hepsi, digerine yalniz kendisininki. */
  requests: CheckpointRequest[];
}

export interface NewEvent {
  title: string;
  kind: EventKind;
  unit_id: Uuid;
  date?: IsoDate;
  priority?: Priority;
}

export type EventPatch =
  | { field: "title"; value: string }
  | { field: "status"; value: EventStatus }
  | { field: "priority"; value: Priority }
  | { field: "owner_id"; value: Uuid | null }
  | { field: "date"; value: IsoDate | null }
  | { field: "start_time"; value: string | null }
  | { field: "place"; value: string | null }
  | { field: "attendees"; value: number | null }
  | { field: "description"; value: string | null };

/** OTF (FORM.GN.05) formu — Rust api/otf.rs. Etkinlikten gelenler (ad, tarih,
 *  baslangic saati, yer, katilimci sayisi) burada yok: dosyada etkinlikten okunur. */
export interface OtfFields {
  purpose: string | null;
  /** "HH:MM" */
  end_time: string | null;
  advisor: string | null;
  age_group: string | null;
  outcomes: string | null;
  layout_notes: string | null;
  av_notes: string | null;
  tech_notes: string | null;
  host_notes: string | null;
  care_notes: string | null;
  other_notes: string | null;
}

export interface OtfItem {
  item: string;
  /** Doluysa bolum aciklamasina "Etiket+N" olarak yazilir (universite kurali: "+" ve adet). */
  quantity: number | null;
}

export interface OtfInput extends OtfFields {
  items: OtfItem[];
  /** En cok 3 etkinlik sorumlusu, formdaki sirayla; telefon profilden. */
  contacts: Uuid[];
  /** "Formu gozden gecirdim" — yalniz PUT'ta; kopyayla dolan formun kilidini acar. */
  reviewed?: boolean;
}

export interface OtfView extends OtfInput {
  /** Kutu katalogu (tek kaynak Rust otf::SECTIONS). `key` bolumun aciklama alanini secer: `${key}_notes`. */
  catalog: { key: "layout" | "av" | "tech" | "host" | "care" | "other"; label: string; items: { key: string; label: string }[] }[];
  club_name: string;
  file_name: string;
  subject: string;
  /** Etkinlikten 3 is gunu once; tarihsiz etkinlikte null. */
  deadline: IsoDate | null;
  late: boolean;
  /** Otomatik doldurmanin kaynagi: en son kaydedilen, gozden gecirilmis baska form. */
  autofill_source: { event_id: Uuid; title: string; updated_at: IsoTime } | null;
  /** Form kopyayla dolduysa. `needs_review` iken Word indirilemez; "gozden
   *  gecirdim" ancak `edited` (kopyadan sonra en az bir alan degisti) ise. */
  review: { copied_from: Uuid | null; copied_title: string | null; needs_review: boolean; edited: boolean } | null;
}

export interface MaterialPatch {
  name?: string;
  notes?: string | null;
  type?: MaterialType;
  priority?: Priority;
  state?: number;
  has_sponsor?: boolean;
  owned?: boolean;
}

export type AccessMode = "public" | "request" | "private";

/** Erisim kipi + bu kisinin kayitla iliskisi (Rust records.rs Membership). */
export interface Membership {
  mode: AccessMode;
  /** Uye = yazma yetkisi olan her yol (admin, sorumlu, acan, katilimci, takim, dal). */
  is_member: boolean;
  /** private kayitta uye olmayan: eylem/kart/katilimci/sohbet gizli. */
  restricted: boolean;
  request: "pending" | "denied" | null;
  /** Istekleri sorumlu, acan ve admin karara baglar. */
  can_decide: boolean;
  requests: { user_id: Uuid; created_at: IsoTime }[];
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

export interface PollOption {
  label: string;
  /** Secenek fotografi (ek kimligi). */
  attachment_id?: Uuid;
}

export interface PollVote {
  user_id: Uuid;
  /** Secilen secenek siralari; tek secimlide en fazla bir, yalniz serbest cevapta bos. */
  options: number[];
  text: string | null;
  at: IsoTime | null;
}

export interface CardView {
  id: Uuid;
  card_type: string;
  /** Kodda tanimli tur mu; degilse BOZUK cizilir (KNOW-280). */
  known: boolean;
  /** `title` + turun alanlari, hepsi metin. */
  data: Record<string, string | undefined>;
  signups: { user_id: Uuid; answer: SignupAnswer; note: string | null; at: IsoTime | null }[];
  /** Yalniz oylamada (card_type "poll"). */
  options: PollOption[];
  allow_other: boolean;
  /** Olusturulurken acilan opt-in ozellikler (secenek fotosu, sayac/sure); sonradan degismez. */
  media_enabled: boolean;
  timer_enabled: boolean;
  /** Kisi birden cok secenek isaretleyebilir (opt-in, olusturulurken). */
  multiple_choice: boolean;
  /** "2026-10-02T18:00" (Turkiye saati) ya da null; `closed` sunucuda hesaplanir. */
  closes_at: string | null;
  closed: boolean;
  votes: PollVote[];
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
  | { field: "description"; value: string | null }
  | { field: "access_mode"; value: AccessMode };

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
  /** Erisim kipi; kayit sayfasindan sonra da degisir. */
  access_mode: AccessMode;
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

export type NotifyLevel = "all" | "mentions" | "none";

export interface Notice {
  kind: "message" | "activity";
  id: Uuid;
  created_at: IsoTime;
  chat_id: Uuid;
  /** Son "gordum" damgasindan yeni mi (sunucu hesaplar). */
  unread: boolean;
  actor_id: Uuid | null;
  verb: string | null;
  subject_label: string | null;
  target_label: string | null;
  body: string | null;
  record_id: Uuid | null;
  team_id: Uuid | null;
  title: string;
}

export interface NoticeList {
  items: Notice[];
  unread: number;
}

/** Iki katman: varsayilan (`level`) + sohbet basina ozel secim (`chats`). */
export interface NotifyPrefs {
  level: NotifyLevel;
  /** Sessiz saat 0-23, ikisi birlikte; null = kapali. Yalniz push'u susturur. */
  quiet_start: number | null;
  quiet_end: number | null;
  chats: Record<Uuid, NotifyLevel>;
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
  /** Bildirim ayari ozeti (yalniz gorunurluk). */
  notify_level: NotifyLevel;
  quiet_start: number | null;
  quiet_end: number | null;
  /** Anlik bildirim icin kayitli cihaz sayisi. */
  push_devices: number;
  /** Sohbet basina ozel bildirim secimi sayisi. */
  chat_overrides: number;
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
  | { op: "grant_role" | "revoke_role" | "grant_node" | "revoke_node"; value: Uuid }
  | { op: "avatar"; value: Uuid | null };

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
  /** Yuklenmis ek kimligi; null = banner'i kaldir. */
  banner_id?: Uuid | null;
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

/** Kisinin kendi profili; verilmeyen alan degismez, null = sil. */
export interface ProfilePatch {
  nickname?: string | null;
  phone?: string | null;
  birth_day?: number | null;
  birth_month?: number | null;
  birth_year?: number | null;
  avatar_id?: Uuid | null;
}

/** GET /api/admin/activity: kisi basina kullanim ozeti. */
export interface PersonUse {
  user_id: Uuid;
  last_login_at: IsoTime | null;
  last_seen_at: IsoTime | null;
  /** Son 120 gun, eskiden yeniye; kullanimsiz gunler yok. `day` = "2026-10-01". */
  /** `messages`/`changes` KATKI: gonderilen mesaj ve yazilan olay (kayit, alan,
   *  eylem, katilma, takim). `minutes` sekmenin acik kaldigi dakika. */
  days: { day: string; requests: number; minutes: number; messages: number; changes: number }[];
}
