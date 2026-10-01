// Widget: takim/pillar sayfasindaki kutularin ortak kabugu. Hepsi ayni davranir:
// basliga basinca katlanir (cihazda hatirlanir), sag ustte uzerine gelince
// kalem ikonu cikar ve kutuyu DUZENLEME moduna alir (ekle/cikar denetimleri
// yalniz bu modda), sayfa "Düzen" modundayken yukari/asagi tasinir. Sira ve
// katlanma kisisel arayuz tercihi — cihazda (localStorage), sunucuya gitmez.

import { useState, type ReactNode } from "react";
import { useStored } from "../../lib/stored";
import { Icon } from "../../ui/icons";
import { Button, cx, IconButton } from "../../ui/ui";
import s from "./dashboard.module.css";

/** Uzun satir listesi kutuda bu kadar gosterilir; gerisi "Tümünü göster"le. */
export const ROW_LIMIT = 5;

export type WidgetMove = { first: boolean; last: boolean; onMove: (dir: -1 | 1) => void };

/** Sayfanin widget sirasi. Kayitli sirada olmayan (yeni eklenmis) widget sona duser.
 *  `moveOf` yalniz duzen modunda tanimli doner — Widget'in `move`'una verilir. */
export function useWidgetOrder<K extends string>(page: string, ids: readonly K[], arranging: boolean) {
  const [saved, setSaved] = useStored<string[]>(`widgets.order.${page}`, []);
  const order: K[] = [...ids.filter((x) => saved.includes(x)).sort((a, b) => saved.indexOf(a) - saved.indexOf(b)),
    ...ids.filter((x) => !saved.includes(x))];
  const moveOf = (id: K): WidgetMove | undefined => {
    if (!arranging) return undefined;
    const i = order.indexOf(id);
    return {
      first: i === 0,
      last: i === order.length - 1,
      onMove: (dir) => {
        const other = order[i + dir];
        if (other === undefined) return;
        const next = [...order];
        next[i] = other;
        next[i + dir] = id;
        setSaved(next);
      },
    };
  };
  return { order, moveOf };
}

/** Sayfa basligindaki "Düzen" dugmesi: widget'lari siralama modunu acar/kapatir. */
export function ArrangeButton({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <Button variant={on ? "primary" : "default"} aria-pressed={on} onClick={() => onChange(!on)}>
      <Icon name={on ? "check" : "sliders"} size={15} /> {on ? "Düzeni bitir" : "Düzen"}
    </Button>
  );
}

export function Widget(props: {
  /** Sayfa ici benzersiz: katlanma anahtari (`team.members`). */
  id: string;
  title: string;
  count?: number | undefined;
  /** Baslik satirinin sagi (ör. Açık/Kapanan); katliyken gizli. */
  actions?: ReactNode;
  /** Kalem ikonu yalniz yazma yetkisi olana. */
  canEdit?: boolean;
  /** Sayfa "Düzen" modunda: kalem yerine yukari/asagi. */
  move?: WidgetMove | undefined;
  children: (editing: boolean) => ReactNode;
}) {
  const [collapsed, setCollapsed] = useStored<string[]>("widgets.collapsed", []);
  const [editing, setEditing] = useState(false);
  const folded = collapsed.includes(props.id);
  const headId = `w-${props.id}`;
  const toggle = () => setCollapsed(folded ? collapsed.filter((x) => x !== props.id) : [...collapsed, props.id]);

  return (
    <section className={cx(s.surface, s.widget)} aria-labelledby={headId} data-folded={folded || undefined}>
      <div className={s.surfaceHead}>
        <button type="button" className={s.widgetToggle} aria-expanded={!folded} onClick={toggle}>
          <span className={cx(s.caret, !folded && s.caretOpen)}><Icon name="chevron" size={14} /></span>
          <span id={headId}>{props.title}</span>
          {props.count !== undefined && <span className={s.count}>{props.count}</span>}
        </button>
        <span className={s.widgetActs}>
          {!folded && props.actions}
          {props.move !== undefined ? (
            <>
              <IconButton icon="up" label={`${props.title} yukarı taşı`} disabled={props.move.first} onClick={() => props.move?.onMove(-1)} />
              <IconButton icon="down" label={`${props.title} aşağı taşı`} disabled={props.move.last} onClick={() => props.move?.onMove(1)} />
            </>
          ) : props.canEdit === true && !folded && (
            editing ? (
              <Button size="sm" variant="primary" onClick={() => setEditing(false)}>
                <Icon name="check" size={14} /> Bitti
              </Button>
            ) : (
              <IconButton className={s.widgetEdit} icon="edit" label={`${props.title} düzenle`} onClick={() => setEditing(true)} />
            )
          )}
        </span>
      </div>
      {!folded && props.children(editing && props.move === undefined)}
    </section>
  );
}

/** Ilk ROW_LIMIT satir + "Tümünü göster". Duzenlemede hepsi acik (kaldirilacak satir gizli kalmasin). */
export function useRowLimit<T>(rows: T[], showAll: boolean): { shown: T[]; more: ReactNode } {
  const [open, setOpen] = useState(false);
  const all = open || showAll || rows.length <= ROW_LIMIT;
  return {
    shown: all ? rows : rows.slice(0, ROW_LIMIT),
    more: rows.length > ROW_LIMIT && !showAll && (
      <button type="button" className={s.widgetMore} onClick={() => setOpen(!open)}>
        {open ? "Daha az göster" : `Tümünü göster (${rows.length})`}
      </button>
    ),
  };
}
