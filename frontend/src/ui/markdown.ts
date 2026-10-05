// Kaynak aralıkları hem salt okunur çizim hem editörün DOM eşlemesi için ortak.
export type Part = {
  text: string;
  from: number;
  to: number;
  hidden?: boolean;
  kind?: "strong" | "em" | "link" | "mention" | "quote" | "heading" | "list" | "rule";
  href?: string;
  rawUrl?: boolean;
  provider?: "drive" | "sharepoint";
  fallback?: boolean;
  linkFrom?: number;
  linkTo?: number;
};

// URL doğrulaması değil: yalnız gezinme yetkisi. Kontrol karakterleri hiçbir
// zaman temizlenip etkinleştirilmez; bilinmeyen şemalar biçimli ama etkisizdir.
export function safeHref(raw: string): string | null {
  if (/[\u0000- \u007f-\u009f]/u.test(raw)) return null;
  if (/^(?:https?:|mailto:)/i.test(raw)) return raw;
  if (/^[a-z][a-z\d+.-]*:/i.test(raw) || raw.includes(":")) return null;
  return raw;
}

export function fileProvider(raw: string): Part["provider"] {
  // ponytail: yalnız host regex'i; dosya varlığı/türü veya metadata sorgulanmaz.
  if (/^https?:\/\/(?:drive|docs)\.google\.com(?::\d+)?(?:[/?#]|$)/i.test(raw)) return "drive";
  if (/^https?:\/\/[a-z\d.-]+\.sharepoint\.com(?::\d+)?(?:[/?#]|$)/i.test(raw)) return "sharepoint";
  return undefined;
}

function inlineParts(text: string, offset: number): Part[] {
  const out: Part[] = [];
  const push = (from: number, to: number, extra: Partial<Part> = {}) => {
    out.push({ text: text.slice(from, to), from: offset + from, to: offset + to, ...extra });
  };
  // Escape ve sıradan karakter dalları AYRI olmalı: bozuk uzun bağlantıda
  // backslash'ı iki dal da kabul ederse regex üstel backtracking yapar.
  const token = /\[((?:\\.|[^\]\\\n])*)\]\(((?:\\.|[^()\\\n]|\((?:\\.|[^()\\\n])*\))*)\)|(\*\*(?:(?!\*\*)[^\n])+\*\*|__(?:(?!__)[^\n])+__)|((?<!\*)\*[^*\n]+\*(?!\*)|(?<!_)_[^_\n]+_(?!_))|https?:\/\/[^\s<>]+|@[\p{L}\p{N}_.-]+/gu;
  let at = 0;
  for (const m of text.matchAll(token)) {
    const i = m.index;
    if (i < at) continue;
    if (i > at) push(at, i);
    let end = i + m[0].length;
    if (m[1] !== undefined && m[2] !== undefined) {
      const href = safeHref(m[2]);
      const provider = fileProvider(m[2]);
      const extra: Partial<Part> = {
        kind: "link", linkFrom: offset + i, linkTo: offset + end,
        ...(href === null ? {} : { href }), ...(provider === undefined ? {} : { provider }),
      };
      push(i, i + 1, { hidden: true });
      push(i + 1, i + 1 + m[1].length, m[1] === ""
        ? { ...extra, text: m[2], fallback: true } : extra);
      push(i + 1 + m[1].length, end, { hidden: true });
    } else if (m[3] !== undefined || m[4] !== undefined) {
      const width = m[3] === undefined ? 1 : 2;
      const body = m[0].slice(width, -width);
      // İç içe emphasis bu küçük dilde yok; kısmen yorumlayıp marker kaybetme.
      if (width === 2 && /\*|_[^_]+_/.test(body)) push(i, end);
      else {
        push(i, i + width, { hidden: true });
        push(i + width, end - width, { kind: width === 2 ? "strong" : "em" });
        push(end - width, end, { hidden: true });
      }
    } else if (m[0].startsWith("@")) {
      push(i, end, { kind: "mention" });
    } else {
      // Cümle sonu noktalama ve URL dışındaki kapanış parantezi bağlantıya girmez.
      let raw = m[0];
      let previous: string;
      do {
        previous = raw;
        raw = raw.replace(/[.,;!?]+$/, "");
        while (raw.endsWith(")") && (raw.match(/\)/g)?.length ?? 0) > (raw.match(/\(/g)?.length ?? 0)) raw = raw.slice(0, -1);
      } while (raw !== previous);
      end = i + raw.length;
      const href = safeHref(raw);
      const incompleteLink = text.lastIndexOf("](", i);
      if (incompleteLink >= 0 && !text.slice(incompleteLink + 2, i).includes(")")) push(i, end);
      else push(i, end, { kind: "link", rawUrl: true, ...(href === null ? {} : { href }) });
    }
    at = end;
  }
  if (at < text.length) push(at, text.length);
  return out;
}

export function visiblePosition(parts: Part[], position: number, direction: number): number {
  const hidden = parts.find((p) => p.hidden && p.from < position && position < p.to);
  if (hidden === undefined) return position;
  if (direction < 0) return hidden.from;
  if (direction > 0) return hidden.to;
  return position - hidden.from < hidden.to - position ? hidden.from : hidden.to;
}

export function continueList(source: string, position: number): { from: number; to: number; insert: string; caret: number } | null {
  const start = source.lastIndexOf("\n", position - 1) + 1;
  const nextLine = source.indexOf("\n", position);
  const end = nextLine < 0 ? source.length : nextLine;
  const line = source.slice(start, end);
  const match = /^(\s*)([-*+]\s+|(\d+)([.)])\s+)(?!\[[ x]\])/i.exec(line);
  if (match === null || position < start + match[0].length) return null;
  if (line.slice(match[0].length).trim() === "") return { from: start, to: end, insert: "", caret: start };
  const marker = match[3] === undefined ? match[2] ?? "" : `${BigInt(match[3]) + 1n}${match[4] ?? "."} `;
  const insert = `\n${match[1] ?? ""}${marker}`;
  return { from: position, to: position, insert, caret: position + insert.length };
}

export function parseMarkdownParts(text: string): Part[] {
  const out: Part[] = [];
  let offset = 0;
  for (const [i, line] of text.split("\n").entries()) {
    if (i > 0) out.push({ text: "\n", from: offset - 1, to: offset });
    const heading = /^(#{1,3}\s+)(.+)$/.exec(line);
    const quote = /^(> ?)(.*)$/.exec(line);
    const list = /^(\s*)([-*+]\s+|\d+[.)]\s+)(?!\[[ x]\])/i.exec(line);
    const prefix = heading?.[1] ?? quote?.[1];
    if (/^\s*(?:-{3,}|={3,})\s*$/.test(line)) {
      out.push({ text: "────────────", from: offset, to: offset + line.length, kind: "rule" });
    } else if (prefix !== undefined) {
      out.push({ text: prefix, from: offset, to: offset + prefix.length, hidden: true });
      const parts = inlineParts(line.slice(prefix.length), offset + prefix.length);
      out.push(...parts.map((p) => p.kind === undefined && !p.hidden ? { ...p, kind: heading ? "heading" as const : "quote" as const } : p));
    } else if (list !== null) {
      const indent = list[1] ?? "";
      const marker = list[2] ?? "";
      if (indent) out.push({ text: indent, from: offset, to: offset + indent.length });
      out.push({ text: /^\d/.test(marker) ? marker.replace(/[.)]\s+$/, ". ") : "• ", from: offset + indent.length, to: offset + list[0].length, kind: "list" });
      out.push(...inlineParts(line.slice(list[0].length), offset + list[0].length));
    } else {
      out.push(...inlineParts(line, offset));
    }
    offset += line.length + 1;
  }
  return out;
}
