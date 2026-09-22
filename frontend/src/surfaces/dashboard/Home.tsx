// Panolar: sayaclar + moduller. Hazir olanlar kart; "yakinda" olanlar tek
// soluk satir — calisan uc ekran kalabaliga gomulmesin (spec/16 P2 #12).

import { useEffect } from "react";
import { useHome } from "../../api/hooks";
import { useLookup } from "../../lib/lookup";
import { Icon, type IconName } from "../../ui/icons";
import { cx, Link, Loading } from "../../ui/ui";
import s from "./dashboard.module.css";
import { href, type Route } from "./routes";

// Modul katalogu ON YUZDE: ekran metni ve rotasi burada (spec/15 kural 3).
// Ray bugun sabit (iki hazir modul); pinleme modul sayisi artinca anlam
// kazanir — uc Rust'ta hazir (`/api/pins/{slug}`).
const READY: { slug: string; icon: IconName; name: string; desc: string; route: Route }[] = [
  {
    slug: "tasks",
    icon: "tasks",
    name: "Görev Yöneticisi",
    desc: "Bütün kayıtlar tek tabloda: hızlı filtreler, özet, arama. Satır kayıt sayfasına gider.",
    route: { name: "tasks", query: {} },
  },
  {
    slug: "teams",
    icon: "teams",
    name: "Takımlar",
    desc: "Takımlar, roller, açık kayıtlar ve takım duvarı.",
    route: { name: "teams" },
  },
];

const SOON = ["Veri Yönetimi", "Pivot & Analiz", "WDS Panosu", "Takvim", "Görev Tanımları", "Ekip Arşivi", "Dosyalar", "Yönetim Paneli"];

export function Home() {
  const L = useLookup();
  const home = useHome();
  useEffect(() => {
    document.title = "Panolar — EkipTakip";
  }, []);
  const c = home.data?.counts;

  return (
    <div className={s.page}>
      <div className={s.pageHead}>
        <h1>Merhaba {L.me.name}</h1>
      </div>
      {c === undefined ? (
        <Loading />
      ) : (
        <div className={s.stats}>
          <Link className={s.stat} href={href({ name: "tasks", query: { quick: "my_actions" } })}>
            <b>{c.my_open_actions}</b>
            <span>açık eylemim</span>
          </Link>
          <Link className={cx(s.stat, c.overdue_records > 0 && s.statAlert)} href={href({ name: "tasks", query: { quick: "overdue" } })}>
            <b>{c.overdue_records}</b>
            <span>geciken kayıt</span>
          </Link>
          <Link className={s.stat} href={href({ name: "tasks", query: { quick: "unassigned" } })}>
            <b>{c.unassigned}</b>
            <span>atanmamış</span>
          </Link>
          <Link className={s.stat} href={href({ name: "tasks", query: {} })}>
            <b>{c.open_records}</b>
            <span>açık kayıt</span>
          </Link>
        </div>
      )}

      <div className={s.mods}>
        {READY.map((m) => (
          <Link key={m.slug} href={href(m.route)} className={s.mod}>
            <span className={s.modIcon}>
              <Icon name={m.icon} size={24} />
            </span>
            <h2>{m.name}</h2>
            <p>{m.desc}</p>
          </Link>
        ))}
      </div>

      <section className={s.soon} aria-labelledby="soon-h">
        <h2 id="soon-h">Yakında</h2>
        <ul className={s.soonList}>
          {SOON.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
