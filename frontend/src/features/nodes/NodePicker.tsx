// Referans veri secicileri (spec/74 §6): kokune gore dugum secen TEK bilesen
// ailesi. Kok `tree` ise NodeTreePicker (katlanir + favori + arama), `list`
// ise NodeListPicker (arama + favori, istege bagli "Diger… (yaz)" metin yedegi).
// Favoriler sunucuda, kisi basina (`meta.me.favorite_nodes`, useNodeFavorite).
// Gorunum ui.tsx'teki Picker'in aynisi (Radix popover + cmdk); suzme burada
// yapilir (cmdk `shouldFilter={false}`), cunku arama eslesen dallari da acar.

import * as RP from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { errorText } from "../../api/client";
import { useNodeFavorite } from "../../api/hooks";
import type { MetaNode, RootKey, Uuid } from "../../api/types";
import { useLookup } from "../../lib/lookup";
import { useStored } from "../../lib/stored";
import { Icon } from "../../ui/icons";
import { Button, cx, ui, useToast } from "../../ui/ui";
import s from "./NodePicker.module.css";

type Look = "field" | "chip" | "prop" | "bare";

/** Kokun altindaki aktif dugumler (kok haric), ekran (Euler) sirasinda.
 *  Pasif bir dugumun altindakiler de gizli (ebeveyn once gelir). */
export function useNodesOf(rootKey: RootKey): MetaNode[] {
  const L = useLookup();
  return useMemo(() => {
    const kept = new Set<Uuid>();
    const out: MetaNode[] = [];
    for (const n of L.meta.nodes) {
      if (n.root_key !== rootKey || n.key !== null || !n.is_active) continue;
      const parent = L.node(n.parent_id);
      if (parent !== undefined && parent.key === null && !kept.has(parent.id)) continue;
      kept.add(n.id);
      out.push(n);
    }
    return out;
  }, [L, rootKey]);
}

const fold = (t: string) => t.toLocaleLowerCase("tr");

/** Sunucudaki favoriler + yildiz. */
function useFavorites(): [Set<Uuid>, (id: Uuid) => void] {
  const L = useLookup();
  const m = useNodeFavorite();
  const toast = useToast();
  const ids = useMemo(() => new Set(L.meta.me.favorite_nodes), [L]);
  const toggle = (id: Uuid) =>
    m.mutate({ id, on: !ids.has(id) }, { onError: (e) => toast({ text: errorText(e), error: true }) });
  return [ids, toggle];
}

interface ShellProps {
  label: string;
  look: Look;
  placeholder: string | undefined;
  disabled: boolean;
  /** Tetikte gorunen ad (secili dugum ya da yazilan metin). */
  current: string | undefined;
  children: ReactNode;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  search: string;
  onSearch: (v: string) => void;
  active: string;
  onActive: (v: string) => void;
  onKeyDown?: (e: KeyboardEvent) => void;
  /** Listenin yerine gecen icerik (metin yedegi). */
  alt?: ReactNode;
  list: ReactNode;
}

/** Tetik + acilir yuzey: Picker'in gorunumu, liste icerigi disaridan. */
function Shell(p: ShellProps) {
  return (
    <RP.Root open={p.open} onOpenChange={p.onOpenChange}>
      <RP.Trigger asChild>
        <button
          type="button"
          className={cx(ui.trigger, ui[`look-${p.look}`], p.current !== undefined && ui.triggerOn)}
          aria-label={`${p.label}: ${p.current ?? p.placeholder ?? "seçilmedi"}`}
          disabled={p.disabled}
        >
          <span className={ui.triggerVal}>
            {p.children ?? p.current ?? <span className={ui.none}>{p.placeholder ?? "Seç"}</span>}
          </span>
          {p.look !== "bare" && <Icon name="updown" size={14} />}
        </button>
      </RP.Trigger>
      <RP.Portal>
        <RP.Content className={ui.pop} align="start" sideOffset={6} collisionPadding={12}>
          {p.alt ?? (
            <Command label={p.label} loop shouldFilter={false} value={p.active} onValueChange={p.onActive}
              {...(p.onKeyDown === undefined ? {} : { onKeyDown: p.onKeyDown })}>
              <Command.Input className={ui.popSearch} placeholder={`${p.label} ara…`} autoFocus
                value={p.search} onValueChange={p.onSearch} />
              <Command.List className={ui.popList}>
                <Command.Empty className={ui.popEmpty}>Sonuç yok</Command.Empty>
                {p.list}
              </Command.List>
            </Command>
          )}
        </RP.Content>
      </RP.Portal>
    </RP.Root>
  );
}

