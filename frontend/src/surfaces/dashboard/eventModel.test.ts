import { expect, it } from "vitest";
import { bestOffer, materialSteps, purchaseHealth, type Material } from "./eventModel";

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
