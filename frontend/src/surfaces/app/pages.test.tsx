// R1-F01: "Ana ekrana ekle" ipucu, uygulama standalone acikken gizlenir
// (spec/90-geri-tasima.md, 003d86a).

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Meta } from "../../api/types";
import { LookupProvider } from "../../lib/lookup";
import { TodoPage } from "./pages";

const META: Meta = { me: { id: "u1", is_admin: false, scopes: [], team_ids: [] }, users: [], teams: [], nodes: [] };

function mockMatchMedia(matches: boolean): void {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function renderTodo() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LookupProvider meta={META}>
        <TodoPage done={false} />
      </LookupProvider>
    </QueryClientProvider>,
  );
}

describe("mobil 'ana ekrana ekle' ipucu (R1-F01)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => [] } as Response),
    );
  });

  afterEach(async () => {
    await act(async () => {}); // bekleyen sorgu guncellemesini bosalt
    cleanup(); // "test.globals" kapali: otomatik unmount calismaz, elle yapilir
    vi.unstubAllGlobals();
  });

  it("normal sekmede gorunur", () => {
    mockMatchMedia(false);
    renderTodo();
    expect(screen.getByText(/Ana ekrana ekle/)).toBeTruthy();
  });

  it("uygulama olarak (standalone) açıksa hiç görünmez", () => {
    mockMatchMedia(true);
    renderTodo();
    expect(screen.queryByText(/Ana ekrana ekle/)).toBeNull();
  });
});