/** Tek satir: [ok] ad · ipucu · onay · yildiz. Ok ve yildiz satiri secmez. */
function Row(p: {
  value: string;
  node: MetaNode;
  on: boolean;
  fav: boolean;
  onFav: () => void;
  onPick: () => void;
  disabled?: boolean;
  indent?: number;
  caret?: ReactNode;
  hint?: string;
}) {
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return (
    <Command.Item value={p.value} disabled={p.disabled === true} className={ui.popItem} data-on={p.on}
      onSelect={p.onPick} style={p.indent === undefined ? undefined : { paddingLeft: 8 + p.indent * 14 }}>
      {p.caret}
      <span className={ui.popLabel}>{p.node.name}</span>
      {p.hint !== undefined && p.hint !== "" && <span className={ui.popHint}>{p.hint}</span>}
      <span className={ui.popCheck}>{p.on && <Icon name="check" size={14} />}</span>
      <button type="button" className={cx(s.star, p.fav && s.starOn)} aria-pressed={p.fav}
        aria-label={`${p.node.name} favori`} onPointerDown={stop}
        onClick={(e) => { stop(e); p.onFav(); }}>
        <Icon name="star" size={13} />
      </button>
    </Command.Item>
  );
}

/** Ustteki "Favoriler" grubu: aramaya uyan, bu kokteki favoriler; ipucu = yol. */
function Favorites(p: {
  nodes: MetaNode[];
  favs: Set<Uuid>;
  onFav: (id: Uuid) => void;
  value: Uuid | null;
  q: string;
  pick: (id: Uuid) => void;
  skip?: (n: MetaNode) => boolean;
}) {
  const L = useLookup();
  const rows = p.nodes.filter((n) => p.favs.has(n.id) && p.skip?.(n) !== true && fold(n.name).includes(p.q));
  if (rows.length === 0) return null;
  return (
    <>
      <Command.Group heading="Favoriler" className={s.group}>
        {rows.map((n) => (
          <Row key={n.id} value={`fav:${n.id}`} node={n} on={n.id === p.value} fav onFav={() => p.onFav(n.id)}
            onPick={() => p.pick(n.id)} hint={L.path(n.id).slice(1, -1).join(" › ")} />
        ))}
      </Command.Group>
      <div className={s.sep} role="none" />
    </>
  );
}

export function NodeTreePicker(props: {
  rootKey: RootKey;
  value: Uuid | null;
  onChange: (id: Uuid) => void;
  /** Tetigin ve listenin erisilebilir adi. */
  label: string;
  look?: Look;
  /** Secim yokken tetikte gorunen metin. */
  placeholder?: string;
  disabled?: boolean;
  /** Tetikte gorunen icerik; verilmezse secili dugumun adi. */
  children?: ReactNode;
  /** Secilemeyecek dugumler (or. zaten bagli olanlar): agacta soluk kalir
   *  (altindakilere yol olsun diye), favorilerde gorunmez. */
  exclude?: (n: MetaNode) => boolean;
}) {
  const L = useLookup();
  const nodes = useNodesOf(props.rootKey);
  const [favs, toggleFav] = useFavorites();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState("");
  // Katlama durumu cihazda (spec/74 §6); kok basina ayri.
  const [openIds, setOpenIds] = useStored<Uuid[]>(`nodes.open.${props.rootKey}`, []);

  const { ancestors, hasKids, base } = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const anc = new Map<Uuid, Uuid[]>();
    for (const n of nodes) {
      const parent = n.parent_id === null ? undefined : byId.get(n.parent_id);
      anc.set(n.id, parent === undefined ? [] : [...(anc.get(parent.id) ?? []), parent.id]);
    }
    return {
      ancestors: (id: Uuid) => anc.get(id) ?? [],
      hasKids: new Set(nodes.flatMap((n) => (n.parent_id !== null && byId.has(n.parent_id) ? [n.parent_id] : []))),
      base: nodes.reduce((m, n) => Math.min(m, n.depth), Infinity),
    };
  }, [nodes]);

  const q = fold(search.trim());
  // Arama yokken: atalarinin hepsi acik olanlar. Aramada: eslesenler + atalari (acik).
  const { rows, expanded } = useMemo(() => {
    if (q === "") {
      const exp = new Set(openIds);
      return { rows: nodes.filter((n) => ancestors(n.id).every((a) => exp.has(a))), expanded: exp };
    }
    const hits = nodes.filter((n) => fold(n.name).includes(q));
    const exp = new Set(hits.flatMap((n) => ancestors(n.id)));
    const show = new Set([...exp, ...hits.map((n) => n.id)]);
    return { rows: nodes.filter((n) => show.has(n.id)), expanded: exp };
  }, [q, openIds, nodes, ancestors]);

  const toggle = (id: Uuid, to = !expanded.has(id)) =>
    setOpenIds(to ? [...new Set([...openIds, id])] : openIds.filter((x) => x !== id));

  const pick = (id: Uuid) => {
    setOpen(false);
    if (id !== props.value) props.onChange(id);
  };

  const onOpenChange = (v: boolean) => {
    if (v) {
      // Secili dugumun yolu acik acilir.
      setSearch("");
      setActive(props.value ?? "");
      if (props.value !== null) setOpenIds([...new Set([...openIds, ...ancestors(props.value)])]);
    }
    setOpen(v);
  };

  // Ok tuslari: sag dali acar, sol kapatir (arama yokken; aramada imlec yazida).
  const onKeyDown = (e: KeyboardEvent) => {
    if (q !== "" || !hasKids.has(active)) return;
    if (e.key === "ArrowRight" && !expanded.has(active)) toggle(active, true);
    else if (e.key === "ArrowLeft" && expanded.has(active)) toggle(active, false);
    else return;
    e.preventDefault();
  };

  return (
    <Shell label={props.label} look={props.look ?? "field"} placeholder={props.placeholder}
      disabled={props.disabled === true} current={L.node(props.value)?.name} open={open} onOpenChange={onOpenChange}
      search={search} onSearch={setSearch} active={active} onActive={setActive} onKeyDown={onKeyDown}
      list={
        <>
          <Favorites nodes={nodes} favs={favs} onFav={toggleFav} value={props.value} q={q} pick={pick}
            {...(props.exclude === undefined ? {} : { skip: props.exclude })} />
          {rows.map((n) => (
            <Row key={n.id} value={n.id} node={n} on={n.id === props.value} fav={favs.has(n.id)}
              onFav={() => toggleFav(n.id)} onPick={() => pick(n.id)} disabled={props.exclude?.(n) === true}
              indent={n.depth - base}
              caret={
                hasKids.has(n.id) ? (
                  <button type="button" className={s.caret} aria-expanded={expanded.has(n.id)}
                    aria-label={`${n.name} dalını aç/kapat`} tabIndex={-1}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); toggle(n.id); }}>
                    <Icon name="chevron" size={12} />
                  </button>
                ) : (
                  <span className={s.leaf} aria-hidden="true" />
                )
              } />
          ))}
        </>
      }>
      {props.children}
    </Shell>
  );
}

