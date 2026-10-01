// Tablo sutun genislikleri: kisi surukleyerek ayarlar, cihazda hatirlanir.
// Varsayilan + [MIN, MAX] araligina kenetlenir; bozuk kayit varsayilana doner.

export const COL_MIN = 70;
export const COL_MAX = 640;

export function clampWidth(w: number): number {
  return Math.min(COL_MAX, Math.max(COL_MIN, Math.round(w)));
}

/** Kayitli genislikler + varsayilanlar; bilinmeyen/bozuk deger atilir. */
export function resolveWidths<K extends string>(defaults: Record<K, number>, saved: Record<string, unknown>): Record<K, number> {
  const out = { ...defaults };
  for (const k of Object.keys(defaults) as K[]) {
    const v = saved[k];
    if (typeof v === "number" && Number.isFinite(v)) out[k] = clampWidth(v);
  }
  return out;
}
