// dashboard. yuzu: kenar cubugu + icerik. Kenar cubugu tam etiketli (ikon +
// ad), takimlar kisayol olarak listelenir, en altta kisi menusu (tema, cikis).
// Dar ekranda cubuk cekmeceye doner. ⌘K her yerden komut paletini acar.
// Mobil yuze BAGLANTI YOK — bilincli ayrim (KNOW-153).

import { useEffect, useRef, useState } from "react";
import { useNotifications } from "../../api/hooks";
import { NotifySettings } from "../../features/profile/NotifySettings";
import { ProfileDialog } from "../../features/profile/ProfileDialog";
import { useLookup } from "../../lib/lookup";
import { mergeOrder, moveTo } from "../../lib/order";
import { useLocation } from "../../lib/router";
import { useStored } from "../../lib/stored";
import { setTheme, useTheme, type Theme } from "../../lib/theme";
import { Icon, type IconName } from "../../ui/icons";
import { Avatar, cx, IconButton, Kbd, Link, Menu, MenuItem, MenuLabel, MenuRadio, MenuSep } from "../../ui/ui";
import { ErrorScreen } from "../errors/ErrorScreen";
import { signOut } from "../Session";
import { Admin } from "./Admin";
import { AdminLlmProfile } from "./AdminLlmProfile";
import { AdminLlmTask } from "./AdminLlmTask";
import s from "./dashboard.module.css";
import { DataTree } from "./DataTree";
import { EventPage } from "./EventPage";
import { Events } from "./Events";
import { Home } from "./Home";
import { Notifications } from "./Notifications";
import { People } from "./People";
import { Palette } from "./Palette";
import { PillarPage, Pillars } from "./Pillars";
import { RecordPage } from "./RecordPage";
import { href, parse, type Route } from "./routes";
import { Tasks } from "./Tasks";
import { TeamPage, Teams } from "./Teams";

export default function Dashboard() {
  const route = parse(useLocation());
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);
  // Masaustunde kenar cubugu daraltilir; tercih cihazda hatirlanir.
  const [folded, setFolded] = useStored("side.folded", false);

  // Gezinince cekmece kapanir.
  useEffect(() => setDrawer(false), [route.name, "id" in route ? route.id : ""]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className={s.shell} data-drawer={drawer} data-folded={folded}>
      <a className={s.skip} href="#main">İçeriğe geç</a>
      <Sidebar route={route} onSearch={() => setPalette(true)} onFold={() => setFolded(true)} />
      {folded && (
        <span className={s.foldOpen}>
          <IconButton icon="chevron" label="Kenar çubuğunu aç" onClick={() => setFolded(false)} />
        </span>
      )}
      <button type="button" className={s.scrim} aria-label="Menüyü kapat" tabIndex={-1} onClick={() => setDrawer(false)} />
      <div className={s.column}>
        <header className={s.mobileBar}>
          <IconButton icon="sliders" label="Menü" onClick={() => setDrawer(true)} />
          <Brand />
          <IconButton icon="search" label="Ara" onClick={() => setPalette(true)} />
        </header>
        <main className={s.main} id="main">
          <Page route={route} />
        </main>
      </div>
      <Palette open={palette} onOpenChange={setPalette} />
    </div>
  );
}

function Page({ route }: { route: Route }) {
  switch (route.name) {
    case "home":
      return <Home />;
    case "tasks":
      return <Tasks query={route.query} />;
    case "record":
      return <RecordPage id={route.id} />;
    case "events":
      return <Events query={route.query} />;
    case "event":
      return <EventPage id={route.id} />;
    case "teams":
      return <Teams />;
    case "team":
      return <TeamPage id={route.id} />;
    case "pillars":
      return <Pillars />;
    case "pillar":
      return <PillarPage id={route.id} />;
    case "tree":
      return <DataTree />;
    case "people":
      return <People />;
    case "notifications":
      return <Notifications />;
    case "admin":
      return <Admin />;
    case "llmProfile":
      return <AdminLlmProfile id={route.id} />;
    case "llmTask":
      return <AdminLlmTask feature={route.feature} />;
    case "notFound":
      return <ErrorScreen code="not_found" />;
    default: {
      const never: never = route;
      return never;
    }
  }
}

