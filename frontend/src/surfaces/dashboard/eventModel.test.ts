import { expect, it } from "vitest";
import type { Material, MetaNode } from "../../api/types";
import { bestOffer, kindTemplate, materialSteps, placeLabel, purchaseHealth } from "./eventModel";

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
  id: "x", name: "x", notes: null, type: "consumable", priority: "medium", state: 0,
  has_sponsor: false, owned: false, updated_at: "2026-10-01T00:00:00Z", providers: [], ...p,
});

it("sponsorlu malzemeye bir adim eklenir", () => {
  expect(materialSteps(m({}))).toHaveLength(3);
  expect(materialSteps(m({ has_sponsor: true }))).toHaveLength(4);
});

it("baslik noktasi yalniz 'gerekli' adimini gecmis, elde olmayanlara bakar", () => {
  expect(purchaseHealth([])).toBe("none");
  // gerekli adimini gecmemis kritik malzeme sayilmaz
  expect(purchaseHealth([m({ priority: "critical" })])).toBe("none");
  expect(purchaseHealth([m({ state: 3 })])).toBe("ok");
  // sponsorlu: 3 adim yetmez, 4 gerekir
  expect(purchaseHealth([m({ state: 3, has_sponsor: true })])).toBe("warn");
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
