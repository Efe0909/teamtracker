// R2-F05: Veri Yonetimi ekrani (spec/90-geri-tasima.md). Yerlesim kurali
// SUNUCUDA (KNOW-241): bu testler ekranin `can_*` bayraklarina ve
// root_types/child_types listelerine harfiyen uydugunu, kendi kuralini
// uydurmadigini dogruluyor.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ERRORS } from "../../api/errors";
import type { TreeView } from "../../api/types";
import { DataTree } from "./DataTree";

function node(over: Partial<TreeView["nodes"][number]> & { id: string; name: string }): TreeView["nodes"][number] {
  return {
    parent_id: null,
    node_type: "generic",
    description: null,
    is_active: true,
    depth: 0,
    child_count: 0,
    can_edit: false,
    can_retype: true,
    can_hard_delete: false,
    delete_counts: { children: 0, records: 0, permissions: 0 },
    ...over,
  };
}

/** GET her zaman `tree`; diger metodlar `onWrite` ile (varsayilan: hic çağrılmaz). */
function stubFetch(tree: TreeView, onWrite?: (method: string, url: string, body: unknown) => unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET") {
        return { ok: true, status: 200, json: async () => tree } as Response;
      }
      const body = init?.body !== undefined ? JSON.parse(init.body as string) : undefined;
      const result = onWrite?.(method, url, body) ?? { ok: true, status: 200, json: async () => tree };
      return result as Response;
    }),
  );
}

function renderTree() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DataTree />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("salt okunur (butun bayraklar false)", () => {
  it("duzenle/ekle/kalici sil dugmesi hic cizilmez", async () => {
    stubFetch({
      can_add_root: false,
      root_types: ["cell"],
      child_types: ["generic"],
      nodes: [node({ id: "n1", name: "Kök Düğüm", can_edit: false, can_hard_delete: false })],
    });
    renderTree();
    await screen.findByText("Kök Düğüm");
    expect(screen.queryByRole("button", { name: /Kök düğüm/ })).toBeNull();
    expect(screen.queryByLabelText(/düzenle/)).toBeNull();
    expect(screen.queryByLabelText(/alt düğüm ekle/)).toBeNull();
    expect(screen.queryByText(/Kalıcı sil/)).toBeNull();
    expect(screen.getByText(/editör yetkisi gerekiyor/)).toBeTruthy();
  });
});

describe("tur secenekleri SUNUCUDAN gelir, yerel enum'dan degil (KNOW-241)", () => {
  it("alt dugum ekleme formu yalniz child_types'taki turleri listeler", async () => {
    // child_types kasten kisitli: gercek NodeType enum'unda 'machine', 'step'
    // gibi baska turler de var ama ekran ONLARI GOSTERMEMELI.
    stubFetch({
      can_add_root: false,
      root_types: ["cell"],
      child_types: ["team"],
      nodes: [node({ id: "n1", name: "Üretim Hattı", can_edit: true, child_count: 0 })],
    });
    renderTree();
    await screen.findByText("Üretim Hattı");
    fireEvent.click(screen.getByLabelText(/Üretim Hattı: alt düğüm ekle/));
    const select = (await screen.findByLabelText("Tür")) as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.textContent);
    expect(options).toEqual(["Takım"]);
  });

  it("kok ekleme formu yalniz root_types'taki turleri listeler", async () => {
    stubFetch({
      can_add_root: true,
      root_types: ["team", "step"],
      child_types: ["generic"],
      nodes: [],
    });
    renderTree();
    await screen.findByRole("button", { name: /Kök düğüm/ });
    fireEvent.click(screen.getByRole("button", { name: /Kök düğüm/ }));
    const select = (await screen.findByLabelText("Tür")) as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.textContent);
    expect(options).toEqual(["Takım", "Adım"]);
  });
});

describe("arama: eslesenler + ustleri gorunur, geri kalani gizli", () => {
  it("eslesmeyen dal gizlenir, eslesen ve onun ustu gorunur", async () => {
    stubFetch({
      can_add_root: false,
      root_types: ["cell"],
      child_types: ["generic"],
      nodes: [
        node({ id: "r1", name: "Alfa Birimi", depth: 0 }),
        node({ id: "r2", name: "Beta Birimi", depth: 0, child_count: 1 }),
        node({ id: "c1", name: "Hedef Görevi", parent_id: "r2", depth: 1 }),
      ],
    });
    renderTree();
    await screen.findByText("Alfa Birimi");
    expect(screen.getByText("Beta Birimi")).toBeTruthy();
    // c1 baslangicta kapali: ust acilmadan gorunmez.
    expect(screen.queryByText("Hedef Görevi")).toBeNull();

    fireEvent.change(screen.getByLabelText("Ağaçta ara"), { target: { value: "hedef" } });

    await waitFor(() => expect(screen.getByText("Hedef Görevi")).toBeTruthy());
    expect(screen.getByText("Beta Birimi")).toBeTruthy(); // esleseninin ustu
    expect(screen.queryByText("Alfa Birimi")).toBeNull(); // ilgisiz dal gizli
  });
});

describe("API hata kodu Turkce metne cevrilir (api/errors.ts)", () => {
  it("invalid_name kodu ERRORS.invalid_name metnini gosterir", async () => {
    stubFetch(
      {
        can_add_root: true,
        root_types: ["generic"],
        child_types: ["generic"],
        nodes: [],
      },
      (method) => {
        if (method === "POST") {
          return { ok: false, status: 400, json: async () => ({ error: "invalid_name" }) } as Response;
        }
        return undefined;
      },
    );
    renderTree();
    await screen.findByRole("button", { name: /Kök düğüm/ });
    fireEvent.click(screen.getByRole("button", { name: /Kök düğüm/ }));
    fireEvent.change(await screen.findByLabelText("Düğüm adı"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Ekle" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(ERRORS.invalid_name));
  });
});
