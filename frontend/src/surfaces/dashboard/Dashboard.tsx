// dashboard. yuzu: kenar cubugu + icerik. Kenar cubugu tam etiketli (ikon +
// ad), takimlar kisayol olarak listelenir, en altta kisi menusu (tema, cikis).
// Dar ekranda cubuk cekmeceye doner. ⌘K her yerden komut paletini acar.
// Mobil yuze BAGLANTI YOK — bilincli ayrim (KNOW-153).

import { useEffect, useState } from "react";
import { useLookup } from "../../lib/lookup";
import { useLocation } from "../../lib/router";
import { setTheme, useTheme, type Theme } from "../../lib/theme";
import { Icon, type IconName } from "../../ui/icons";
import { Avatar, cx, IconButton, Kbd, Link, Menu, MenuItem, MenuLabel, MenuRadio, MenuSep } from "../../ui/ui";
import { ErrorScreen } from "../errors/ErrorScreen";
import { signOut } from "../Session";
import { Admin } from "./Admin";
import s from "./dashboard.module.css";
import { DataTree } from "./DataTree";
import { Home } from "./Home";
import { Palette } from "./Palette";
import { RecordPage } from "./RecordPage";
import { href, parse, type Route } from "./routes";
import { Tasks } from "./Tasks";
import { TeamPage, Teams } from "./Teams";

export default function Dashboard() {
  const route = parse(useLocation());
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);

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
    <div className={s.shell} data-drawer={drawer}>
      <a className={s.skip} href="#main">İçeriğe geç</a>
      <Sidebar route={route} onSearch={() => setPalette(true)} />
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
    case "teams":
      return <Teams />;
    case "team":
      return <TeamPage id={route.id} />;
    case "tree":
      return <DataTree />;
    case "admin":
      return <Admin />;
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
  { route: { name: "teams" }, icon: "teams", label: "Takımlar", match: ["teams"] },
  { route: { name: "tree" }, icon: "tree", label: "Veri yönetimi", match: ["tree"] },
];

/** Yalniz admin ya da manage_users gorur; uc yine kendisi kontrol eder. */
const ADMIN_NAV: NavItem = { route: { name: "admin" }, icon: "lock", label: "Yönetim", match: ["admin"] };

const THEME_OPTS: { value: Theme; label: string; icon: IconName }[] = [
  { value: "light", label: "Açık", icon: "sun" },
  { value: "dark", label: "Koyu", icon: "moon" },
  { value: "system", label: "Sistem", icon: "system" },
];

function Sidebar({ route, onSearch }: { route: Route; onSearch: () => void }) {
  const L = useLookup();
  const theme = useTheme();
  const admin = L.meta.me.is_admin || L.can("manage_users");
  const mine = new Set(L.meta.me.team_ids);
  const teams = [...L.meta.teams].sort((a, b) => Number(mine.has(b.id)) - Number(mine.has(a.id)) || a.name.localeCompare(b.name, "tr"));
  const current = route.name === "team" ? route.id : null;

  const item = (n: NavItem) => {
    const on = n.match.includes(route.name);
    return (
      <Link key={n.label} href={href(n.route)} className={cx(s.nav, on && s.navOn)} aria-current={on ? "page" : undefined}>
        <Icon name={n.icon} size={16} />
        <span>{n.label}</span>
      </Link>
    );
  };

  return (
    <nav className={s.side} aria-label="Ana gezinme">
      <div className={s.sideTop}>
        <Brand />
        <span className={s.ver}>alpha 0.2</span>
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
        {NAV.map(item)}
        {admin && item(ADMIN_NAV)}
      </div>

      {teams.length > 0 && (
        <div className={s.navGroup}>
          <span className={s.navHead}>Takımlar</span>
          {teams.map((t) => (
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
        <MenuLabel>Tema</MenuLabel>
        <MenuRadio value={theme} onChange={setTheme} options={THEME_OPTS} />
        <MenuSep />
        <MenuItem icon="logout" onSelect={() => void signOut()}>
          Çıkış yap
        </MenuItem>
      </Menu>
    </nav>
  );
}
