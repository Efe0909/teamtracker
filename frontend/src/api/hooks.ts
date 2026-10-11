// Uc basina sorgu ve yazma kancalari (TanStack Query). Onbellek anahtarlari
// BURADA tanimli; bilesen anahtar yazmaz, kanca cagirir.
//
// Yazma uclari guncel kayit ayrintisini dondurur: `setQueryData` ile ikinci
// GET atmadan tazelenir, liste/ana sayfa gecersiz sayilir.

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ApiError, qs, request } from "./client";
import { useRealtimeUp, useTopic, type RealtimeEvent } from "./realtime";
import type {
  ActionPatch,
  AdminView,
  LlmCallDetail,
  LlmCallsView,
  LlmConfig,
  LlmConfigView,
  LlmFeature,
  LlmFeatureIn,
  LlmFeatureView,
  LlmFilter,
  LlmKeyView,
  LlmLimit,
  LlmModelsView,
  LlmParams,
  LlmPromptsView,
  LlmStatusView,
  LlmTryOut,
  LlmUsageView,
  Quality,
  QualityConfig,
  QualityView,
  Attachment,
  CheckpointAction,
  EventDetail,
  EventPatch,
  EventSummary,
  IsoDate,
  MaterialPatch,
  MaterialProvider,
  MaterialSuggestions,
  ProviderPatch,
  NewEvent,
  OtfInput,
  OtfView,
  WidgetType,
  Feed,
  InboxChat,
  Home,
  Meta,
  MyAction,
  NewAction,
  NewNode,
  NewRecord,
  NewTeam,
  NodePatch,
  NoticeList,
  NotifyLevel,
  PersonUse,
  NotifyPrefs,
  PillarPatch,
  RecordDetail,
  RecordPatched,
  RecordPatch,
  RecordSummary,
  ProfilePatch,
  TeamPatch,
  TeamRole,
  TeamView,
  TreeView,
  UserOp,
  Uuid,
} from "./types";

export const keys = {
  meta: ["meta"] as const,
  home: ["home"] as const,
  records: (q: RecordQuery) => ["records", q] as const,
  recordsAll: ["records"] as const,
  record: (id: Uuid) => ["record", id] as const,
  feed: (chat: Uuid) => ["feed", chat] as const,
  inbox: ["inbox"] as const,
  teams: ["teams"] as const,
  team: (id: Uuid) => ["team", id] as const,
  notifications: ["notifications"] as const,
  notifyPrefs: ["notify-prefs"] as const,
  adminActivity: ["admin", "activity"] as const,
  myActions: ["my-actions"] as const,
  nodes: ["nodes"] as const,
  admin: ["admin"] as const,
  quality: ["admin", "quality"] as const,
  llm: ["admin", "llm"] as const,
  tags: ["tags"] as const,
  events: ["events"] as const,
  event: (id: Uuid) => ["event", id] as const,
  otf: (id: Uuid) => ["otf", id] as const,
};

/** Rust `db/filters.rs` sozlesmesi. Gecersiz deger sunucuda sessizce duser. */
export interface RecordQuery {
  kind?: string;
  status?: string;
  priority?: string;
  team?: string;
  person?: string;
  node?: string;
  pillar?: string;
  search?: string;
  quick?: string;
  sort?: string;
  done?: "true" | "false";
  /** Yalniz benim sabitlediklerim. */
  pinned?: "true";
}

// --- okumalar --------------------------------------------------------------

export function useMeta() {
  return useQuery({ queryKey: keys.meta, queryFn: () => request<Meta>("GET", "/api/meta"), staleTime: 60_000 });
}

export function useHome() {
  return useQuery({ queryKey: keys.home, queryFn: () => request<Home>("GET", "/api/home") });
}

export function useRecords(q: RecordQuery, enabled = true) {
  return useQuery({
    queryKey: keys.records(q),
    queryFn: () => request<RecordSummary[]>("GET", `/api/records${qs({ ...q })}`),
    enabled,
    placeholderData: (prev) => prev,
  });
}

export function useRecord(id: Uuid) {
  useTopic(`record:${id}`);
  return useQuery({ queryKey: keys.record(id), queryFn: () => request<RecordDetail>("GET", `/api/records/${id}`) });
}

/** Sohbet gercek zamanli tazelenir (`chat:` konusu); soket kapaliyken yoklama
 *  geri doner. Sekme gizliyken durur (Query varsayilani). */
