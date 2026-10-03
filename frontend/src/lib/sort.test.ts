import { expect, test } from "vitest";
import { nextSort, sortRows, type Accessors } from "./sort";

interface Row {
  name: string | null;
  n: number | null;
}
const rows: Row[] = [
  { name: "Zeynep", n: 3 },
  { name: null, n: null },
  { name: "Çağla", n: 10 },
  { name: "Ayşe", n: 2 },
  { name: "Ilgaz", n: 1 },
  { name: "İpek", n: null },
];
const acc: Accessors<Row> = { name: (r) => r.name, n: (r) => r.n };
const names = (r: Row[]) => r.map((x) => x.name);

test("Turkce harmanlama: C, Ç'den once; I, İ'den once; bos sonda", () => {
  expect(names(sortRows(rows, { key: "name", dir: "asc" }, acc))).toEqual(["Ayşe", "Çağla", "Ilgaz", "İpek", "Zeynep", null]);
});

test("azalanda da bos deger sonda", () => {
  expect(names(sortRows(rows, { key: "name", dir: "desc" }, acc))).toEqual(["Zeynep", "İpek", "Ilgaz", "Çağla", "Ayşe", null]);
  expect(sortRows(rows, { key: "n", dir: "desc" }, acc).map((r) => r.n)).toEqual([10, 3, 2, 1, null, null]);
});

test("sayi dogal sirayla (10 > 2), kapali durum satirlari degistirmez", () => {
  expect(sortRows(rows, { key: "n", dir: "asc" }, acc).map((r) => r.n)).toEqual([1, 2, 3, 10, null, null]);
  expect(sortRows(rows, null, acc)).toBe(rows);
  expect(sortRows(rows, { key: "yok", dir: "asc" }, acc)).toBe(rows);
});

test("baslik dongusu: artan → azalan → kapali; baska sutun artan baslar", () => {
  const a = nextSort(null, "name");
  expect(a).toEqual({ key: "name", dir: "asc" });
  const d = nextSort(a, "name");
  expect(d).toEqual({ key: "name", dir: "desc" });
  expect(nextSort(d, "name")).toBeNull();
  expect(nextSort(d, "n")).toEqual({ key: "n", dir: "asc" });
});
