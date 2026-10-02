// Etkinlik modeli — ON YUZ TASLAGI, Rust tarafi henuz yok. Hedef sema ve
// kurallar: spec/73-etkinlik.md (bu dosyayla celisirse spec kazanir).
// Widget'lar kart blob'u degil: her turun verisi kendi iliskisel tablosunda.
// Yeni etkinlikte checkpoint ve widget'lar TURUN sablonundan (EVENT_TEMPLATE)
// kopyalanir; sonra elle eklenir/silinir.
//
// ponytail: veri sahte (useMockEvents, mockMaterials) — /api/events gelince bu
// kancalar gercek istege doner, sayfalar degismez.

import { useMemo } from "react";
import { useRecords } from "../../api/hooks";
import type { IsoDate, IsoTime, MetaTeam, MetaUser, Priority, RecordSummary, Uuid } from "../../api/types";
import { toIsoDay } from "../../lib/labels";
import { useLookup } from "../../lib/lookup";
import type { IconName } from "../../ui/icons";

export type EventKind = "meeting" | "training" | "social" | "visit" | "conference";
export type EventStatus = "idea" | "planning" | "confirmed" | "done" | "cancelled";
/** Yalniz alanlari TANIMLI widget turleri — iskelet tur yok. Yeni tur = kendi
 *  tablosu + bilesen birlikte gelir (spec/73 §3). `record` tek kayitlik: bir
 *  etkinlikte birden cok olabilir, digerleri tekil. */
export type WidgetType = "supplies" | "record";

export interface EventWidget {
  id: string;
  type: WidgetType;
  /** Yalniz `record` widget'inda. Null = henuz secilmedi (yeni/var olan sorusu);
   *  bu hal sunucuya yazilmaz, istemcide kalir. */
  record_id: Uuid | null;
}

export interface Checkpoint {
  id: string;
  label: string;
  /** Havuzdaki etkinlikte tarih yok: checkpoint'ler de tarihsiz. */
  date: IsoDate | null;
  done: boolean;
}

export interface EventItem {
  id: string;
  /** Etkinligin kendi kaydi (sohbet + arsiv, spec/73 §3a). Semada not null;
   *  sahte veride kayit sayisi yetmeyince null. */
  record_id: Uuid | null;
  title: string;
  kind: EventKind;
  status: EventStatus;
  priority: Priority;
  owner_id: Uuid | null;
  date: IsoDate | null;
  start: string | null;
  place: string | null;
  description: string | null;
  attendees: number;
  created_by: Uuid | null;
  created_at: IsoTime;
  participants: { user_id: Uuid; role: string }[];
  team_ids: Uuid[];
  record_ids: Uuid[];
  checkpoints: Checkpoint[];
  widgets: EventWidget[];
}

type Tone = "info" | "ok" | "neutral" | "critical";

export const EVENT_KIND: Record<EventKind, string> = {
  meeting: "Toplantı",
  training: "Eğitim",
  social: "Sosyal",
  visit: "Saha ziyareti",
  conference: "Konferans",
};

export const EVENT_STATUS: Record<EventStatus, { label: string; tone: Tone }> = {
  idea: { label: "Fikir", tone: "neutral" },
  planning: { label: "Planlanıyor", tone: "info" },
  confirmed: { label: "Kesin", tone: "ok" },
  done: { label: "Yapıldı", tone: "neutral" },
  cancelled: { label: "İptal", tone: "critical" },
};

export const WIDGET: Record<WidgetType, { label: string; icon: IconName }> = {
  supplies: { label: "Satın alımlar", icon: "box" },
  record: { label: "Kayıt", icon: "tasks" },
};
export const WIDGET_TYPES = Object.keys(WIDGET) as WidgetType[];

/** Tur sablonu: yeni etkinlige otomatik yuklenen widget'lar ve checkpoint'ler
 *  (gun farki etkinlik tarihine gore; 0 = etkinlik gunu). `record` sablonda
 *  yok: kaydi olmayan kayit widget'i sunucuda tutulmaz. */
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

// --- satin alimlar: ilk tanimli widget (spec/73 §5) --------------------------------
// materials + material_providers. En iyi fiyat / en yakin tarih SAKLANMAZ,
// tedarikcilerden turetilir. `state` = tamamlanan adim sayisi, elle ileri/geri.

export type MaterialType = "consumable" | "equipment" | "service";

export const MATERIAL_TYPE: Record<MaterialType, string> = {
  consumable: "Sarf",
  equipment: "Alet / ekipman",
  service: "Hizmet",
};

export interface MaterialProvider {
  id: string;
  /** Baglanti ya da telefon — serbest metin. */
  contact: string;
  price: number | null;
  arrival_date: IsoDate | null;
}