export function useFeed(chat: Uuid | undefined) {
  const up = useRealtimeUp();
  useTopic(chat === undefined ? undefined : `chat:${chat}`);
  return useQuery({
    queryKey: keys.feed(chat ?? ""),
    queryFn: () => request<Feed>("GET", `/api/chats/${chat ?? ""}/feed`),
    enabled: chat !== undefined,
    refetchInterval: up ? false : 15_000,
  });
}

/** Soket aciksa `lists` olayi zaten tazeler; yoklama yalniz kacirilana karsi yavas yedek. */
const SLOW_FALLBACK = 5 * 60_000;

export function useInbox() {
  const up = useRealtimeUp();
  return useQuery({
    queryKey: keys.inbox,
    queryFn: () => request<InboxChat[]>("GET", "/api/chats/inbox"),
    refetchInterval: up ? SLOW_FALLBACK : 30_000,
  });
}

export function useTeams() {
  return useQuery({ queryKey: keys.teams, queryFn: () => request<TeamView[]>("GET", "/api/teams") });
}

export function useTeam(id: Uuid) {
  return useQuery({ queryKey: keys.team(id), queryFn: () => request<TeamView>("GET", `/api/teams/${id}`) });
}

export function useNotifications() {
  const up = useRealtimeUp();
  return useQuery({
    queryKey: keys.notifications,
    queryFn: () => request<NoticeList>("GET", "/api/notifications"),
    refetchInterval: up ? SLOW_FALLBACK : 60_000,
  });
}

export function useMyActions() {
  return useQuery({ queryKey: keys.myActions, queryFn: () => request<MyAction[]>("GET", "/api/actions/mine") });
}

/** Secicilerde favori dugum (PUT ekler, DELETE cikarir); cevap guncel liste,
 *  meta onbellegine yazilir (seciciler `meta.me.favorite_nodes` okur). */
export function useNodeFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, on }: { id: Uuid; on: boolean }) =>
      request<Uuid[]>(on ? "PUT" : "DELETE", `/api/nodes/${id}/favorite`),
    onSuccess: (ids) => qc.setQueryData<Meta>(keys.meta, (m) => (m === undefined ? m : { ...m, me: { ...m.me, favorite_nodes: ids } })),
  });
}

export function useNodeTree() {
  return useQuery({ queryKey: keys.nodes, queryFn: () => request<TreeView>("GET", "/api/nodes") });
}

// --- gercek zamanli olaylar ------------------------------------------------

/** Olay yagmurunu (bir kayit yazimi: record + lists + chat) tek tazelemeye indirir.
 *  `invalidateQueries` yarim kalan istegi iptal edip bastan baslatir; ardisik
 *  olaylarda ayni sorgu bos yere defalarca cekilmesin. */
const BATCH_MS = 250;
const pending = new Map<string, { qc: QueryClient; e: RealtimeEvent }>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;

function invalidateFor(qc: QueryClient, e: RealtimeEvent): void {
  const stale = (queryKey: readonly unknown[]) => void qc.invalidateQueries({ queryKey });
  switch (e.t) {
    case "record":
      stale(keys.record(e.id));
      // Alan, eylem, kart degisikligi sohbet akisina da satir yazar.
      stale(["feed"]);
      break;
    case "chat":
      stale(keys.feed(e.id));
      break;
    case "lists":
      [keys.recordsAll, keys.home, keys.myActions, keys.inbox, keys.notifications].forEach(stale);
      break;
  }
}

/** Sunucu olayi: ilgili sorgulari bayat say (acik olanlar yeniden cekilir). */
export function onRealtimeEvent(qc: QueryClient, e: RealtimeEvent): void {
  pending.set(e.t === "lists" ? "lists" : `${e.t}:${e.id}`, { qc, e });
  flushTimer ??= setTimeout(() => {
    flushTimer = undefined;
    const batch = [...pending.values()];
    pending.clear();
    batch.forEach((b) => invalidateFor(b.qc, b.e));
  }, BATCH_MS);
}

/** Yeniden baglandi: kacirilan olaylar tekrar oynatilmaz, hepsi tazelenir. */
export function resyncAll(qc: QueryClient): void {
  void qc.invalidateQueries();
}

// --- yazmalar --------------------------------------------------------------

function afterRecordWrite(qc: QueryClient, d: RecordDetail) {
  qc.setQueryData(keys.record(d.record.id), d);
  void qc.invalidateQueries({ queryKey: keys.recordsAll });
  void qc.invalidateQueries({ queryKey: keys.feed(d.record.chat_id) });
  void qc.invalidateQueries({ queryKey: keys.home });
  void qc.invalidateQueries({ queryKey: keys.myActions });
}

