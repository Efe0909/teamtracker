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
/** Hangi turun nerede olabilecegini kok semasi soyler (Rust refdata.rs, spec/74). */
export type NodeType =
  | "cell" | "machine" | "task" | "step" | "operational" | "generic"
  | "option" | "checkpoint" | "widget" | "location" | "outcome";
/** Cocuklara izin: leaf = cocuk yok; list = butun cocuklar ayni turde; tree = serbest. */
export type Shape = "leaf" | "list" | "tree";
/** Gocle dogan kok ve bolumlerin sabit anahtarlari: kod bunlari adla degil bununla bulur.
 *  `event_management` kok; `event_types` / `event_locations` / `event_outcomes` onun bolumleri.
 *  Dugumun `root_key`'i en yakin key'li atasidir (kendisi dahil). */
export type RootKey = "units" | "event_management" | "event_types" | "event_locations" | "event_outcomes";
export type TeamRole = "lead" | "mentor" | "member";

// --- /api/meta -------------------------------------------------------------

export interface MetaRole {
  id: Uuid;
  name: string;
  color: string;
}

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
  /** Ekip sayfasinda gosterilen roller; yetki ayrintisi tasimaz. */
  roles: MetaRole[];
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
  /** Yalniz kokte. */
  key: RootKey | null;
  /** Kokunun key'i: seciciler kok basina suzer. */
  root_key: RootKey | null;
  shape: Shape;
  /** checkpoint: {offset_days}, widget: {widget}, slot: {slot: "steps"|"widgets"}. */
  attrs: { offset_days?: number; widget?: WidgetType; slot?: "steps" | "widgets" };
}

export interface Meta {
  me: {
    id: Uuid; is_admin: boolean; scopes: string[]; team_ids: Uuid[]; profile_complete: boolean;
    /** Secicilerdeki favori dugumler (spec/74 §6). */
    favorite_nodes: Uuid[];
  };
  users: MetaUser[];
  teams: MetaTeam[];
  /** sort_order, sonra ad; pasifler de gelir. */
  pillars: MetaPillar[];
  nodes: MetaNode[];
  external_off?: ("decision" | "resend" | "push" | "suggest")[];
  /** Manifest (backend/manifest.json): uygulama surumu ve gelistirici e-postasi. */
  version?: string;
  contact_email?: string;
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
  closing_note: string | null;
}

export interface Action {
  id: Uuid;
  title: string;
  status: ActionStatus;
  owner_id: Uuid | null;
  due_date: IsoDate | null;
  created_at: IsoTime;
  resolved_at: IsoTime | null;
  closing_note: string | null;
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

/** Karar modelinin bir degerlendirmesi (spec/76). `noul` = evet olasiligi. */
export interface Quality {
  outcome: "pass" | "low" | "skipped";
  model?: string;
  provider?: string;
  answers?: Record<string, { type: string; noul: number }>;
  reasons: string[];
}

/** PATCH /api/records/{id}: kayit + (baslik, aciklama ya da kapanista) kalite karari. */
export interface RecordPatched extends RecordDetail {
  quality?: Quality;
}

// --- etkinlikler (Rust api/events.rs, spec/73) --------------------------------

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
  /** Etkinlik Turleri'ndeki `option` dugumu (adi meta.nodes'tan). */
  kind_id: Uuid;
  status: EventStatus;
  priority: Priority;
  owner_id: Uuid | null;
  date: IsoDate | null;
  /** "HH:MM" */
  start_time: string | null;
  /** Etkinlik Yerleri'ndeki `location`; yoksa `place` metni (kampus disi / tek seferlik). */
  location_id: Uuid | null;
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
  /** Baglanti ya da telefon. */
  contact: string;
  /** Telefonda kisi/firma adi; baglantida null. */
  name: string | null;
  price: number | null;
  arrival_date: IsoDate | null;
  /** Teklifin kademesi (kalemin butcesine gore): 0 $, 1 $$, 2 $$$. Bos: butce ya da fiyat yok. */
  overage_level: number | null;
}

