// Masaustu kayit sayfasi: sol is (baslik, ozellikler, eylemler, kartlar), sag
// sutun sohbet (spec/60 2.4). Admin ile uye AYNI ekran; fark yetkiden
// (spec/17 etki 1).

import { useEffect } from "react";
import { ApiError } from "../../api/client";
import { useRecord } from "../../api/hooks";
import type { Uuid } from "../../api/types";
import { Chat } from "../../features/chat/Chat";
import { Properties } from "../../features/record/fields";
import { Cards } from "../../features/record/Cards";
import { ActionList, BallLine, CollapsibleProps, QuickAction, ReadOnlyNote, RecordHead } from "../../features/record/parts";
import { useLookup } from "../../lib/lookup";
import { Icon } from "../../ui/icons";
import { Link, Loading } from "../../ui/ui";
import { ErrorScreen } from "../errors/ErrorScreen";
import s from "./dashboard.module.css";
import { href } from "./routes";

export function RecordPage({ id }: { id: Uuid }) {
  const L = useLookup();
  const q = useRecord(id);
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
            <RecordHead d={d} showPath={false} />
            <ReadOnlyNote d={d} />
            <div className={s.fieldsBlock}>
              <CollapsibleProps d={d}>
                <Properties d={d} />
              </CollapsibleProps>
              <BallLine d={d} />
            </div>
            <ActionList d={d} />
            <Cards d={d} />
          </div>
        </div>
        <aside className={s.recordSide} aria-label="Sohbet">
          <div className={s.sideHead}>
            <Icon name="chat" size={16} /> Sohbet
          </div>
          <div className={s.sideBody}>
            <Chat
              chatId={d.record.chat_id}
              canPost={d.access.can_edit}
              lockedText="Bu kayıtta yazma yetkin yok."
              empty="Henüz mesaj yok. İlk mesajı sen yaz."
              tools={<QuickAction d={d} />}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
