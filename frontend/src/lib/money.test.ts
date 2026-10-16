import { describe, expect, it } from "vitest";
import { cents, money, parseAmount, parseRate } from "./money";

describe("para", () => {
  it("Türkçe yazımı okur", () => {
    expect(parseAmount("640")).toBe(640);
    expect(parseAmount("640,5")).toBe(640.5);
    expect(parseAmount("1.234,50 ₺")).toBe(1234.5);
    expect(parseAmount("1234.5")).toBe(1234.5);
    expect(parseAmount("1.234.567")).toBe(1234567);
    expect(parseAmount("12,345")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("")).toBeNull();
  });

  it("kuruşta toplar, biçimler", () => {
    expect(cents(0.1) + cents(0.2)).toBe(cents(0.3));
    expect(money(640)).toContain("640,00");
    expect(money(25, "USD")).toContain("25,00");
    expect(parseRate("41,82")).toBe(41.82);
    expect(parseRate("0")).toBeNull();
  });
});
