// Birden fazla kisi secici (eylemin atananlari). Alan bilmez: kullanici listesi ve
// secili kimlikler gelir. Liste acikken degisiklik yerelde birikir; kapaninca TEK
// onChange (her tikta ayri kayit/geri al bildirimi olmasin).

import { useState } from "react";
import type { MetaUser, Uuid } from "../api/types";
import { Icon } from "./icons";
import s from "./PeoplePicker.module.css";
import { Avatar, cx, Popover } from "./ui";

export function PeoplePicker(props: {
  users: MetaUser[];
  value: Uuid[];
  onChange: (next: Uuid[]) => void;
  /** Tetigin ve listenin erisilebilir adi. */
  label: string;
  /** Hic kimse secili degilken yazi. */
  empty?: string;
  disabled?: boolean;
  align?: "start" | "end";
  /** Bos secimi geri vermek de gecerli mi (eylem havuzda kalabilir). Varsayilan evet. */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Uuid[]>(props.value);
  const [q, setQ] = useState("");
  const empty = props.empty ?? "Havuzda";
  const byId = (id: Uuid) => props.users.find((u) => u.id === id);
  const chosen = props.value.map(byId).filter((u): u is MetaUser => u !== undefined);
  const needle = q.trim().toLocaleLowerCase("tr");
  const shown = props.users.filter((u) => needle === "" || u.name.toLocaleLowerCase("tr").includes(needle));

  const toggle = (id: Uuid) =>
    setDraft((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));
  const sameSet = (a: Uuid[], b: Uuid[]) => a.length === b.length && a.every((x) => b.includes(x));

  const changeOpen = (v: boolean) => {
    if (v) {
      setDraft(props.value);
      setQ("");
    } else if (!sameSet(draft, props.value)) {
      props.onChange(draft);
    }
    setOpen(v);
  };

  const names = chosen.map((u) => u.name).join(", ");
  return (
    <Popover open={open} onOpenChange={changeOpen} align={props.align ?? "end"}
      trigger={
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
      }>
      <div className={s.panel}>
        {props.users.length > 7 && (
          <input className={s.search} type="search" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={`${props.label} ara…`} aria-label={`${props.label} ara`} autoFocus />
        )}
        <div className={s.list} role="group" aria-label={props.label}>
          {shown.map((u) => (
            <label key={u.id} className={s.item}>
              <input type="checkbox" checked={draft.includes(u.id)} onChange={() => toggle(u.id)} />
              <Avatar user={u} size={20} />
              <span>{u.name}</span>
              {draft.includes(u.id) && <Icon name="check" size={14} />}
            </label>
          ))}
          {shown.length === 0 && <span className={s.none}>Sonuç yok</span>}
        </div>
        <div className={s.foot}>
          <button type="button" className={s.link} disabled={draft.length === 0} onClick={() => setDraft([])}>
            Havuza bırak
          </button>
          <button type="button" className={s.done} onClick={() => changeOpen(false)}>Tamam</button>
        </div>
      </div>
    </Popover>
  );
}
