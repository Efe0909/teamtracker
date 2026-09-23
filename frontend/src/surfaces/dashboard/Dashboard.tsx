// dashboard. yuzu: sol ray + icerik. Ray etiketleri gorunur (yalniz hover
// degil, spec/16 P2 #11). Mobil yuze BAGLANTI YOK — bilincli ayrim (KNOW-153).

import { useEffect, useState } from "react";
import { useLookup } from "../../lib/lookup";
import { useLocation } from "../../lib/router";
import { Icon, type IconName } from "../../ui/icons";
import { Avatar, cx, Link } from "../../ui/ui";
import { ErrorScreen } from "../errors/ErrorScreen";
import { signOut } from "../Session";
import { Admin } from "./Admin";
import s from "./dashboard.module.css";
import { DataTree } from "./DataTree";
import { Home } from "./Home";
import { RecordPage } from "./RecordPage";
import { href, parse, type Route } from "./routes";
import { Tasks } from "./Tasks";
import { TeamPage, Teams } from "./Teams";

export default function Dashboard() {
  const route = parse(useLocation());
  return (
    <div className={s.shell}>
      <Rail route={route} />
      <main className={s.main} id="main">
        <Page route={route} />
      </main>
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

type NavItem = { route: Route; icon: IconName; label: string; match: Route["name"][] };

/** Yalniz admin ya da manage_users gorur; uc yine kendisi kontrol eder. */
const ADMIN_NAV: NavItem = { route: { name: "admin" }, icon: "lock", label: "Yönetim", match: ["admin"] };

const NAV: NavItem[] = [
  { route: { name: "home" }, icon: "home", label: "Panolar", match: ["home"] },
  { route: { name: "tasks", query: {} }, icon: "tasks", label: "Görevler", match: ["tasks", "record"] },
  { route: { name: "teams" }, icon: "teams", label: "Takımlar", match: ["teams", "team"] },
  { route: { name: "tree" }, icon: "tree", label: "Veri", match: ["tree"] },
];

function Rail({ route }: { route: Route }) {
  const L = useLookup();
  const nav = L.meta.me.is_admin || L.can("manage_users") ? [...NAV, ADMIN_NAV] : NAV;
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    if (!menu) return;
    const close = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [menu]);
  return (
    <nav className={s.rail} aria-label="Ana gezinme">
      <a className={s.skip} href="#main">İçeriğe geç</a>
      <span className={s.logo} aria-hidden="true">
        <svg viewBox="0 0 32 32" width="34" height="34">
          <rect width="32" height="32" rx="9" className={s.logoBg} />
          <path d="M9 11h9M9 16h14M9 21h6" className={s.logoLine} />
        </svg>
      </span>
      {nav.map((n) => {
        const on = n.match.includes(route.name);
        return (
          <Link key={n.label} href={href(n.route)} className={cx(s.rbtn, on && s.rbtnOn)}>
            <Icon name={n.icon} size={22} />
            <span className={s.rlabel}>{n.label}</span>
          </Link>
        );
      })}
      <div className={s.grow} />
      <div className={s.me}>
        <button
          type="button"
          className={s.rbtn}
          aria-expanded={menu}
          aria-haspopup="menu"
          onClick={() => setMenu((v) => !v)}
        >
          <Avatar user={L.me} size={30} />
          <span className={s.rlabel}>{L.me.name}</span>
        </button>
        {menu && (
          <div className={s.menu} role="menu">
            <div className={s.menuHead}>
              <b>{L.me.name}</b>
              {L.meta.me.is_admin && <span>Yönetici</span>}
            </div>
            <button role="menuitem" type="button" className={s.menuItem} onClick={() => void signOut()}>
              <Icon name="logout" size={18} /> Çıkış yap
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
