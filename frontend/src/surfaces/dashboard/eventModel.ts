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
};
export const WIDGET_TYPES = Object.keys(WIDGET) as WidgetType[];

/** Tur sablonunun ONIZLEMESI (yeni etkinlik formu). Kaynak Rust `events.rs`
 *  `template`: etkinlik olusturulurken orada kopyalanir. Ikisi birlikte degisir. */
export const EVENT_TEMPLATE: Record<EventKind, { widgets: Exclude<WidgetType, "record">[]; checkpoints: [string, number][] }> = {
  meeting: {
    widgets: [],
    checkpoints: [["Gündem toplandı", -7], ["Davet gönderildi", -5], ["Toplantı", 0], ["Notlar paylaşıldı", 2]],
  },
  training: {
    widgets: ["supplies"],
    checkpoints: [["Eğitmen kesinleşti", -21], ["Mekan ayarlandı", -14], ["Malzeme hazır", -3], ["Eğitim", 0], ["Geri bildirim", 3]],
  },
  social: {
    widgets: [],
    checkpoints: [["Bütçe onayı", -21], ["Mekan ayarlandı", -14], ["Duyuru", -7], ["Etkinlik", 0]],
  },
  visit: {
    widgets: [],
    checkpoints: [["Ziyaret onayı", -21], ["Ulaşım ayarlandı", -7], ["Ziyaret", 0], ["Rapor", 5]],
  },
  conference: {
    widgets: ["supplies"],
    checkpoints: [["Başvuru", -45], ["Stand kesinleşti", -30], ["Tanıtım", -10], ["Malzeme hazır", -3], ["Etkinlik", 0], ["Değerlendirme", 7]],
  },
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
