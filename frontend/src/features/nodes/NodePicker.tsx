// Referans veri secicileri (spec/74 §6): kokune gore dugum secen TEK bilesen
// ailesi. Kok `tree` ise NodeTreePicker (katlanir + favori + arama), `list`
// ise NodeListPicker (arama + favori, istege bagli "Diger… (yaz)" metin yedegi).
// Favoriler sunucuda, kisi basina (`meta.me.favorite_nodes`, useNodeFavorite).
//
// GECICI: arayuz sabit, ic uygulama sade Picker — paylasilan katlanir/favorili
// secici bu dosyada yazilacak (props degismeden).

import type { ReactNode } from "react";
import type { MetaNode, RootKey, Uuid } from "../../api/types";
import { useLookup } from "../../lib/lookup";
import { Picker } from "../../ui/ui";

type Look = "field" | "chip" | "prop" | "bare";

/** Kokun altindaki aktif dugumler (kok haric), ekran (Euler) sirasinda. */
export function useNodesOf(rootKey: RootKey): MetaNode[] {
  const L = useLookup();
  return L.meta.nodes.filter((n) => n.root_key === rootKey && n.key === null && n.is_active);
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
  /** Listeden cikarilacak dugumler (or. zaten bagli olanlar). */
  exclude?: (n: MetaNode) => boolean;
}) {
  const nodes = useNodesOf(props.rootKey).filter((n) => props.exclude?.(n) !== true);
  const base = Math.min(...nodes.map((n) => n.depth), 99);
  return (
    <Picker look={props.look ?? "field"} label={props.label} value={props.value ?? ""} search
      disabled={props.disabled === true} placeholder={props.placeholder ?? "Ara…"}
      options={nodes.map((n) => ({ value: n.id, label: `${"  ".repeat(n.depth - base)}${n.name}` }))}
      onChange={(v) => { if (v !== "") props.onChange(v); }}>
      {props.children}
    </Picker>
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
  const nodes = useNodesOf(props.rootKey);
  return (
    <Picker look={props.look ?? "field"} label={props.label} value={props.value ?? ""} search
      disabled={props.disabled === true} placeholder={props.placeholder ?? "Ara…"}
      options={nodes.map((n) => ({ value: n.id, label: n.name }))}
      onChange={(v) => { if (v !== "") props.onChange(v); }}>
      {props.children}
    </Picker>
  );
}