export function NodeListPicker(props: {
  rootKey: RootKey;
  value: Uuid | null;
  onChange: (id: Uuid) => void;
  label: string;
  look?: Look;
  placeholder?: string;
  disabled?: boolean;
  children?: ReactNode;
  /** Metin yedegi (or. etkinlik yeri): verilirse sonda "Diger… (yaz)" satiri;
   *  yazilan metin `onText` ile gelir (liste secimi temizlenir sunucuda). */
  text?: { value: string | null; onText: (t: string) => void };
}) {
  const L = useLookup();
  // Yalniz kokun dogrudan cocuklari (tur: option, yer: location); slotlar ve
  // altindakiler (adim/widget) secilmez.
  const all = useNodesOf(props.rootKey);
  const nodes = useMemo(() => all.filter((n) => L.node(n.parent_id)?.key != null), [all, L]);
  const [favs, toggleFav] = useFavorites();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState("");
  const [typing, setTyping] = useState<string | null>(null);
  const q = fold(search.trim());
  const text = props.text;

  const pick = (id: Uuid) => {
    setOpen(false);
    if (id !== props.value) props.onChange(id);
  };
  const current = props.value === null ? (text?.value ?? undefined) : L.node(props.value)?.name;

  return (
    <Shell label={props.label} look={props.look ?? "field"} placeholder={props.placeholder}
      disabled={props.disabled === true} current={current} open={open} search={search} onSearch={setSearch}
      active={active} onActive={setActive}
      onOpenChange={(v) => {
        if (v) {
          setSearch("");
          setTyping(null);
          setActive(props.value ?? "");
        }
        setOpen(v);
      }}
      {...(typing === null || text === undefined ? {} : {
        alt: (
          <form className={s.text} onSubmit={(e) => {
            e.preventDefault();
            if (typing.trim() === "") return;
            setOpen(false);
            text.onText(typing.trim());
          }}>
            <input className={ui.input} value={typing} onChange={(e) => setTyping(e.target.value)} autoFocus
              aria-label={props.label} placeholder="Yaz…" maxLength={200} />
            <Button type="submit" size="sm" variant="primary" disabled={typing.trim() === ""}>Tamam</Button>
          </form>
        ),
      })}
      list={
        <>
          <Favorites nodes={nodes} favs={favs} onFav={toggleFav} value={props.value} q={q} pick={pick} />
          {nodes.filter((n) => fold(n.name).includes(q)).map((n) => (
            <Row key={n.id} value={n.id} node={n} on={n.id === props.value} fav={favs.has(n.id)}
              onFav={() => toggleFav(n.id)} onPick={() => pick(n.id)} />
          ))}
          {text !== undefined && (
            <Command.Item value="__text" className={ui.popItem} data-on={props.value === null && text.value !== null}
              onSelect={() => setTyping(text.value ?? search.trim())}>
              <Icon name="edit" size={14} />
              <span className={ui.popLabel}>Diğer… (yaz)</span>
            </Command.Item>
          )}
        </>
      }>
      {props.children}
    </Shell>
  );
}
