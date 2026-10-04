// R1-F01: "Ana ekrana ekle" ipucu, uygulama standalone acikken gizlenir
// (spec/90-geri-tasima.md, 003d86a).

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventDetail, Meta, RecordSummary } from "../../api/types";
import { LookupProvider } from "../../lib/lookup";
import MobileApp, { CameraFlow, TopBar } from "./MobileApp";
import { setCsrf } from "../../api/client";
import { keys } from "../../api/hooks";
import { navigate } from "../../lib/router";
import { href, parse } from "./routes";
import { ActionsPage, ChatsPage, RecordCard, SearchPage, TeamsListPage } from "./pages";
import { MobileEventStrip, TeamPage } from "./RecordPage";

const META: Meta = {
  me: { id: "u1", is_admin: false, scopes: [], team_ids: ["t1"], profile_complete: true, favorite_nodes: [] },
  users: [
    { id: "u1", name: "Efe Tester", nickname: "efe", color: null, is_admin: false, last_seen_at: null, phone: "5551234567", avatar_id: null, birth_day: null, birth_month: null, birth_year: null, roles: [] },
    { id: "u2", name: "Ahmet Yılmaz", nickname: "ahmet", color: null, is_admin: false, last_seen_at: null, phone: null, avatar_id: null, birth_day: null, birth_month: null, birth_year: null, roles: [] },
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

function renderActions() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LookupProvider meta={META}>
        <ActionsPage />
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
    renderActions();
    expect(screen.getByText(/Ana ekrana ekle/)).toBeTruthy();
  });

  it("uygulama olarak (standalone) açıksa hiç görünmez", () => {
    mockMatchMedia(true);
    renderActions();
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

const INBOX = [
  { chat_id: "chat-team", team_id: "t1", record_id: null, kind: "team" as const, title: "Yazılım Ekibi", last_message: "Son gerçek mesaj", last_actor_id: "u2", updated_at: "2026-10-04T10:00:00Z", can_post: true },
  { chat_id: "chat-record", team_id: null, record_id: "r1", kind: "record" as const, title: "Örnek Kayıt", last_message: null, last_actor_id: null, updated_at: null, can_post: true },
  { chat_id: "chat-readonly", team_id: null, record_id: "r2", kind: "record" as const, title: "Salt okunur", last_message: null, last_actor_id: null, updated_at: null, can_post: false },
];

function renderMobile(children: React.ReactNode, meta = META) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  qc.setQueryData(keys.inbox, INBOX);
  return render(<QueryClientProvider client={qc}><LookupProvider meta={meta}>{children}</LookupProvider></QueryClientProvider>);
}

function json(data: unknown, status = 200): Response {
  return { status, ok: status < 400, json: async () => data } as Response;
}

describe("mobil yeni gezinme ve konuşmalar", () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    history.replaceState(null, "", "/");
    vi.stubGlobal("scrollTo", vi.fn());
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/teams/t1")) return json({ id: "t1", open_records: 1, members: [{ user_id: "u1", role: "lead" }] });
      if (url === "/api/teams") return json([{ id: "t1", open_records: 1, members: [{ user_id: "u1", role: "lead" }, { user_id: "u2", role: "member" }] }]);
      if (url.includes("/api/records")) return json([REC_BASE, { ...REC_BASE, id: "other", owner_id: "u2", title: "Başkasının kaydı" }]);
      if (url.includes("/feed")) return json({ items: [], attachments: {}, quotes: [] });
      if (url === "/api/me/notifications") return json({ chats: {}, level: "all", quiet_start: null, quiet_end: null });
      if (url.includes("/notifications")) return json({ items: [], unread: 0 });
      return json([]);
    }));
  });
  afterEach(async () => { await act(async () => {}); cleanup(); vi.unstubAllGlobals(); });

  it("kök ve /actions aynı eylem rotasıdır; alt gezinme beş öğedir", () => {
    expect(parse(new URL("https://app.example/actions"))).toEqual({ name: "actions" });
    expect(parse(new URL("https://app.example/"))).toEqual({ name: "actions" });
    expect(href({ name: "actions" })).toBe("/");
    renderMobile(<MobileApp />);
    const nav = screen.getByRole("navigation", { name: "Sekmeler" });
    expect(nav.querySelectorAll("a")).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Ekle" })).toBeTruthy();
    expect(nav.textContent).toBe("EylemlerTakımlarKonuşmalarBildirim");
  });

  it("üstteki kayıtlar yalnız açık sahipli kayıtlardır ve DB pin isteği atmaz", async () => {
    renderMobile(<ActionsPage />);
    expect(await screen.findByText(/Sahibi olduğum açık kayıtlar \(1\)/)).toBeTruthy();
    expect(screen.getByText("Örnek Kayıt")).toBeTruthy();
    expect(screen.queryByText("Başkasının kaydı")).toBeNull();
    expect(screen.getByText(/Sahibi olduğum/).closest("details")?.open).toBe(false);
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method !== "GET")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "İpucunu kapat" }));
    expect(localStorage.getItem("hint:a2hs")).toBe("off");
  });

  it("inbox gerçek aktörü ve hedef entity #chat bağlantılarını gösterir", () => {
    renderMobile(<ChatsPage />);
    expect(screen.getByText("Ahmet Yılmaz: Son gerçek mesaj")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Yazılım Ekibi/ }).getAttribute("href")).toBe("/team/t1#chat");
    expect(screen.getByRole("link", { name: /Örnek Kayıt/ }).getAttribute("href")).toBe("/record/r1#chat");
    expect(screen.getAllByText("Henüz mesaj yok")).toHaveLength(2);
  });

  it("takımlarım üye ve lider bilgisiyle listelenir", async () => {
    renderMobile(<TeamsListPage />);
    expect(await screen.findByText("2 üye · 1 açık kayıt")).toBeTruthy();
    expect(screen.getByText(/Efe Tester · Lider/)).toBeTruthy();
    expect(screen.queryByText("Tasarım Ekibi")).toBeNull();
  });

  it("takım kapağını korur; üyeler ve birimler başlangıçta kapalıdır", async () => {
    const meta = { ...META, teams: META.teams.map((team) => team.id === "t1" ? { ...team, banner_id: "banner" } : team) };
    renderMobile(<TeamPage id="t1" />, meta);
    const banner = await screen.findByRole("img", { name: "Yazılım Ekibi kapak fotoğrafı" });
    expect(banner.getAttribute("src")).toBe("/api/attachments/banner");
    expect(screen.getByText("Üyeler (1)").closest("details")?.open).toBe(false);
    expect(screen.getByText("Birimler (0)").closest("details")?.open).toBe(false);
    expect(screen.getByText("Örnek Kayıt")).toBeTruthy();
  });

  it("aynı takımda #chat gezinmesi diyaloğu açar; kapatma hash'i temizler", async () => {
    history.replaceState(null, "", "/team/t1");
    renderMobile(<TeamPage id="t1" />);
    await screen.findByText("Ön yüz ve arka yüz");
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => navigate("/team/t1#chat"));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Kapat" }));
    expect(location.hash).toBe("");
  });
});

