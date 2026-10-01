// "Birime bagla" agaci: bagli birimlerin dallari ACIK, digerleri kapali (kucuk
// ok). Yildiz kisisel favoridir — cihazda (localStorage), sunucuya gitmez;
// "Favoriler" suzgeci yalniz yildizlilari gosterir.

import { useMemo, useState } from "react";
import type { MetaNode, Uuid } from "../../api/types";
import { useStored } from "../../lib/stored";
import { Icon } from "../../ui/icons";
import { cx } from "../../ui/ui";
import s from "./dashboard.module.css";

export function useFavoriteNodes(): [Set<Uuid>, (id: Uuid) => void] {
  const [ids, setIds] = useStored<Uuid[]>("favorites.nodes", []);
  const set = useMemo(() => new Set(ids), [ids]);
  const toggle = (id: Uuid) => setIds(set.has(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  return [set, toggle];
}

/** `units` Euler sirasinda (once ust, sonra cocuklar), `depth` ile. */
export function UnitPicker(props: {
  units: MetaNode[];
  linked: Uuid[];
  onLink: (id: Uuid) => void;
  disabled?: boolean;
}) {
  const { units, linked } = props;
  const [favs, toggleFav] = useFavoriteNodes();
  const [onlyFavs, setOnlyFavs] = useState(false);

  // Her dugumun atalari (sira korunur); baslangicta bagli dugumlerin atalari acik.
  const { ancestors, hasKids } = useMemo(() => {
    const stack: Uuid[] = [];
    const anc = new Map<Uuid, Uuid[]>();
    const kids = new Set<Uuid>();
    for (const n of units) {
      stack.length = n.depth;
      anc.set(n.id, [...stack]);
      const parent = stack[stack.length - 1];
      if (parent !== undefined) kids.add(parent);
      stack[n.depth] = n.id;
    }
    return { ancestors: anc, hasKids: kids };
  }, [units]);
  const [open, setOpen] = useState<Set<Uuid>>(
    () => new Set(linked.flatMap((id) => ancestors.get(id) ?? [])),
  );
  const toggle = (id: Uuid) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const rows = units.filter((n) =>
    onlyFavs ? favs.has(n.id) : (ancestors.get(n.id) ?? []).every((a) => open.has(a)),
  );

  return (
    <div className={s.unitPicker}>
      <div className={s.unitBar}>
        <span>Birime bağla</span>
        <button type="button" className={cx(s.favFilter, onlyFavs && s.favFilterOn)} aria-pressed={onlyFavs}
          onClick={() => setOnlyFavs(!onlyFavs)}>
          <Icon name="star" size={13} /> Favoriler
        </button>
      </div>
      <ul className={s.unitList}>
        {rows.length === 0 && <li className={s.dim}>{onlyFavs ? "Henüz favori birim yok." : "Birim yok."}</li>}
        {rows.map((n) => {
          const on = linked.includes(n.id);
          return (
            <li key={n.id} style={{ paddingLeft: onlyFavs ? 0 : n.depth * 16 }} className={s.unitRow}>
              {!onlyFavs && hasKids.has(n.id) ? (
                <button type="button" className={s.unitCaret} aria-expanded={open.has(n.id)}
                  aria-label={`${n.name} dalını aç/kapat`} onClick={() => toggle(n.id)}>
                  <Icon name="chevron" size={12} />
                </button>
              ) : (
                <span className={s.unitCaret} aria-hidden="true" />
              )}
              <button type="button" className={cx(s.unitName, on && s.unitOn)} disabled={on || props.disabled === true}
                onClick={() => props.onLink(n.id)}>
                {n.name}
                {on && <Icon name="check" size={13} />}
              </button>
              <button type="button" className={cx(s.star, favs.has(n.id) && s.starOn)} aria-pressed={favs.has(n.id)}
                aria-label={`${n.name} favori`} onClick={() => toggleFav(n.id)}>
                <Icon name="star" size={13} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
