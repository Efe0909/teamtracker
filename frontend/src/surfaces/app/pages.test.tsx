// R1-F01: "Ana ekrana ekle" ipucu, uygulama standalone acikken gizlenir
// (spec/90-geri-tasima.md, 003d86a).

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventDetail, Meta, RecordSummary } from "../../api/types";
import { LookupProvider } from "../../lib/lookup";
import { TopBar } from "./MobileApp";
import { RecordCard, SearchPage, TodoPage } from "./pages";
import { MobileEventStrip, TeamPage } from "./RecordPage";

const META: Meta = {
  me: { id: "u1", is_admin: false, scopes: [], team_ids: ["t1"], profile_complete: true, favorite_nodes: [] },
  users: [
    { id: "u1", name: "Efe Tester", nickname: "efe", color: null, is_admin: false, last_seen_at: null, phone: "5551234567", avatar_id: null, birth_day: null, birth_month: null, birth_year: null },
    { id: "u2", name: "Ahmet Yılmaz", nickname: "ahmet", color: null, is_admin: false, last_seen_at: null, phone: null, avatar_id: null, birth_day: null, birth_month: null, birth_year: null },
  ],
  teams: [
    { id: "t1", name: "Yazılım Ekibi", description: "Ön yüz ve arka yüz", color: null, chat_id: "c1", node_ids: [], pillar_id: null, banner_id: null },
    { id: "t2", name: "Tasarım Ekibi", description: "UI/UX ve grafik", color: null, chat_id: "c2", node_ids: [], pillar_id: null, banner_id: null },
  ],
  pillars: [],
  nodes: [],
};

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

describe("mobil üst çubuk ve hesap menüsü (spec/31)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => [] } as Response),
    );
  });

  afterEach(async () => {
    await act(async () => {});
    cleanup();
    vi.unstubAllGlobals();
  });

  it("hesap menüsü tetikleyicisi görünür", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <LookupProvider meta={META}>
          <TopBar title="Test" />
        </LookupProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("button", { name: "Hesap menüsü" })).toBeTruthy();
  });

  it("eksik profilde profil tamamlama diyalogu açılır", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const incompleteMeta: Meta = {
      ...META,
      me: { ...META.me, profile_complete: false },
    };
    render(
      <QueryClientProvider client={qc}>
        <LookupProvider meta={incompleteMeta}>
          <TopBar title="Test" />
        </LookupProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText(/Devam etmeden önce telefon numaranı gir/)).toBeTruthy();
  });
});

const REC_BASE: RecordSummary = {
  id: "r1",
  unit_id: "u1",
  pillar_id: null,
  team_id: null,
  kind: "task",
  title: "Örnek Kayıt",
  status: "open",
  priority: "medium",
  owner_id: "u1",
  due_date: null,
  created_at: "2026-10-01T10:00:00Z",
  updated_at: "2026-10-01T10:00:00Z",
  open_actions: 0,
  action_overdue: false,
  messages: 0,
  event_id: null,
};

describe("mobil kayıt kartı etkinlik rozeti (spec/31 Faz 2)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("etkinliğe bağlı olmayan kayıtta Etkinlik rozeti görünmez", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <LookupProvider meta={META}>
          <RecordCard r={REC_BASE} />
        </LookupProvider>
      </QueryClientProvider>,
    );
    expect(screen.queryByText("Etkinlik")).toBeNull();
  });

  it("etkinliğe bağlı kayıtta (event_id !== null) Etkinlik rozeti görünür", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <LookupProvider meta={META}>
          <RecordCard r={{ ...REC_BASE, event_id: "ev1" }} />
        </LookupProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText("Etkinlik")).toBeTruthy();
  });
});

const EVENT_FIXTURE: EventDetail = {
  id: "ev1",
  record_id: "r1",
  title: "Robotik Turnuvası",
  kind_id: "k1",
  status: "confirmed",
  priority: "high",
  owner_id: "u1",
  date: "2026-10-15",
  start_time: "14:00",
  location_id: null,
  place: "Spor Salonu",
  attendees: 100,
  description: "Turnuva hazırlığı",
  created_by: "u1",
  created_at: "2026-10-01T10:00:00Z",
  updated_at: "2026-10-01T10:00:00Z",
  record_ids: [],
  participants: [],
  team_ids: [],
  checkpoints: [
    { id: "cp1", label: "Afişler asıldı", date: "2026-10-10", done: true },
    { id: "cp2", label: "Masa düzeni", date: "2026-10-14", done: false },
  ],
  widgets: [],
  materials: [],
  can_edit: true,
  can_manage: true,
  can_approve: true,
  requests: [],
};

