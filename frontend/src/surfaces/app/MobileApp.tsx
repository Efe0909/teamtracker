// app. yuzu: ust cubuk + alt sekmeler + ortada "yeni kayit". Kaynak UX:
// sahadaki mobil kalip (buyuk baslik, yapiskan arama, kart listesi).
// Masaustu yuze BAGLANTI YOK — bilincli ayrim (KNOW-153).

import { useEffect, useState, type ReactNode } from "react";
import { useMyActions, useNotifications } from "../../api/hooks";
import { NotifySettings } from "../../features/profile/NotifySettings";
import { ProfileDialog } from "../../features/profile/ProfileDialog";
import { useLookup } from "../../lib/lookup";
import { useLocation } from "../../lib/router";
import { setTheme, useTheme, type Theme } from "../../lib/theme";
import { Icon, type IconName } from "../../ui/icons";
import { Avatar, cx, Link, Menu, MenuItem, MenuLabel, MenuRadio, MenuSep, ui } from "../../ui/ui";
import { ErrorScreen } from "../errors/ErrorScreen";
import { signOut } from "../Session";
import s from "./app.module.css";
import { ActionsPage, NewPage, NotificationsPage, SearchPage, TeamsListPage, ChatsPage } from "./pages";
import { uploadFile } from "../../api/client";
import { useInbox, usePostMessage } from "../../api/hooks";
import { navigate } from "../../lib/router";

import { RecordPage, TeamPage } from "./RecordPage";
import { href, parse, type Route } from "./routes";

export default function MobileApp() {
  const route = parse(useLocation());
  return (
    <div className={s.app}>
      <Page route={route} />
      <Tabs route={route} />
    </div>
  );
}

function Page({ route }: { route: Route }) {
  switch (route.name) {
    case "actions":
      return <ActionsPage />;
    case "teams":
      return <TeamsListPage />;
    case "chats":
      return <ChatsPage />;
    case "search":
      return <SearchPage q={route.q} />;
    case "notifications":
      return <NotificationsPage />;
    case "record":
      return <RecordPage id={route.id} />;
    case "team":
      return <TeamPage id={route.id} />;
    case "new":
      return <NewPage />;
    case "notFound":
      return (
        <>
          <TopBar title="Bulunamadı" />
          <ErrorScreen code="not_found" />
        </>
      );
    default: {
      const never: never = route;
      return never;
    }
  }
}
}

const THEME_OPTS: { value: Theme; label: string; icon: IconName }[] = [
  { value: "light", label: "Açık", icon: "sun" },
  { value: "dark", label: "Koyu", icon: "moon" },
  { value: "system", label: "Sistem", icon: "system" },
];

function MobileUserMenu() {
  const L = useLookup();
  const theme = useTheme();
  const [profileOpen, setProfileOpen] = useState(!L.meta.me.profile_complete);
  const [notifyOpen, setNotifyOpen] = useState(false);
  return (
    <>
      <Menu
        align="end"
        side="bottom"
        trigger={
          <button type="button" className={ui.iconBtn} aria-label="Hesap menüsü">
            <Avatar user={L.me} size={30} />
          </button>
        }
      >
        <MenuLabel>{L.me.name}</MenuLabel>
        <MenuItem icon="user" onSelect={() => setProfileOpen(true)}>
          Profilim
        </MenuItem>
        <MenuItem icon="bell" onSelect={() => setNotifyOpen(true)}>
          Bildirimler
        </MenuItem>
        <MenuSep />
        <MenuLabel>Tema</MenuLabel>
        <MenuRadio value={theme} onChange={setTheme} options={THEME_OPTS} />
        <MenuSep />
        <MenuItem icon="logout" onSelect={() => void signOut()}>
          Çıkış yap
        </MenuItem>
      </Menu>
      <NotifySettings open={notifyOpen} onClose={() => setNotifyOpen(false)} />
      <ProfileDialog open={profileOpen} onClose={() => setProfileOpen(false)} />
    </>
  );
}

/** Ust cubuk. `back` verilirse solda geri dugmesi (gecmis yoksa listeye). */
export function TopBar({ title, back, right }: { title: string; back?: boolean; right?: ReactNode }) {
  useEffect(() => {
    document.title = `${title} — EkipTakip`;
  }, [title]);
  return (
    <header className={s.top}>
      <span className={s.slot}>
        {back === true && (
          <button
            type="button"
            className={ui.iconBtn}
            aria-label="Geri"
            onClick={() => (history.length > 1 ? history.back() : location.assign("/"))}
          >
            <Icon name="back" size={22} />
          </button>
        )}
      </span>
      <h1>{title}</h1>
      <span className={s.slot}>{right ?? <MobileUserMenu />}</span>
    </header>
  );
}

