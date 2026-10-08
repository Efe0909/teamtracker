// Son yazan sessizce kazanmaz: alan yazmasi "gordugum deger"i (`base`) tasir,
// sunucu 409 `stale_field` dondururse kullanici guncel degeri gorur ve bilerek
// ustune yazar. Sunucu tarafi: backend/tools/check_api.sh `record_patch_stale`.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { keys, usePatchRecord } from "../../api/hooks";
import type { Meta, RecordDetail } from "../../api/types";
import { LookupProvider } from "../../lib/lookup";
import { ToastProvider } from "../../ui/ui";
import { RecordHead } from "./parts";

const META: Meta = {
  me: { id: "u-me", is_admin: false, scopes: [], team_ids: [], profile_complete: true, favorite_nodes: [] },
  users: [], teams: [], pillars: [], nodes: [], external_off: [],
};

function detail(title = "Bütçe onayı"): RecordDetail {
  return {
    record: {
      id: "r1", unit_id: "n1", pillar_id: null, team_id: null, chat_id: "c1", kind: "task",
      title, description: null, status: "open", priority: "medium", owner_id: null,
      created_by: "u-me", due_date: null, created_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-01T00:00:00Z", closing_note: null,
    },
    actions: [], participants: [], cards: [], access: { can_edit: true, can_edit_deadline: true },
    pinned: false, membership: { mode: "public", is_member: true, restricted: false, request: null, can_decide: false, requests: [] },
    event_id: null,
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const sent = (fetchMock: ReturnType<typeof vi.fn>, n: number): Record<string, unknown> =>
  JSON.parse(String((fetchMock.mock.calls[n]?.[1] as RequestInit).body)) as Record<string, unknown>;

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function clientWith(d: RecordDetail) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(keys.record(d.record.id), d);
  return qc;
}

it("fills base from the cached record when the caller gives none", async () => {
  const qc = clientWith(detail());
  fetchMock.mockImplementation(() => Promise.resolve(json(200, detail())));
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => usePatchRecord("r1"), { wrapper });

  await act(() => result.current.mutateAsync({ field: "priority", value: "high" }));
  expect(sent(fetchMock, 0)).toMatchObject({ field: "priority", value: "high", base: "medium" });

  // null gecerli bir base ("sorumlusuz gormustu"); anahtar JSON'da kalmali.
  await act(() => result.current.mutateAsync({ field: "owner_id", value: "u-selin" }));
  expect(sent(fetchMock, 1)).toHaveProperty("base", null);

  // Cagiranin verdigi base'e dokunulmaz.
  await act(() => result.current.mutateAsync({ field: "priority", value: "low", base: "critical" }));
  expect(sent(fetchMock, 2)).toMatchObject({ base: "critical" });
});

it("leaves fields the cache does not carry unchecked", async () => {
  const qc = clientWith(detail());
  fetchMock.mockImplementation(() => Promise.resolve(json(200, detail())));
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => usePatchRecord("r1"), { wrapper });

  await act(() => result.current.mutateAsync({ field: "access_mode", value: "private" }));
  expect(sent(fetchMock, 0)).not.toHaveProperty("base");
});

it("refetches the record when the server says the field is stale", async () => {
  const qc = clientWith(detail());
  const spy = vi.spyOn(qc, "invalidateQueries");
  fetchMock.mockImplementation(() => Promise.resolve(json(409, { error: "stale_field" })));
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => usePatchRecord("r1"), { wrapper });

  await act(() => result.current.mutateAsync({ field: "priority", value: "high" }).catch(() => undefined));
  expect(spy).toHaveBeenCalledWith({ queryKey: keys.record("r1") });
});

it("title editor sends what it opened with, then retries against the live text", async () => {
  const qc = clientWith(detail());
  const tree = (d: RecordDetail) => (
    <QueryClientProvider client={qc}>
      <ToastProvider><LookupProvider meta={META}><RecordHead d={d} /></LookupProvider></ToastProvider>
    </QueryClientProvider>
  );
  const view = render(tree(detail()));

  fireEvent.click(screen.getByRole("button", { name: "Başlığı düzenle" }));
  fireEvent.change(screen.getByDisplayValue("Bütçe onayı"), { target: { value: "Bütçe onayı v2" } });
  fetchMock.mockResolvedValueOnce(json(409, { error: "stale_field" }));
  fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));

  // Acilista gorulen baslik gider; 409 gelince hata + guncel hali + yeni dugme.
  await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/başkası değiştirdi/));
  expect(sent(fetchMock, 0)).toMatchObject({ field: "title", value: "Bütçe onayı v2", base: "Bütçe onayı" });

  // Kayit yeniden cekildi: baskasinin basligi artik props'ta.
  view.rerender(tree(detail("Başkasının başlığı")));
  expect(screen.getByText(/Güncel hâli: Başkasının başlığı/)).toBeTruthy();

  fetchMock.mockResolvedValueOnce(json(200, detail("Bütçe onayı v2")));
  fireEvent.click(screen.getByRole("button", { name: "Yine de kaydet" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(sent(fetchMock, 1)).toMatchObject({ value: "Bütçe onayı v2", base: "Başkasının başlığı" });
});
