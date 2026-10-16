import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import { useState, type ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { Meta, RecordSummary } from "../../api/types";
import { LookupProvider } from "../../lib/lookup";
import { MarkdownField, MarkdownText } from "../../ui/MarkdownField";
import { RecordMarkdownProvider } from "./MarkdownRecords";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const records: RecordSummary[] = [{ id: "record-1", title: "Bütçe incelemesi", kind: "task", status: "open", priority: "medium",
  unit_id: "unit", pillar_id: null, team_id: null, owner_id: null, due_date: null, created_at: "2026-10-01T12:00:00Z",
  updated_at: "2026-10-01T12:00:00Z", open_actions: 0, action_overdue: false, messages: 0, event_id: null }];

function setup(child: ReactNode, data = records) {
  const fetchMock = vi.fn(async (_url: string) => ({ ok: true, status: 200, json: async () => data }));
  vi.stubGlobal("fetch", fetchMock);
  const meta: Meta = { me: { id: "me", is_admin: false, scopes: [], team_ids: [], profile_complete: true, favorite_nodes: [] },
    users: [], teams: [], pillars: [], nodes: [] };
  const result = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
    <LookupProvider meta={meta}><RecordMarkdownProvider recordHref={(id) => `/tasks/${id}`} searchHref={(title) => `/tasks?search=${encodeURIComponent(title)}`}>
      {child}
    </RecordMarkdownProvider></LookupProvider>
  </QueryClientProvider>);
  return { ...result, fetchMock };
}

function Field() {
  const [value, setValue] = useState("Önce seçili sonra");
  return <><MarkdownField label="Açıklama" value={value} onChange={setValue} /><output data-testid="source">{value}</output></>;
}

it("searches records from the task toolbar button, inserts wiki syntax at the saved selection, and supports undo", async () => {
  const { container, fetchMock } = setup(<Field />);
  const view = EditorView.findFromDOM(container.querySelector(".cm-content")!);
  if (view === null) throw new Error("Editor not mounted");
  act(() => { view.dispatch({ selection: { anchor: 5, head: 11 } }); });
  fireEvent.click(screen.getByRole("button", { name: "Görev bağla" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Görev ara" }), { target: { value: "Bütçe" } });
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes("search=B%C3%BCt%C3%A7e"))).toBe(true));
  fireEvent.click(await screen.findByRole("option", { name: /Bütçe incelemesi/ }));
  expect(view.state.doc.toString()).toBe("Önce [[Bütçe incelemesi]] sonra");
  expect(view.state.selection.main.head).toBe("Önce [[Bütçe incelemesi]]".length);
  await waitFor(() => expect(document.activeElement).toBe(view.contentDOM));
  act(() => { undo(view); });
  expect(view.state.doc.toString()).toBe("Önce seçili sonra");
  fireEvent.click(screen.getByRole("button", { name: "Görev bağla" }));
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(view.state.doc.toString()).toBe("Önce seçili sonra");
});

it("resolves a manually typed wiki title to the record and renders linkTextOnly without fetching", async () => {
  setup(<MarkdownText value="[[Bütçe incelemesi]]" />);
  await waitFor(() => expect(screen.getByRole("link", { name: "Bütçe incelemesi" }).getAttribute("href")).toBe("/tasks/record-1"));
  cleanup();
  const { fetchMock } = setup(<MarkdownText value="[[Bütçe incelemesi]]" linkTextOnly />);
  expect(screen.queryByRole("link")).toBeNull();
  expect(screen.getByText("Bütçe incelemesi")).toBeTruthy();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("opens search for duplicate record titles rather than linking to an arbitrary match", async () => {
  setup(<MarkdownText value="[[Bütçe incelemesi]]" />, [...records, { ...records[0]!, id: "record-2" }]);
  const link = screen.getByRole("link", { name: "Bütçe incelemesi" });
  await waitFor(() => expect(link.getAttribute("title")).toContain("birden fazla"));
  expect(link.getAttribute("href")).toBe("/tasks?search=B%C3%BCt%C3%A7e%20incelemesi");
});
