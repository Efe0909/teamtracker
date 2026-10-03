// Veri Yonetimi ekrani (spec/74; once R2-F05). Yerlesim kurali SUNUCUDA
// (KNOW-241): bu testler ekranin `can_*`, `locked`, dugum basina
// `child_types`/`child_fixed` ve `warnings` alanlarina harfiyen uydugunu,
// kendi kuralini uydurmadigini dogruluyor.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ERRORS } from "../../api/errors";
import type { Meta, TreeNode, TreeView } from "../../api/types";
import { LookupProvider } from "../../lib/lookup";
import { DataTree } from "./DataTree";

/** Secici (ui Picker) tetigini acar, listedeki secenek metinlerini dondurur. */
async function pickerOptions(label: string): Promise<string[]> {
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(`^${label}:`) }));
  const opts = await screen.findAllByRole("option");
  return opts.map((o) => o.textContent ?? "");
}

function node(over: Partial<TreeNode> & { id: string; name: string }): TreeNode {
  return {
    parent_id: "units",
    node_type: "generic",
    key: null,
    root_key: "units",
    shape: "tree",
    attrs: {},
    description: null,
    is_active: true,
    depth: 1,
    child_count: 0,
    locked: null,
    can_edit: false,
    child_types: [],
    child_fixed: false,
    can_hard_delete: false,
    warnings: [],
    delete_counts: { children: 0, records: 0, permissions: 0, teams: 0 },
    ...over,
  };
}

/** Birimler koku: kilitli, serbest kural. */
function unitsRoot(over: Partial<TreeNode> = {}): TreeNode {
  return node({
    id: "units", name: "Birimler", parent_id: null, node_type: "operational", key: "units", depth: 0,
    locked: "root", can_edit: true, child_types: ["cell", "machine", "task", "step", "generic"], ...over,
  });
}

/** GET her zaman `tree`; diger metodlar `onWrite` ile (varsayilan: hic çağrılmaz). */
function stubFetch(tree: TreeView, onWrite?: (method: string, url: string, body: unknown) => unknown) {
  const f = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "GET") {
      return { ok: true, status: 200, json: async () => tree } as Response;
    }
    const body = init?.body !== undefined ? JSON.parse(init.body as string) : undefined;
    const result = onWrite?.(method, url, body) ?? { ok: true, status: 200, json: async () => tree };
    return result as Response;
  });
  vi.stubGlobal("fetch", f);
  return f;
}

const META: Meta = {
  me: { id: "u1", is_admin: false, scopes: [], team_ids: [], profile_complete: true, favorite_nodes: [] },
  users: [],
  teams: [{ id: "t1", name: "Maliye", description: null, color: null, chat_id: "c1", node_ids: ["n1"], pillar_id: null, banner_id: null }],
  pillars: [],
  nodes: [],
};

function renderTree() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LookupProvider meta={META}>
        <DataTree />
      </LookupProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("salt okunur (butun bayraklar false)", () => {
  it("duzenle/ekle/kalici sil dugmesi hic cizilmez", async () => {
    stubFetch({ nodes: [unitsRoot({ can_edit: false, child_types: [] })] });
    renderTree();
    await screen.findByText("Birimler");
    expect(screen.queryByLabelText(/düzenle/)).toBeNull();
    expect(screen.queryByLabelText(/alt düğüm ekle/)).toBeNull();
    expect(screen.queryByText(/Kalıcı sil/)).toBeNull();
    expect(screen.getByText(/editör yetkisi gerekiyor/)).toBeTruthy();
  });
});

describe("kokler koddan gelir (spec/74 §4.1)", () => {
  it("kok dugum ekleme dugmesi yok", async () => {
    stubFetch({ nodes: [unitsRoot()] });
    renderTree();
    await screen.findByText("Birimler");
    expect(screen.queryByRole("button", { name: /Kök düğüm/ })).toBeNull();
  });

  it("kilitli kokte kilit isareti var; pasiflestirme, tasima, kalici silme yok", async () => {
    // can_hard_delete kasten true: kilitli dugumde yine de cizilmemeli.
    stubFetch({ nodes: [unitsRoot({ can_hard_delete: true })] });
    renderTree();
    await screen.findByText("Birimler");
    expect(screen.getByLabelText("Birimler: kilitli")).toBeTruthy();
    expect(screen.queryByLabelText(/Birimler: pasifleştir/)).toBeNull();
    fireEvent.click(screen.getByLabelText("Birimler: düzenle"));
    await screen.findByText(/yalnız ad ve açıklama değişir\./);
    expect(screen.queryByRole("button", { name: /^Üst düğüm:/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Tür:/ })).toBeNull();
    expect(screen.queryByText(/Kalıcı sil/)).toBeNull();
  });
});

