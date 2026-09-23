// Mobil kayit: masaustuyle AYNI bolumler (alanlar + eylemler), sohbet sag
// alttaki baloncuktan acilan tam ekran sayfa. Takim duvari da ayni kalip.

import { type ReactNode, useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { useFeed, useRecord, useTeam } from "../../api/hooks";
import type { Uuid } from "../../api/types";
import { Chat } from "../../features/chat/Chat";
import { FieldStrip } from "../../features/record/fields";
import { ActionList, BallLine, QuickAction, ReadOnlyNote, RecordHead } from "../../features/record/parts";
import { TEAM_ROLE } from "../../lib/labels";
import { useLookup } from "../../lib/lookup";
import { Icon } from "../../ui/icons";
import { Avatar, Loading, ui } from "../../ui/ui";
import { ErrorScreen } from "../errors/ErrorScreen";
import s from "./app.module.css";
import { TopBar } from "./MobileApp";

function ChatSheet(props: {
  chatId: Uuid;
  title: string;
  canPost: boolean;
  lockedText: string;
  empty: string;
  tools?: ReactNode;
}) {
  const [open, setOpen] = useState(() => location.hash === "#chat");
  const feed = useFeed(props.chatId);
  const messages = feed.data?.items.filter((i) => i.kind === "message").length ?? 0;
  // Sayfa acikken govde kaymasin; Esc kapatir.
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <>
      <button type="button" className={s.chatFab} onClick={() => setOpen(true)} aria-label={`Sohbeti aç, ${messages} mesaj`}>
        <Icon name="chat" size={26} />
        {messages > 0 && <span className={s.badge}>{messages}</span>}
      </button>
      {open && (
        <div className={s.sheet} role="dialog" aria-modal="true" aria-label="Sohbet">
          <div className={s.sheetHead}>
            <Icon name="chat" size={20} />
            <span>{props.title}</span>
            <button type="button" className={ui.iconBtn} onClick={() => setOpen(false)} aria-label="Sohbeti kapat">
              <Icon name="x" size={22} />
            </button>
          </div>
          <div className={s.sheetBody}>
            <Chat chatId={props.chatId} canPost={props.canPost} lockedText={props.lockedText} empty={props.empty}
              tools={props.tools} />
          </div>
        </div>
      )}
    </>
  );
}

export function RecordPage({ id }: { id: Uuid }) {
  const q = useRecord(id);
  if (q.error !== null) {
    return (
      <>
        <TopBar title="Kayıt" back />
        <ErrorScreen code={q.error instanceof ApiError && q.error.code === "not_found" ? "not_found" : "network"} />
      </>
    );
  }
  if (q.data === undefined) {
    return (
      <>
        <TopBar title="Kayıt" back />
        <Loading />
      </>
    );
  }
  const d = q.data;
  return (
    <>
      <TopBar title="Kayıt" back />
      <div className={s.recordPad}>
        <RecordHead d={d} />
        <BallLine d={d} />
        <ReadOnlyNote d={d} />
        <FieldStrip d={d} compact />
        <ActionList d={d} />
      </div>
      <ChatSheet
        chatId={d.record.chat_id}
        title={d.record.title}
        canPost={d.access.can_edit}
        lockedText="Bu kayıtta yazma yetkin yok."
        empty="Henüz mesaj yok."
        tools={<QuickAction d={d} />}
      />
    </>
  );
}

export function TeamPage({ id }: { id: Uuid }) {
  const L = useLookup();
  const q = useTeam(id);
  const team = L.team(id);
  if (q.error !== null || team === undefined) {
    return (
      <>
        <TopBar title="Takım" back />
        <ErrorScreen code="not_found" />
      </>
    );
  }
  if (q.data === undefined) return <Loading />;
  const member = q.data.members.some((m) => m.user_id === L.me.id);
  return (
    <>
      <TopBar title={team.name} back />
      <div className={s.recordPad}>
        {team.description !== null && <p style={{ margin: 0 }}>{team.description}</p>}
        <ul className={s.members}>
          {q.data.members.map((m) => (
            <li key={m.user_id}>
              <Avatar user={L.user(m.user_id)} size={26} />
              {L.user(m.user_id)?.name ?? "?"} · {TEAM_ROLE[m.role]}
            </li>
          ))}
        </ul>
        <p style={{ margin: 0, color: "var(--dim)" }}>{q.data.open_records} açık kayıt</p>
      </div>
      <ChatSheet
        chatId={team.chat_id}
        title={`${team.name} — duvar`}
        canPost={member || L.meta.me.is_admin}
        lockedText="Duvara yalnız takım üyeleri yazar."
        empty="Duvar boş."
      />
    </>
  );
}