export interface Material {
  id: string;
  name: string;
  notes: string | null;
  type: MaterialType;
  priority: Priority;
  state: number;
  has_sponsor: boolean;
  /** "Zaten var": surece girmez, listede soluk durur. */
  owned: boolean;
  updated_at: IsoTime;
  providers: MaterialProvider[];
}

/** Malzemenin surec adimlari; sponsorlu malzemeye bir adim eklenir. */
export function materialSteps(m: Pick<Material, "has_sponsor">): string[] {
  return m.has_sponsor ? ["Gerekli mi?", "Tedarikçi bulundu", "Sponsor", "Onaylandı"] : ["Gerekli mi?", "Tedarikçi bulundu", "Onaylandı"];
}

export function bestOffer(m: Material): { price: number | null; date: IsoDate | null } {
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

export function mockMaterials(): Material[] {
  const day = (n: number) => toIsoDay(new Date(Date.now() + n * 86_400_000));
  const at = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
  return [
    { id: "m1", name: "MDF plaka 18 mm", notes: "Gövde ve tabla için 4 adet.", type: "consumable", priority: "high", state: 1,
      has_sponsor: false, owned: false, updated_at: at(30), providers: [
        { id: "p1", contact: "https://www.koctas.com.tr/mdf-18mm", price: 1450, arrival_date: day(5) },
        { id: "p2", contact: "Kadıköy Kereste — 0216 555 12 34", price: 1300, arrival_date: day(9) },
      ] },
    { id: "m2", name: "Lazer kesim", notes: "Sponsor firma kesimi karşılayabilir.", type: "service", priority: "low", state: 2,
      has_sponsor: true, owned: false, updated_at: at(52), providers: [
        { id: "p3", contact: "Atölye Lazer — 0532 111 22 33", price: 2000, arrival_date: null },
      ] },
    { id: "m3", name: "Arduino / ESP32", notes: null, type: "equipment", priority: "high", state: 3,
      has_sponsor: false, owned: false, updated_at: at(70), providers: [
        { id: "p4", contact: "https://www.robotistan.com/esp32", price: 289.9, arrival_date: day(3) },
        { id: "p5", contact: "https://www.direnc.net/esp32", price: 315, arrival_date: day(2) },
      ] },
    { id: "m4", name: "DC motor", notes: null, type: "consumable", priority: "medium", state: 0,
      has_sponsor: false, owned: false, updated_at: at(4), providers: [] },
    { id: "m5", name: "Breadboard", notes: null, type: "consumable", priority: "critical", state: 0,
      has_sponsor: false, owned: false, updated_at: at(4), providers: [] },
    { id: "m6", name: "Jumper kablo", notes: null, type: "consumable", priority: "medium", state: 0,
      has_sponsor: false, owned: true, updated_at: at(90), providers: [] },
  ];
}

// --- sahte veri ----------------------------------------------------------------

const NO_RECORDS: RecordSummary[] = [];

export function useMockEvents(): EventItem[] {
  const L = useLookup();
  const records = useRecords({}).data ?? NO_RECORDS;
  return useMemo(() => mockEvents(L.meta.users, L.plainTeams, records), [L.meta.users, L.plainTeams, records]);
}

export function useMockRecords(): RecordSummary[] {
  return useRecords({}).data ?? NO_RECORDS;
}

/** Bu kayit bir etkinligin kendi kaydi mi? (spec/73 §3a, yol a: `events.record_id`
 *  uzerinden ters arama). API gelince RecordDetail.event_id'den okunur. */
export function useEventOfRecord(recordId: Uuid): EventItem | undefined {
  return useMockEvents().find((e) => e.record_id === recordId);
}

const DESC: Record<EventKind, string> = {
  meeting: "Ekiple bir araya gelip durum ve sonraki adımlar konuşulacak.",
  training: "Yeni ve mevcut üyeler için uygulamalı eğitim; malzeme listesi widget'ta.",
  social: "Ekip içi kaynaşma etkinliği. Bütçe ve mekan kesinleşince duyurulacak.",
  visit: "Saha ziyareti: ulaşım ve iletişim kişisi netleşmeli.",
  conference: "Dış etkinlik: stand, tanıtım malzemesi ve ekip nöbeti planlanacak.",
};
const ROLES = ["Sosyal medya", "Lojistik", "Sponsorluk"];

/** Tarihler bugune gore kayar: sekmeler hangi gun acilirsa acilsin dolu. */
function mockEvents(users: MetaUser[], teams: MetaTeam[], records: RecordSummary[]): EventItem[] {
  const shift = (base: IsoDate | null, n: number): IsoDate | null => {
    if (base === null) return null;
    const [y, m, d] = base.split("-").map(Number);
    return toIsoDay(new Date(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + n));
  };
  const today = toIsoDay(new Date());
  const user = (i: number) => users[i % Math.max(users.length, 1)]?.id ?? null;
  // Ikizler: son iki kayit, ilk iki etkinligin. Bagli kayit listelerine girmezler —
  // sahte veride kayit az, gerisi "bagli kayit" ornegi olarak kalsin.
  const twins = records.slice(-2).map((x) => x.id);
  const pool = records.filter((x) => !twins.includes(x.id));
  const recs = (...i: number[]) => (pool.length === 0 ? [] : [...new Set(i.map((n) => pool[n % pool.length]!.id))]);
  const rows: [string, EventKind, EventStatus, Priority, number | null, string | null, string | null, number, Uuid[]][] = [
    ["Sponsor sunumu provası", "meeting", "confirmed", "high", 4, "14:00", "Toplantı odası B", 8, recs(0, 1)],
    ["Yeni üye oryantasyonu", "training", "confirmed", "medium", 12, "10:00", "Atölye", 24, recs(2)],
    ["Lise tanıtım günü", "visit", "planning", "high", 21, "09:30", "Kadıköy Anadolu Lisesi", 6, recs(0, 3)],
    ["Cadılar bayramı akşamı", "social", "planning", "low", 27, "19:00", "Kampüs kafe", 40, []],
    ["Bölge yarışması hazırlık kampı", "training", "planning", "critical", 34, "09:00", "Atölye", 30, recs(0, 1, 4)],
    ["Teknofest değerlendirme", "meeting", "planning", "medium", 41, "16:00", "Çevrim içi", 12, recs(1)],
    ["Fabrika ziyareti", "visit", "planning", "medium", 49, "08:30", "Gebze OSB", 15, recs(5)],
    ["Yıl sonu buluşması", "social", "idea", "low", 62, null, null, 0, []],
    ["Mezunlar paneli", "conference", "planning", "high", 70, "13:00", "Konferans salonu", 120, recs(0, 2)],
    ["Kış dönemi planlama", "meeting", "planning", "high", 77, "11:00", "Toplantı odası A", 10, recs(0, 1, 3)],
    ["Robot fuarı standı", "conference", "done", "high", -20, "10:00", "İstanbul Fuar Merkezi", 18, recs(0, 4)],
    ["Dönem açılış toplantısı", "meeting", "done", "medium", -7, "15:00", "Toplantı odası A", 35, recs(1)],
    ["Piknik", "social", "cancelled", "low", -3, "11:00", "Belgrad Ormanı", 0, []],
    ["DC araba atölyesi", "training", "idea", "high", null, null, "Atölye", 0, recs(4)],
    ["Ortaokullara robotik semineri", "visit", "idea", "medium", null, null, null, 0, []],
    ["Hackathon", "conference", "idea", "medium", null, null, null, 0, recs(2, 5)],
    // ayni gunde iki etkinlik: takvimde iki nokta, gune basinca onemlisi (sunum provasi) acilir
    ["Sponsor teşekkür yemeği", "social", "planning", "low", 4, "19:30", "Kampüs kafe", 12, []],
  ];
  return rows.map(([title, kind, status, priority, offset, start, place, attendees, record_ids], i) => {
    // Etkinligin kendi kaydi (unique). Semada not null; sahte veride ikiz yalniz ilk ikisinde.
    const record_id = twins[i] ?? null;
    const date = offset === null ? null : shift(today, offset);
    const owner = user(i);
    const tpl = EVENT_TEMPLATE[kind];
    const helpers = [user(i + 1), user(i + 2)].filter((u): u is Uuid => u !== null && u !== owner);
    return {
      id: `e${i + 1}`, record_id, title, kind, status, priority, owner_id: owner, date, start, place, attendees, record_ids,
      description: i % 4 === 3 ? null : DESC[kind],
      created_by: owner,
      created_at: new Date(Date.now() - (offset === null ? 23 : Math.max(offset, 0) + 23) * 86_400_000).toISOString(),
      participants: [
        ...(owner === null ? [] : [{ user_id: owner, role: "Sorumlu" }]),
        ...[...new Set(helpers)].map((u, j) => ({ user_id: u, role: ROLES[(i + j) % ROLES.length]! })),
      ],
      team_ids: teams.length === 0 ? [] : [...new Set([teams[i % teams.length]!.id, teams[(i + 1) % teams.length]!.id])],
      checkpoints: tpl.checkpoints.map(([label, n], j) => {
        const d = shift(date, n);
        return { id: `e${i + 1}-c${j}`, label, date: d, done: d !== null && d < today };
      }),
      widgets: [
        ...tpl.widgets.map((type, j): EventWidget => ({ id: `e${i + 1}-w${j}`, type, record_id: null })),
        // Bagli her kayit kendi widget'i (spec/73 §3: event_records yok, kayit widget'i tek kaynak).
        ...record_ids.map((rid, j): EventWidget => ({ id: `e${i + 1}-r${j}`, type: "record", record_id: rid })),
      ],
    };
  });
}
