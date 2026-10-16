// Birden fazla kisi secici (eylemin atananlari). Alan bilmez: kullanici listesi ve
// secili kimlikler gelir. Liste acikken degisiklik yerelde birikir; kapaninca TEK
// onChange (her tikta ayri kayit/geri al bildirimi olmasin).

import * as RP from "@radix-ui/react-popover";
import { useId, useState } from "react";
import type { MetaUser, Uuid } from "../api/types";
import { Icon } from "./icons";
import s from "./PeoplePicker.module.css";
import { Avatar, cx, ui, Who } from "./ui";

export function PeoplePicker(props: {
  users: MetaUser[];
  currentUserId?: Uuid;
  value: Uuid[];
  onChange: (next: Uuid[]) => void;
  /** Tetigin ve listenin erisilebilir adi. */
  label: string;
  /** Hic kimse secili degilken yazi. */
  empty?: string;
  disabled?: boolean;
  align?: "start" | "end";
  className?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Uuid[]>(props.value);
  const [q, setQ] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const empty = props.empty ?? "Havuzda";
  const byId = (id: Uuid) => props.users.find((u) => u.id === id);
  const chosen = props.value.map(byId).filter((u): u is MetaUser => u !== undefined);
  const needle = q.trim().toLocaleLowerCase("tr");
  const shown = props.users.filter((u) => needle === "" || u.name.toLocaleLowerCase("tr").includes(needle));
  const options: (MetaUser | null)[] = needle === "" ? [null, ...shown] : shown;
  const optionId = (index: number) => `${listId}-option-${index}`;

  const toggle = (id: Uuid) =>
    setDraft((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));
  const sameSet = (a: Uuid[], b: Uuid[]) => a.length === b.length && a.every((x) => b.includes(x));

  const changeOpen = (v: boolean) => {
    if (v) {
      setDraft(props.value);
      setQ("");
      setActiveIndex(0);
    } else if (!sameSet(draft, props.value)) {
      props.onChange(draft);
    }
    setOpen(v);
  };

  const names = chosen.map((u) => u.name).join(", ");
  return (
    <RP.Root open={open} onOpenChange={changeOpen}>
      <RP.Trigger asChild>
        <button type="button" className={cx(s.trigger, props.className)} disabled={props.disabled}
          aria-label={`${props.label}: ${names === "" ? empty : names}`}>
          {chosen.length === 0 ? <span className={s.none}>{empty}</span> : (
            <>
              <span className={s.stack}>
                {chosen.slice(0, 3).map((u) => <Avatar key={u.id} user={u} size={20} />)}
              </span>
              <span className={s.names}>{chosen[0]?.name}{chosen.length > 1 ? ` +${chosen.length - 1}` : ""}</span>
            </>
          )}
        </button>
      </RP.Trigger>
      <RP.Portal>
        <RP.Content className={cx(ui.pop, s.panel)} align={props.align ?? "end"} sideOffset={6} collisionPadding={12}>
          <input className={ui.popSearch} value={q}
            onChange={(e) => { setQ(e.target.value); setActiveIndex(0); }}
            placeholder="Kullanıcı ara…" aria-label="Kullanıcı ara" autoComplete="off" autoFocus
            role="combobox" aria-expanded={open} aria-controls={listId}
            aria-autocomplete="list" aria-activedescendant={options.length > 0 ? optionId(activeIndex) : undefined}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                if (options.length === 0) return;
                const next = (activeIndex + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
                setActiveIndex(next);
                document.getElementById(optionId(next))?.scrollIntoView({ block: "nearest" });
              } else if (e.key === "Enter") {
                e.preventDefault();
                const user = options[activeIndex];
                if (user === null) setDraft([]);
                else if (user !== undefined) toggle(user.id);
              }
            }} />
          <div id={listId} className={ui.popList} role="listbox" aria-label={props.label} aria-multiselectable="true">
            {options.map((user, index) => {
              const selected = user === null ? draft.length === 0 : draft.includes(user.id);
              return (
                <button key={user?.id ?? "none"} id={optionId(index)} type="button" role="option" tabIndex={-1}
                  className={cx(ui.popItem, s.option)} aria-selected={selected} data-on={selected}
                  data-highlighted={activeIndex === index ? "" : undefined}
                  onPointerMove={() => setActiveIndex(index)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => user === null ? setDraft([]) : toggle(user.id)}>
                  <span className={ui.popLabel}>
                    {user === null ? <span className={s.none}>Havuza bırak</span> : <Who user={user} />}
                  </span>
                  {user !== null && user.id === props.currentUserId && <span className={ui.popHint}>sen</span>}
                  <span className={ui.popCheck}>{selected && <Icon name="check" size={14} />}</span>
                </button>
              );
            })}
            {options.length === 0 && <div className={ui.popEmpty}>Sonuç yok</div>}
          </div>
        </RP.Content>
      </RP.Portal>
    </RP.Root>
  );
}
