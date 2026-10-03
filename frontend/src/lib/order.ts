// Kenar cubugu modul sirasi: kisi surukleyerek duzenler, cihazda hatirlanir.
// Kayitli sira + guncel anahtarlar birlestirilir: kaldirilmis anahtar atilir,
// yeni anahtar sona eklenir, bozuk kayit varsayilan siraya doner.

export function mergeOrder(saved: unknown, keys: readonly string[]): string[] {
  const known = new Set(keys);
  const out: string[] = [];
  if (Array.isArray(saved)) {
    for (const k of saved) if (typeof k === "string" && known.has(k) && !out.includes(k)) out.push(k);
  }
  for (const k of keys) if (!out.includes(k)) out.push(k);
  return out;
}

/** `from`'u `to`'nun bulundugu konuma tasir (asagi surukleme hedefin ALTINA, yukari ustune duser). */
export function moveTo(order: readonly string[], from: string, to: string): string[] {
  const at = order.indexOf(to);
  if (at < 0 || from === to || !order.includes(from)) return [...order];
  const out = order.filter((k) => k !== from);
  out.splice(at, 0, from);
  return out;
}