describe("mobil ikiz kayıtta etkinlik ve checkpoint şeridi (spec/31 Faz 2)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.includes("/api/events/ev1")) {
          return { status: 200, ok: true, json: async () => EVENT_FIXTURE } as Response;
        }
        if (url.includes("/api/event-checkpoints/cp2") && init?.method === "PATCH") {
          return {
            status: 200,
            ok: true,
            json: async () => ({
              ...EVENT_FIXTURE,
              checkpoints: [
                EVENT_FIXTURE.checkpoints[0],
                { ...EVENT_FIXTURE.checkpoints[1], done: true },
              ],
            }),
          } as Response;
        }
        return { status: 200, ok: true, json: async () => [] } as Response;
      }),
    );
  });

  afterEach(async () => {
    await act(async () => {});
    cleanup();
    vi.unstubAllGlobals();
  });

  it("etkinlik özeti, yeri ve adım sayısını gösterir", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <LookupProvider meta={META}>
          <MobileEventStrip eventId="ev1" />
        </LookupProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Spor Salonu")).toBeTruthy();
    expect(screen.getByText("Kesin")).toBeTruthy();
    expect(screen.getByText("1/2 adım")).toBeTruthy();
    expect(screen.getByRole("progressbar")).toBeTruthy();
  });

  it("adım sayısı butonuna basılınca checkpoint listesi açılır ve işaretlenebilir", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <LookupProvider meta={META}>
          <MobileEventStrip eventId="ev1" />
        </LookupProvider>
      </QueryClientProvider>,
    );

    const toggleBtn = await screen.findByRole("button", { name: /1\/2 adım/ });
    fireEvent.click(toggleBtn);

    expect(screen.getByText("Afişler asıldı")).toBeTruthy();
    const cp2Btn = screen.getByRole("button", { name: /Masa düzeni: tamamlandı olarak işaretle/ });
    expect(cp2Btn).toBeTruthy();

    await act(async () => {
      fireEvent.click(cp2Btn);
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/event-checkpoints/cp2"),
      expect.objectContaining({ method: "PATCH" }),
    );
  });
});

describe("mobil takım sayfası açık kayıtları (spec/31 Faz 3)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("/api/teams/t1")) {
          return {
            status: 200,
            ok: true,
            json: async () => ({
              id: "t1",
              name: "Yazılım Ekibi",
              description: "Ön yüz ve arka yüz",
              chat_id: "c1",
              open_records: 1,
              members: [{ user_id: "u1", role: "lead" }],
            }),
          } as Response;
        }
        if (url.includes("/api/records")) {
          return { status: 200, ok: true, json: async () => [REC_BASE] } as Response;
        }
        if (url.includes("/api/chats/")) {
          return { status: 200, ok: true, json: async () => ({ items: [] }) } as Response;
        }
        return { status: 200, ok: true, json: async () => [] } as Response;
      }),
    );
  });

  afterEach(async () => {
    await act(async () => {});
    cleanup();
    vi.unstubAllGlobals();
  });

  it("takım bilgilerini ve açık kayıtlar listesini çizer", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <LookupProvider meta={META}>
          <TeamPage id="t1" />
        </LookupProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Ön yüz ve arka yüz")).toBeTruthy();
    expect(screen.getByText(/Açık Kayıtlar/)).toBeTruthy();
    expect(await screen.findByText("Örnek Kayıt")).toBeTruthy();
  });
});

describe("mobil zengin arama (spec/31 Faz 3)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("/api/records") && url.includes("search=yaz")) {
          return { status: 200, ok: true, json: async () => [REC_BASE] } as Response;
        }
        return { status: 200, ok: true, json: async () => [] } as Response;
      }),
    );
  });

  afterEach(async () => {
    await act(async () => {});
    cleanup();
    vi.unstubAllGlobals();
  });

  it("en az 2 harf yazılmadığında yönlendirme metnini gösterir", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <LookupProvider meta={META}>
          <SearchPage q="a" />
        </LookupProvider>
      </QueryClientProvider>,
    );

    expect(screen.getByText("Arama yap")).toBeTruthy();
    expect(screen.getByText(/En az iki harf yaz/)).toBeTruthy();
  });

  it("arama sorgusu eşleşen takım, kişi ve kayıtları ayrı gruplarda gösterir", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <LookupProvider meta={META}>
          <SearchPage q="yaz" />
        </LookupProvider>
      </QueryClientProvider>,
    );

    // Takım eşleşmesi ("Yazılım Ekibi")
    expect(await screen.findByText("Takımlar (1)")).toBeTruthy();
    expect(screen.getByText("Yazılım Ekibi")).toBeTruthy();

    // Kayıt eşleşmesi ("Örnek Kayıt")
    expect(await screen.findByText("Kayıtlar (1)")).toBeTruthy();
    expect(screen.getByText("Örnek Kayıt")).toBeTruthy();
  });

  it("kişi eşleştiğinde avatar, ad ve telefon bağlantısını gösterir", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <LookupProvider meta={META}>
          <SearchPage q="ahmet" />
        </LookupProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Kişiler (1)")).toBeTruthy();
    expect(screen.getByText("Ahmet Yılmaz")).toBeTruthy();
  });

  it("hiçbir şey eşleşmediğinde sonuç yok durumunu gösterir", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <LookupProvider meta={META}>
          <SearchPage q="xyzbulunamaz" />
        </LookupProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Sonuç yok")).toBeTruthy();
    expect(screen.getByText(/“xyzbulunamaz” için sonuç yok/)).toBeTruthy();
  });
});
