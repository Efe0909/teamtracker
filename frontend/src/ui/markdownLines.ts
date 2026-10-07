// Salt okunur çizim modeli: `analyze()` çıktısından satır/segment listesi.
// İşaretler gizli; editörle aynı ayrıştırıcı ve aynı güvenlik kuralları.
import { analyze, type Construct, type Provider, type Range } from "./markdown";

export type Style = "strong" | "em" | "code" | "link" | "mention";
export type Segment = {
  text: string;
  styles: Style[];
  href?: string;
  provider?: Provider;
  /** Boş adlı bağlantıda kaynaktan türetilen metin (hedef ya da genel "Dosya"). */
  fallback?: boolean;
};
export type LineKind = "h1" | "h2" | "h3" | "quote" | "list" | "rule" | "code";
export type RenderedLine = { kind?: LineKind; segments: Segment[] };

type Block = Extract<Construct, { kind: "heading" | "quote" | "list" }>;
type Inline = Extract<Construct, { kind: "strong" | "em" | "code" | "link" | "url" | "mention" }>;

export function renderLines(source: string): RenderedLine[] {
  const constructs = analyze(source);
  const lines: RenderedLine[] = [];
  let ls = 0;
  for (const text of source.split("\n")) {
    const le = ls + text.length;
    const within = (r: Range) => r.from >= ls && r.to <= le;
    const fence = constructs.find((c) => c.kind === "fence" && c.from <= ls && le <= c.to);
    if (fence?.kind === "fence") {
      const edge = (at: number) => ls <= at && at <= le;
      // Çit satırları salt okunurda görünmez; gövde satırları kod.
      if (!edge(fence.open.from) && !edge(fence.close.from)) {
        lines.push({ kind: "code", segments: text === "" ? [] : [{ text, styles: [] }] });
      }
      ls = le + 1;
      continue;
    }

    const block = constructs.find((c): c is Block => (c.kind === "heading" || c.kind === "quote" || c.kind === "list") && c.from === ls)
      ?? constructs.find((c): c is Extract<Construct, { kind: "rule" }> => c.kind === "rule" && within(c));
    const hidden: Range[] = [];
    const inline: Inline[] = [];
    for (const c of constructs) {
      if (c.to < ls || c.from > le) continue;
      if (c.kind === "strong" || c.kind === "em" || c.kind === "code") { hidden.push(...c.marks); inline.push(c); }
      else if (c.kind === "link") { hidden.push(...(c.alias.from === c.alias.to ? [{ from: c.from, to: c.to }] : c.marks)); inline.push(c); }
      else if (c.kind === "url" || c.kind === "mention") inline.push(c);
    }
    if (block !== undefined && block.kind !== "rule") hidden.push(...block.marks);

    const cuts = new Set<number>([ls, le]);
    for (const r of [...hidden, ...inline, ...inline.flatMap((c) => c.kind === "link" ? [c.alias] : [])]) {
      if (r.from > ls && r.from < le) cuts.add(r.from);
      if (r.to > ls && r.to < le) cuts.add(r.to);
    }
    const points = [...cuts].sort((a, b) => a - b);
    const segments: Segment[] = [];
    for (let i = 0; i + 1 < points.length; i++) {
      const from = points[i] ?? ls;
      const to = points[i + 1] ?? le;
      const empty = inline.find((c) => c.kind === "link" && c.alias.from === c.alias.to && c.from === from);
      if (empty?.kind === "link") {
        segments.push({ text: empty.provider ? "Dosya" : source.slice(empty.destination.from, empty.destination.to),
          styles: ["link"], fallback: true,
          ...(empty.href ? { href: empty.href } : {}), ...(empty.provider ? { provider: empty.provider } : {}) });
      }
      if (hidden.some((r) => r.from <= from && r.to >= to)) continue;
      const segment: Segment = { text: source.slice(from, to), styles: [] };
      for (const c of inline) {
        if (c.kind === "link") {
          if (c.alias.from <= from && c.alias.to >= to && c.alias.from !== c.alias.to) {
            segment.styles.push("link");
            if (c.href) segment.href = c.href;
            if (c.provider) segment.provider = c.provider;
          }
        } else if (c.from <= from && c.to >= to) {
          segment.styles.push(c.kind === "url" ? "link" : c.kind);
          if (c.kind === "url" && c.href) segment.href = c.href;
        }
      }
      segments.push(segment);
    }

    const line: RenderedLine = { segments };
    if (block?.kind === "heading") line.kind = `h${block.level}`;
    else if (block?.kind === "quote") line.kind = "quote";
    else if (block?.kind === "list") {
      line.kind = "list";
      line.segments.unshift({ text: block.ordered ? source.slice(block.marks[0].from, block.marks[0].to) : "• ", styles: [] });
    } else if (block?.kind === "rule") { line.kind = "rule"; line.segments = []; }
    lines.push(line);
    ls = le + 1;
  }
  return lines;
}
