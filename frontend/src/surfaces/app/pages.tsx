// Mobil liste sayfalari: yapilacaklar, arama, eylemlerim, bildirimler, yeni.

import { useEffect, useRef, useState } from "react";
import { NotifySettings } from "../../features/profile/NotifySettings";
import { useMarkSeen, useMyActions, useNotifications, useRecords, useInbox, useTeams } from "../../api/hooks";
import type { MyAction, RecordSummary } from "../../api/types";
import { NewRecordForm } from "../../features/record/NewRecordForm";
import { describe } from "../../lib/activity";
import { ago, daysFromToday, isDone, TEAM_ROLE } from "../../lib/labels";
import { useLookup } from "../../lib/lookup";
import { mentionsMe } from "../../lib/mentions";
import { navigate } from "../../lib/router";
import { Icon } from "../../ui/icons";
import { Avatar, cx, Due, Empty, KindTag, Link, Loading, PriorityTag, Status, Tag, ui } from "../../ui/ui";
import s from "./app.module.css";
import { TopBar } from "./MobileApp";
import { href } from "./routes";

// --- kayit karti -----------------------------------------------------------

/** Acik zemin, tek dil (koyu gradyan kart kaldirildi — spec/16 P2 #13).
 *  Kartin tamami tek baglanti; sahte "Devam et" dugmesi yok (P2 #6). */
export function RecordCard({ r }: { r: RecordSummary }) {
  const L = useLookup();
  const path = L.path(r.unit_id);
  return (
    <Link href={href({ name: "record", id: r.id })} className={s.card}>
      <span className={s.cardBody}>
        <span className={s.cardTags}>
          <KindTag kind={r.kind} />
          {r.event_id !== null && (
            <Tag tone="neutral">
              <Icon name="calendar" size={12} /> Etkinlik
            </Tag>
          )}
          {(r.priority === "critical" || r.priority === "high") && <PriorityTag priority={r.priority} />}
        </span>
        <span className={s.cardTitle}>{r.title}</span>
        <span className={s.cardPath}>{path.slice(-2).join(" › ")}</span>
        <span className={s.cardMeta}>
          <Status status={r.status} />
          {(r.due_date !== null || r.action_overdue) && (
            <Due date={r.due_date} done={isDone(r.status)} actionLate={r.action_overdue} />
          )}
          {r.messages > 0 && (
            <span>
              <Icon name="chat" size={14} /> {r.messages}
            </span>
          )}
        </span>
      </span>
      <span className={s.chev}>
        <Icon name="chevron" size={20} />
      </span>
    </Link>
  );
}

export function RecordList({ rows, empty }: { rows: RecordSummary[] | undefined; empty: string }) {
  if (rows === undefined) return <Loading />;
  if (rows.length === 0) return <Empty title="Burası boş">{empty}</Empty>;
  return (
    <>
      {rows.map((r) => (
        <RecordCard key={r.id} r={r} />
      ))}
    </>
  );
}

// --- arama -----------------------------------------------------------------