function CameraFlow({ file, onClose }: { file: File; onClose: () => void }) {
  const L = useLookup();
  const [desc, setDesc] = useState("");
  const [selectedChats, setSelectedChats] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const q = useInbox();
  
  // Create a post message hook, but we need it per chat.
  // We'll just do manual fetches for simplicity.
  const handleSend = async () => {
    if (selectedChats.length === 0) return;
    setLoading(true);
    try {
      const att = await uploadFile(file);
      for (const chatId of selectedChats) {
        await fetch(`/api/chats/${chatId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: desc, attachment_ids: [att.id] })
        });
      }
      onClose();
    } catch (e) {
      console.error(e);
      alert("Gönderilemedi");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "var(--panel)", display: "flex", flexDirection: "column" }}>
      <header className={s.top}>
        <span className={s.slot}>
          <button type="button" className={ui.iconBtn} onClick={onClose}><Icon name="x" size={22} /></button>
        </span>
        <h1>Fotoğraf Gönder</h1>
        <span className={s.slot}></span>
      </header>
      <div className={s.pad} style={{ flex: 1, overflowY: "auto" }}>
        <img src={URL.createObjectURL(file)} style={{ width: "100%", maxHeight: 200, objectFit: "contain", background: "#000", borderRadius: "var(--r-md)" }} />
        <textarea
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="Açıklama ekle..."
          style={{ width: "100%", marginTop: "var(--s-3)", minHeight: 80, padding: "var(--s-2)", borderRadius: "var(--r-md)", border: "1px solid var(--line)" }}
        />
        <h3 style={{ marginTop: "var(--s-4)", marginBottom: "var(--s-2)" }}>Gönderilecek Sohbetler</h3>
        {q.data === undefined ? <Loading /> : q.data.length === 0 ? <p>Sohbet yok.</p> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {q.data.map(c => (
              <label key={c.chat_id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "var(--s-2)", border: "1px solid var(--line)", borderRadius: "var(--r-md)" }}>
                <input type="checkbox" checked={selectedChats.includes(c.chat_id)} onChange={e => {
                  if (e.target.checked) setSelectedChats([...selectedChats, c.chat_id]);
                  else setSelectedChats(selectedChats.filter(id => id !== c.chat_id));
                }} style={{ width: 20, height: 20 }} />
                <span>{c.title} <span style={{ color: "var(--dim)", fontSize: "var(--fs-sm)" }}>({c.kind === "team" ? "Takım" : "Kayıt"})</span></span>
              </label>
            ))}
          </div>
        )}
      </div>
      <div style={{ padding: "var(--s-3)", borderTop: "1px solid var(--line)" }}>
        <button onClick={handleSend} disabled={loading || selectedChats.length === 0} style={{ width: "100%", padding: "12px", background: "var(--acc-strong)", color: "#fff", border: 0, borderRadius: "var(--r-md)", fontWeight: 600 }}>
          {loading ? "Gönderiliyor..." : "Gönder"}
        </button>
      </div>
    </div>
  );
}

function FabMenu({ onFile }: { onFile: (f: File) => void }) {
  const fileInput = import("react").then(r => r.useRef<HTMLInputElement>(null)); // use standard useRef
  const ref = { current: null as any };
  return (
    <>
      <Menu
        align="center"
        side="top"
        trigger={
          <button type="button" aria-label="Ekle" style={{ background: "transparent", border: 0, cursor: "pointer", display: "flex", color: "inherit" }}>
            <Icon name="plus" size={28} label="Ekle" />
          </button>
        }
      >
        <MenuItem icon="search" onSelect={() => navigate(href({ name: "search", q: "" }))}>Arama</MenuItem>
        <MenuItem icon="plus" onSelect={() => navigate(href({ name: "new" }))}>Yeni Kayıt</MenuItem>
        <MenuItem icon="image" onSelect={() => {
           document.getElementById("camera-input")?.click();
        }}>Fotoğraf Çek / Seç</MenuItem>
      </Menu>
      <input id="camera-input" type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) {
          onFile(file);
          e.target.value = "";
        }
      }} />
    </>
  );
}

function Tabs({ route }: { route: Route }) {
  const notes = useNotifications();
  const acts = useMyActions();
  const inbox = useInbox();
  const [cameraFile, setCameraFile] = useState<File | null>(null);

  // Rozet: son "gordum"den beri okunmamis (sunucu sayar, tercihe gore suzulmus).
  const fresh = notes.data?.unread ?? 0;
  const unreadChats = inbox.data?.filter(c => c.unread).length ?? 0;
  
  const items: { r: Route; icon: IconName; label: string; on: boolean; badge?: number }[] = [
    { r: { name: "actions" }, icon: "bolt", label: "Eylemler", on: route.name === "actions", badge: acts.data?.length ?? 0 },
    { r: { name: "teams" }, icon: "users", label: "Takımlar", on: route.name === "teams" },
    { r: { name: "chats" }, icon: "chat", label: "Konuşmalar", on: route.name === "chats", badge: unreadChats },
    { r: { name: "notifications" }, icon: "bell", label: "Bildirim", on: route.name === "notifications", badge: fresh },
  ];
  const tab = (i: (typeof items)[number]) => (
    <Link key={i.label} href={href(i.r)} className={cx(s.tab, i.on && s.tabOn)}>
      <Icon name={i.icon} size={24} />
      {i.label}
      {i.badge !== undefined && i.badge > 0 && <span className={s.badge}>{i.badge > 99 ? "99+" : i.badge}</span>}
    </Link>
  );
  return (
    <>
      <nav className={s.tabs} aria-label="Sekmeler">
        <div className={s.tabsIn}>
          {items.slice(0, 2).map(tab)}
          <span className={s.fab}>
            <FabMenu onFile={setCameraFile} />
          </span>
          {items.slice(2).map(tab)}
        </div>
      </nav>
      {cameraFile && <CameraFlow file={cameraFile} onClose={() => setCameraFile(null)} />}
    </>
  );
}
      {i.badge !== undefined && i.badge > 0 && <span className={s.badge}>{i.badge > 99 ? "99+" : i.badge}</span>}
    </Link>
  );
  return (
    <nav className={s.tabs} aria-label="Sekmeler">
      <div className={s.tabsIn}>
        {items.slice(0, 2).map(tab)}
        <span className={s.fab}>
          <Link href={href({ name: "new" })} title="Yeni kayıt">
            <Icon name="plus" size={28} label="Yeni kayıt" />
          </Link>
        </span>
        {items.slice(2).map(tab)}
      </div>
    </nav>
  );
}
