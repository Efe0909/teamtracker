// Mobil liste sayfalari: yapilacaklar, arama, eylemlerim, bildirimler, yeni.

import { useEffect, useState } from "react";
import { useMyActions, useNotifications, useRecords } from "../../api/hooks";
import type { MyAction, RecordSummary } from "../../api/types";
import { NewRecordForm } from "../../features/record/NewRecordForm";
import { describe } from "../../lib/activity";
import { ago, daysFromToday, isDone } from "../../lib/labels";
import { useLookup } from "../../lib/lookup";
import { mentionsMe } from "../../lib/mentions";
import { navigate } from "../../lib/router";
import { Icon } from "../../ui/icons";
import { Avatar, Due, Empty, KindTag, Link, Loading, PriorityTag, Segmented, Status, Tag, ui } from "../../ui/ui";
import s from "./app.module.css";
import { TopBar } from "./MobileApp";
import { href } from "./routes";

// --- kayit karti -----------------------------------------------------------

/** Acik zemin, tek dil (koyu gradyan kart kaldirildi — spec/16 P2 #13).
 *  Kartin tamami tek baglanti; sahte "Devam et" dugmesi yok (P2 #6). */
function RecordCard({ r }: { r: RecordSummary }) {
  const L = useLookup();
  const path = L.path(r.unit_id);
  return (
    <Link href={href({ name: "record", id: r.id })} className={s.card}>
      <span className={s.cardBody}>
        <span className={s.cardTags}>
          <KindTag kind={r.kind} />
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

function RecordList({ rows, empty }: { rows: RecordSummary[] | undefined; empty: string }) {
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

// --- yapilacaklar ----------------------------------------------------------

const HINT_KEY = "hint:a2hs";

function readHint(): boolean {
  // Ana ekrandan aciksa ipucu anlamsiz. `navigator.standalone` yalniz iOS'ta;
  // display-mode sorgusu digerleri (ve yeni iOS) icin.
  const standalone =
    matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && navigator.standalone === true);
  if (standalone) return false;
  try {
    return localStorage.getItem(HINT_KEY) !== "off";
  } catch {
    return true;
  }
}

export function TodoPage({ done }: { done: boolean }) {
  const rows = useRecords({ quick: "mine", done: done ? "true" : "false", sort: "activity" });
  const [hint, setHint] = useState(readHint);
  return (
    <>
      <TopBar title="Yapılacaklar" />
      <div className={s.stickyBar}>
        <Segmented
          label="Kayıtlar"
          value={done ? "done" : "open"}
          onChange={(v) => navigate(href({ name: "todo", done: v === "done" }), { replace: true })}
          options={[
            { value: "open", label: "Yapılacak" },
            { value: "done", label: "Tamamlandı" },
          ]}
        />
      </div>
      <div className={s.pad}>
        {hint && (
          // Kapatilabilir (spec/16 P2 #15); uygulama olarak aciksa hic gorunmez.
          <div className={s.hint} role="note">
            <p>
              <b>Ana ekrana ekle:</b> Safari'de Paylaş → Ana Ekrana Ekle. Uygulama gibi açılır.
            </p>
            <button
              type="button"
              className={ui.iconBtn}
              aria-label="İpucunu kapat"
              onClick={() => {
                setHint(false);
                try {
                  localStorage.setItem(HINT_KEY, "off");
                } catch {
                  /* depolama kapali */
                }
              }}
            >
              <Icon name="x" size={18} />
            </button>
          </div>
        )}
        <RecordList
          rows={rows.data}
          empty={done ? "Kapanan kaydın yok." : "Sana atanan, açtığın ya da dahil olduğun açık kayıt yok."}
        />
      </div>
    </>
  );
}

// --- arama -----------------------------------------------------------------

export function SearchPage({ q }: { q: string }) {
  const [text, setText] = useState(q);
  useEffect(() => {
    const t = window.setTimeout(() => navigate(href({ name: "search", q: text.trim() }), { replace: true }), 300);
    return () => window.clearTimeout(t);
  }, [text]);
  const rows = useRecords({ search: q }, q.length >= 3);
  return (
    <>
      <TopBar title="Ara" />
      <div className={s.stickyBar}>
        <input
          className={s.search}
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Başlık veya açıklama ara…"
          aria-label="Ara"
          enterKeyHint="search"
        />
      </div>
      <div className={s.pad}>
        {q.length < 3 ? (
          <Empty title="Kayıt ara">En az üç harf yaz; başlık ve açıklamada aranır.</Empty>
        ) : (
          <RecordList rows={rows.data} empty={`“${q}” için sonuç yok.`} />
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

export function ActionsPage() {
  const q = useMyActions();
  return (
    <>
      <TopBar title="Eylemlerim" />
      <div className={s.pad}>
        {q.data === undefined ? (
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
  return (
    <>
      <TopBar title="Bildirimler" />
      <div className={s.pad}>
        {q.data === undefined ? (
          <Loading />
        ) : q.data.length === 0 ? (
          <Empty title="Sessiz">Kayıtlarında ve takımlarında hareket olunca burada görünür.</Empty>
        ) : (
          q.data.map((n) => {
            const actor = L.user(n.actor_id);
            const to = n.record_id !== null ? href({ name: "record", id: n.record_id }) : href({ name: "team", id: n.team_id ?? "" });
            return (
              <Link key={n.id} href={to} className={s.card}>
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
