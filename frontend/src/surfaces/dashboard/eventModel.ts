// Etkinlik modeli: etiketler, tur sablonu onizlemesi, satin alim turetmeleri.
// Veri /api/events'ten (Rust api/events.rs); sema ve kurallar spec/73-etkinlik.md.
// Widget'lar kart blob'u degil: her turun verisi kendi iliskisel tablosunda.

import type { EventSummary, Material, MaterialType, MetaNode, Uuid, WidgetType } from "../../api/types";
import { EVENT_STATUS } from "../../lib/labels";
import type { IconName } from "../../ui/icons";

export { EVENT_STATUS };

export const WIDGET: Record<WidgetType, { label: string; icon: IconName }> = {
  supplies: { label: "Satın alımlar", icon: "box" },
  record: { label: "Kayıt", icon: "tasks" },
  otf: { label: "Etkinlik talep formu (OTF)", icon: "edit" },
};
export const WIDGET_TYPES = Object.keys(WIDGET) as WidgetType[];

// --- tur ve yer referans veriden (spec/74 §5, §5b) -----------------------------------
// Tur = `event_types` altindaki `option` dugumu; yer = `event_locations` altindaki
// `location` dugumu. Pasif dugum de ad verir: eski etkinlik gostermeye devam eder.

/** Dugumun adi; meta'da yoksa (silinmis/yuklenmemis) "—". */
export function nodeName(nodes: MetaNode[], id: Uuid | null): string {
  return nodes.find((n) => n.id === id)?.name ?? "—";
}

/** Ekranda ve OTF'de yer: konum seciliyse adi, yoksa metin, o da yoksa null. */
export function placeLabel(nodes: MetaNode[], e: Pick<EventSummary, "location_id" | "place">): string | null {
  return e.location_id !== null ? nodeName(nodes, e.location_id) : e.place;
}

/** Tur sablonunun ONIZLEMESI (yeni etkinlik formu): option'in `steps` slotundaki
 *  aktif checkpoint'ler ve `widgets` slotundaki aktif widget'lar. Kaynak Rust
 *  `refdata::template` — etkinlik olusturulurken orada kopyalanir; ikisi ayni kurali tasir. */
export function kindTemplate(nodes: MetaNode[], kindId: Uuid | null): { checkpoints: [string, number][]; widgets: WidgetType[] } {
  const kids = (parent: Uuid) => nodes.filter((n) => n.parent_id === parent);
  const slot = (name: "steps" | "widgets") =>
    kindId === null ? [] : kids(kindId).filter((s) => s.attrs.slot === name).flatMap((s) => kids(s.id).filter((c) => c.is_active));
  const checkpoints = slot("steps").flatMap((c): [string, number][] =>
    c.attrs.offset_days === undefined ? [] : [[c.name, c.attrs.offset_days]]);
  const widgets = slot("widgets").flatMap((c) => (c.attrs.widget === undefined || c.attrs.widget === "record" ? [] : [c.attrs.widget]));
  return { checkpoints, widgets: [...new Set(widgets)] };
}

// --- satin alimlar (spec/73 §5) -----------------------------------------------------
// En iyi fiyat / en yakin tarih SAKLANMAZ, tedarikcilerden turetilir.
// `state` = tamamlanan adim sayisi, elle ileri/geri.

export const MATERIAL_TYPE: Record<MaterialType, string> = {
  consumable: "Sarf",
  equipment: "Alet / ekipman",
  service: "Hizmet",
};

/** Malzemenin surec adimlari; sponsorlu malzemeye bir adim eklenir. */
export function materialSteps(m: Pick<Material, "has_sponsor">): string[] {
  return m.has_sponsor ? ["Gerekli mi?", "Tedarikçi bulundu", "Sponsor", "Onaylandı"] : ["Gerekli mi?", "Tedarikçi bulundu", "Onaylandı"];
}

export function bestOffer(m: Pick<Material, "providers">): { price: number | null; date: string | null } {
  const prices = m.providers.flatMap((p) => (p.price === null ? [] : [p.price]));
  const dates = m.providers.flatMap((p) => (p.arrival_date === null ? [] : [p.arrival_date])).sort();
  return { price: prices.length === 0 ? null : Math.min(...prices), date: dates[0] ?? null };
}

export type PurchaseHealth = "none" | "ok" | "warn" | "err";

/** Baslik noktasi: "gerekli" adimini gecmis (ve elde olmayan) malzemelere bakar.
 *  Hepsi onayli → yesil; kritik bekleyen → kirmizi; baska bekleyen → turuncu. */
export function purchaseHealth(items: Material[]): PurchaseHealth {
  const live = items.filter((m) => !m.owned && m.state >= 1);
  if (live.length === 0) return "none";
  const left = live.filter((m) => m.state < materialSteps(m).length);
  if (left.length === 0) return "ok";
  return left.some((m) => m.priority === "critical") ? "err" : "warn";
}
