// Bildirimler: mobildeki liste (surfaces/app/pages.tsx NotificationsPage) ile ayni
// veri ve ayni "gordum" mantigi; masaustu satir diliyle. Ayarlar yan menudeki
// kisi menusuyle ayni NotifySettings penceresi.

import { useEffect, useRef, useState } from "react";
import { useMarkSeen, useNotifications } from "../../api/hooks";
import { NotifySettings } from "../../features/profile/NotifySettings";
import { describe } from "../../lib/activity";
import { ago } from "../../lib/labels";
import { useLookup } from "../../lib/lookup";
import { mentionsMe } from "../../lib/mentions";
import { Button, cx, Empty, Link, Loading, Tag, Who } from "../../ui/ui";
import s from "./dashboard.module.css";
import { href } from "./routes";

export function Notifications() {
  const L = useLookup();
  const q = useNotifications();
  const seen = useMarkSeen();
  const [settings, setSettings] = useState(false);
  useEffect(() => {
    document.title = "Bildirimler — EkipTakip";
  }, []);

  // Liste gorununce "gordum": rozet sifirlanir, satirlar bu yuklemede vurgulu kalir.
  const loaded = q.data !== undefined && q.data.unread > 0;
  const fresh = useRef<Set<string> | null>(null);
  if (fresh.current === null && q.data !== undefined) {
    fresh.current = new Set(q.data.items.filter((n) => n.unread).map((n) => n.id));
  }
  useEffect(() => {
    if (loaded) seen.mutate();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  return (
    <div className={s.page}>
      <div className={s.pageHead}>
        <div className={s.pageTitle}>
          <h1>Bildirimler</h1>
          <p className={s.pageSub}>Kayıtlarında ve takımlarında olan hareketler.</p>
        </div>
        <Button onClick={() => setSettings(true)}>Bildirim ayarları</Button>
      </div>
      <NotifySettings open={settings} onClose={() => setSettings(false)} />
      {q.error !== null ? (
        <p role="alert">Bildirimler yüklenemedi.</p>
      ) : q.data === undefined ? (
        <Loading />
      ) : q.data.items.length === 0 ? (
        <Empty title="Sessiz" icon="bell">Kayıtlarında ve takımlarında hareket olunca burada görünür.</Empty>
      ) : (
        <section className={s.surface} aria-label="Bildirim listesi">
          <ul className={s.rows}>
            {q.data.items.map((n) => {
              const actor = L.user(n.actor_id);
              const to = n.record_id !== null ? href({ name: "record", id: n.record_id }) : href({ name: "team", id: n.team_id ?? "" });
              return (
                <li key={n.id}>
                  <Link href={to} className={cx(s.row, fresh.current?.has(n.id) === true && s.rowUnread)}>
                    <Who user={actor} empty="Sistem" />
                    <span className={s.rowMain}>
                      <b>{n.kind === "message" ? (n.body ?? "") : describe(n, L)}</b>
                      <span>{n.team_id !== null ? "Takım duvarı · " : ""}{n.title}</span>
                    </span>
                    {n.kind === "message" && mentionsMe(n.body, L.me.name) && <Tag tone="info">seni andı</Tag>}
                    <span className={`${s.rowMeta} ${s.rowTime}`}>{ago(n.created_at)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
