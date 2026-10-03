// Tarih alani: tetik dugmesi + acilir takvim (native tarayici takvimi YOK).
// `DateField`: yalniz gun ("YYYY-MM-DD"). `DateTimeField`: gun + saat
// ("YYYY-MM-DDTHH:mm", yerel — sunucuya Poll'daki gibi bu bicimde gider).
// Takvim Pazartesi'den baslar; oklarla gun gezilir, Enter secer, Esc kapatir.

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { IsoDate } from "../api/types";
import { formatDay, parseDay, toIsoDay } from "../lib/labels";
import { Icon } from "./icons";
import { Button, cx, Popover, ui } from "./ui";
import s from "./DateField.module.css";

const DOW = ["Pt", "Sa", "Ça", "Pe", "Cu", "Ct", "Pz"];
const monthFmt = new Intl.DateTimeFormat("tr", { month: "long", year: "numeric" });
const longFmt = new Intl.DateTimeFormat("tr", { day: "numeric", month: "long", year: "numeric" });

/** Bugunden `n` gun sonrasi. */
function plus(n: number): IsoDate {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return toIsoDay(d);
}

/** `iso`'dan `n` ay sonrasi; hedef ay kisaysa ayin son gunune oturur (31 Ocak + 1 ay = 28 Subat). */
function addMonths(iso: IsoDate, n: number): IsoDate {
  const d = parseDay(iso);
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  return toIsoDay(new Date(t.getFullYear(), t.getMonth(), Math.min(d.getDate(), last)));
}

function addDays(iso: IsoDate, n: number): IsoDate {
  const d = parseDay(iso);
  return toIsoDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}

const KEY_STEP: Record<string, (iso: IsoDate) => IsoDate> = {
  ArrowLeft: (d) => addDays(d, -1),
  ArrowRight: (d) => addDays(d, 1),
  ArrowUp: (d) => addDays(d, -7),
  ArrowDown: (d) => addDays(d, 7),
  PageUp: (d) => addMonths(d, -1),
  PageDown: (d) => addMonths(d, 1),
};

/** Ay izgarasi: Pazartesi'den baslayan 6 satir (42 gun) — ay degisince yukseklik sabit. */
function cells(view: IsoDate): IsoDate[] {
  const first = parseDay(view.slice(0, 8) + "01");
  const offset = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) => toIsoDay(new Date(first.getFullYear(), first.getMonth(), 1 - offset + i)));
}

function Calendar(props: { value: IsoDate | null; busy: boolean; onPick: (d: IsoDate) => void }) {
  const today = toIsoDay(new Date());
  const [cursor, setCursor] = useState<IsoDate>(props.value ?? today);
  const [view, setView] = useState<IsoDate>(props.value ?? today);
  const grid = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  const month = view.slice(0, 7);
  // Sekme durağı: imlec gorunen aydaysa o gun, degilse ayin ilk gunu.
  const stop = cursor.startsWith(month) ? cursor : `${month}-01`;

  // Klavyeyle gezince odak yeni gune tasinir (ay degisse bile).
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    grid.current?.querySelector<HTMLElement>(`[data-day="${cursor}"]`)?.focus();
  }, [cursor, view]);

  const go = (next: IsoDate) => {
    moved.current = true;
    setCursor(next);
    setView(next);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = KEY_STEP[e.key];
    if (step === undefined) return;
    e.preventDefault();
    go(step(cursor));
  };

  return (
    <>
      <div className={s.head}>
        <button type="button" className={ui.iconBtn} aria-label="Önceki ay" onClick={() => setView(addMonths(view, -1))}>
          <Icon name="back" size={16} />
        </button>
        <span className={s.month} aria-live="polite">{monthFmt.format(parseDay(view))}</span>
        <button type="button" className={ui.iconBtn} aria-label="Sonraki ay" onClick={() => setView(addMonths(view, 1))}>
          <Icon name="chevron" size={16} />
        </button>
      </div>
      <div className={s.grid} ref={grid} role="grid" onKeyDown={onKeyDown}>
        {DOW.map((d) => <span key={d} className={s.dow} aria-hidden>{d}</span>)}
        {cells(view).map((d) => (
          <button
            key={d}
            type="button"
            role="gridcell"
            data-day={d}
            data-on={d === props.value}
            tabIndex={d === stop ? 0 : -1}
            disabled={props.busy}
            aria-label={longFmt.format(parseDay(d))}
            aria-selected={d === props.value}
            className={cx(s.day, !d.startsWith(month) && s.out, d === today && s.today)}
            onClick={() => props.onPick(d)}
          >
            {Number(d.slice(8))}
          </button>
        ))}
      </div>
    </>
  );
}

