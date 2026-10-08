import { expect, it } from "vitest";
import type { Material, MetaNode } from "../../api/types";
import { bestOffer, columnOf, daysBefore, etaOf, isLate, kindTemplate, placeLabel, priceOf, purchaseHealth, purchaseTotals, unitPrice } from "./eventModel";

const n = (id: string, parent_id: string | null, attrs: MetaNode["attrs"] = {}, is_active = true): MetaNode => ({
  id, parent_id, name: id, node_type: "option", is_active, depth: 0, key: null, root_key: "event_types", shape: "leaf", attrs,
});

it("tur sablonu option'in slotlarindaki aktif dugumlerden okunur", () => {
  const nodes = [
    n("root", null), n("atolye", "root"),
    n("steps", "atolye", { slot: "steps" }),
    n("egitmen", "steps", { offset_days: -21 }), n("eski", "steps", { offset_days: -14 }, false), n("otf-gitti", "steps", { offset_days: -7 }),
    n("widgets", "atolye", { slot: "widgets" }),
    n("otf", "widgets", { widget: "otf" }), n("otf2", "widgets", { widget: "otf" }), n("kayit", "widgets", { widget: "record" }),
    n("baska", "root"), n("steps2", "baska", { slot: "steps" }), n("x", "steps2", { offset_days: -1 }),
  ];
  expect(kindTemplate(nodes, "atolye")).toEqual({ checkpoints: [["egitmen", -21], ["otf-gitti", -7]], widgets: ["otf"] });
  expect(kindTemplate(nodes, null)).toEqual({ checkpoints: [], widgets: [] });
  // eski URL/enum degeri: dugum yok, bos sablon
  expect(kindTemplate(nodes, "training")).toEqual({ checkpoints: [], widgets: [] });
});

it("yer: konum seciliyse adi, yoksa metin", () => {
  const nodes = [n("Amfi", null)];
  expect(placeLabel(nodes, { location_id: "Amfi", place: "eski" })).toBe("Amfi");
  expect(placeLabel(nodes, { location_id: null, place: "Kafe" })).toBe("Kafe");
  expect(placeLabel(nodes, { location_id: null, place: null })).toBeNull();
});

const m = (p: Partial<Material>): Material => ({
  id: "x", name: "x", notes: null, type: "consumable", priority: "medium", state: 0, qty: 1,
  has_sponsor: false, owned: false, chosen_provider_id: null, sponsor_chosen: false, sponsor_qty: null,
  sponsor_date: null, in_sponsor_record: false, delivered: false, purchased: false, purchased_at: null,
  created_by: null, updated_at: "2026-10-01T00:00:00Z", providers: [], ...p,
});
const prov = (id: string, price: number | null, arrival_date: string | null) => ({ id, contact: id, price, arrival_date });

it("baslik noktasi yalniz 'gerekli' adimini gecmis, elde olmayanlara bakar", () => {
  expect(purchaseHealth([])).toBe("none");
  // gerekli adimini gecmemis kritik malzeme sayilmaz
  expect(purchaseHealth([m({ priority: "critical" })])).toBe("none");
  expect(purchaseHealth([m({ state: 3 })])).toBe("ok");
  // sponsor istegi adim eklemez: 3 yeter
  expect(purchaseHealth([m({ state: 3, has_sponsor: true })])).toBe("ok");
  expect(purchaseHealth([m({ state: 2, has_sponsor: true })])).toBe("warn");
  expect(purchaseHealth([m({ state: 1, priority: "critical" }), m({ state: 3 })])).toBe("err");
  // elde olan surece girmez
  expect(purchaseHealth([m({ state: 1, priority: "critical", owned: true })])).toBe("none");
});

it("en iyi teklif tedarikcilerden turetilir", () => {
  expect(bestOffer(m({}))).toEqual({ price: null, date: null });
  expect(bestOffer(m({ providers: [
    { id: "a", contact: "a", price: 1450, arrival_date: "2026-10-07" },
    { id: "b", contact: "b", price: 1300, arrival_date: null },
    { id: "c", contact: "c", price: null, arrival_date: "2026-10-05" },
  ] }))).toEqual({ price: 1300, date: "2026-10-05" });
});

it("kart fiyati: sponsor secildiyse 0, secili teklif, yoksa en dusuk", () => {
  const providers = [prov("a", 7200, "2026-10-17"), prov("b", 6900, "2026-10-28")];
  expect(priceOf(m({ providers }))).toBe(6900);
  expect(priceOf(m({ providers, chosen_provider_id: "a" }))).toBe(7200);
  expect(priceOf(m({ providers, has_sponsor: true, sponsor_chosen: true }))).toBe(0);
  expect(priceOf(m({}))).toBeNull();
  expect(unitPrice(7200, 12)).toBe(600);
  expect(unitPrice(null, 12)).toBeNull();
});

it("gecikme: secili teklifin ya da sponsorun varisi etkinlikten sonraysa", () => {
  const providers = [prov("a", 7200, "2026-10-17"), prov("b", 6900, "2026-10-28")];
  const day = "2026-10-24";
  expect(etaOf(m({ providers }))).toBe("2026-10-17"); // secim yok: en yakin tarih
  expect(isLate(m({ providers }), day)).toBe(false);
  expect(isLate(m({ providers, chosen_provider_id: "b" }), day)).toBe(true);
  expect(isLate(m({ providers, chosen_provider_id: "b", delivered: true }), day)).toBe(false);
  expect(isLate(m({ has_sponsor: true, sponsor_chosen: true, sponsor_date: "2026-10-30" }), day)).toBe(true);
  expect(isLate(m({ providers, chosen_provider_id: "b" }), null)).toBe(false); // etkinlik tarihsiz (havuz)
  expect(daysBefore(day, "2026-10-17")).toBe(7);
  expect(daysBefore(day, "2026-10-28")).toBe(-4);
});

it("pano sutunu ve toplamlar: zaten var Onaylandi'da, toplama girmez", () => {
  expect([0, 1, 2, 3].map((state) => columnOf({ state, owned: false }))).toEqual([0, 0, 1, 2]);
  expect(columnOf({ state: 0, owned: true })).toBe(2);
  const items = [
    m({ state: 3, providers: [prov("a", 340, null)] }),
    m({ state: 2, providers: [prov("b", 2480, null)] }),
    m({ owned: true, state: 3, providers: [prov("c", 999, null)] }),
  ];
  expect(purchaseTotals(items)).toEqual({ total: 2820, approved: 340 });
});
