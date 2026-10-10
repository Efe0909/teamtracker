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

/** Surec adimlari (sabit, 3). Sponsor adim DEGIL: ayri istek (`has_sponsor`). */
export const MATERIAL_STEPS = ["Gerekli mi?", "Tedarikçi bulundu", "Onaylandı"] as const;
export const MAX_STATE = MATERIAL_STEPS.length;

/** `state` 0..3'un ekran karsiligi (kart etiketi, liste). */
export const MATERIAL_STAGE = ["Planlanan", "Tedarikçi aranıyor", "Tedarikçi bulundu", "Onaylandı"] as const;

/** Pano sutunlari. Ortadaki, tedarikci bulunsa da onay gelene kadar "aranıyor"dur (1 ve 2);
 *  kartin etiketi aranıyor/bulundu ayrimini gosterir. */
export const BOARD_COLUMNS = [
  { name: "Planlanan" },
  { name: "Tedarikçi aranıyor" },
  { name: "Onaylandı" },
] as const;

/** Kalemin pano sutunu; "zaten var" kalem Onaylandi'da durur (ikonuyla ayrilir). */
export function columnOf(m: Pick<Material, "state" | "owned">): number {
  return m.owned ? 2 : m.state === 0 ? 0 : m.state === 3 ? 2 : 1;
}

/** Kart `col` sutununa birakilinca yazilan `state`. Ortadaki sutun: teklifi olan kalem
 *  "tedarikci bulundu" (2), yoksa "aranıyor" (1); zaten orada olan kalem degismez. */
export function dropState(col: number, m: Pick<Material, "state" | "providers">): number {
  if (col === 0) return 0;
  if (col === 2) return 3;
  return m.state === 1 || m.state === 2 ? m.state : m.providers.length > 0 ? 2 : 1;
}

export function bestOffer(m: Pick<Material, "providers">): { price: number | null; date: string | null } {
  const prices = m.providers.flatMap((p) => (p.price === null ? [] : [p.price]));
  const dates = m.providers.flatMap((p) => (p.arrival_date === null ? [] : [p.arrival_date])).sort();
  return { price: prices.length === 0 ? null : Math.min(...prices), date: dates[0] ?? null };
}

/** Karttaki fiyat: sponsor secildiyse 0, secili teklif, yoksa en dusuk teklif. null = fiyat yok. */
export function priceOf(m: Pick<Material, "providers" | "chosen_provider_id" | "sponsor_chosen">): number | null {
  if (m.sponsor_chosen) return 0;
  const picked = m.providers.find((p) => p.id === m.chosen_provider_id);
  return picked !== undefined ? picked.price : bestOffer(m).price;
}

/** Beklenen varis: sponsor secildiyse sponsor tarihi, secili teklif, yoksa en yakin teklif tarihi. */
export function etaOf(m: Pick<Material, "providers" | "chosen_provider_id" | "sponsor_chosen" | "sponsor_date">): string | null {
  if (m.sponsor_chosen) return m.sponsor_date;
  const picked = m.providers.find((p) => p.id === m.chosen_provider_id);
  return picked !== undefined ? picked.arrival_date : bestOffer(m).date;
}

/** Etkinlik gunu belliyse ve beklenen varis ondan sonraysa. Teslim edilen ya da elde olan sayilmaz. */
export function isLate(m: Pick<Material, "providers" | "chosen_provider_id" | "sponsor_chosen" | "sponsor_date" | "owned" | "delivered">, eventDate: string | null): boolean {
  const eta = etaOf(m);
  return eventDate !== null && eta !== null && !m.owned && !m.delivered && eta > eventDate;
}

/** Toplam tutar adedi hesaba katmaz: teklif zaten TOPLAM tutardir, birim fiyat turetilir. */
export function unitPrice(price: number | null, qty: number): number | null {
  return price === null ? null : Math.round((price / qty) * 100) / 100;
}

// --- butce asimi ----------------------------------------------------------------------
// Kademe sunucuda turetilir (`overage_level`: ln(fiyat/butce) ve tarihli taban). Burada
// yalniz ekran karsiligi ve yuzde. Kademe 0 = butce icinde, 1 = hafif asim, 2 = belirgin asim.

export const OVERAGE_MARK = ["$", "$$", "$$$"] as const;

/** Butce asiminin yuzdesi (negatif: altinda). Fiyat ya da butce yoksa null. */
export function overPct(price: number | null, budget: number | null): number | null {
  if (price === null || budget === null || budget <= 0) return null;
  return Math.round((price / budget - 1) * 100);
}

/** Teklif metni telefon mu (rakam, bosluk, +, parantez, tire); degilse baglanti. */
export function isPhone(contact: string): boolean {
  return /^[+\d][\d\s()-]{6,}$/.test(contact.trim());
}

/** Etkinlik gunune kac gun kala (negatif = gec). */
export function daysBefore(eventDate: string, arrival: string): number {
  return Math.round((Date.parse(eventDate) - Date.parse(arrival)) / 86_400_000);
}

export function purchaseTotals(items: Material[]): { total: number; approved: number } {
  const live = items.filter((m) => !m.owned);
  const sum = (xs: Material[]) => xs.reduce((a, m) => a + (priceOf(m) ?? 0), 0);
  return { total: sum(live), approved: sum(live.filter((m) => m.state === MAX_STATE)) };
}

export type PurchaseHealth = "none" | "ok" | "warn" | "err";

/** Baslik noktasi: "gerekli" adimini gecmis (ve elde olmayan) malzemelere bakar.
 *  Hepsi onayli → yesil; kritik bekleyen → kirmizi; baska bekleyen → turuncu. */
export function purchaseHealth(items: Material[]): PurchaseHealth {
  const live = items.filter((m) => !m.owned && m.state >= 1);
  if (live.length === 0) return "none";
  const left = live.filter((m) => m.state < MAX_STATE);
  if (left.length === 0) return "ok";
  return left.some((m) => m.priority === "critical") ? "err" : "warn";
}

export const money = new Intl.NumberFormat("tr", { style: "currency", currency: "TRY", minimumFractionDigits: 0, maximumFractionDigits: 2 });
