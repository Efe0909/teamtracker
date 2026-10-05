import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ApiError } from "../../api/client";
import type { Meta, RecordDetail } from "../../api/types";
import { LookupProvider } from "../../lib/lookup";
import { ToastProvider } from "../../ui/ui";
import { NewRecordForm } from "./NewRecordForm";
import { Properties } from "./fields";

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock("../../api/hooks", () => ({
  useCreateRecord: () => ({ mutate, isPending: false }),
  usePatchRecord: () => ({ mutate, isPending: false }),
}));
vi.mock("../nodes/NodePicker", () => ({
  useNodesOf: () => [{ id: "unit-1", name: "Üretim" }],
  NodeTreePicker: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

afterEach(() => { cleanup(); mutate.mockReset(); });

const meta: Meta = {
  me: { id: "user-1", is_admin: false, scopes: [], team_ids: [], profile_complete: true, favorite_nodes: [] },
  users: [], teams: [], pillars: [], nodes: [], external_off: [],
};
const detail: RecordDetail = {
  record: {
    id: "record-1", unit_id: "unit-1", pillar_id: null, team_id: null, chat_id: "chat-1", kind: "task",
    title: "Görev başlığı", description: "Bu açıklama yeterince uzun ve açıklayıcı bir örnek metindir.",
    status: "open", priority: "medium", owner_id: null, created_by: "user-1", due_date: null,
    created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", closing_note: null,
  },
  actions: [], participants: [], cards: [], access: { can_edit: true, can_edit_deadline: true },
  pinned: false, membership: { mode: "public", is_member: true, restricted: false, request: null, can_decide: false, requests: [] }, event_id: null,
};
function wrap(child: React.ReactNode, scopes: string[] = []) {
  const scoped = { ...meta, me: { ...meta.me, scopes } };
  return render(<QueryClientProvider client={new QueryClient()}><ToastProvider><LookupProvider meta={scoped}>{child}</LookupProvider></ToastProvider></QueryClientProvider>);
}

it("requires 5/30 characters before record submission", () => {
  wrap(<NewRecordForm onCreated={() => undefined} />);
  expect((screen.getByRole("button", { name: "Kaydı aç" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Başlık"), { target: { value: "Planlama" } });
  fireEvent.change(screen.getByLabelText("Açıklama"), { target: { value: "Kısa" } });
  expect((screen.getByRole("button", { name: "Kaydı aç" }) as HTMLButtonElement).disabled).toBe(true);
});

it("bypass_text_quality permits short titles and descriptions", () => {
  wrap(<NewRecordForm onCreated={() => undefined} />, ["bypass_text_quality"]);
  fireEvent.change(screen.getByLabelText("Başlık"), { target: { value: "x" } });
  const submit = screen.getByRole("button", { name: "Kaydı aç" }) as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Açıklama"), { target: { value: "y" } });
  expect(submit.disabled).toBe(false);
  fireEvent.click(submit);
  expect(mutate.mock.calls[0]?.[0]).toMatchObject({ title: "x", description: "y" });
  expect(screen.queryByText(/modeline gider/)).toBeNull();
});

it("shows low-quality reasons and retries with quality_override", () => {
  const created = vi.fn();
  mutate.mockImplementation((body: { quality_override?: boolean }, options: { onError: (e: unknown) => void; onSuccess: (v: { id: string }) => void }) => {
    if (body.quality_override) options.onSuccess({ id: "record-1" });
    else options.onError(new ApiError("low_quality", 422, ["specific"]));
  });
  wrap(<NewRecordForm onCreated={created} />);
  fireEvent.change(screen.getByLabelText("Başlık"), { target: { value: "Planlama" } });
  fireEvent.change(screen.getByLabelText("Açıklama"), { target: { value: "Toplanti yapilacak ve ekip bilgilendirilecek." } });
  fireEvent.click(screen.getByRole("button", { name: "Kaydı aç" }));
  expect(screen.getByText(/somut iş veya sonuç/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Yine de gönder" }));
  expect(mutate.mock.calls[1]?.[0]).toMatchObject({ quality_override: true });
  expect(created).toHaveBeenCalledWith("record-1");
});

it("requires 30 characters in record closing dialog", () => {
  wrap(<Properties d={detail} />);
  fireEvent.click(screen.getByRole("button", { name: "Durum: Açık" }));
  fireEvent.click(screen.getByRole("option", { name: "Kapandı" }));
  expect(screen.getByText("Kaydı kapat")).toBeTruthy();
  const note = screen.getByLabelText(/Kapanış notu/);
  const closeButton = () => screen.getAllByRole("button", { name: "Kapat" }).at(-1) as HTMLButtonElement;
  fireEvent.change(note, { target: { value: "Kısa" } });
  expect(closeButton().disabled).toBe(true);
  fireEvent.change(note, { target: { value: "Yapilan is tamamlandi ve sonucu ekiple paylasildi." } });
  expect(closeButton().disabled).toBe(false);
});

it("bypass_text_quality still requires a closing note", () => {
  wrap(<Properties d={detail} />, ["bypass_text_quality"]);
  fireEvent.click(screen.getByRole("button", { name: "Durum: Açık" }));
  fireEvent.click(screen.getByRole("option", { name: "Kapandı" }));
  const closeButton = () => screen.getAllByRole("button", { name: "Kapat" }).at(-1) as HTMLButtonElement;
  expect(closeButton().disabled).toBe(true);
  fireEvent.change(screen.getByLabelText(/Kapanış notu/), { target: { value: "x" } });
  expect(closeButton().disabled).toBe(false);
});
