// Referans veri secicileri (spec/74 §6): kok ve baska kokler listede yok,
// favoriler ustte, arama eslesen dali acar, liste secici yalniz dogrudan cocuklar.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it } from "vitest";
import type { Meta, MetaNode, NodeType, RootKey } from "../../api/types";
import { LookupProvider } from "../../lib/lookup";
import { ToastProvider } from "../../ui/ui";
import { NodeListPicker, NodeTreePicker } from "./NodePicker";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const node = (id: string, name: string, depth: number, parent_id: string | null, root_key: RootKey, node_type: NodeType = "generic"): MetaNode => ({
  id, name, depth, parent_id, root_key, node_type, is_active: true, shape: "tree", attrs: {},
  key: parent_id === null ? root_key : null,
});

const NODES = [
  node("u", "Birimler", 0, null, "units"),
  node("a", "Maliye", 1, "u", "units"),
  node("a1", "Bütçe", 2, "a", "units"),
  node("b", "Hukuk", 1, "u", "units"),
  node("b1", "Sözleşme", 2, "b", "units"),
  node("e", "Etkinlik Türleri", 0, null, "event_types"),
  node("t", "Toplantı", 1, "e", "event_types", "option"),
  node("ts", "Adımlar", 2, "t", "event_types"),
];

function renderWith(ui: ReactNode) {
  const meta: Meta = {
    me: { id: "me", is_admin: false, scopes: [], team_ids: [], profile_complete: true, favorite_nodes: ["b1"] },
    users: [], teams: [], pillars: [], nodes: NODES,
  };
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <LookupProvider meta={meta}>{ui}</LookupProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

it("agac: favoriler ustte, ilk seviye katli, kok ve baska kok yok", () => {
  renderWith(<NodeTreePicker rootKey="units" label="Birim" value={null} onChange={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: /Birim/ }));
  const favs = screen.getByRole("group", { name: "Favoriler" });
  expect(within(favs).getByText("Sözleşme")).toBeTruthy();
  const list = screen.getByRole("listbox");
  expect(within(list).getByText("Maliye")).toBeTruthy();
  expect(within(list).queryByText("Bütçe")).toBeNull();
  expect(within(list).queryByText("Birimler")).toBeNull();
  expect(within(list).queryByText("Toplantı")).toBeNull();
  fireEvent.click(screen.getByLabelText("Maliye dalını aç/kapat"));
  expect(within(list).getByText("Bütçe")).toBeTruthy();
});

it("agac: arama eslesen dali kendiliginden acar, parent secilebilir", () => {
  const picked: string[] = [];
  renderWith(<NodeTreePicker rootKey="units" label="Birim" value={null} onChange={(id) => picked.push(id)} />);
  fireEvent.click(screen.getByRole("button", { name: /Birim/ }));
  fireEvent.change(screen.getByPlaceholderText("Birim ara…"), { target: { value: "bütç" } });
  const list = screen.getByRole("listbox");
  expect(within(list).getByText("Bütçe")).toBeTruthy();
  expect(within(list).getByText("Maliye")).toBeTruthy();
  expect(within(list).queryByText("Hukuk")).toBeNull();
  fireEvent.click(within(list).getByText("Maliye"));
  expect(picked).toEqual(["a"]);
});

it("liste: yalniz kokun dogrudan cocuklari, metin yedegi satiri", () => {
  renderWith(<NodeListPicker rootKey="event_types" label="Tür" value={null} onChange={() => {}}
    text={{ value: null, onText: () => {} }} />);
  fireEvent.click(screen.getByRole("button", { name: /Tür/ }));
  const list = screen.getByRole("listbox");
  expect(within(list).getByText("Toplantı")).toBeTruthy();
  expect(within(list).queryByText("Adımlar")).toBeNull();
  expect(within(list).queryByText("Maliye")).toBeNull();
  fireEvent.click(within(list).getByText("Diğer… (yaz)"));
  expect(screen.getByRole("textbox", { name: "Tür" })).toBeTruthy();
});