function Brand() {
  return (
    <span className={s.brand}>
      <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true">
        <rect width="32" height="32" rx="8" className={s.logoBg} />
        <path d="M9 11h9M9 16h14M9 21h6" className={s.logoLine} />
      </svg>
      <span>EkipTakip</span>
    </span>
  );
}

type NavItem = { route: Route; icon: IconName; label: string; match: Route["name"][] };

const NAV: NavItem[] = [
  { route: { name: "home" }, icon: "home", label: "Panolar", match: ["home"] },
  { route: { name: "tasks", query: {} }, icon: "tasks", label: "Görevler", match: ["tasks", "record"] },
  { route: { name: "events", query: {} }, icon: "calendar", label: "Etkinlikler", match: ["events", "event"] },
  { route: { name: "teams" }, icon: "teams", label: "Takımlar", match: ["teams"] },
  { route: { name: "notifications" }, icon: "bell", label: "Bildirimler", match: ["notifications"] },
  { route: { name: "people" }, icon: "user", label: "Ekip", match: ["people"] },
  { route: { name: "pillars" }, icon: "pin", label: "Pillar'lar", match: ["pillars"] },
  { route: { name: "tree" }, icon: "tree", label: "Veri yönetimi", match: ["tree"] },
];

/** Yalniz admin, manage_users ya da manage_llm gorur; uc yine kendisi kontrol eder. */
const ADMIN_NAV: NavItem = { route: { name: "admin" }, icon: "lock", label: "Yönetim", match: ["admin", "llmProfile", "llmTask"] };

const THEME_OPTS: { value: Theme; label: string; icon: IconName }[] = [
  { value: "light", label: "Açık", icon: "sun" },
  { value: "dark", label: "Koyu", icon: "moon" },
  { value: "system", label: "Sistem", icon: "system" },
];