describe("ekleme formu dugumun child_types/child_fixed'ine uyar (KNOW-241)", () => {
  it("serbest dal: tur yalniz child_types'tan, yapi varsayilan Agac", async () => {
    // child_types kasten kisitli: ekran baska turleri GOSTERMEMELI.
    stubFetch({
      nodes: [unitsRoot({ child_count: 1 }), node({ id: "n1", name: "Üretim Hattı", can_edit: true, child_types: ["machine"] })],
    });
    renderTree();
    fireEvent.click(await screen.findByLabelText("Birimler: alt düğümleri aç"));
    fireEvent.click(await screen.findByLabelText(/Üretim Hattı: alt düğüm ekle/));
    expect(screen.getByRole("button", { name: /^Yapı:/ }).textContent).toContain("Ağaç");
    expect(await pickerOptions("Tür")).toEqual(["Makine"]);
  });

  it("child_types bos: ekle dugmesi yok", async () => {
    stubFetch({ nodes: [unitsRoot({ child_types: [] })] });
    renderTree();
    await screen.findByText("Birimler");
    expect(screen.getByLabelText("Birimler: düzenle")).toBeTruthy();
    expect(screen.queryByLabelText(/Birimler: alt düğüm ekle/)).toBeNull();
  });

  it("child_fixed: tur/yapi sorulmaz; checkpoint gun farkini gonderir, tur gondermez", async () => {
    let sent: unknown;
    stubFetch(
      {
        nodes: [
          node({
            id: "steps", name: "Adımlar", node_type: "operational", root_key: "event_types", parent_id: null,
            depth: 0, shape: "list", locked: "operational", attrs: { slot: "steps" }, can_edit: true,
            child_types: ["checkpoint"], child_fixed: true,
          }),
        ],
      },
      (method, _url, body) => {
        if (method === "POST") sent = body;
        return undefined;
      },
    );
    renderTree();
    fireEvent.click(await screen.findByLabelText("Adımlar: alt düğüm ekle"));
    expect(screen.queryByRole("button", { name: /^Tür:/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Yapı:/ })).toBeNull();
    fireEvent.change(screen.getByLabelText(/^Adım adı/), { target: { value: "OTF gönderildi" } });
    fireEvent.change(screen.getByLabelText(/Etkinlikten kaç gün önce\/sonra/), { target: { value: "-10" } });
    fireEvent.click(screen.getByRole("button", { name: "Ekle" }));
    await waitFor(() => expect(sent).toBeDefined());
    expect(sent).toEqual({ name: "OTF gönderildi", parent_id: "steps", description: null, attrs: { offset_days: -10 } });
  });
});

describe("satir: ayar ve uyari", () => {
  it("checkpoint gun farki satirda, uyari tooltip'i Turkce", async () => {
    stubFetch({
      nodes: [
        node({
          id: "cp", name: "Son hazırlık", node_type: "checkpoint", root_key: "event_types", parent_id: null,
          depth: 0, shape: "leaf", attrs: { offset_days: -3 }, warnings: ["late_checkpoint"],
        }),
      ],
    });
    renderTree();
    await screen.findByText("Son hazırlık");
    expect(screen.getByText("−3 gün")).toBeTruthy();
    const w = screen.getByTitle(/en geç 7 gün önce bitmeli/);
    expect(w.getAttribute("aria-label")).toBe(
      "Etkinlikten 7 günden daha az önce — hazırlık en geç 7 gün önce bitmeli",
    );
  });
});

describe("arama: eslesenler + ustleri gorunur, geri kalani gizli", () => {
  it("eslesmeyen dal gizlenir, eslesen ve onun ustu gorunur", async () => {
    stubFetch({
      nodes: [
        node({ id: "r1", name: "Alfa Birimi", depth: 0, parent_id: null }),
        node({ id: "r2", name: "Beta Birimi", depth: 0, parent_id: null, child_count: 1 }),
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
    stubFetch({ nodes: [unitsRoot()] }, (method) => {
      if (method === "POST") {
        return { ok: false, status: 400, json: async () => ({ error: "invalid_name" }) } as Response;
      }
      return undefined;
    });
    renderTree();
    fireEvent.click(await screen.findByLabelText("Birimler: alt düğüm ekle"));
    fireEvent.change(await screen.findByLabelText(/^Alt düğüm adı/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Ekle" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(ERRORS.invalid_name));
  });
});

describe("takim baglari (team_nodes, spec/22)", () => {
  it("dugumde calisan takim satirda gorunur", async () => {
    stubFetch({
      nodes: [
        node({ id: "n1", name: "Bütçe Onayı", parent_id: null, depth: 0 }),
        node({ id: "n2", name: "Sevkiyat", parent_id: null, depth: 0 }),
      ],
    });
    renderTree();
    await screen.findByText("Bütçe Onayı");
    const chips = screen.getAllByRole("link", { name: "Maliye" });
    expect(chips).toHaveLength(1); // yalniz n1'de; n2 bagsiz
  });
});
