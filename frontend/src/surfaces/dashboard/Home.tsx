// Panolar: sayac seridi + son hareket + moduller. Hazir olanlar satir;
// "yakinda" olanlar tek soluk liste (spec/16 P2 #12).

import { useEffect, useState } from "react";
import { useHome, useRecords } from "../../api/hooks";
import { NewRecordForm } from "../../features/record/NewRecordForm";
import { ago } from "../../lib/labels";
import { useLookup } from "../../lib/lookup";
import { navigate } from "../../lib/router";
import { Icon, type IconName } from "../../ui/icons";
import { Button, cx, Dialog, Kbd, Link, Loading, Status, Who } from "../../ui/ui";
import s from "./dashboard.module.css";
import { href, type Route } from "./routes";

// Modul katalogu ON YUZDE: ekran metni ve rotasi burada (spec/15 kural 3).
const READY: { slug: string; icon: IconName; name: string; desc: string; route: Route }[] = [
  {
    slug: "tasks",
    icon: "tasks",
    name: "Görev Yöneticisi",
    desc: "Bütün kayıtlar tek tabloda: filtre, arama, özet.",
    route: { name: "tasks", query: {} },
  },
  {
    slug: "teams",
    icon: "teams",
    name: "Takımlar",
    desc: "Üyeler, roller, açık kayıtlar ve takım duvarı.",
    route: { name: "teams" },
  },
  {
    slug: "pillars",
    icon: "pin",
    name: "Pillar'lar",
    desc: "Kesişen sorumluluk alanları: kendi takımı, sohbeti ve kayıtları.",
    route: { name: "pillars" },
  },
  {
    slug: "outcome-tree",
    icon: "tree",
    name: "Veri Yönetimi",
    desc: "Yapı: düğüm ekle, adlandır, taşı, pasifleştir.",
    route: { name: "tree" },
  },
];

const SOON = ["Pivot & Analiz", "WDS Panosu", "Takvim", "Görev Tanımları", "Ekip Arşivi", "Dosyalar"];

/** Yalniz acabilene gorunur (kenar cubugu ile ayni kural); uc yine kendisi kontrol eder. */
const ADMIN_MOD = {
  slug: "admin",
  icon: "lock" as const,
  name: "Yönetim Paneli",
  desc: "Kullanıcılar, kapsamlar, roller, dal izinleri.",
  route: { name: "admin" } as const,
};

function greeting(): string {
  const h = new Date().getHours();
  return h < 6 ? "İyi geceler" : h < 12 ? "Günaydın" : h < 18 ? "İyi günler" : "İyi akşamlar";
}

export function Home() {
  const L = useLookup();
  const home = useHome();
  const recent = useRecords({});
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    document.title = "Panolar — EkipTakip";
  }, []);
  const c = home.data?.counts;
  const mods = L.meta.me.is_admin || L.can("manage_users") ? [...READY, ADMIN_MOD] : READY;
  const today = new Date().toLocaleDateString("tr", { weekday: "long", day: "numeric", month: "long" });

  const stat = (n: number, label: string, icon: IconName, q: Route, alert = false) => (
    <Link className={cx(s.stat, alert && n > 0 && s.statAlert)} href={href(q)}>
      <span className={s.statLabel}>
        <Icon name={icon} size={14} />
        {label}
        <Icon name="external" size={14} />
      </span>
      <b>{n}</b>
    </Link>
  );

  return (
    <div className={s.page}>
      <div className={s.pageHead}>
        <div className={s.pageTitle}>
          <h1>
            {greeting()}, {L.me.name}
          </h1>
          <p className={s.pageSub}>
            {today} · her yere <Kbd>⌘</Kbd> <Kbd>K</Kbd> ile git
          </p>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Icon name="plus" size={15} /> Yeni kayıt
        </Button>
      </div>

      {c === undefined ? (
        <Loading />
      ) : (
        <div className={`${s.surface} ${s.stats}`}>
          {stat(c.my_open_actions, "Açık eylemim", "bolt", { name: "tasks", query: { quick: "my_actions" } })}
          {stat(c.overdue_records, "Geciken kayıt", "alert", { name: "tasks", query: { quick: "overdue" } }, true)}
          {stat(c.unassigned, "Atanmamış", "user", { name: "tasks", query: { quick: "unassigned" } })}
          {stat(c.open_records, "Açık kayıt", "stOpen", { name: "tasks", query: {} })}
        </div>
      )}

      <div className={s.homeGrid}>
        <section className={s.surface} aria-labelledby="recent-h">
          <div className={s.surfaceHead}>
            <span id="recent-h">Son hareket</span>
            <Link href={href({ name: "tasks", query: {} })}>Tümü →</Link>
          </div>
          {recent.data === undefined ? (
            <Loading />
          ) : (
            <ul className={s.rows}>
              {recent.data.slice(0, 7).map((r) => (
                <li key={r.id}>
                  <Link href={href({ name: "record", id: r.id })} className={s.row}>
                    <Status status={r.status} />
                    <span className={s.rowMain}>
                      <b>{r.title}</b>
                      <span>{L.path(r.unit_id).join(" › ")}</span>
                    </span>
                    <span className={s.rowWho}>
                      <Who user={L.user(r.owner_id)} empty="Sorumlusuz" />
                    </span>
                    <span className={`${s.rowMeta} ${s.rowTime}`}>{ago(r.updated_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <section className={s.surface} aria-labelledby="mods-h">
            <div className={s.surfaceHead}>
              <span id="mods-h">Modüller</span>
            </div>
            <ul className={s.rows}>
              {mods.map((m) => (
                <li key={m.slug}>
                  <Link href={href(m.route)} className={s.row}>
                    <span className={s.rowIcon}>
                      <Icon name={m.icon} size={15} />
                    </span>
                    <span className={s.rowMain}>
                      <b>{m.name}</b>
                      <span>{m.desc}</span>
                    </span>
                    <Icon name="chevron" size={15} />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
          <section className={s.surface} aria-labelledby="soon-h">
            <div className={s.surfaceHead}>
              <span id="soon-h">Yakında</span>
            </div>
            <ul className={s.soonList}>
              {SOON.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      <Dialog open={creating} onClose={() => setCreating(false)} title="Yeni kayıt" wide>
        <NewRecordForm
          onCancel={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            navigate(href({ name: "record", id }));
          }}
        />
      </Dialog>
    </div>
  );
}