/** Alan yazmasina "gordugum deger"i ekler: yazma, o alan arada baska biri
 *  tarafindan degistiyse reddedilir (son yazan sessizce kazanmaz). Cagiran
 *  `base` verdiyse (acilista goruleni korumasi gereken metin duzenleyici) ona dokunmaz. */
function withBase(qc: QueryClient, id: Uuid, p: RecordPatch): RecordPatch {
  if (p.base !== undefined) return p;
  const seen = qc.getQueryData<RecordDetail>(keys.record(id))?.record;
  // Onbellekte karsiligi olmayan alan (ornegin access_mode) kontrolsuz kalir.
  return seen !== undefined && p.field in seen ? { ...p, base: seen[p.field as keyof typeof seen] } : p;
}

export function usePatchRecord(id: Uuid) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: RecordPatch) => request<RecordPatched>("PATCH", `/api/records/${id}`, withBase(qc, id, p)),
    // Onbellege kalite girmez: GET'te yok, bayat karar kayitla yasamasin.
    onSuccess: ({ quality: _, ...d }) => afterRecordWrite(qc, d),
    // Baska biri alani degistirmis: ekrandaki bayat degeri hemen tazele.
    onError: (e) => {
      if (e instanceof ApiError && e.code === "stale_field") void qc.invalidateQueries({ queryKey: keys.record(id) });
    },
  });
}

/** Katilimci ekle (PUT) / cikar (DELETE); yanit guncel kayittir. */
export function useParticipant(recordId: Uuid) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (w: { user: Uuid; on: boolean }) =>
      request<RecordDetail>(w.on ? "PUT" : "DELETE", `/api/records/${recordId}/participants/${w.user}`),
    onSuccess: (d) => afterRecordWrite(qc, d),
  });
}

/** Sabitle (PUT) / kaldir (DELETE). */
export function usePin(recordId: Uuid) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (on: boolean) => request<RecordDetail>(on ? "PUT" : "DELETE", `/api/records/${recordId}/pin`),
    onSuccess: (d) => afterRecordWrite(qc, d),
  });
}

/** Bu kayittaki kart sirasi (yalniz benim gorunumum, sunucuda). */
export function useCardOrder(recordId: Uuid) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: Uuid[]) => request<RecordDetail>("PUT", `/api/records/${recordId}/card-order`, { ids }),
    onSuccess: (d) => qc.setQueryData(keys.record(d.record.id), d),
  });
}

/** Katil (public: aninda; request/private: istek) / istegi geri cek. */
export function useJoin(recordId: Uuid) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (join: boolean) => request<RecordDetail>(join ? "POST" : "DELETE", `/api/records/${recordId}/join`),
    onSuccess: (d) => afterRecordWrite(qc, d),
  });
}

/** Sorumlu/acan/admin: istegi onayla ya da reddet. */
export function useDecideJoin(recordId: Uuid) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (w: { user: Uuid; approve: boolean }) =>
      request<RecordDetail>("POST", `/api/records/${recordId}/join-requests/${w.user}`, { approve: w.approve }),
    onSuccess: (d) => afterRecordWrite(qc, d),
  });
}

export function useAddAction(recordId: Uuid) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: NewAction) => request<RecordDetail>("POST", `/api/records/${recordId}/actions`, a),
    onSuccess: (d) => afterRecordWrite(qc, d),
  });
}

export function usePatchAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: Uuid; patch: ActionPatch }) =>
      request<RecordDetail>("PATCH", `/api/actions/${id}`, patch),
    onSuccess: (d) => afterRecordWrite(qc, d),
  });
}

// --- etkinlikler (spec/73) ---------------------------------------------------------

export function useEvents() {
  return useQuery({ queryKey: keys.events, queryFn: () => request<EventSummary[]>("GET", "/api/events") });
}

export function useEvent(id: Uuid) {
  return useQuery({ queryKey: keys.event(id), queryFn: () => request<EventDetail>("GET", `/api/events/${id}`) });
}

export function useCreateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (e: NewEvent) => request<{ id: Uuid; record_id: Uuid }>("POST", "/api/events", e),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.events });
      void qc.invalidateQueries({ queryKey: keys.recordsAll });
    },
  });
}

/** Etkinlige yazan her uc guncel ayrintiyi doner. Yollar burada (`eventOps`),
 *  bilesen yol yazmaz. */
export type EventOp = { method: "POST" | "PATCH" | "PUT" | "DELETE"; path: string; body?: unknown };

