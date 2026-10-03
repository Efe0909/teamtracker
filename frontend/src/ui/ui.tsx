// Yapi taslari. Alan bilmez (kayit, eylem...) — yalniz gorunum.
// Etkilesimli ogeler Radix primitifleri (basliksiz: davranis + erisilebilirlik
// onlarda, gorunum ui.module.css'te) ve cmdk (aranabilir liste).

import * as RD from "@radix-ui/react-dialog";
import * as RM from "@radix-ui/react-dropdown-menu";
import * as RP from "@radix-ui/react-popover";
import * as RT from "@radix-ui/react-tooltip";
import { Command } from "cmdk";
import {
  createContext,
  useCallback,
  useContext,
  useState,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import type { ActionStatus, IsoDate, MetaTeam, MetaUser, Priority, RecordKind, RecordStatus } from "../api/types";
import { ACTION_STATUS, dueLabel, daysFromToday, formatDay, KIND, PRIORITY, STATUS } from "../lib/labels";
import { onLinkClick } from "../lib/router";
import { Icon, type IconName } from "./icons";
import s from "./ui.module.css";

export { s as ui };

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(" ");
}

// --- dugme -----------------------------------------------------------------

type Variant = "default" | "primary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export function Button(
  props: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; big?: boolean },
) {
  const { variant = "default", size, big = false, className, type = "button", ...rest } = props;
  const sz = size ?? (big ? "lg" : "md");
  return (
    <button
      type={type}
      className={cx(s.btn, s[`v-${variant}`], s[`z-${sz}`], className)}
      {...rest}
    />
  );
}

/** Yalniz ikonlu dugme: etiket ZORUNLU (ipucu + erisilebilir ad ayni metin). */
export function IconButton(
  props: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & { icon: IconName; label: string; size?: number },
) {
  const { icon, label, size = 16, className, type = "button", ...rest } = props;
  return (
    <Tip label={label}>
      <button type={type} className={cx(s.iconBtn, className)} aria-label={label} {...rest}>
        <Icon name={icon} size={size} />
      </button>
    </Tip>
  );
}

/** SPA baglantisi. Ctrl/cmd-tik yeni sekmede acar (tarayiciya birakilir). */
export function Link(props: {
  href: string;
  className?: string;
  children: ReactNode;
  title?: string;
  "aria-current"?: "page" | undefined;
  /** Ek oznitelikler (suruklenebilir satir gibi); href/className/onClick Link'in kalir. */
  extra?: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "className" | "onClick" | "children"> | undefined;
}) {
  return (
    <a
      {...props.extra}
      href={props.href}
      className={props.className}
      title={props.title}
      aria-current={props["aria-current"]}
      onClick={(e) => onLinkClick(e, props.href)}
    >
      {props.children}
    </a>
  );
}

/** Zorunlu alan isareti. Ekran okuyucu `required` ozniteligini zaten okur;
 *  yildiz yalniz gorsel ve CSS'te (::after) — etiket metnine karismaz. */
export function Req() {
  return <span className={s.req} aria-hidden="true" />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className={s.kbd}>{children}</kbd>;
}

// --- ipucu -----------------------------------------------------------------

export function Tip({ label, children, side = "top" }: { label: string; children: ReactElement; side?: "top" | "right" | "bottom" | "left" }) {
  return (
    <RT.Provider delayDuration={350}>
      <RT.Root>
        <RT.Trigger asChild>{children}</RT.Trigger>
        <RT.Portal>
          <RT.Content side={side} sideOffset={6} className={s.tip}>
            {label}
          </RT.Content>
        </RT.Portal>
      </RT.Root>
    </RT.Provider>
  );
}

// --- rozetler --------------------------------------------------------------

export function KindTag({ kind }: { kind: RecordKind }) {
  return <span className={cx(s.tag, kind === "issue" ? s["t-issue"] : s["t-task"])}>{KIND[kind]}</span>;
}

const PRIORITY_ICON: Record<Priority, IconName> = { critical: "alert", high: "prHigh", medium: "prMedium", low: "prLow" };

/** Oncelik: ikon + metin; renk tek basina anlam tasimaz. */
export function PriorityTag({ priority, bare = false }: { priority: Priority; bare?: boolean }) {
  return (
    <span className={cx(bare ? s.inline : s.tag, s[`p-${priority}`])}>
      <Icon name={PRIORITY_ICON[priority]} size={13} />
      {PRIORITY[priority]}
    </span>
  );
}

export function Tag({ tone, children }: { tone: "info" | "ok" | "neutral" | "critical" | "high"; children: ReactNode }) {
  return <span className={cx(s.tag, s[`t-${tone}`])}>{children}</span>;
}

