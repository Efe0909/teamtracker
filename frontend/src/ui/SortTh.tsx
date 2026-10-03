// Siralanir tablo basligi: tikla → artan → azalan → kapali (lib/sort.ts).
// `children` (ornegin sutun tutamaci) dugmenin yanina eklenir.

import type { ReactNode } from "react";
import type { Sorter } from "../lib/sort";
import { Icon } from "./icons";
import s from "./SortTh.module.css";

export function SortTh<T>(props: { sorter: Sorter<T>; k: string; title?: string; children?: ReactNode; label: ReactNode }) {
  const on = props.sorter.sort?.key === props.k;
  const dir = on ? props.sorter.sort?.dir : undefined;
  return (
    <th scope="col" aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}>
      <button type="button" className={s.btn} data-on={on} title={props.title} onClick={() => props.sorter.toggle(props.k)}>
        {props.label}
        <Icon name={dir === "asc" ? "up" : dir === "desc" ? "down" : "updown"} size={12} />
      </button>
      {props.children}
    </th>
  );
}