export const eventOps = {
  patch: (id: Uuid, p: EventPatch, quality_override = false): EventOp => ({ method: "PATCH", path: `/api/events/${id}`, body: { ...p, quality_override } }),
  participant: (id: Uuid, user: Uuid, on: boolean, role: string | null = null): EventOp =>
    on ? { method: "PUT", path: `/api/events/${id}/participants/${user}`, body: { role } }
      : { method: "DELETE", path: `/api/events/${id}/participants/${user}` },
  team: (id: Uuid, team: Uuid, on: boolean): EventOp => ({ method: on ? "PUT" : "DELETE", path: `/api/events/${id}/teams/${team}` }),
  addCheckpoint: (id: Uuid, label: string, date: IsoDate | null): EventOp =>
    ({ method: "POST", path: `/api/events/${id}/checkpoints`, body: { label, date } }),
  checkpoint: (cid: Uuid, done: boolean): EventOp => ({ method: "PATCH", path: `/api/event-checkpoints/${cid}`, body: { done } }),
  /** `manage_events`. null = varsayilan son tarih (etkinlikten 7 gun once). */
  checkpointDate: (cid: Uuid, date: IsoDate | null): EventOp =>
    ({ method: "PATCH", path: `/api/event-checkpoints/${cid}`, body: { date } }),
  dropCheckpoint: (cid: Uuid): EventOp => ({ method: "DELETE", path: `/api/event-checkpoints/${cid}` }),
  /** Onaylayici olmayan duzenleyen dogrudan degistiremez: ister. */
  requestCheckpoint: (cid: Uuid, action: CheckpointAction): EventOp =>
    ({ method: "POST", path: `/api/event-checkpoints/${cid}/requests`, body: { action } }),
  /** Onaylayici: istegi onayla (eylemi yapar) ya da reddet. */
  resolveRequest: (rid: Uuid, approve: boolean): EventOp =>
    ({ method: "POST", path: `/api/checkpoint-requests/${rid}`, body: { approve } }),
  addWidget: (id: Uuid, type: WidgetType, record_id: Uuid | null = null): EventOp =>
    ({ method: "POST", path: `/api/events/${id}/widgets`, body: { type, record_id } }),
  dropWidget: (wid: Uuid): EventOp => ({ method: "DELETE", path: `/api/event-widgets/${wid}` }),
  /** `notes`: kabul edilen önerinin açıklaması (isteğe bağlı). */
  addMaterial: (id: Uuid, name: string, notes?: string): EventOp =>
    ({ method: "POST", path: `/api/events/${id}/materials`, body: notes === undefined ? { name } : { name, notes } }),
  material: (mid: Uuid, p: MaterialPatch): EventOp => ({ method: "PATCH", path: `/api/materials/${mid}`, body: p }),
  dropMaterial: (mid: Uuid): EventOp => ({ method: "DELETE", path: `/api/materials/${mid}` }),
  addProvider: (mid: Uuid, p: Omit<MaterialProvider, "id" | "overage_level">): EventOp =>
    ({ method: "POST", path: `/api/materials/${mid}/providers`, body: p }),
  provider: (pid: Uuid, p: ProviderPatch): EventOp => ({ method: "PATCH", path: `/api/material-providers/${pid}`, body: p }),
  dropProvider: (pid: Uuid): EventOp => ({ method: "DELETE", path: `/api/material-providers/${pid}` }),
};

export function useEventWrite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (op: EventOp) => request<EventDetail>(op.method, op.path, op.body),
    onSuccess: (d) => {
      qc.setQueryData(keys.event(d.id), d);
      void qc.invalidateQueries({ queryKey: keys.events });
      // Baslik ve kisiler ikize de yazilir; baglanan kayit "en cok baglanan"i degistirir.
      void qc.invalidateQueries({ queryKey: keys.recordsAll });
      void qc.invalidateQueries({ queryKey: keys.record(d.record_id) });
    },
  });
}

/** Bir parti malzeme önerisi (tek model çağrısı, ~9 öneri). Sunucu durumsuz: reddedilenler
 *  istekle gider. Cache'e yazılmaz; parti `lib/suggestions.ts`'te oturum boyunca tutulur. */
export function useMaterialSuggestions(eventId: Uuid) {
  return useMutation({
    mutationFn: (rejected: string[]) =>
      request<MaterialSuggestions>("POST", `/api/events/${eventId}/material-suggestions`, { rejected }),
  });
}

export function useOtf(eventId: Uuid) {
  return useQuery({ queryKey: keys.otf(eventId), queryFn: () => request<OtfView>("GET", `/api/events/${eventId}/otf`) });
}

