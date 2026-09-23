// Sohbet kutusu: mesaj + sistem olayi tek kronoloji (chat_feed). Kayit karti
// ve takim duvari ayni bileseni cizer; yalniz `chatId` ve yazma izni degisir.

import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { errorText } from "../../api/client";
import { useFeed, usePostMessage } from "../../api/hooks";
import type { FeedItem, Uuid } from "../../api/types";
import { describe } from "../../lib/activity";
import { clock, formatDay, toIsoDay } from "../../lib/labels";
import { useLookup } from "../../lib/lookup";
import { Icon } from "../../ui/icons";
import { Avatar, Button, cx, Loading, useToast } from "../../ui/ui";
import s from "./chat.module.css";

function draftKey(chat: Uuid) {
  return `draft:${chat}`;
}

// Taslak `sessionStorage`'da: yanlislikla sayfa degisince yazilan kaybolmasin
// (spec/16 Y8). Erisim atabilir (gizli pencere) — sessizce yok say.
function readDraft(chat: Uuid): string {
  try {
    return sessionStorage.getItem(draftKey(chat)) ?? "";
  } catch {
    return "";
  }
}
function writeDraft(chat: Uuid, v: string) {
  try {
    if (v === "") sessionStorage.removeItem(draftKey(chat));
    else sessionStorage.setItem(draftKey(chat), v);
  } catch {
    /* depolama kapali */
  }
}

export function Chat(props: {
  chatId: Uuid;
  canPost: boolean;
  lockedText: string;
  empty: string;
  /** Kompozerin ustunde kucuk araclar (kayitta ⚡ hizli eylem). Sohbet alani bilmez. */
  tools?: ReactNode;
}) {
  const L = useLookup();
  const feed = useFeed(props.chatId);
  const [reply, setReply] = useState<FeedItem | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const count = feed.data?.items.length ?? 0;

  // Yeni satir gelince dibe in (acilista da).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [count]);

  if (feed.data === undefined) return <Loading />;
  const quotes = new Map(feed.data.quotes.map((q) => [q.id, q]));
  let lastDay = "";

  return (
    <div className={s.wrap}>
      <div className={s.feed} ref={scroller} aria-live="polite">
        {feed.data.items.length === 0 && <div className={s.sys}>{props.empty}</div>}
        {feed.data.items.map((it) => {
          const day = toIsoDay(new Date(it.created_at));
          const sep = day !== lastDay ? <div className={s.day}>{formatDay(day)}</div> : null;
          lastDay = day;
          const actor = L.user(it.actor_id);
          if (it.kind === "activity") {
            return (
              <div key={it.id} style={{ display: "contents" }}>
                {sep}
                <div className={s.sys}>
                  {actor !== undefined && <b>{actor.name} </b>}
                  {describe(it, L)} · {clock(it.created_at)}
                </div>
              </div>
            );
          }
          const mine = it.actor_id === L.me.id;
          const q = it.reply_to_id === null ? undefined : quotes.get(it.reply_to_id);
          return (
            <div key={it.id} style={{ display: "contents" }}>
              {sep}
              <div className={cx(s.msg, mine && s.mine)} id={`event-${it.id}`}>
                {!mine && <Avatar user={actor} size={28} />}
                <div className={s.bub}>
                  {!mine && <div className={s.name}>{actor?.name ?? "silinmiş kişi"}</div>}
                  {q !== undefined && (
                    <a
                      className={s.quote}
                      href={`#event-${q.id}`}
                      onClick={(e) => {
                        e.preventDefault();
                        const el = document.getElementById(`event-${q.id}`);
                        el?.scrollIntoView({ behavior: "smooth", block: "center" });
                        el?.querySelector(`.${s.bub}`)?.classList.add(s.flash ?? "");
                      }}
                    >
                      <b>{L.user(q.author_id)?.name ?? "?"}:</b> {q.body}
                    </a>
                  )}
                  <div className={s.text}>{it.body}</div>
                  <div className={s.meta}>
                    {props.canPost && (
                      <button type="button" className={s.replyBtn} onClick={() => setReply(it)} aria-label="Yanıtla">
                        <Icon name="reply" size={13} /> Yanıtla
                      </button>
                    )}
                    <span>{clock(it.created_at)}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {props.canPost ? (
        <>
          {/* Kompozerin FORMU DISINDA: arac kendi formunu (dialog) acabilir. */}
          {props.tools !== undefined && <div className={s.tools}>{props.tools}</div>}
          <Composer chatId={props.chatId} reply={reply} onClearReply={() => setReply(null)} />
        </>
      ) : (
        <div className={s.comp}>
          <div className={s.locked}>
            <Icon name="lock" size={16} /> {props.lockedText}
          </div>
        </div>
      )}
    </div>
  );
}

function Composer(props: { chatId: Uuid; reply: FeedItem | null; onClearReply: () => void }) {
  const L = useLookup();
  const toast = useToast();
  const m = usePostMessage(props.chatId);
  const [text, setText] = useState(() => readDraft(props.chatId));
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => writeDraft(props.chatId, text), [props.chatId, text]);
  useEffect(() => {
    if (props.reply !== null) box.current?.focus();
  }, [props.reply]);
  // Kutu icerige gore buyur (160px'e kadar, sonra kayar).
  useLayoutEffect(() => {
    const el = box.current;
    if (el === null) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const send = () => {
    const body = text.trim();
    if (body === "" || m.isPending) return;
    m.mutate(
      { body, reply_to_id: props.reply?.id ?? null },
      {
        onSuccess: () => {
          setText("");
          props.onClearReply();
        },
        onError: (e) => toast({ text: errorText(e), error: true }),
      },
    );
  };

  return (
    <form
      className={s.comp}
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      {props.reply !== null && (
        <div className={s.replying}>
          <Icon name="reply" size={14} />
          <span>
            <b>{L.user(props.reply.actor_id)?.name ?? "?"}</b>: {props.reply.body}
          </span>
          <button type="button" className={s.replyBtn} onClick={props.onClearReply} aria-label="Yanıtı iptal et">
            <Icon name="x" size={14} />
          </button>
        </div>
      )}
      <div className={s.compRow}>
        <textarea
          ref={box}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter gonderir, Shift+Enter satir. Dokunmatikte Enter satir kalir.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && matchMedia("(pointer: fine)").matches) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Mesaj yaz…"
          aria-label="Mesaj"
          maxLength={4000}
        />
        <Button type="submit" variant="primary" big disabled={m.isPending || text.trim() === ""}>
          Gönder
        </Button>
      </div>
    </form>
  );
}
