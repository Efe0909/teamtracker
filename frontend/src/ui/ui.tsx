// Yapi taslari. Alan bilmez (kayit, eylem...) — yalniz gorunum.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import type { ActionStatus, IsoDate, MetaTeam, MetaUser, Priority, RecordKind, RecordStatus } from "../api/types";
import { ACTION_STATUS, dueLabel, daysFromToday, formatDay, KIND, PRIORITY, STATUS } from "../lib/labels";
import { onLinkClick } from "../lib/router";
import { Icon } from "./icons";
import s from "./ui.module.css";

export { s as ui };

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(" ");
}

// --- dugme -----------------------------------------------------------------

type Variant = "default" | "primary" | "ghost" | "danger";

export function Button(
  props: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; big?: boolean },
) {
  const { variant = "default", big = false, className, type = "button", ...rest } = props;
  return (
    <button
      type={type}
      className={cx(
        s.btn,
        variant === "primary" && s.primary,
        variant === "ghost" && s.ghost,
        variant === "danger" && s.danger,
        big && s.big,
        className,
      )}
      {...rest}
    />
  );
}

/** SPA baglantisi. Ctrl/cmd-tik yeni sekmede acar (tarayiciya birakilir). */
export function Link(props: { href: string; className?: string; children: ReactNode; title?: string }) {
  return (
    <a
      href={props.href}
      className={props.className}
      title={props.title}
      onClick={(e) => onLinkClick(e, props.href)}
    >
      {props.children}
    </a>
  );
}

// --- rozetler --------------------------------------------------------------

export function KindTag({ kind }: { kind: RecordKind }) {
  return <span className={cx(s.tag, kind === "issue" ? s["t-issue"] : s["t-task"])}>{KIND[kind]}</span>;
}

export function PriorityTag({ priority }: { priority: Priority }) {
  return <span className={cx(s.tag, s[`t-${priority}`])}>{PRIORITY[priority]}</span>;
}

export function Tag({ tone, children }: { tone: "info" | "ok" | "neutral" | "critical" | "high"; children: ReactNode }) {
  return <span className={cx(s.tag, s[`t-${tone}`])}>{children}</span>;
}

export function Status({ status, action = false }: { status: RecordStatus | ActionStatus; action?: boolean }) {
  const label = action ? ACTION_STATUS[status as ActionStatus] : STATUS[status as RecordStatus];
  return <span className={cx(s.status, s[`s-${status}`])}>{label}</span>;
}

/** Son tarih: gecikme METINLE soylenir, renk tek basina degil (P2 #9).
 *  `actionLate`: kaydin kendi tarihi gecmemis ama acik bir eylemininki gecmis. */
export function Due({ date, done = false, actionLate = false }: { date: IsoDate | null; done?: boolean; actionLate?: boolean }) {
  const late = !done && date !== null && daysFromToday(date) < 0;
  const extra = !done && !late && actionLate;
  return (
    <span className={s.due}>
      {date === null ? (
        !extra && "—"
      ) : (
        <span className={cx(s.due, late && s.late)} title={formatDay(date)}>
          {late && <Icon name="alert" size={14} />}
          {done ? formatDay(date) : dueLabel(date)}
        </span>
      )}
      {extra && (
        <span className={cx(s.due, s.late)}>
          <Icon name="alert" size={14} /> eylem gecikti
        </span>
      )}
    </span>
  );
}

// --- kisi ------------------------------------------------------------------

const ONLINE_MS = 5 * 60_000;

export function Avatar({ user, size = 24 }: { user: Pick<MetaUser, "name" | "color" | "last_seen_at"> | undefined; size?: number }) {
  const online = user?.last_seen_at != null && Date.now() - new Date(user.last_seen_at).getTime() < ONLINE_MS;
  return (
    <span
      className={cx(s.av, online && s.online)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42), ...(user?.color != null ? { background: user.color } : {}) }}
      aria-hidden="true"
    >
      {(user?.name ?? "?").slice(0, 1).toLocaleUpperCase("tr")}
    </span>
  );
}

export function Who({ user, empty = "—" }: { user: MetaUser | undefined; empty?: string }) {
  if (user === undefined) return <span className={s.who}>{empty}</span>;
  return (
    <span className={s.who}>
      <Avatar user={user} size={22} />
      <span>{user.name}</span>
    </span>
  );
}

export function TeamName({ team, empty = "—" }: { team: MetaTeam | undefined; empty?: string }) {
  if (team === undefined) return <span className={s.who}>{empty}</span>;
  return (
    <span className={s.who}>
      <span className={s.dot} style={team.color !== null ? { background: team.color } : {}} aria-hidden="true" />
      <span>{team.name}</span>
    </span>
  );
}

// --- dialog ----------------------------------------------------------------

/** Native <dialog>: odak tuzagi, Esc ve arka plan bedava. `open` kontrollu. */
export function Dialog(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  hint?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { open, onClose } = props;
  useEffect(() => {
    const d = ref.current;
    if (d === null) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={cx(s.dialog, props.wide === true && s.wide)}
      onClose={onClose}
      onClick={(e) => {
        // Arka plana tik kapatir; icerige tik kapatmaz.
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby="dlg-title"
    >
      {open && (
        <>
          <div className={s.dhead}>
            <h2 id="dlg-title">{props.title}</h2>
            <button type="button" className={s.iconBtn} onClick={onClose} aria-label="Kapat">
              <Icon name="x" />
            </button>
          </div>
          {props.hint !== undefined && <p className={s.dhint}>{props.hint}</p>}
          {props.children}
        </>
      )}
    </dialog>
  );
}

export interface Choice<V> {
  value: V;
  label: ReactNode;
  disabled?: boolean;
  note?: string;
}

/** Secenek listesi: tek dokunus secer (dialog zaten ikinci adim). */
export function Choices<V>(props: { options: Choice<V>[]; current: V; onPick: (v: V) => void; busy?: boolean }) {
  return (
    <div className={s.opts} role="group">
      {props.options.map((o, i) => (
        <button
          key={i}
          type="button"
          className={s.opt}
          aria-pressed={o.value === props.current}
          disabled={o.disabled === true || props.busy === true}
          onClick={() => props.onPick(o.value)}
        >
          {o.label}
          {o.note !== undefined && <span className={s.optNote}>{o.note}</span>}
        </button>
      ))}
    </div>
  );
}

// --- segment ---------------------------------------------------------------

export function Segmented<V extends string>(props: {
  options: { value: V; label: string }[];
  value: V;
  onChange: (v: V) => void;
  label: string;
}) {
  return (
    <div className={s.seg} role="tablist" aria-label={props.label}>
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === props.value}
          className={s.segBtn}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// --- bos / yukleniyor ------------------------------------------------------

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className={s.empty}>
      <strong>{title}</strong>
      {children}
    </div>
  );
}

export function Loading() {
  return (
    <div className={s.loading} role="status" aria-live="polite">
      Yükleniyor…
    </div>
  );
}

// --- toast -----------------------------------------------------------------

interface ToastItem {
  id: number;
  text: string;
  error: boolean;
  undo?: () => void;
}

const ToastCtx = createContext<(t: Omit<ToastItem, "id">) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((t: Omit<ToastItem, "id">) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-2), { ...t, id }]);
    window.setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), t.error ? 6000 : 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className={s.toasts} role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={cx(s.toast, t.error && s.toastErr)}>
            {t.text}
            {t.undo !== undefined && (
              <button
                type="button"
                onClick={() => {
                  t.undo?.();
                  setItems((xs) => xs.filter((x) => x.id !== t.id));
                }}
              >
                Geri al
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}