/** Formun tamami tek PUT (form gibi kaydedilir). */
export function useSaveOtf(eventId: Uuid) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (f: OtfInput) => request<OtfView>("PUT", `/api/events/${eventId}/otf`, f),
    onSuccess: (v) => qc.setQueryData(keys.otf(eventId), v),
  });
}

/** Otomatik doldur: en son kaydedilen baska formdan kopyalar (sunucuda); form
 *  gozden gecirilene kadar Word kilitli. */
export function useAutofillOtf(eventId: Uuid) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => request<OtfView>("POST", `/api/events/${eventId}/otf/autofill`),
    onSuccess: (v) => qc.setQueryData(keys.otf(eventId), v),
  });
}

/** Doldurulmus Word dosyasi (Content-Disposition dosya adini tasir). */
export const otfDocxUrl = (eventId: Uuid) => `/api/events/${eventId}/otf.docx`;

export function useCreateRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (r: NewRecord) => request<{ id: Uuid }>("POST", "/api/records", r),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.recordsAll });
      void qc.invalidateQueries({ queryKey: keys.home });
    },
  });
}

// --- ekler ve kartlar ---------------------------------------------------------

export const attachmentUrl = (id: Uuid, thumb = false) => `/api/attachments/${id}${thumb ? "/thumb" : ""}`;

/** Ek her iki yerde durabilir (sohbet, medya karti): ikisi de tazelenir. */
function afterAttachmentWrite(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ["feed"] });
  void qc.invalidateQueries({ queryKey: ["record"] });
}

export function useDeleteAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: Uuid) => request<undefined>("DELETE", `/api/attachments/${id}`),
    onSuccess: () => afterAttachmentWrite(qc),
  });
}

export function useTags(enabled: boolean) {
  return useQuery({ queryKey: keys.tags, queryFn: () => request<{ id: Uuid; name: string }[]>("GET", "/api/tags"), enabled });
}

/** Etiket ekle (`name`) ya da cikar (`tagId`). */
export function useTagAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (w: { id: Uuid; name?: string; tagId?: Uuid }) =>
      w.tagId !== undefined
        ? request<Attachment>("DELETE", `/api/attachments/${w.id}/tags/${w.tagId}`)
        : request<Attachment>("POST", `/api/attachments/${w.id}/tags`, { name: w.name }),
    onSuccess: () => {
      afterAttachmentWrite(qc);
      void qc.invalidateQueries({ queryKey: keys.tags });
    },
  });
}

/** Kart yazmalari guncel kayit ayrintisini doner. */
export function useCardWrite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (w: { method: "POST" | "PATCH" | "PUT" | "DELETE"; path: string; body?: unknown }) =>
      request<RecordDetail>(w.method, w.path, w.body),
    onSuccess: (d) => afterRecordWrite(qc, d),
  });
}

export function useSendMessage() {
  const qc = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async ({ chat, ...message }: { chat: Uuid; body: string; reply_to_id: Uuid | null; attachment_ids: Uuid[] }) => {
      try {
        return await request<{ id: Uuid }>("POST", `/api/chats/${chat}/messages`, message);
      } catch (error) {
        // Yanit kaybolduysa ayni ekle ikinci mesaj gonderme. Ek tek mesaja aittir.
        if (message.attachment_ids.length > 0) {
          try {
            const feed = await request<Feed>("GET", `/api/chats/${chat}/feed`);
            const linked = Object.entries(feed.attachments).find(([, attachments]) =>
              message.attachment_ids.every((id) => attachments?.some((attachment) => attachment.id === id)));
            if (linked !== undefined) return { id: linked[0] };
          } catch { /* asil gonderim hatasini koru */ }
        }
        throw error;
      }
    },
    onSuccess: (_, message) => {
      void qc.invalidateQueries({ queryKey: keys.feed(message.chat) });
      void qc.invalidateQueries({ queryKey: keys.recordsAll });
      void qc.invalidateQueries({ queryKey: keys.inbox });
    },
  });
}

export function usePostMessage(chat: Uuid) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (m: { body: string; reply_to_id: Uuid | null; attachment_ids: Uuid[] }) =>
      request<{ id: Uuid }>("POST", `/api/chats/${chat}/messages`, m),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.feed(chat) });
      void qc.invalidateQueries({ queryKey: keys.recordsAll });
      void qc.invalidateQueries({ queryKey: keys.inbox });
    },
  });
}

// --- takim uyeligi -----------------------------------------------------------

