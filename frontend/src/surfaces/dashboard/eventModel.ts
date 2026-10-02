// Etkinlik modeli: etiketler, tur sablonu onizlemesi, satin alim turetmeleri.
// Veri /api/events'ten (Rust api/events.rs); sema ve kurallar spec/73-etkinlik.md.
// Widget'lar kart blob'u degil: her turun verisi kendi iliskisel tablosunda.

import type { EventKind, Material, MaterialType, WidgetType } from "../../api/types";
import { EVENT_KIND, EVENT_STATUS } from "../../lib/labels";
import type { IconName } from "../../ui/icons";

export { EVENT_KIND, EVENT_STATUS };

export const WIDGET: Record<WidgetType, { label: string; icon: IconName }> = {
  supplies: { label: "Satın alımlar", icon: "box" },
  record: { label: "Kayıt", icon: "tasks" },
  otf: { label: "Etkinlik talep formu (OTF)", icon: "edit" },
};
export const WIDGET_TYPES = Object.keys(WIDGET) as WidgetType[];

/** Tur sablonunun ONIZLEMESI (yeni etkinlik formu). Kaynak Rust `events.rs`
 *  `template`: etkinlik olusturulurken orada kopyalanir. Ikisi birlikte degisir. */
export const EVENT_TEMPLATE: Record<EventKind, { widgets: Exclude<WidgetType, "record">[]; checkpoints: [string, number][] }> = {
  // Butun hazirlik etkinlikten en gec 7 gun once biter (Rust DEADLINE_DAYS).
  meeting: { widgets: ["otf"], checkpoints: [["Gündem toplandı", -10], ["OTF gönderildi", -7], ["Davet gönderildi", -7]] },
  training: {
    widgets: ["otf", "supplies"],
    checkpoints: [["Eğitmen kesinleşti", -21], ["Mekan ayarlandı", -14], ["OTF gönderildi", -7], ["Malzeme hazır", -7]],
  },
  social: { widgets: ["otf"], checkpoints: [["Bütçe onayı", -21], ["Mekan ayarlandı", -14], ["OTF gönderildi", -7], ["Duyuru", -7]] },
  visit: { widgets: [], checkpoints: [["Ziyaret onayı", -21], ["Ulaşım ayarlandı", -7]] },
  conference: { widgets: ["supplies"], checkpoints: [["Başvuru", -45], ["Stand kesinleşti", -30], ["Tanıtım", -10], ["Malzeme hazır", -7]] },
};

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