export interface Material {
  id: Uuid;
  name: string;
  notes: string | null;
  type: MaterialType;
  priority: Priority;
  /** Tamamlanan adim sayisi (0..3): Gerekli mi? · Tedarikci bulundu · Onaylandi. */
  state: number;
  /** Adet; birim fiyat tekliften turetilir, saklanmaz. */
  qty: number;
  /** "Sponsordan istendi": surec adimi degil, ayri istek. */
  has_sponsor: boolean;
  /** "Zaten var": surece girmez. */
  owned: boolean;
  /** Secilen teklif; bos ve `sponsor_chosen` ise sponsor secildi, ikisi de bos ise secim yok. */
  chosen_provider_id: Uuid | null;
  sponsor_chosen: boolean;
  sponsor_qty: number | null;
  sponsor_date: IsoDate | null;
  /** Sponsorluk kaydinin aciklamasina islendi mi. */
  in_sponsor_record: boolean;
  /** Teslim alindi (yalniz onayli kalem). */
  delivered: boolean;
  /** Yalniz maliye incelemesi; widget onayi satin alindi demek DEGIL. Doluyken tedarik donar. */
  purchased: boolean;
  purchased_at: IsoTime | null;
  created_by: Uuid | null;
  updated_at: IsoTime;
  /** Kalem butcesi (TL); bos: girilmemis. */
  budget: number | null;
  /** Kademe: 0 $ (butce icinde), 1 $$, 2 $$$. Bos: fiyat ya da butce yok, ya da sponsor secili. */
  overage_level: number | null;
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
  kind_id: Uuid;
  unit_id: Uuid;
  date?: IsoDate;
  priority?: Priority;
  description: string;
  quality_override?: boolean;
}

export type EventPatch =
  | { field: "title"; value: string }
  | { field: "status"; value: EventStatus }
  | { field: "priority"; value: Priority }
  | { field: "owner_id"; value: Uuid | null }
  | { field: "date"; value: IsoDate | null }
  | { field: "start_time"; value: string | null }
  /** Listeden yer; secilince metin yer temizlenir. */
  | { field: "location_id"; value: Uuid | null }
  /** Serbest metin yer ("Diger…"); yazilinca liste yeri temizlenir. */
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
  /** Etkinlik Kazanimlari'ndan secilenler (DB'de `event_otf_outcomes`, n:m).
   *  `outcomes` alani yalniz listede olmayan serbest metin; Word'de ikisi birlesir. */
  outcome_ids: Uuid[];
  /** "Formu gozden gecirdim" — yalniz PUT'ta; kopyayla dolan formun kilidini acar. */
  reviewed?: boolean;
}

export interface OtfOutcomeOption {
  id: Uuid;
  name: string;
  /** Benzer kazanimlari ayirt etmek icin (Veri Yonetimi'nde yazilir). */
  description: string | null;
  /** Pasif ama formda secili kalanlar da listelenir. */
  is_active: boolean;
}