interface Common {
  disabled?: boolean;
  /** Kayit surerken gun secilemez. */
  busy?: boolean;
  /** Dolu degeri kaldiran dugme gosterilir (onChange(null)). */
  clearable?: boolean;
  clearLabel?: string;
  "aria-label": string;
  /** Bos degerde tetikte gorunen metin. */
  placeholder?: string;
  /** Verilirse varsayilan tetik gorunumunun YERINE gecer (kayit ozellik satiri gibi). */
  className?: string;
  /** Verilirse tetik icerigi bu olur (ikon + metin yerine). */
  children?: ReactNode;
  align?: "start" | "end";
}

function Shell(props: Common & { text: string | null; open: boolean; setOpen: (o: boolean) => void; body: ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  const label = `${props["aria-label"]}: ${props.text ?? "yok"}`;
  return (
    <Popover
      open={props.open}
      onOpenChange={props.setOpen}
      align={props.align ?? "start"}
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        wrap.current?.querySelector<HTMLElement>("[data-day][tabindex='0']")?.focus();
      }}
      trigger={
        <button type="button" className={props.className ?? s.trigger} disabled={props.disabled === true} aria-label={label}>
          {props.children ?? (
            <>
              <Icon name="calendar" size={14} />
              {props.text ?? <span className={s.empty}>{props.placeholder ?? "Tarih seç"}</span>}
            </>
          )}
        </button>
      }
    >
      <div className={s.cal} ref={wrap}>{props.body}</div>
    </Popover>
  );
}

function Quick({ onPick }: { onPick: (d: IsoDate) => void }) {
  return (
    <div className={s.quick}>
      <Button size="sm" onClick={() => onPick(plus(0))}>Bugün</Button>
      <Button size="sm" onClick={() => onPick(plus(1))}>Yarın</Button>
      <Button size="sm" onClick={() => onPick(plus(7))}>+1 hafta</Button>
    </div>
  );
}

/** Yalniz gun. Gune tiklayinca onChange + kapanir; ayni gune tiklamak degistirmez. */
export function DateField(props: Common & { value: IsoDate | null; onChange: (v: IsoDate | null) => void }) {
  const [open, setOpen] = useState(false);
  const pick = (d: IsoDate | null) => {
    setOpen(false);
    if (d !== props.value) props.onChange(d);
  };
  return (
    <Shell {...props} text={props.value === null ? null : formatDay(props.value)} open={open} setOpen={setOpen}
      body={
        <>
          <Quick onPick={pick} />
          <Calendar value={props.value} busy={props.busy === true} onPick={pick} />
          {props.clearable === true && props.value !== null && (
            <div className={ui.dact}>
              <Button variant="ghost" size="sm" onClick={() => pick(null)}>{props.clearLabel ?? "Temizle"}</Button>
            </div>
          )}
        </>
      } />
  );
}

/** Gun + saat; deger yerel "YYYY-MM-DDTHH:mm". Gun/saat degisince hemen onChange; "Tamam" kapatir. */
export function DateTimeField(props: Common & { value: string | null; onChange: (v: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const day = props.value === null ? null : props.value.slice(0, 10);
  const time = props.value === null ? "09:00" : props.value.slice(11, 16);
  return (
    <Shell {...props} text={props.value === null ? null : `${formatDay(props.value.slice(0, 10))}, ${props.value.slice(11, 16)}`} open={open} setOpen={setOpen}
      body={
        <>
          <Quick onPick={(d) => props.onChange(`${d}T${time}`)} />
          <Calendar value={day} busy={props.busy === true} onPick={(d) => props.onChange(`${d}T${time}`)} />
          <label className={s.time}>
            Saat
            <input className={ui.input} type="time" value={time} aria-label="Saat"
              onChange={(e) => { if (e.target.value !== "") props.onChange(`${day ?? plus(0)}T${e.target.value}`); }} />
          </label>
          <div className={ui.dact}>
            {props.clearable === true && props.value !== null && (
              <Button variant="ghost" size="sm" onClick={() => { props.onChange(null); setOpen(false); }}>{props.clearLabel ?? "Temizle"}</Button>
            )}
            <Button variant="primary" size="sm" onClick={() => setOpen(false)}>Tamam</Button>
          </div>
        </>
      } />
  );
}