const STATUS_ICON: Record<RecordStatus | ActionStatus, IconName> = {
  open: "stOpen",
  in_progress: "stProgress",
  pending: "stPending",
  closed: "stDone",
  cancelled: "off",
};

/** Durum: ikon + renk + metin (Linear dili). */
export function Status({ status, action = false }: { status: RecordStatus | ActionStatus; action?: boolean }) {
  const label = action ? ACTION_STATUS[status as ActionStatus] : STATUS[status as RecordStatus];
  return (
    <span className={cx(s.status, s[`s-${status}`])}>
      <Icon name={STATUS_ICON[status]} size={14} />
      {label}
    </span>
  );
}

/** Son tarih: gecikme METINLE soylenir, renk tek basina degil (P2 #9).
 *  `actionLate`: kaydin kendi tarihi gecmemis ama acik bir eylemininki gecmis. */
export function Due({ date, done = false, actionLate = false }: { date: IsoDate | null; done?: boolean; actionLate?: boolean }) {
  const late = !done && date !== null && daysFromToday(date) < 0;
  const extra = !done && !late && actionLate;
  return (
    <span className={s.due}>
      {date === null ? (
        !extra && <span className={s.none}>—</span>
      ) : (
        <span className={cx(s.due, late && s.late)} title={formatDay(date)}>
          {late ? <Icon name="alert" size={13} /> : <Icon name="calendar" size={13} />}
          {done ? formatDay(date) : dueLabel(date)}
        </span>
      )}
      {extra && (
        <span className={cx(s.due, s.late)}>
          <Icon name="alert" size={13} /> eylem gecikti
        </span>
      )}
    </span>
  );
}

// --- kisi ------------------------------------------------------------------

// Cevrimici esigi. Sunucu `last_seen_at`'i kullanici basina dakikada en fazla
// bir kez yaziyor (backend/src/auth.rs PRESENCE_INTERVAL); esik bu araligin
// USTUNDE kalmali, yoksa sayfasi acik biri yanip soner. Python'da da 2 dk.
const ONLINE_MS = 2 * 60_000;

type AvatarUser = Pick<MetaUser, "name" | "color" | "last_seen_at"> &
  Partial<Pick<MetaUser, "avatar_id" | "birth_day" | "birth_month">>;

function isBirthday(u: AvatarUser | undefined): boolean {
  if (u?.birth_day == null || u.birth_month == null) return false;
  const now = new Date();
  return u.birth_day === now.getDate() && u.birth_month === now.getMonth() + 1;
}

export function Avatar({ user, size = 24 }: { user: AvatarUser | undefined; size?: number }) {
  const online = user?.last_seen_at != null && Date.now() - new Date(user.last_seen_at).getTime() < ONLINE_MS;
  const photo = user?.avatar_id ?? null;
  return (
    <span
      className={cx(s.av, online && s.online)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.44), ...(user?.color != null ? { background: user.color } : {}) }}
      aria-hidden="true"
    >
      {photo !== null ? (
        <img className={s.avImg} src={`/api/attachments/${photo}/thumb`} alt="" loading="lazy" />
      ) : (
        (user?.name ?? "?").slice(0, 1).toLocaleUpperCase("tr")
      )}
      {isBirthday(user) && (
        <span className={s.cake}>
          <Icon name="cake" size={Math.max(10, Math.round(size * 0.45))} />
        </span>
      )}
    </span>
  );
}

export function Who({ user, empty = "—", size = 20 }: { user: MetaUser | undefined; empty?: string; size?: number }) {
  if (user === undefined) return <span className={cx(s.who, s.none)}>{empty}</span>;
  return (
    <span className={s.who}>
      <Avatar user={user} size={size} />
      <span>{user.name}</span>
    </span>
  );
}

export function TeamName({ team, empty = "—" }: { team: MetaTeam | undefined; empty?: string }) {
  if (team === undefined) return <span className={cx(s.who, s.none)}>{empty}</span>;
  return (
    <span className={s.who}>
      <span className={s.dot} style={team.color !== null ? { background: team.color } : {}} aria-hidden="true" />
      <span>{team.name}</span>
    </span>
  );
}

// --- dialog ----------------------------------------------------------------

/** Radix Dialog: odak tuzagi, Esc, arka plan, kaydirma kilidi. `open` kontrollu.
 *  Baslik id'si sabit `dlg-title` — icerik alanlari ona `aria-labelledby` verebilir. */