/** Yazma guncel takimi dondurur; duvar (olgu) ve benim takimlarim (meta) tazelenir. */
export function useTeamMember(team: Uuid, chat: Uuid) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (w: { user_id: Uuid; role: TeamRole | null }) =>
      w.role === null
        ? request<TeamView>("DELETE", `/api/teams/${team}/members/${w.user_id}`)
        : request<TeamView>("POST", `/api/teams/${team}/members`, w),
    onSuccess: (v) => {
      qc.setQueryData(keys.team(team), v);
      void qc.invalidateQueries({ queryKey: keys.teams });
      void qc.invalidateQueries({ queryKey: keys.feed(chat) });
      void qc.invalidateQueries({ queryKey: keys.meta });
    },
  });
}

// --- takim ve pillar yazmalari (spec/22) ------------------------------------
// Takim/pillar adi, rengi, dugum baglari sozlukte (`/api/meta`): her yazma onu
// tazeler. Uclar govde dondurmez (201 {id} ya da 204).

function afterTeamWrite(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: keys.meta });
  void qc.invalidateQueries({ queryKey: keys.teams });
  void qc.invalidateQueries({ queryKey: keys.recordsAll });
  void qc.invalidateQueries({ queryKey: keys.nodes });
}

/** Tek yazma kancasi; islem `teamOps`/`pillarOps` ile kurulur (adminOps kalibi). */
export function useTeamWrite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (w: { method: "POST" | "PATCH" | "PUT" | "DELETE"; path: string; body?: unknown }) =>
      request<{ id?: Uuid; team_id?: Uuid } | null>(w.method, w.path, w.body),
    onSuccess: () => afterTeamWrite(qc),
  });
}

export const teamOps = {
  create: (b: NewTeam) => ({ method: "POST" as const, path: "/api/teams", body: b }),
  patch: (id: Uuid, p: TeamPatch) => ({ method: "PATCH" as const, path: `/api/teams/${id}`, body: p }),
  remove: (id: Uuid) => ({ method: "DELETE" as const, path: `/api/teams/${id}` }),
  link: (id: Uuid, node: Uuid) => ({ method: "PUT" as const, path: `/api/teams/${id}/nodes/${node}` }),
  unlink: (id: Uuid, node: Uuid) => ({ method: "DELETE" as const, path: `/api/teams/${id}/nodes/${node}` }),
};

export const pillarOps = {
  create: (b: NewTeam) => ({ method: "POST" as const, path: "/api/pillars", body: b }),
  patch: (id: Uuid, p: PillarPatch) => ({ method: "PATCH" as const, path: `/api/pillars/${id}`, body: p }),
  remove: (id: Uuid) => ({ method: "DELETE" as const, path: `/api/pillars/${id}` }),
};

// --- yapi (veri yonetimi) ---------------------------------------------------

/** Yazma guncel agaci dondurur. Dugumler HER ekrani besliyor (`/api/meta`:
 *  konu listesi, yollar, takimlar); kalici silme kayitlari da goturur. */
function afterTreeWrite(qc: QueryClient, t: TreeView) {
  qc.setQueryData(keys.nodes, t);
  void qc.invalidateQueries({ queryKey: keys.meta });
  void qc.invalidateQueries({ queryKey: keys.teams });
  void qc.invalidateQueries({ queryKey: keys.recordsAll });
  void qc.invalidateQueries({ queryKey: keys.home });
}

export function useCreateNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (n: NewNode) => request<TreeView>("POST", "/api/nodes", n),
    onSuccess: (t) => afterTreeWrite(qc, t),
  });
}

export function usePatchNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: Uuid; patch: NodePatch }) =>
      request<TreeView>("PATCH", `/api/nodes/${id}`, patch),
    onSuccess: (t) => afterTreeWrite(qc, t),
  });
}

// --- yonetim paneli ----------------------------------------------------------

export function useAdmin() {
  return useQuery({ queryKey: keys.admin, queryFn: () => request<AdminView>("GET", "/api/admin") });
}

/** Her yazma guncel paneli dondurur. Kisi/yetki degisimi sozlugu (`/api/meta`:
 *  kisiler, benim kapsamlarim) de degistirir. */
export function useAdminWrite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (w: { method: "POST" | "PATCH" | "DELETE"; path: string; body?: unknown }) =>
      request<AdminView>(w.method, `/api/admin${w.path}`, w.body),
    onSuccess: (v) => {
      qc.setQueryData(keys.admin, v);
      void qc.invalidateQueries({ queryKey: keys.meta });
    },
  });
}