function Sidebar({ route, onSearch, onFold }: { route: Route; onSearch: () => void; onFold: () => void }) {
  const L = useLookup();
  const theme = useTheme();
  const unread = useNotifications().data?.unread ?? 0;
  const admin = L.can("manage_users") || L.can("manage_llm");
  const mine = new Set(L.meta.me.team_ids);
  const teams = [...L.plainTeams].sort((a, b) => Number(mine.has(b.id)) - Number(mine.has(a.id)) || a.name.localeCompare(b.name, "tr"));
  const [profileOpen, setProfileOpen] = useState(!L.meta.me.profile_complete);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [teamsOpen, setTeamsOpen] = useStored("nav.teams.open", true);
  const current = route.name === "team" || route.name === "pillar" ? route.id : null;

  // Modul dugmeleri surukleyerek (ya da Alt+Yukari/Asagi) siralanir; sira cihazda hatirlanir.
  const [savedOrder, setSavedOrder] = useStored<string[]>("nav.order", []);
  const order = mergeOrder(savedOrder, NAV.map((n) => n.route.name));
  const navByKey = new Map<string, NavItem>(NAV.map((n) => [n.route.name, n]));
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const refocus = useRef<string | null>(null);
  // DOM tasininca odak dusebilir: klavye ile tasinan oge odagi geri alir.
  useEffect(() => {
    if (refocus.current === null) return;
    document.getElementById(`nav-${refocus.current}`)?.focus();
    refocus.current = null;
  });
  const drop = (from: string, to: string) => {
    setSavedOrder(moveTo(order, from, to));
    setDragKey(null);
    setOverKey(null);
  };

  const item = (n: NavItem, movable = false) => {
    const on = n.match.includes(route.name);
    const key = n.route.name;
    return (
      <Link
        key={n.label}
        href={href(n.route)}
        className={cx(
          s.nav,
          on && s.navOn,
          movable && dragKey === key && s.navDrag,
          movable && dragKey !== null && dragKey !== key && overKey === key && s.navOver,
        )}
        aria-current={on ? "page" : undefined}
        {...(movable ? { title: "Sürükle ya da Alt+↑/↓ ile sırala" } : {})}
        extra={
          movable
            ? {
                draggable: true,
                id: `nav-${key}`,
                onDragStart: (e) => {
                  e.dataTransfer.effectAllowed = "move";
                  setDragKey(key);
                },
                onDragEnd: () => {
                  setDragKey(null);
                  setOverKey(null);
                },
                onDragOver: (e) => {
                  if (dragKey === null) return;
                  e.preventDefault();
                  setOverKey(key);
                },
                onDrop: (e) => {
                  e.preventDefault();
                  if (dragKey !== null) drop(dragKey, key);
                },
                onKeyDown: (e) => {
                  if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
                  e.preventDefault();
                  const to = order[order.indexOf(key) + (e.key === "ArrowUp" ? -1 : 1)];
                  if (to === undefined) return;
                  refocus.current = key;
                  setSavedOrder(moveTo(order, key, to));
                },
              }
            : undefined
        }
      >
        <Icon name={n.icon} size={16} />
        <span>{n.label}</span>
        {key === "notifications" && unread > 0 && (
          <span className={s.navBadge} aria-label={`${unread} okunmamış`}>{unread > 99 ? "99+" : unread}</span>
        )}
      </Link>
    );
  };

  return (
    <nav className={s.side} aria-label="Ana gezinme">
      <div className={s.sideTop}>
        <Brand />
        <span className={s.ver}>v{L.meta.version ?? __APP_VERSION__}</span>
        <span className={s.foldBtn}>
          <IconButton icon="back" label="Kenar çubuğunu daralt" onClick={onFold} />
        </span>
      </div>

      <button type="button" className={s.searchBtn} onClick={onSearch}>
        <Icon name="search" size={15} />
        <span>Ara ya da git…</span>
        <span className={s.keys}>
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>

      <div className={s.navGroup}>
        <span className={s.navHead}>Çalışma alanı</span>
        {order.flatMap((k) => navByKey.get(k) ?? []).map((n) => item(n, true))}
        {admin && item(ADMIN_NAV)}
      </div>

      {L.pillars.length > 0 && (
        <div className={s.navGroup}>
          <span className={s.navHead}>Pillar'lar</span>
          {L.pillars.map((p) => (
            <Link
              key={p.id}
              href={href({ name: "pillar", id: p.id })}
              className={cx(s.nav, current === p.id && s.navOn)}
              aria-current={current === p.id ? "page" : undefined}
            >
              <span className={s.pillarDot} style={p.color !== null ? { background: p.color } : undefined} aria-hidden="true" />
              <span>{p.name}</span>
              {mine.has(p.team_id) && <span className={s.navMeta}>üye</span>}
            </Link>
          ))}
        </div>
      )}

      {teams.length > 0 && (
        <div className={s.navGroup}>
          <button type="button" className={s.navHeadBtn} aria-expanded={teamsOpen} onClick={() => setTeamsOpen(!teamsOpen)}>
            <span>Takımlar</span>
            <Icon name="chevron" size={12} />
          </button>
          {teamsOpen && teams.map((t) => (
            <Link
              key={t.id}
              href={href({ name: "team", id: t.id })}
              className={cx(s.nav, current === t.id && s.navOn)}
              aria-current={current === t.id ? "page" : undefined}
            >
              <span className={s.teamDot} style={t.color !== null ? { background: t.color } : undefined} aria-hidden="true" />
              <span>{t.name}</span>
              {mine.has(t.id) && <span className={s.navMeta}>üye</span>}
            </Link>
          ))}
        </div>
      )}

      <div className={s.grow} />

      <Menu
        side="top"
        trigger={
          <button type="button" className={s.me}>
            <Avatar user={L.me} size={26} />
            <span className={s.meText}>
              <b>{L.me.name}</b>
              <span>{L.meta.me.is_admin ? "Yönetici" : "Üye"}</span>
            </span>
            <Icon name="updown" size={14} />
          </button>
        }
      >
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
    </nav>
  );
}