export function Dialog(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  hint?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <RD.Root open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <RD.Portal>
        <RD.Overlay className={s.overlay} />
        <RD.Content className={cx(s.dialog, props.wide === true && s.wide)} aria-describedby={undefined}>
          <div className={s.dhead}>
            <RD.Title id="dlg-title">{props.title}</RD.Title>
            <RD.Close asChild>
              <button type="button" className={s.iconBtn} aria-label="Kapat">
                <Icon name="x" />
              </button>
            </RD.Close>
          </div>
          {props.hint !== undefined && <p className={s.dhint}>{props.hint}</p>}
          <div className={s.dbody}>{props.children}</div>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

// --- secici (Picker) -------------------------------------------------------
// Native <select> yerine: tetik dugmesi + acilir aranabilir liste. Tek secim
// IKI ADIM (ac → sec): kaydirmayla yanlislikla degisen select yok.

export interface Option<V> {
  value: V;
  label: string;
  /** Listede ve tetikte cizilecek zengin icerik (avatar, durum ikonu). */
  render?: ReactNode;
  /** Kisa not, etiketin sagina (ornegin "sen"). */
  hint?: string;
  /** Uzun aciklama: etiketin ALTINA, soluk ve satir kirarak. */
  desc?: string;
  disabled?: boolean;
  /** Agac girintisi. */
  depth?: number;
}

export function Picker<V>(props: {
  options: Option<V>[];
  value: V;
  onChange: (v: V) => void;
  /** Tetigin ve listenin erisilebilir adi. */
  label: string;
  /** Tetikte gorunen icerik; verilmezse secili secenek. */
  children?: ReactNode;
  /** field: form alani · chip: filtre cipi · prop: ozellik satiri · bare: dugme cercevesiz. */
  look?: "field" | "chip" | "prop" | "bare";
  active?: boolean;
  disabled?: boolean;
  busy?: boolean;
  search?: boolean;
  placeholder?: string;
  empty?: string;
  align?: "start" | "end";
  className?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const { look = "field" } = props;
  const current = props.options.find((o) => Object.is(o.value, props.value));
  const searchable = props.search ?? props.options.length > 7;
  return (
    <RP.Root open={open} onOpenChange={setOpen}>
      <RP.Trigger asChild>
        <button
          type="button"
          id={props.id}
          className={cx(s.trigger, s[`look-${look}`], props.active === true && s.triggerOn, props.className)}
          aria-label={`${props.label}: ${current?.label ?? props.placeholder ?? "seçilmedi"}`}
          disabled={props.disabled}
        >
          <span className={s.triggerVal}>
            {props.children ?? current?.render ?? current?.label ?? <span className={s.none}>{props.placeholder ?? "Seç"}</span>}
          </span>
          {look !== "bare" && <Icon name="updown" size={14} />}
        </button>
      </RP.Trigger>
      <RP.Portal>
        <RP.Content className={s.pop} align={props.align ?? "start"} sideOffset={6} collisionPadding={12}>
          <Command label={props.label} loop>
            {searchable && <Command.Input className={s.popSearch} placeholder={`${props.label} ara…`} autoFocus />}
            <Command.List className={s.popList}>
              <Command.Empty className={s.popEmpty}>{props.empty ?? "Sonuç yok"}</Command.Empty>
              {props.options.map((o, i) => {
                const on = Object.is(o.value, props.value);
                return (
                  <Command.Item
                    key={i}
                    value={`${i}`}
                    keywords={[o.label, o.hint ?? "", o.desc ?? ""]}
                    disabled={o.disabled === true || props.busy === true}
                    className={cx(s.popItem, o.desc !== undefined && s.popItemDesc)}
                    data-on={on}
                    onSelect={() => {
                      setOpen(false);
                      if (!on) props.onChange(o.value);
                    }}
                  >
                    <span className={s.popBody}>
                      <span className={s.popLabel} style={o.depth !== undefined ? { paddingLeft: o.depth * 14 } : undefined}>
                        {o.render ?? o.label}
                      </span>
                      {o.desc !== undefined && o.desc !== "" && <span className={s.popDesc}>{o.desc}</span>}
                    </span>
                    {o.hint !== undefined && <span className={s.popHint}>{o.hint}</span>}
                    <span className={s.popCheck}>{on && <Icon name="check" size={14} />}</span>
                  </Command.Item>
                );
              })}
            </Command.List>
          </Command>
        </RP.Content>
      </RP.Portal>
    </RP.Root>
  );
}

/** Serbest icerikli acilir yuzey (tarih secici gibi). Tetik tek eleman. */
export function Popover(props: {
  trigger: ReactElement;
  children: ReactNode;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  align?: "start" | "end";
  /** Acilista odagi kendin ver (preventDefault) — takvim gun dugmesine odaklanir. */
  onOpenAutoFocus?: (e: Event) => void;
}) {
  return (
    <RP.Root open={props.open} onOpenChange={props.onOpenChange}>
      <RP.Trigger asChild>{props.trigger}</RP.Trigger>
      <RP.Portal>
        <RP.Content className={cx(s.pop, s.popPad)} align={props.align ?? "start"} sideOffset={6} collisionPadding={12}
          {...(props.onOpenAutoFocus !== undefined ? { onOpenAutoFocus: props.onOpenAutoFocus } : {})}>
          {props.children}
        </RP.Content>
      </RP.Portal>
    </RP.Root>
  );
}

/** Eski ad: dialog icinde secenek listesi. Artik Picker'in listesi, satir ici. */
export interface Choice<V> {
  value: V;
  label: ReactNode;
  disabled?: boolean;
  note?: string;
}

export function Choices<V>(props: { options: Choice<V>[]; current: V; onPick: (v: V) => void; busy?: boolean }) {
  return (
    <div className={s.opts} role="group">
      {props.options.map((o, i) => (
        <button
          key={i}
          type="button"
          className={s.opt}
          aria-pressed={Object.is(o.value, props.current)}
          disabled={o.disabled === true || props.busy === true}
          onClick={() => props.onPick(o.value)}
        >
          {o.label}
          {o.note !== undefined && <span className={s.optNote}>{o.note}</span>}
          {Object.is(o.value, props.current) && <Icon name="check" size={14} />}
        </button>
      ))}
    </div>
  );
}

// --- menu ------------------------------------------------------------------

export function Menu(props: { trigger: ReactElement; children: ReactNode; align?: "start" | "end"; side?: "top" | "bottom" | "right" }) {
  return (
    <RM.Root>
      <RM.Trigger asChild>{props.trigger}</RM.Trigger>
      <RM.Portal>
        <RM.Content className={s.pop} align={props.align ?? "start"} side={props.side ?? "bottom"} sideOffset={6} collisionPadding={12}>
          <div className={s.menuList}>{props.children}</div>
        </RM.Content>
      </RM.Portal>
    </RM.Root>
  );
}

export function MenuItem(props: { icon?: IconName; onSelect: () => void; danger?: boolean; children: ReactNode; hint?: string }) {
  return (
    <RM.Item className={cx(s.popItem, props.danger === true && s.popDanger)} onSelect={props.onSelect}>
      {props.icon !== undefined && <Icon name={props.icon} size={15} />}
      <span className={s.popLabel}>{props.children}</span>
      {props.hint !== undefined && <span className={s.popHint}>{props.hint}</span>}
    </RM.Item>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <RM.Label className={s.menuLabel}>{children}</RM.Label>;
}

export function MenuSep() {
  return <RM.Separator className={s.menuSep} />;
}

export function MenuRadio<V extends string>(props: { value: V; onChange: (v: V) => void; options: { value: V; label: string; icon?: IconName }[] }) {
  return (
    <RM.RadioGroup value={props.value} onValueChange={(v) => props.onChange(v as V)}>
      {props.options.map((o) => (
        <RM.RadioItem key={o.value} value={o.value} className={s.popItem} data-on={o.value === props.value}>
          {o.icon !== undefined && <Icon name={o.icon} size={15} />}
          <span className={s.popLabel}>{o.label}</span>
          <span className={s.popCheck}>
            <RM.ItemIndicator>
              <Icon name="check" size={14} />
            </RM.ItemIndicator>
          </span>
        </RM.RadioItem>
      ))}
    </RM.RadioGroup>
  );
}

// --- segment ---------------------------------------------------------------

export function Segmented<V extends string>(props: {
  options: { value: V; label: string; count?: number }[];
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
          {o.count !== undefined && <span className={s.segCount}>{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

// --- bos / yukleniyor ------------------------------------------------------

export function Empty({ title, children, icon = "inbox" }: { title: string; children?: ReactNode; icon?: IconName }) {
  return (
    <div className={s.empty}>
      <span className={s.emptyIcon}>
        <Icon name={icon} size={20} />
      </span>
      <strong>{title}</strong>
      {children}
    </div>
  );
}

export function Loading() {
  return (
    <div className={s.loading} role="status" aria-live="polite">
      <span className={s.spinner} aria-hidden="true" />
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
            <Icon name={t.error ? "alert" : "check"} size={15} />
            <span>{t.text}</span>
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