export const adminOps = {
  addUser: (email: string, name: string) => ({ method: "POST" as const, path: "/users", body: { email, name } }),
  user: (id: Uuid, op: UserOp) => ({ method: "PATCH" as const, path: `/users/${id}`, body: op }),
  createRole: (name: string, color: string, scopes: string[], node_ids: Uuid[]) =>
    ({ method: "POST" as const, path: "/roles", body: { name, color, scopes, node_ids } }),
  patchRole: (id: Uuid, name: string, color: string, scopes: string[], node_ids: Uuid[]) =>
    ({ method: "PATCH" as const, path: `/roles/${id}`, body: { name, color, scopes, node_ids } }),
  deleteRole: (id: Uuid) => ({ method: "DELETE" as const, path: `/roles/${id}` }),
};

export function useDeleteNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: Uuid) => request<TreeView>("DELETE", `/api/nodes/${id}`),
    onSuccess: (t) => afterTreeWrite(qc, t),
  });
}

// --- profil -----------------------------------------------------------------

export function usePatchProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: ProfilePatch) => request<null>("PATCH", "/api/me/profile", p),
    // Ad/foto her ekranda cozuldugu icin sozluk tazelenir.
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.meta }),
  });
}

/** Ad (`edit_user_names`): kendi ya da baskasinin adi. Sozluk ve yonetim tazelenir. */
export function useRenameUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: Uuid; name: string }) => request<null>("PATCH", `/api/users/${id}/name`, { name }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.meta });
      void qc.invalidateQueries({ queryKey: keys.admin });
    },
  });
}

export function useMarkSeen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => request<null>("POST", "/api/notifications/seen"),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.notifications }),
  });
}

export function useNotifyPrefs() {
  return useQuery({ queryKey: keys.notifyPrefs, queryFn: () => request<NotifyPrefs>("GET", "/api/me/notifications") });
}

function afterPrefs(qc: QueryClient, p: NotifyPrefs) {
  qc.setQueryData(keys.notifyPrefs, p);
  void qc.invalidateQueries({ queryKey: keys.notifications });
}

export function usePatchNotifyPrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { level?: NotifyLevel; quiet_start?: number | null; quiet_end?: number | null }) =>
      request<NotifyPrefs>("PATCH", "/api/me/notifications", p),
    onSuccess: (p) => afterPrefs(qc, p),
  });
}

/** Sohbet/kayit icin ozel secim; `null` varsayilana doner. */
export function useSetChatPref(chat: Uuid) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mode: NotifyLevel | null) => request<NotifyPrefs>("PUT", `/api/chats/${chat}/prefs`, { mode }),
    onSuccess: (p) => afterPrefs(qc, p),
  });
}

export function useAdminActivity() {
  return useQuery({
    queryKey: keys.adminActivity,
    queryFn: () => request<PersonUse[]>("GET", "/api/admin/activity"),
  });
}

// --- kalite kapisi ayarlari (yalniz admin) -------------------------------------

export function useQualityConfig() {
  return useQuery({ queryKey: keys.quality, queryFn: () => request<QualityView>("GET", "/api/admin/quality") });
}

export function useQualityWrite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cfg: QualityConfig | null) =>
      cfg === null ? request<QualityView>("DELETE", "/api/admin/quality") : request<QualityView>("PUT", "/api/admin/quality", cfg),
    onSuccess: (v) => qc.setQueryData(keys.quality, v),
  });
}

/** Kaydetmeden tek deneme: taslak sorularla modele sorar. */
export function useQualityTry() {
  return useMutation({
    mutationFn: (b: { kind: "entry" | "closing"; state: string; config: QualityConfig }) =>
      request<Quality>("POST", "/api/admin/quality/try", b),
  });
}

// --- Yonetim > Veri isleme ve LLM (admin ya da manage_llm, spec/79 §11) --------------

const filterQs = (f: LlmFilter, cursor?: string) =>
  qs({ from: f.from, to: f.to, feature: f.feature, model: f.model, user: f.user, status: f.status, cursor });

export function useLlmStatus() {
  return useQuery({ queryKey: [...keys.llm, "status"], queryFn: () => request<LlmStatusView>("GET", "/api/admin/llm/status") });
}

export function useLlmUsage(f: LlmFilter) {
  return useQuery({
    queryKey: [...keys.llm, "usage", f],
    queryFn: () => request<LlmUsageView>("GET", `/api/admin/llm/usage${filterQs(f)}`),
  });
}

export function useLlmCalls(f: LlmFilter, cursor: string | undefined) {
  return useQuery({
    queryKey: [...keys.llm, "calls", f, cursor ?? ""],
    queryFn: () => request<LlmCallsView>("GET", `/api/admin/llm/calls${filterQs(f, cursor)}`),
  });
}

