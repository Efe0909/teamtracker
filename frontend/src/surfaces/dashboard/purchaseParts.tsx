// Satin alimlar widget'inin ortak parcalari (pano, liste, detay).

import type { EventOp } from "../../api/hooks";
import type { Priority } from "../../api/types";
import { PRIORITY } from "../../lib/labels";
import { Icon, type IconName } from "../../ui/icons";
import s from "./purchases.module.css";

/** Tek yazma kapisi: hata tostu ortak, `ok` yalniz basarida. */
export type Run = (op: EventOp, ok?: () => void) => void;

/** 4 cubuklu seviye: dusuk 1 · orta 2 · yuksek 3 · kritik tam. */
const PRIO_ICON: Record<Priority, IconName> = { critical: "prCritical", high: "prHigh", medium: "prMedium", low: "prLow" };

export function PrioMark({ p }: { p: Priority }) {
  return (
    <span className={s.prio} data-p={p} title={`Öncelik: ${PRIORITY[p]}`}>
      <Icon name={PRIO_ICON[p]} size={16} />
    </span>
  );
}
