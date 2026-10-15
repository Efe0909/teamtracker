// Para gosterimi ve girisi (spec/81). Sunucu kurusta dogrular; burasi yalniz
// bicim: "1.234,50 ₺" yazar, "1.234,50" / "1234.5" / "640" okur.

const FORMATS = new Map<string, Intl.NumberFormat>();

/** Iki ondalikli para: `money(640)` -> "640,00 ₺", `money(25, "USD")` -> "$25,00". */
export function money(n: number, currency = "TRY"): string {
  let f = FORMATS.get(currency);
  if (f === undefined) {
    try {
      f = new Intl.NumberFormat("tr-TR", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } catch {
      f = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    FORMATS.set(currency, f);
  }
  return f.format(n);
}

/** Kullanicinin yazdigi tutar. Virgul varsa ondalik odur, noktalar binlik;
 *  virgul yoksa tek nokta ondalik, birden cok nokta binlik. Gecersizse null. */
export function parseAmount(raw: string): number | null {
  const s = raw.trim().replace(/\s|₺|\$|€/g, "");
  if (s === "") return null;
  let norm: string;
  if (s.includes(",")) norm = s.replace(/\./g, "").replace(",", ".");
  else if ((s.match(/\./g) ?? []).length > 1) norm = s.replace(/\./g, "");
  else norm = s;
  if (!/^-?\d+(\.\d{1,2})?$/.test(norm)) return null;
  const n = Number(norm);
  return Number.isFinite(n) ? n : null;
}

/** Kurus toplami: float artigi olmadan "dagitilan = toplam" karsilastirmasi. */
export function cents(n: number): number {
  return Math.round(n * 100);
}

/** Kur girisi: 6 ondaliga kadar. */
export function parseRate(raw: string): number | null {
  const s = raw.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,6})?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}