export interface OtfView extends OtfInput {
  /** Secilebilir kazanimlar, agac sirasinda. */
  outcome_options: OtfOutcomeOption[];
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

/** Yapay zekâ önerisi (spec/79 §9): ad + açıklama; sayı yok. Kabulde kalem olur (açıklama = not). */
export interface MaterialSuggestion {
  name: string;
  description: string;
}

export interface MaterialSuggestions {
  items: MaterialSuggestion[];
  batch_id: Uuid;
}

export interface MaterialPatch {
  name?: string;
  notes?: string | null;
  type?: MaterialType;
  priority?: Priority;
  state?: number;
  qty?: number;
  has_sponsor?: boolean;
  sponsor_qty?: number | null;
  sponsor_date?: IsoDate | null;
  /** Teklif id'si, `"sponsor"` ya da `null` (secimi kaldir). */
  chosen?: Uuid | "sponsor" | null;
  owned?: boolean;
  delivered?: boolean;
  budget?: number | null;
}

export interface ProviderPatch {
  contact?: string;
  name?: string | null;
  price?: number | null;
  arrival_date?: IsoDate | null;
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
export type RecordPatch = (
  | { field: "status"; value: RecordStatus }
  | { field: "priority"; value: Priority }
  | { field: "owner_id"; value: Uuid | null }
  | { field: "team_id"; value: Uuid | null }
  | { field: "pillar_id"; value: Uuid | null }
  | { field: "unit_id"; value: Uuid }
  | { field: "due_date"; value: IsoDate | null }
  | { field: "title"; value: string }
  | { field: "description"; value: string | null }
  | { field: "access_mode"; value: AccessMode }
) & {
  closing_note?: string;
  quality_override?: boolean;
  /** Kullanicinin GORDUGU deger; alan baska biri tarafindan degistiyse 409 `stale_field`.
   *  Verilmezse kancada onbellekteki kayittan doldurulur (`usePatchRecord`). */
  base?: unknown;
};

export type ActionPatch = (
  | { field: "status"; value: ActionStatus }
  | { field: "owner_id"; value: Uuid | null }
  | { field: "due_date"; value: IsoDate | null }
  | { field: "title"; value: string }
) & { closing_note?: string; quality_override?: boolean };

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
  quality_override?: boolean;
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

export interface InboxChat {
  chat_id: Uuid;
  title: string;
  kind: "team" | "record";
  last_message: string | null;
  last_actor_id: Uuid | null;
  record_id: Uuid | null;
  team_id: Uuid | null;
  can_post: boolean;
  updated_at: IsoTime | null;
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
  key: RootKey | null;
  root_key: RootKey | null;
  shape: Shape;
  attrs: MetaNode["attrs"];
  description: string | null;
  is_active: boolean;
  depth: number;
  child_count: number;
  /** root = kok (yalniz ad/aciklama), operational = kod slotu (yalniz ad/aciklama). */
  locked: "root" | "operational" | null;
  can_edit: boolean;
  /** Altina eklenebilecek turler (bos = eklenemez). `child_fixed`: tur ve shape
   *  sunucudan, formda tur secimi yok. */
  child_types: NodeType[];
  child_fixed: boolean;
  can_hard_delete: boolean;
  /** Reddetmeyen isaretler: missing_slot, late_checkpoint, unknown_widget, unknown_slot, invalid_attrs. */
  warnings: string[];
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
  color: string;
  scopes: string[];
  node_ids: Uuid[];
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

/** Kokler yalniz gocle dogar; yerlesim kurali dugum basina (`child_types`). */
export interface TreeView {
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

/** Kok yaratilmaz (yalniz goc). `child_fixed` ebeveynde tur/shape verilmez. */
export interface NewNode {
  name: string;
  node_type?: NodeType;
  parent_id: Uuid;
  description: string | null;
  shape?: Shape;
  attrs?: MetaNode["attrs"];
}

/** Verilmeyen alan degismez; `description` null = sil. Kok ve slotta yalniz ad/aciklama. */
export interface NodePatch {
  name?: string;
  node_type?: NodeType;
  description?: string | null;
  parent_id?: Uuid;
  is_active?: boolean;
  shape?: Shape;
  attrs?: MetaNode["attrs"];
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

// --- kalite kapisi ayarlari (Rust api/quality.rs, spec/76) --------------------

export interface QuestionCfg {
  instructions: string;
  yes: string;
  no: string;
  /** Evet olasiligi bunun altindaysa metin zayif. */
  min: number;
}

/** Soru adlari sabit: specific, context, closing_justified. */
export interface QualityConfig {
  questions: Record<string, QuestionCfg>;
}

export interface QualityView {
  config: QualityConfig;
  defaults: QualityConfig;
  customized: boolean;
  updated_at: string | null;
  updated_by: Uuid | null;
  /** false: anahtar yok ya da manifest'te kapali; "Dene" bos doner. */
  service_on: boolean;
}

// --- Yonetim > Veri isleme ve LLM (Rust api/llm.rs + llm_usage.rs, spec/79 §11) ----

/** Temizleme kurallari (`llm_config`, spec/79 §4). */
export interface LlmRules {
  patterns: boolean;
  known_names: boolean;
  capitalized: boolean;
}

export interface LlmConfig {
  free_text_allowed: boolean;
  rules: LlmRules;
}

export interface LlmConfigView {
  config: LlmConfig;
  defaults: LlmConfig;
  customized: boolean;
  updated_at: string | null;
  updated_by: Uuid | null;
}

export type LlmFeature = "material_suggestions" | "quality_gate";
export type LlmStatus = "ok" | "limit" | "http" | "timeout" | "network" | "parse" | "schema";

export type LlmEndpoint = "chat" | "decisions";

/** Profil parametreleri (satirdaki ham hali); yoksa uc turunun varsayilani. */
export interface LlmParams {
  max_tokens?: number;
  temperature?: number;
  timeout_ms?: number;
  reasoning_off?: boolean;
}

/** Profil + gorev birlesimi (gecerli ayar). */
export interface LlmEffective {
  profile_id: Uuid | null;
  profile_name: string;
  model: string;
  max_tokens: number;
  temperature: number | null;
  timeout_ms: number;
  reasoning_off: boolean;
  batch: number;
  enabled: boolean;
  store_bodies: boolean;
  /** 0 = koddaki istem. */
  prompt_version: number;
}

/** Profil: model + parametre + dolar limitleri; gorevler buna baglanir. */
export interface LlmProfileView {
  id: Uuid;
  name: string;
  endpoint: LlmEndpoint;
  model: string;
  params: LlmParams;
  effective: LlmEffective;
  tested_at: string | null;
  created_at: string;
  updated_at: string;
  updated_by: Uuid | null;
  /** Bu profile bagli gorevler (sozlesme anahtarlari). */
  used_by: LlmFeature[];
  limits: LlmLimit[];
  service_on: boolean;
}

export interface LlmProfileIn {
  name: string;
  model: string;
  params: LlmParams;
}

/** Gorev: koddaki sozlesme + istem + hangi profil. */
export interface LlmTaskView {
  feature: LlmFeature;
  label: string;
  endpoint: LlmEndpoint;
  has_prompt: boolean;
  has_batch: boolean;
  profile: { id: Uuid; name: string; model: string } | null;
  /** Satirdaki parti (null = varsayilan). */
  batch: number | null;
  effective: LlmEffective;
  updated_at: string | null;
  updated_by: Uuid | null;
  service_on: boolean;
  sample_input: unknown;
}

export interface LlmTaskIn {
  profile_id: Uuid;
  batch?: number;
  enabled: boolean;
  store_bodies: boolean;
}

/** Dene: bir gorevi bir profille; model/params/batch/prompt_version taslak olabilir. */
export interface LlmTryIn {
  feature: LlmFeature;
  profile_id: Uuid;
  model?: string;
  params?: LlmParams;
  batch?: number;
  prompt_version?: number;
  input: unknown;
}

export interface LlmTrace {
  call_id: Uuid | null;
  status: LlmStatus;
  http_status: number | null;
  error: string | null;
  ms: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cost_usd: number | null;
  or_gen_id: string | null;
  asked: number | null;
  kept: number | null;
  outcome: string | null;
}

/** "Dene" cevabi: tam iz yalniz burada, saklanmaz. */
export interface LlmTryOut {
  ok: boolean;
  model: string;
  trace: LlmTrace | null;
  output: unknown;
  request: unknown;
  raw: string | null;
}

export interface LlmPromptVersion {
  version: number;
  body: string;
  created_by: Uuid | null;
  created_at: string;
}

export interface LlmPromptsView {
  feature: LlmFeature;
  active: number;
  code_default: string;
  versions: LlmPromptVersion[];
}

export interface LlmLimit {
  id: Uuid;
  profile_id: Uuid;
  profile_name: string;
  window_minutes: number;
  usd: number;
  spent: number;
  created_at: string;
}

export interface LlmDayRow {
  day: IsoDate;
  feature: string;
  model: string;
  calls: number;
  errors: number;
  limited: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  unpriced: number;
  ms_total: number;
}

export interface LlmUsageView {
  from: IsoDate;
  to: IsoDate;
  /** Bu gunden onceki satirlar ozetten: kisi kirilimi yok. */
  boundary: IsoDate;
  rows: LlmDayRow[];
  by_user: { user_id: Uuid | null; calls: number; errors: number; cost_usd: number }[];
}

export interface LlmCall {
  id: Uuid;
  created_at: string;
  feature: string;
  model: string;
  user_id: Uuid | null;
  event_id: Uuid | null;
  is_try: boolean;
  prompt_version: number | null;
  status: LlmStatus;
  http_status: number | null;
  error: string | null;
  ms: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cost_usd: number | null;
  or_gen_id: string | null;
  batch_id: Uuid | null;
  asked: number | null;
  kept: number | null;
  outcome: string | null;
  has_body: boolean;
}

export interface LlmCallsView {
  rows: LlmCall[];
  total: number;
  next: string | null;
}

export interface LlmCallDetail extends LlmCall {
  request: unknown;
  response: string | null;
}

export interface LlmStatusView {
  key_configured: boolean;
  external_off: string[];
  services: { feature: LlmFeature; label: string; service: string; on: boolean; enabled: boolean }[];
  calls: number;
  bodies: number;
  daily_rows: number;
  oldest_call: string | null;
  size_bytes: number;
  retention_days: number;
  body_ttl_days: number;
  boundary: IsoDate;
}

export interface LlmKeyView {
  off: boolean;
  error: boolean;
  fetched_at: string | null;
  data: {
    limit: number | null;
    limit_remaining: number | null;
    limit_reset: string | null;
    usage: number | null;
    usage_daily: number | null;
    usage_weekly: number | null;
    usage_monthly: number | null;
    is_free_tier: boolean | null;
  } | null;
}

export interface LlmModelInfo {
  id: string;
  name: string;
  context_length: number | null;
  /** USD / 1M jeton; null = onceden bilinmiyor. */
  prompt_per_m: number | null;
  completion_per_m: number | null;
  structured_outputs: boolean;
  response_format: boolean;
  reasoning: boolean;
}

export interface LlmModelsView {
  error: boolean;
  fetched_at: string | null;
  models: LlmModelInfo[];
}

/** Ortak suzgec (Genel, Analiz, Cagrilar). Bos = hepsi. */
export interface LlmFilter {
  from: IsoDate;
  to: IsoDate;
  feature: string;
  model: string;
  user: string;
  status: "" | "ok" | "error" | "limit";
}