export function SearchPage({ q }: { q: string }) {
  const L = useLookup();
  const [text, setText] = useState(q);
  useEffect(() => {
    const t = window.setTimeout(() => navigate(href({ name: "search", q: text.trim() }), { replace: true }), 300);
    return () => window.clearTimeout(t);
  }, [text]);

  const needle = q.trim().toLocaleLowerCase("tr");
  const isQuerying = needle.length >= 2;
  const rows = useRecords({ search: q }, isQuerying);

  const matchedTeams = isQuerying
    ? L.meta.teams.filter(
        (t) =>
          t.name.toLocaleLowerCase("tr").includes(needle) ||
          (t.description !== null && t.description.toLocaleLowerCase("tr").includes(needle)),
      )
    : [];

  const matchedUsers = isQuerying
    ? L.meta.users.filter(
        (u) =>
          u.name.toLocaleLowerCase("tr").includes(needle) ||
          (u.nickname !== null && u.nickname.toLocaleLowerCase("tr").includes(needle)),
      )
    : [];

  const hasAnyResults =
    matchedTeams.length > 0 ||
    matchedUsers.length > 0 ||
    (rows.data !== undefined && rows.data.length > 0);

  return (
    <>
      <TopBar title="Ara" />
      <div className={s.stickyBar}>
        <input
          className={s.search}
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Kayıt, takım veya kişi ara…"
          aria-label="Ara"
          enterKeyHint="search"
        />
      </div>
      <div className={s.pad}>
        {!isQuerying ? (
          <Empty title="Arama yap">En az iki harf yaz; kayıt, takım ve kişilerde aranır.</Empty>
        ) : rows.isPending && !hasAnyResults ? (
          <Loading />
        ) : !hasAnyResults ? (
          <Empty title="Sonuç yok">“{q}” için sonuç yok.</Empty>
        ) : (
          <>
            {matchedTeams.length > 0 && (
              <>
                <h2 className={s.group}>Takımlar ({matchedTeams.length})</h2>
                {matchedTeams.map((t) => (
                  <Link key={t.id} href={href({ name: "team", id: t.id })} className={s.card}>
                    <span className={s.cardBody}>
                      <span className={s.cardTitle}>{t.name}</span>
                      {t.description !== null && <span className={s.cardPath}>{t.description}</span>}
                    </span>
                    <span className={s.chev}>
                      <Icon name="chevron" size={20} />
                    </span>
                  </Link>
                ))}
              </>
            )}

            {matchedUsers.length > 0 && (
              <>
                <h2 className={s.group}>Kişiler ({matchedUsers.length})</h2>
                {matchedUsers.map((u) => (
                  <div key={u.id} className={s.card}>
                    <Avatar user={u} size={36} />
                    <span className={s.cardBody}>
                      <span className={s.cardTitle}>{u.name}</span>
                      <span className={s.cardMeta}>
                        {u.nickname !== null && <span>@{u.nickname}</span>}
                        {u.phone !== null && (
                          <a
                            href={`tel:${u.phone}`}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              color: "var(--acc-strong)",
                              textDecoration: "none",
                            }}
                          >
                            <Icon name="phone" size={13} /> {u.phone}
                          </a>
                        )}
                      </span>
                    </span>
                  </div>
                ))}
              </>
            )}

            {rows.data !== undefined && rows.data.length > 0 && (
              <>
                <h2 className={s.group}>Kayıtlar ({rows.data.length})</h2>
                {rows.data.map((r) => (
                  <RecordCard key={r.id} r={r} />
                ))}
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

// --- eylemlerim ------------------------------------------------------------

function bucket(a: MyAction): string {
  if (a.due_date === null) return "Tarihsiz";
  const n = daysFromToday(a.due_date);
  if (n < 0) return "Geciken";
  if (n <= 7) return "Bu hafta";
  return "Sonra";
}
const BUCKETS = ["Geciken", "Bu hafta", "Sonra", "Tarihsiz"];

const HINT_KEY = "hint:a2hs";

function readHint(): boolean {
  if (matchMedia("(display-mode: standalone)").matches || ("standalone" in navigator && navigator.standalone === true)) return false;
  try { return localStorage.getItem(HINT_KEY) !== "off"; } catch { return true; }
}

function InstallHint() {
  const [visible, setVisible] = useState(readHint);
  if (!visible) return null;
  return <div className={s.hint} role="note">
    <p><b>Ana ekrana ekle:</b> Safari'de Paylaş → Ana Ekrana Ekle. Uygulama gibi açılır.</p>
    <button type="button" className={ui.iconBtn} aria-label="İpucunu kapat" onClick={() => {
      setVisible(false);
      try { localStorage.setItem(HINT_KEY, "off"); } catch { /* depolama kapali */ }
    }}><Icon name="x" size={18} /></button>
  </div>;
}

export function ActionsPage() {
  const L = useLookup();
  const q = useMyActions();
  const recs = useRecords({ quick: "mine", done: "false", sort: "activity" });
  const myRecords = recs.data?.filter((r) => r.owner_id === L.me.id && !isDone(r.status));

  return (
    <>
      <TopBar title="Eylemler" />
      <div className={s.pad}>
        <details className={s.disclosure}>
          <summary><Icon name="pin" size={16} /> Sahibi olduğum açık kayıtlar{myRecords !== undefined && ` (${myRecords.length})`}</summary>
          <div className={s.detailContent}>
            {recs.error !== null ? <p role="alert">Kayıtlar yüklenemedi.</p> : <RecordList rows={myRecords} empty="Sahibi olduğun açık kayıt yok." />}
          </div>
        </details>
        <InstallHint />
        {q.error !== null ? <p role="alert">Eylemler yüklenemedi.</p> : q.data === undefined ? (
          <Loading />
        ) : q.data.length === 0 ? (
          <Empty title="Açık eylemin yok">Sana atanan eylemler burada, son tarihe göre görünür.</Empty>
        ) : (
          BUCKETS.map((b) => {
            const xs = q.data.filter((a) => bucket(a) === b);
            return xs.length === 0 ? null : (
              <section key={b} className={s.pad} style={{ padding: 0 }} aria-label={b}>
                <h2 className={s.group}>{b} · {xs.length}</h2>
                {xs.map((a) => (
                  <Link key={a.id} href={href({ name: "record", id: a.record_id })} className={s.card}>
                    <span className={s.cardBody}>
                      <span className={s.cardTitle}>{a.title}</span>
                      <span className={s.cardPath}>{a.record_title}</span>
                      <span className={s.cardMeta}>
                        <Status status={a.status} action />
                        {a.due_date !== null && <Due date={a.due_date} />}
                      </span>
                    </span>
                    <span className={s.chev}>
                      <Icon name="chevron" size={20} />
                    </span>
                  </Link>
                ))}
              </section>
            );
          })
        )}
      </div>
    </>
  );
}

// --- bildirimler -----------------------------------------------------------

export function NotificationsPage() {
  const L = useLookup();
  const q = useNotifications();
  const seen = useMarkSeen();
  const [settings, setSettings] = useState(false);
  // Liste gorununce "gordum": rozet sifirlanir, satirlar bu yuklemede hala vurgulu kalir.
  const loaded = q.data !== undefined && q.data.unread > 0;
  // Ilk yuklemedeki okunmamislar: "gordum" sonrasi yeniden cekilince de vurgulu kalir.
  const fresh = useRef<Set<string> | null>(null);
  if (fresh.current === null && q.data !== undefined) {
    fresh.current = new Set(q.data.items.filter((n) => n.unread).map((n) => n.id));
  }
  useEffect(() => {
    if (loaded) seen.mutate();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);
  return (
    <>
      <TopBar title="Bildirimler" />
      <NotifySettings open={settings} onClose={() => setSettings(false)} />
      <div className={s.pad}>
        <button type="button" className={s.card} onClick={() => setSettings(true)}>
          <Icon name="bell" size={18} />
          <span className={s.cardBody}>
            <span><b>Bildirim ayarları</b></span>
            <span className={s.cardPath}>Ne zaman bildirim alacağını ve bu cihazda anlık bildirimi buradan seç.</span>
          </span>
        </button>
        {q.data === undefined ? (
          <Loading />
        ) : q.data.items.length === 0 ? (
          <Empty title="Sessiz">Kayıtlarında ve takımlarında hareket olunca burada görünür.</Empty>
        ) : (
          q.data.items.map((n) => {
            const actor = L.user(n.actor_id);
            const to = n.record_id !== null ? href({ name: "record", id: n.record_id }) : href({ name: "team", id: n.team_id ?? "" });
            return (
              <Link key={n.id} href={to} className={cx(s.card, fresh.current?.has(n.id) === true && s.cardUnread)}>
                <Avatar user={actor} size={34} />
                <span className={s.cardBody}>
                  <span>
                    <b>{actor?.name ?? "Sistem"}</b>{" "}
                    {n.kind === "message" ? `: ${n.body ?? ""}` : describe(n, L)}
                    {n.kind === "message" && mentionsMe(n.body, L.me.name) && <> <Tag tone="info">seni andı</Tag></>}
                  </span>
                  <span className={s.cardPath}>
                    {n.team_id !== null ? "Takım duvarı · " : ""}{n.title} · {ago(n.created_at)}
                  </span>
                </span>
              </Link>
            );
          })
        )}
      </div>
    </>
  );
}

// --- yeni kayit ------------------------------------------------------------

export function NewPage() {
  return (
    <>
      <TopBar title="Yeni kayıt" back />
      <div className={s.pad}>
        <NewRecordForm onCreated={(id) => navigate(href({ name: "record", id }), { replace: true })} />
      </div>
    </>
  );
}

// --- takimlar --------------------------------------------------------------

export function TeamsListPage() {
  const L = useLookup();
  const q = useTeams();
  const myTeams = L.meta.teams.filter((t) => L.meta.me.team_ids.includes(t.id));
  return <>
    <TopBar title="Takımlar" />
    <div className={s.pad}>
      {q.error !== null && <p role="alert">Üye bilgileri yüklenemedi.</p>}
      {myTeams.length === 0 ? <Empty title="Takımın yok">Henüz bir takıma dahil değilsin.</Empty> : myTeams.map((team) => {
        const view = q.data?.find((t) => t.id === team.id);
        const members = view?.members ?? [];
        const leads = members.filter((m) => m.role === "lead" || m.role === "mentor");
        return <Link key={team.id} href={href({ name: "team", id: team.id })} className={s.card}>
          <span className={s.teamMark}><Icon name="teams" size={24} /></span>
          <span className={s.cardBody}>
            <span className={s.cardTitle}>{team.name}</span>
            {team.description !== null && <span className={s.cardPath}>{team.description}</span>}
            {view !== undefined && <>
              <span className={s.cardMeta}>{members.length} üye · {view.open_records} açık kayıt</span>
              <span className={s.avatarRow}>{members.slice(0, 5).map((m) => <Avatar key={m.user_id} user={L.user(m.user_id)} size={26} />)}{members.length > 5 && <span>+{members.length - 5}</span>}</span>
              <span className={s.cardPath}>{leads.length > 0 ? leads.map((m) => `${L.user(m.user_id)?.name ?? "?"} · ${TEAM_ROLE[m.role]}`).join(" / ") : members.slice(0, 3).map((m) => L.user(m.user_id)?.name ?? "?").join(", ")}</span>
            </>}
            {team.node_ids.length > 0 && <span className={s.cardPath}>{team.node_ids.map((id) => L.path(id).slice(-2).join(" › ")).join(" · ")}</span>}
          </span>
          <Icon name="chevron" size={20} />
        </Link>;
      })}
    </div>
  </>;
}

// --- konusmalar ------------------------------------------------------------

export function ChatsPage() {
  const q = useInbox();
  const L = useLookup();
  return <>
    <TopBar title="Konuşmalar" />
    <div className={s.inbox}>
      {q.error !== null ? <p role="alert">Konuşmalar yüklenemedi.</p> : q.data === undefined ? <Loading /> : q.data.length === 0 ? <Empty title="Sohbet yok">Dahil olduğun takım veya kayıt sohbeti bulunmuyor.</Empty> : q.data.map((chat) => {
        const id = chat.kind === "team" ? chat.team_id : chat.record_id;
        if (id === null) return null;
        const actor = L.user(chat.last_actor_id);
        return <Link key={chat.chat_id} href={`${href({ name: chat.kind === "team" ? "team" : "record", id })}#chat`} className={s.inboxRow}>
          <span className={s.teamMark}><Icon name={chat.kind === "team" ? "teams" : "chat"} size={24} /></span>
          <span className={s.cardBody}>
            <span className={s.inboxHeading}><span className={s.cardTitle}>{chat.title}</span>{chat.updated_at !== null && <time dateTime={chat.updated_at}>{ago(chat.updated_at)}</time>}</span>
            <span className={s.cardPath}>{chat.last_message === null ? "Henüz mesaj yok" : `${actor?.name ?? "Sistem"}: ${chat.last_message.trim() === "" ? "Fotoğraf / ek" : chat.last_message}`}</span>
            <span className={s.cardMeta}>{chat.kind === "team" ? "Takım" : "Kayıt"}</span>
          </span>
        </Link>;
      })}
    </div>
  </>;
}