export function useLlmCall(id: Uuid | null) {
  return useQuery({
    queryKey: [...keys.llm, "call", id],
    queryFn: () => request<LlmCallDetail>("GET", `/api/admin/llm/calls/${id ?? ""}`),
    enabled: id !== null,
  });
}

/** OpenRouter anahtar kullanimi; sunucu 5 dk onbellekler. `refresh` onbellegi atar. */
export function useLlmKey(refresh: number) {
  return useQuery({
    queryKey: [...keys.llm, "key", refresh],
    queryFn: () => request<LlmKeyView>("GET", `/api/admin/llm/key${refresh > 0 ? "?refresh=1" : ""}`),
  });
}

/** OpenRouter model listesi; sunucu 1 saat onbellekler. */
export function useLlmModels(refresh: number) {
  return useQuery({
    queryKey: [...keys.llm, "models", refresh],
    queryFn: () => request<LlmModelsView>("GET", `/api/admin/llm/models${refresh > 0 ? "?refresh=1" : ""}`),
    staleTime: 3_600_000,
  });
}

export function useLlmFeatures() {
  return useQuery({ queryKey: [...keys.llm, "features"], queryFn: () => request<LlmFeatureView[]>("GET", "/api/admin/llm/features") });
}

export function useLlmFeatureWrite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ feature, body }: { feature: LlmFeature; body: LlmFeatureIn }) =>
      request<LlmFeatureView[]>("PUT", `/api/admin/llm/features/${feature}`, body),
    onSuccess: (v) => {
      qc.setQueryData([...keys.llm, "features"], v);
      void qc.invalidateQueries({ queryKey: [...keys.llm, "status"] });
    },
  });
}

export function useLlmTry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ feature, ...b }: { feature: LlmFeature; model: string; params: LlmParams; prompt_version?: number; input: unknown }) =>
      request<LlmTryOut>("POST", `/api/admin/llm/features/${feature}/try`, b),
    // Dene de bir cagri: gecmis ve maliyet tazelensin.
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.llm, predicate: (q) => q.queryKey[2] !== "features" }),
  });
}

export function useLlmPrompts(feature: LlmFeature) {
  return useQuery({
    queryKey: [...keys.llm, "prompts", feature],
    queryFn: () => request<LlmPromptsView>("GET", `/api/admin/llm/prompts/${feature}`),
  });
}

export function useLlmPromptWrite(feature: LlmFeature) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (op: { add: string } | { activate: number }) =>
      "add" in op
        ? request<LlmPromptsView>("POST", `/api/admin/llm/prompts/${feature}`, { body: op.add })
        : request<LlmPromptsView>("PUT", `/api/admin/llm/prompts/${feature}/active`, { version: op.activate }),
    onSuccess: (v) => {
      qc.setQueryData([...keys.llm, "prompts", feature], v);
      void qc.invalidateQueries({ queryKey: [...keys.llm, "features"] });
    },
  });
}

export function useLlmLimits() {
  return useQuery({ queryKey: [...keys.llm, "limits"], queryFn: () => request<LlmLimit[]>("GET", "/api/admin/llm/limits") });
}

export function useLlmLimitWrite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (op: { put: { model: string; window_minutes: number; usd: number } } | { remove: Uuid }) =>
      "put" in op
        ? request<LlmLimit[]>("POST", "/api/admin/llm/limits", op.put)
        : request<LlmLimit[]>("DELETE", `/api/admin/llm/limits/${op.remove}`),
    onSuccess: (v) => qc.setQueryData([...keys.llm, "limits"], v),
  });
}

/** Temizleyici denemesi: metin modele gitmez, yalniz temizlenmis hali doner. */
export function useLlmRedactTry() {
  return useMutation({
    mutationFn: (b: { text: string; config: LlmConfig }) => request<{ text: string }>("POST", "/api/admin/llm/redact-try", b),
  });
}

/** Temizleme kurallari (`/api/admin/llm`); null = varsayilana don. */
export function useLlmConfig() {
  return useQuery({ queryKey: [...keys.llm, "config"], queryFn: () => request<LlmConfigView>("GET", "/api/admin/llm") });
}

export function useLlmConfigWrite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cfg: LlmConfig | null) =>
      cfg === null ? request<LlmConfigView>("DELETE", "/api/admin/llm") : request<LlmConfigView>("PUT", "/api/admin/llm", cfg),
    onSuccess: (v) => qc.setQueryData([...keys.llm, "config"], v),
  });
}
