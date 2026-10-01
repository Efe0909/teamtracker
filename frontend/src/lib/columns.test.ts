import { expect, it } from "vitest";
import { clampWidth, resolveWidths } from "./columns";

it("kenetler ve bozuk degeri varsayilana dondurur", () => {
  expect(clampWidth(10)).toBe(70);
  expect(clampWidth(5000)).toBe(640);
  const d = { a: 100, b: 200 };
  expect(resolveWidths(d, { a: 300, b: "x", c: 9 })).toEqual({ a: 300, b: 200 });
});
