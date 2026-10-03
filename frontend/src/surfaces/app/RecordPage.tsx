// Mobil kayit: masaustuyle AYNI bolumler (alanlar + eylemler), sohbet sag
// alttaki baloncuktan acilan tam ekran sayfa. Takim duvari da ayni kalip.

import { type ReactNode, useEffect, useState } from "react";
import { ApiError, errorText } from "../../api/client";
import { eventOps, useEvent, useEventWrite, useFeed, useRecord, useRecords, useTeam } from "../../api/hooks";
import type { Uuid } from "../../api/types";
import { Chat } from "../../features/chat/Chat";
import { ChatBell } from "../../features/chat/ChatBell";
import { Properties } from "../../features/record/fields";
import { Cards } from "../../features/record/Cards";
import { JoinBanner, RestrictedSkeleton } from "../../features/record/Join";
import { ActionList, BallLine, CollapsibleProps, QuickAction, ReadOnlyNote, RecordHead } from "../../features/record/parts";
import { EVENT_STATUS, formatDay, TEAM_ROLE } from "../../lib/labels";
import { useLookup } from "../../lib/lookup";
import { navigate, useLocation } from "../../lib/router";
import { Icon } from "../../ui/icons";
import { Avatar, cx, Loading, Tag, ui, useToast } from "../../ui/ui";
import { ErrorScreen } from "../errors/ErrorScreen";
import s from "./app.module.css";
import { TopBar } from "./MobileApp";
import { RecordList } from "./pages";
import { href } from "./routes";

function ChatSheet(props: {
  chatId: Uuid;
  title: string;
  canPost: boolean;
  lockedText: string;
  empty: string;
  tools?: ReactNode;
  prefill?: string | undefined;
}) {
  const [open, setOpen] = useState(() => location.hash === "#chat" || props.prefill !== undefined);
  const feed = useFeed(props.chatId);
  const messages = feed.data?.items?.filter((i) => i.kind === "message").length ?? 0;
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
            <ChatBell chatId={props.chatId} />
            <button type="button" className={ui.iconBtn} onClick={() => setOpen(false)} aria-label="Sohbeti kapat">
              <Icon name="x" size={22} />
            </button>
          </div>
          <div className={s.sheetBody}>
            <Chat chatId={props.chatId} canPost={props.canPost} lockedText={props.lockedText} empty={props.empty}
              tools={props.tools} prefill={props.prefill} />
          </div>
        </div>
      )}
    </>
  );
}

