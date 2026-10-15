import { expect, it } from "vitest";
import { fill, readVariables, sanitize } from "./FinanceTemplates";

it("degiskenleri govdeden okur: tur yoksa metin, ilk gecis kazanir", () => {
  const { vars, conflicts } = readVariables(
    "{{kulup_adi}} {{toplam:para(biçim=yuvarlak, birim=USD)}} {{donem:tarih}} {{kalemler:matris(ad, tutar:para)}} {{toplam:metin}}");
  expect(vars.map((v) => `${v.name}:${v.kind}`)).toEqual(["kulup_adi:metin", "toplam:para", "donem:tarih", "kalemler:matris"]);
  expect(vars[1]?.opts).toEqual({ "biçim": "yuvarlak", birim: "USD" });
  expect(vars[3]?.cols).toEqual([{ name: "ad", kind: "metin" }, { name: "tutar", kind: "para" }]);
  expect(conflicts).toEqual(["toplam"]);
});

it("doldurur: para, tarih, kacis ve matris", () => {
  const body = "<p>{{ad}} {{toplam:para}} {{gun:tarih(biçim=gün)}}</p>{{k:matris(ad, tutar:para)}}";
  const out = fill(body, "html", { ad: "A & B <x>", toplam: "1250,5", gun: "2026-10-14" }, { k: [["Koli", "40"]] });
  expect(out).toContain("A &amp; B &lt;x&gt;");
  expect(out).toContain("1.250,50 ₺");
  expect(out).toContain("14 Ekim 2026");
  expect(out).toContain("<td>Koli</td><td>40,00 ₺</td>");
  const md = fill("{{k:matris(ad, tutar:para)}}", "md", {}, { k: [["Koli", "40"]] });
  expect(md.split("\n")[1]).toBe("| --- | --- |");
});

it("HTML izinli listeye indirgenir: betik, stil, olay ve javascript: atilir", () => {
  const out = sanitize(
    "<p style=\"color:red\" onclick=\"x()\">Merhaba <b>dünya</b></p><script>alert(1)</script>" +
    "<a href=\"javascript:alert(1)\">kötü</a><a href=\"https://example.com\">iyi</a><img src=x onerror=y>");
  expect(out).not.toContain("script");
  expect(out).not.toContain("onclick");
  expect(out).not.toContain("style");
  expect(out).not.toContain("javascript:");
  expect(out).not.toContain("<img");
  expect(out).toContain("<b>dünya</b>");
  expect(out).toContain("href=\"https://example.com\"");
});
