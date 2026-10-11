import { beforeEach, expect, it } from "vitest";
import { EMPTY, load, norm, PAGE, REJECTED_MAX, resolve, save, visible, withBatch, type SuggestState } from "./suggestions";

const g = (name: string) => ({ name, description: `${name} neden` });

beforeEach(() => sessionStorage.clear());

it("norm: harf büyüklüğü, noktalama ve Türkçe i/İ farkı yok sayılır", () => {
  expect(norm("Lehim Teli.")).toBe(norm("lehim teli"));
  expect(norm("PROJEKSİYON")).toBe(norm("projeksiyon"));
});

it("parti: tekrar eden ve reddedilen adlar eklenmez", () => {
  const s: SuggestState = { pending: [g("Kablo")], rejected: ["Makas"] };
  const next = withBatch(s, [g("kablo"), g("Makas"), g("Bant"), g("Bant."), g("   ")]);
  expect(next.pending.map((p) => p.name)).toEqual(["Kablo", "Bant"]);
});

it("üçlü: ilk PAGE tanesi görünür, kalem listesinde artık olan atlanır", () => {
  const s: SuggestState = { pending: ["A", "B", "C", "D", "E"].map(g), rejected: [] };
  expect(visible(s, []).map((p) => p.name)).toEqual(["A", "B", "C"]);
  expect(visible(s, ["b"]).map((p) => p.name)).toEqual(["A", "C", "D"]);
  expect(visible(s, [])).toHaveLength(PAGE);
});

it("üçü de bitince sıradaki üçlü gelir; ret reddedilenlere eklenir, kabul eklemez", () => {
  let s: SuggestState = { pending: ["A", "B", "C", "D"].map(g), rejected: [] };
  s = resolve(s, "A", true);
  s = resolve(s, "B", false);
  expect(s.rejected).toEqual(["A"]);
  expect(visible(s, []).map((p) => p.name)).toEqual(["C", "D"]);
});

it("reddedilenler en yeni REJECTED_MAX kadar tutulur", () => {
  let s = EMPTY;
  for (let i = 0; i < REJECTED_MAX + 5; i++) s = resolve({ ...s, pending: [g(`x${i}`)] }, `x${i}`, true);
  expect(s.rejected).toHaveLength(REJECTED_MAX);
  expect(s.rejected.at(-1)).toBe(`x${REJECTED_MAX + 4}`);
});

it("oturum depolama: yazılır, okunur; bozuk kayıt boş duruma düşer, etkinlikler karışmaz", () => {
  save("e1", { pending: [g("A")], rejected: ["Z"] });
  expect(load("e1")).toEqual({ pending: [g("A")], rejected: ["Z"] });
  expect(load("e2")).toEqual(EMPTY);
  sessionStorage.setItem("ekiptakip.suggest.e3", "{bozuk");
  expect(load("e3")).toEqual(EMPTY);
  sessionStorage.setItem("ekiptakip.suggest.e4", JSON.stringify({ pending: [{ name: 1 }], rejected: [] }));
  expect(load("e4")).toEqual(EMPTY);
});