export function MobileEventStrip({ eventId }: { eventId: Uuid }) {
  const L = useLookup();
  const eq = useEvent(eventId);
  const w = useEventWrite();
  const toast = useToast();
  const [open, setOpen] = useState(false);

  if (eq.data === undefined) return null;
  const e = eq.data;
  const place = e.location_id !== null ? (L.node(e.location_id)?.name ?? e.place) : e.place;
  const doneCount = e.checkpoints.filter((c) => c.done).length;
  const totalCount = e.checkpoints.length;
  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  const toggle = (cid: Uuid, currentDone: boolean) => {
    if (e.can_approve) {
      w.mutate(eventOps.checkpoint(cid, !currentDone), {
        onError: (err) => toast({ text: errorText(err), error: true }),
      });
    } else if (e.can_edit) {
      w.mutate(eventOps.requestCheckpoint(cid, currentDone ? "undone" : "done"), {
        onSuccess: () => toast({ text: "Onay istendi", error: false }),
        onError: (err) => toast({ text: errorText(err), error: true }),
      });
    }
  };

  return (
    <div className={s.eventStrip}>
      <div className={s.eventHead}>
        <div className={s.eventTitleLine}>
          <span className={s.eventTagLine}>
            <Tag tone="neutral">
              <Icon name="calendar" size={12} /> Etkinlik
            </Tag>
            <Tag tone={EVENT_STATUS[e.status].tone}>{EVENT_STATUS[e.status].label}</Tag>
          </span>
          {totalCount > 0 && (
            <button
              type="button"
              className={s.eventToggleBtn}
              onClick={() => setOpen(!open)}
              aria-expanded={open}
            >
              <span>
                {doneCount}/{totalCount} adım
              </span>
              <Icon name={open ? "up" : "down"} size={16} />
            </button>
          )}
        </div>
        <div className={s.eventMeta}>
          {(e.date !== null || e.start_time !== null) && (
            <span>
              <Icon name="calendar" size={14} />
              {e.date !== null ? formatDay(e.date) : "Tarih belirsiz"}
              {e.start_time !== null && ` · ${e.start_time}`}
            </span>
          )}
          {place !== null && place !== undefined && (
            <span>
              <Icon name="venue" size={14} />
              {place}
            </span>
          )}
        </div>
        {totalCount > 0 && (
          <div className={s.progressBar} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className={s.progressFill} style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      {open && totalCount > 0 && (
        <ul className={s.checkpointList}>
          {e.checkpoints.map((c) => {
            const waiting = e.requests.some((q) => q.checkpoint_id === c.id && q.user_id === L.me.id);
            const canToggle = (e.can_approve || e.can_edit) && !w.isPending;
            return (
              <li key={c.id} className={cx(s.checkpointItem, c.done && s.checkpointDone)}>
                <button
                  type="button"
                  className={s.checkpointBtn}
                  disabled={!canToggle}
                  onClick={() => toggle(c.id, c.done)}
                  aria-pressed={c.done}
                  aria-label={`${c.label}: ${c.done ? "tamamlanmadı olarak işaretle" : "tamamlandı olarak işaretle"}`}
                >
                  <span className={cx(s.checkbox, c.done && s.checkboxDone)}>
                    {c.done && <Icon name="check" size={14} />}
                  </span>
                  <span className={s.checkpointLabel}>{c.label}</span>
                  {c.date !== null && <span className={s.checkpointDate}>{formatDay(c.date)}</span>}
                  {waiting && <span className={s.checkpointWaiting}>Onay bekliyor</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function RecordPage({ id }: { id: Uuid }) {
  const loc = useLocation();
  const [pre] = useState(() => {
    const m = loc.searchParams.get("mention");
    return { id, text: m !== null && /^[a-z0-9-]+$/.test(m) ? `@${m} ` : undefined };
  });
  useEffect(() => {
    if (loc.searchParams.has("mention")) navigate(href({ name: "record", id }), { replace: true });
  }, []);

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
        <JoinBanner d={d} />
        <RecordHead d={d} />
        {d.event_id !== null && <MobileEventStrip eventId={d.event_id} />}
        <ReadOnlyNote d={d} />
        <CollapsibleProps d={d}>
          <Properties d={d} />
        </CollapsibleProps>
        <BallLine d={d} />
        {d.membership.restricted ? <RestrictedSkeleton label="Eylemler, kartlar ve sohbet" /> : (
          <>
            <ActionList d={d} />
            <Cards d={d} />
          </>
        )}
      </div>
      {!d.membership.restricted && (
        <ChatSheet
          chatId={d.record.chat_id}
          title={d.record.title}
          canPost={d.access.can_edit}
          lockedText="Bu kayıtta yazma yetkin yok."
          empty="Henüz mesaj yok."
          tools={<QuickAction d={d} />}
          prefill={pre.id === id ? pre.text : undefined}
        />
      )}
    </>
  );
}

export function TeamPage({ id }: { id: Uuid }) {
  const L = useLookup();
  const q = useTeam(id);
  const recs = useRecords({ team: id, done: "false" });
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
        <h2 className={s.group} style={{ margin: "var(--s-2) 0 0" }}>
          Açık Kayıtlar ({recs.data?.length ?? q.data.open_records})
        </h2>
        <RecordList rows={recs.data} empty="Takıma ait açık kayıt yok." />
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
