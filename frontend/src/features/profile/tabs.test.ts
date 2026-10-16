// Profil adresi ve hesap numarasi bicimleri (spec/82).

import { describe, expect, it } from "vitest";
import { parse as parseApp } from "../../surfaces/app/routes";
import { href, parse } from "../../surfaces/dashboard/routes";
import { formatIban, maskIban } from "./BankAccounts";
import { profileHref, profileTab, safeReturn } from "./tabs";

describe("profil adresi", () => {
  it("bölüm ve dönüş URL'de, bilinmeyen bölüm Profilim", () => {
    expect(profileHref("info", null)).toBe("/profile");
    expect(profileHref("accounts", "/finance/invoices/new")).toBe("/profile?tab=accounts&return=%2Ffinance%2Finvoices%2Fnew");
    expect(profileTab("nope")).toBe("info");
    const r = parse(new URL("http://x/profile?tab=accounts&return=/finance/invoices/new"));
    expect(r).toEqual({ name: "profile", tab: "accounts", ret: "/finance/invoices/new" });
    expect(href(r)).toBe("/profile?tab=accounts&return=%2Ffinance%2Finvoices%2Fnew");
    expect(parseApp(new URL("http://x/profile?tab=privacy"))).toEqual({ name: "profile", tab: "privacy", ret: null });
  });

  it("dönüş yalnız uygulama içi göreli yol (açık yönlendirme yok)", () => {
    expect(safeReturn("/events/1")).toBe("/events/1");
    expect(safeReturn("//kotu.example")).toBeNull();
    expect(safeReturn("/\\kotu.example")).toBeNull();
    expect(safeReturn("https://kotu.example")).toBeNull();
    expect(safeReturn(null)).toBeNull();
  });
});

describe("IBAN biçimi", () => {
  it("yazarken 4'lü gruplar, büyük harf, yalnız harf ve rakam", () => {
    expect(formatIban("tr12 0006-1005")).toBe("TR12 0006 1005");
  });

  it("maskeleme baştaki ve sondaki iki grubu açık bırakır", () => {
    expect(maskIban("TR120006100519786457841326", "1326")).toBe("TR12 0006 •••• •••• •••• 8413 26");
    expect(maskIban(null, "1326")).toBe("•••• 1326");
  });
});
