// Anma (R4-F03): "@ayse-yilmaz", "@all", "@here", "@team". Katlama Rust
// `backend/src/mentions.rs` `handle` ile BIREBIR — ayrisirsa sunucu bir kisiyi
// davet eder, ekran baskasini vurgular. Tablo iki yerde ayni sirada.

export const GROUPS = ["all", "here", "team"] as const;

export const GROUP_LABEL: Record<(typeof GROUPS)[number], string> = {
  all: "sohbetteki herkes",
  here: "son 10 dakikada görülenler",
  team: "kaydın takımı",
};

const FOLD = new Map<string, string>();
for (const [to, from] of [
  ["i", "İIıÎîÍí"], ["c", "Çç"], ["g", "Ğğ"], ["o", "ÖöÔô"], ["s", "Şş"],
  ["u", "ÜüÛû"], ["a", "ÂâÁáÀàÄä"], ["e", "ÉéÈèÊê"],
] as const) {
  for (const ch of from) FOLD.set(ch, to);
}

export function handle(name: string): string {
  let out = "";
  for (const ch of name) {
    const c = FOLD.get(ch) ?? (/[A-Z]/.test(ch) ? ch.toLowerCase() : ch);
    if (/^[a-z0-9]$/.test(c)) out += c;
    else if (!out.endsWith("-")) out += "-";
  }
  return out.replace(/^-+|-+$/g, "");
}

/** Anma tokeni: `@` + harf/rakam/`_`/`.`/`-` (Rust `tokens` ile ayni kume). */
export const MENTION = /@[\p{L}\p{N}_.-]+/gu;

/** Bu govde beni aniyor mu: adim ya da bir grup. Bildirimde isaret icin. */
export function mentionsMe(body: string | null, myName: string): boolean {
  if (body === null) return false;
  const me = handle(myName);
  for (const m of body.matchAll(MENTION)) {
    const raw = m[0].slice(1);
    const low = raw.toLowerCase();
    if ((GROUPS as readonly string[]).includes(low) || handle(raw) === me) return true;
  }
  return false;
}