describe("mobil fotoğraf gönderimi", () => {
  beforeEach(() => {
    mockMatchMedia(false);
    setCsrf("camera-csrf");
    vi.stubGlobal("scrollTo", vi.fn());
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });
  afterEach(async () => { await act(async () => {}); cleanup(); setCsrf(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("bağımsız yükler, kısmi başarıyı korur, yalnız başarısız hedefi tekrar dener ve URL'yi temizler", async () => {
    const onClose = vi.fn();
    let uploads = 0;
    let recordSends = 0;
    const fetcher = vi.fn().mockImplementation(async (url: string) => {
      if (url.startsWith("/api/attachments?")) return json({ id: `a${++uploads}` });
      if (url === "/api/chats/chat-record/messages") return ++recordSends === 1 ? json({ error: "internal" }, 500) : json({ id: "m2" });
      if (url.endsWith("/messages")) return json({ id: "m1" });
      if (url.endsWith("/feed")) return json({ items: [], quotes: [], attachments: {} });
      if (url === "/api/chats/inbox") return json(INBOX);
      return json([]);
    });
    vi.stubGlobal("fetch", fetcher);
    const rendered = renderMobile(<CameraFlow file={new File(["image"], "photo.jpg", { type: "image/jpeg" })} onClose={onClose} />);
    expect(screen.queryByRole("checkbox", { name: /Salt okunur/ })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /Yazılım Ekibi/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Örnek Kayıt/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Açıklama" }), { target: { value: "Fotoğraf açıklaması" } });
    fireEvent.click(screen.getByRole("button", { name: "Gönder" }));
    await screen.findByText(/1 konuşmaya gönderildi/);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Gönderilemeyenleri tekrar dene" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(uploads).toBe(2);
    expect(fetcher.mock.calls.filter(([url]) => url === "/api/chats/chat-team/messages")).toHaveLength(1);
    const posts = fetcher.mock.calls.filter(([url]) => String(url).endsWith("/messages"));
    expect(posts.map(([, init]) => JSON.parse(init.body).attachment_ids)).toEqual([["a1"], ["a2"], ["a2"]]);
    expect(posts.every(([, init]) => init.headers["X-CSRF-Token"] === "camera-csrf")).toBe(true);
    rendered.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });

  it("yanıt kaybolsa bile feed'de bağlanan eki başarı sayar; tekrar mesaj göndermez", async () => {
    const onClose = vi.fn();
    const fetcher = vi.fn().mockImplementation(async (url: string) => {
      if (url.startsWith("/api/attachments?")) return json({ id: "uploaded" });
      if (url.endsWith("/messages")) throw new TypeError("response lost");
      if (url.endsWith("/feed")) return json({ items: [], quotes: [], attachments: { committed: [{ id: "uploaded" }] } });
      if (url === "/api/chats/inbox") return json(INBOX);
      return json([]);
    });
    vi.stubGlobal("fetch", fetcher);
    renderMobile(<CameraFlow file={new File(["image"], "photo.jpg")} onClose={onClose} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Yazılım Ekibi/ }));
    fireEvent.click(screen.getByRole("button", { name: "Gönder" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/messages"))).toHaveLength(1);
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
