// Uc basina sorgu ve yazma kancalari (TanStack Query). Onbellek anahtarlari
// BURADA tanimli; bilesen anahtar yazmaz, kanca cagirir.
//
// Yazma uclari guncel kayit ayrintisini dondurur: `setQueryData` ile ikinci
// GET atmadan tazelenir, liste/ana sayfa gecersiz sayilir.

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { qs, request } from "./client";
import type {
  ActionPatch,
  Feed,
  Home,
  Meta,
  MyAction,
  NewAction,
  NewNode,
  NewRecord,
  NodePatch,
  Notice,
  RecordDetail,
  RecordPatch,
  RecordSummary,
  TeamView,
  TreeView,
  Uuid,
} from "./types";

export const keys = {
  meta: ["meta"] as const,
  home: ["home"] as const,
  records: (q: RecordQuery) => ["records", q] as const,
  recordsAll: ["records"] as const,
  record: (id: Uuid) => ["record", id] as const,
  feed: (chat: Uuid) => ["feed", chat] as const,
  teams: ["teams"] as const,
  team: (id: Uuid) => ["team", id] as const,
  notifications: ["notifications"] as const,
  myActions: ["my-actions"] as const,
  nodes: ["nodes"] as const,
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
  return useQuery({ queryKey: keys.record(id), queryFn: () => request<RecordDetail>("GET", `/api/records/${id}`) });
}

/** Sohbet yoklamayla tazelenir; sekme gizliyken durur (Query varsayilani). */
export function useFeed(chat: Uuid | undefined) {
  return useQuery({
    queryKey: keys.feed(chat ?? ""),
    queryFn: () => request<Feed>("GET", `/api/chats/${chat ?? ""}/feed`),
    enabled: chat !== undefined,
    refetchInterval: 15_000,
  });
}

export function useTeams() {
  return useQuery({ queryKey: keys.teams, queryFn: () => request<TeamView[]>("GET", "/api/teams") });
}

export function useTeam(id: Uuid) {
  return useQuery({ queryKey: keys.team(id), queryFn: () => request<TeamView>("GET", `/api/teams/${id}`) });
}

export function useNotifications() {
  return useQuery({
    queryKey: keys.notifications,
    queryFn: () => request<Notice[]>("GET", "/api/notifications"),
    refetchInterval: 60_000,
  });
}

export function useMyActions() {
  return useQuery({ queryKey: keys.myActions, queryFn: () => request<MyAction[]>("GET", "/api/actions/mine") });
}

export function useNodeTree() {
  return useQuery({ queryKey: keys.nodes, queryFn: () => request<TreeView>("GET", "/api/nodes") });
}

// --- yazmalar --------------------------------------------------------------

function afterRecordWrite(qc: QueryClient, d: RecordDetail) {
  qc.setQueryData(keys.record(d.record.id), d);
  void qc.invalidateQueries({ queryKey: keys.recordsAll });
  void qc.invalidateQueries({ queryKey: keys.feed(d.record.chat_id) });
  void qc.invalidateQueries({ queryKey: keys.home });
  void qc.invalidateQueries({ queryKey: keys.myActions });
}

export function usePatchRecord(id: Uuid) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: RecordPatch) => request<RecordDetail>("PATCH", `/api/records/${id}`, p),
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

export function usePostMessage(chat: Uuid) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (m: { body: string; reply_to_id: Uuid | null }) =>
      request<{ id: Uuid }>("POST", `/api/chats/${chat}/messages`, m),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.feed(chat) });
      void qc.invalidateQueries({ queryKey: keys.recordsAll });
    },
  });
}

// --- yapi (veri yonetimi) ---------------------------------------------------

/** Yazma guncel agaci dondurur. Dugumler HER ekrani besliyor (`/api/meta`:
 *  birim listesi, yollar, takimlar); kalici silme kayitlari da goturur. */
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

export function useDeleteNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: Uuid) => request<TreeView>("DELETE", `/api/nodes/${id}`),
    onSuccess: (t) => afterTreeWrite(qc, t),
  });
}
