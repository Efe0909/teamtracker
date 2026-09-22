// app. yuzu: ust cubuk + alt sekmeler + ortada "yeni kayit". Kaynak UX:
// sahadaki mobil kalip (buyuk baslik, yapiskan arama, kart listesi).

import { useEffect, useState, type ReactNode } from "react";
import { useMyActions, useNotifications } from "../../api/hooks";
import { surfaceUrl } from "../../api/session";
import { useLookup } from "../../lib/lookup";
import { useLocation } from "../../lib/router";
import { Icon, type IconName } from "../../ui/icons";
import { Avatar, cx, Link, ui } from "../../ui/ui";
import { ErrorScreen } from "../errors/ErrorScreen";
import { signOut } from "../Session";
import s from "./app.module.css";
import { ActionsPage, NewPage, NotificationsPage, SearchPage, TodoPage } from "./pages";
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
    case "todo":
      return <TodoPage done={route.done} />;
    case "search":
      return <SearchPage q={route.q} />;
    case "actions":
      return <ActionsPage />;
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

/** Ust cubuk. `back` verilirse solda geri dugmesi (gecmis yoksa listeye). */
export function TopBar({ title, back, right }: { title: string; back?: boolean; right?: ReactNode }) {
  const L = useLookup();
  const [menu, setMenu] = useState(false);
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
      <span className={s.slot}>
        {right ?? (
          <button type="button" className={ui.iconBtn} aria-label="Hesap menüsü" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
            <Avatar user={L.me} size={30} />
          </button>
        )}
      </span>
      {menu && (
        <div className={s.menu} role="menu">
          <div className={s.menuHead}>{L.me.name}</div>
          <a role="menuitem" className={s.menuItem} href={surfaceUrl("dashboard")}>
            <Icon name="monitor" size={18} /> Masaüstü paneli
          </a>
          <button role="menuitem" type="button" className={s.menuItem} onClick={() => void signOut()}>
            <Icon name="logout" size={18} /> Çıkış yap
          </button>
        </div>
      )}
    </header>
  );
}

const DAY = 86_400_000;

function Tabs({ route }: { route: Route }) {
  const notes = useNotifications();
  const acts = useMyActions();
  // Rozet: son 24 saatteki hareket (okundu bilgisi henuz yok, spec/20 §6).
  const fresh = (notes.data ?? []).filter((n) => Date.now() - new Date(n.created_at).getTime() < DAY).length;
  const items: { r: Route; icon: IconName; label: string; on: boolean; badge?: number }[] = [
    { r: { name: "todo", done: false }, icon: "tasks", label: "Yapılacak", on: route.name === "todo" },
    { r: { name: "search", q: "" }, icon: "search", label: "Ara", on: route.name === "search" },
    { r: { name: "actions" }, icon: "bolt", label: "Eylemler", on: route.name === "actions", badge: acts.data?.length ?? 0 },
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
