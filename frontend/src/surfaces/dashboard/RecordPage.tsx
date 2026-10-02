// Masaustu kayit sayfasi: sol is (baslik, ozellikler, eylemler, kartlar), sag
// sutun sohbet (spec/60 2.4). Admin ile uye AYNI ekran; fark yetkiden
// (spec/17 etki 1).

import { useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { useRecord } from "../../api/hooks";
import type { Uuid } from "../../api/types";
import { Chat } from "../../features/chat/Chat";
import { ChatBell } from "../../features/chat/ChatBell";
import { Properties } from "../../features/record/fields";
import { Cards } from "../../features/record/Cards";
import { JoinBanner, RestrictedSkeleton } from "../../features/record/Join";
import { ActionList, BallLine, CollapsibleProps, QuickAction, ReadOnlyNote, RecordHead } from "../../features/record/parts";
import { useLookup } from "../../lib/lookup";
import { navigate, useLocation } from "../../lib/router";
import { Icon } from "../../ui/icons";
import { Link, Loading } from "../../ui/ui";
import { ErrorScreen } from "../errors/ErrorScreen";
import s from "./dashboard.module.css";
import { EventSwitch } from "./EventPage";
import { useEventOfRecord } from "./eventModel";
import { href } from "./routes";

export function RecordPage({ id }: { id: Uuid }) {
  const L = useLookup();
  const q = useRecord(id);
  // Etkinligin kendi kaydiysa baslikta Etkinlik | Kayıt anahtari (spec/73 §3a).
  const ev = useEventOfRecord(id);
  // `?mention=<ad>`: etkinlik kisilerinden "yaz" (DM yok — ikizin sohbetine anmayla
  // gelinir). Bir kez okunur, adresten silinir; yalniz bu kayda uygulanir.
  const loc = useLocation();
  const [pre] = useState(() => {
    const m = loc.searchParams.get("mention");
    return { id, text: m !== null && /^[a-z0-9-]+$/.test(m) ? `@${m} ` : undefined };
  });
  useEffect(() => {
    if (loc.searchParams.has("mention")) navigate(href({ name: "record", id }), { replace: true });
  }, []);
  const title = q.data?.record.title;
  useEffect(() => {
    if (title !== undefined) document.title = `${title} — EkipTakip`;
  }, [title]);

  if (q.error !== null) {
    return <ErrorScreen code={q.error instanceof ApiError && q.error.code === "not_found" ? "not_found" : "network"} />;
  }
  if (q.data === undefined) return <Loading />;
  const d = q.data;
  const path = L.path(d.record.unit_id);

  return (
    <div className={s.recordPage}>
      <nav className={s.crumb} aria-label="Konum">
        <Link href={href({ name: "tasks", query: {} })}>Görevler</Link>
        {path.map((p, i) => (
          <span key={i} style={{ display: "contents" }}>
            <Icon name="chevron" size={13} />
            {i === path.length - 1 ? (
              <Link href={href({ name: "tasks", query: { node: d.record.unit_id } })}>{p}</Link>
            ) : (
              <span>{p}</span>
            )}
          </span>
        ))}
        <Icon name="chevron" size={13} />
        <b>{d.record.title}</b>
      </nav>
      <div className={s.recordBody}>
        <div className={s.recordMain}>
          <div className={s.recordInner}>
            <JoinBanner d={d} />
            <RecordHead d={d} showPath={false}
              titleExtra={ev !== undefined && <EventSwitch eventId={ev.id} recordId={id} at="record" />} />
            <ReadOnlyNote d={d} />
            <div className={s.fieldsBlock}>
              <CollapsibleProps d={d}>
                <Properties d={d} />
              </CollapsibleProps>
              <BallLine d={d} />
            </div>
            {d.membership.restricted ? <RestrictedSkeleton label="Eylemler ve kartlar" /> : (
              <>
                <ActionList d={d} />
                <Cards d={d} />
              </>
            )}
          </div>
        </div>
        <aside className={s.recordSide} aria-label="Sohbet">
          <div className={s.sideHead}>
            <Icon name="chat" size={16} /> Sohbet
            <ChatBell chatId={d.record.chat_id} />
          </div>
          <div className={s.sideBody}>
            {d.membership.restricted ? <RestrictedSkeleton label="Sohbet" /> : (
              <Chat
                chatId={d.record.chat_id}
                canPost={d.access.can_edit}
                lockedText="Bu kayıtta yazma yetkin yok."
                empty="Henüz mesaj yok. İlk mesajı sen yaz."
                tools={<QuickAction d={d} />}
                prefill={pre.id === id ? pre.text : undefined}
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
