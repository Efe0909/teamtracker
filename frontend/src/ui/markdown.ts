// Markdown kaynağının tek ayrıştırıcısı: Lezer ağacı → `Construct` listesi.
// Editör (CodeMirror dekorasyonları) ve salt okunur çizim AYNI listeyi tüketir;
// regex gramer yok. Kaynak metin hiçbir zaman normalize edilmez.
import { Autolink, parser, type MarkdownConfig, type MarkdownExtension } from "@lezer/markdown";
import type { Tree } from "@lezer/common";

export type Range = { from: number; to: number };
export type Provider = "drive" | "sharepoint";

export type Construct =
  | { kind: "strong" | "em" | "code"; from: number; to: number; marks: [Range, Range] }
  | { kind: "link"; from: number; to: number; marks: [Range, Range]; alias: Range; destination: Range; href?: string; provider?: Provider }
  | { kind: "url"; from: number; to: number; href?: string }
  | { kind: "mention"; from: number; to: number }
  // Blok yapılar: `from` satır başı. `marks` satır başındaki işaret (+ ardındaki boşluk).
  | { kind: "heading"; level: 1 | 2 | 3; from: number; to: number; marks: [Range] }
  | { kind: "quote"; from: number; to: number; marks: [Range] }
  | { kind: "list"; ordered: boolean; from: number; to: number; marks: [Range]; hang: number }
  | { kind: "rule"; from: number; to: number }
  | { kind: "fence"; from: number; to: number; open: Range; close: Range };

// URL doğrulaması değil: yalnız gezinme yetkisi. Kontrol karakterleri hiçbir
// zaman temizlenip etkinleştirilmez; bilinmeyen şemalar biçimli ama etkisizdir.
export function safeHref(raw: string): string | null {
  if (/[\u0000- \u007f-\u009f]/u.test(raw)) return null;
  if (/^(?:https?:|mailto:)/i.test(raw)) return raw;
  if (/^[a-z][a-z\d+.-]*:/i.test(raw) || raw.includes(":")) return null;
  return raw;
}

export function fileProvider(raw: string): Provider | undefined {
  // ponytail: yalnız host eşleşmesi; dosya varlığı/türü veya metadata sorgulanmaz.
  // Host'tan sonra yalnız `:port`, `/`, `?`, `#` gelebilir: `drive.google.com.evil.test`
  // ve `drive.google.com@evil.test` sağlayıcı sayılmaz.
  if (/^https?:\/\/(?:drive|docs)\.google\.com(?::\d+)?(?:[/?#]|$)/i.test(raw)) return "drive";
  if (/^https?:\/\/[a-z\d.-]+\.sharepoint\.com(?::\d+)?(?:[/?#]|$)/i.test(raw)) return "sharepoint";
  return undefined;
}

// Kullanıcı `===` istedi: Setext başlık altı çizgisi değil, kendi satırında yatay çizgi.
const EQUALS_RULE = /^={3,}\s*$/;
const equalsRule: MarkdownConfig = {
  parseBlock: [{
    name: "EqualsRule",
    parse(cx, line) {
      if (!EQUALS_RULE.test(line.text.slice(line.pos))) return false;
      cx.addElement(cx.elt("HorizontalRule", cx.lineStart + line.pos, cx.lineStart + line.text.length));
      cx.nextLine();
      return true;
    },
    endLeaf: (_cx, line) => EQUALS_RULE.test(line.text.slice(line.pos)),
    before: "HorizontalRule",
  }],
};

// Editör (lang-markdown) ve salt okunur çizim aynı gramer yapılandırmasını kullanır.
export const markdownExtensions: MarkdownExtension[] = [Autolink, equalsRule, { remove: ["SetextHeading"] }];
export const markdownParser = parser.configure(markdownExtensions);

const MENTION = /(?<![\p{L}\p{N}_.-])@[\p{L}\p{N}_.-]+/gu;

function lineStart(source: string, pos: number): number {
  return source.lastIndexOf("\n", pos - 1) + 1;
}
function lineEnd(source: string, pos: number): number {
  const end = source.indexOf("\n", pos);
  return end < 0 ? source.length : end;
}
// İşaretin ardındaki boşluklar işaretin parçası: başlık/liste/alıntı birlikte açılır-kapanır.
function withSpaces(source: string, from: number, to: number, max = Infinity): Range {
  let end = to;
  while (end < source.length && end - to < max && (source[end] === " " || source[end] === "\t")) end++;
  return { from, to: end };
}

export function analyzeTree(tree: Tree, source: string): Construct[] {
  const out: Construct[] = [];
  const skip: Range[] = []; // mention aranmayacak aralıklar

  tree.iterate({
    enter(ref) {
      const node = ref.node;
      switch (ref.name) {
        case "StrongEmphasis":
        case "Emphasis":
        case "InlineCode": {
          const marks = node.getChildren(ref.name === "InlineCode" ? "CodeMark" : "EmphasisMark");
          const first = marks[0];
          const last = marks[marks.length - 1];
          if (marks.length >= 2 && first && last) {
            out.push({
              kind: ref.name === "StrongEmphasis" ? "strong" : ref.name === "Emphasis" ? "em" : "code",
              from: node.from, to: node.to,
              marks: [{ from: first.from, to: first.to }, { from: last.from, to: last.to }],
            });
          }
          if (ref.name === "InlineCode") { skip.push({ from: node.from, to: node.to }); return false; }
          return true;
        }
        case "Link": {
          // Yalnız tamamlanmış `[ad](hedef)`; kısa/referans biçimleri literal kalır.
          const marks = node.getChildren("LinkMark");
          const [open, close, paren, end] = marks;
          if (marks.length !== 4 || !open || !close || !paren || !end
            || source[close.from] !== "]" || source[paren.from] !== "(" || source[end.from] !== ")") return true;
          const url = node.getChildren("URL").find((u) => u.from >= paren.to);
          const destination = url ? { from: url.from, to: url.to } : { from: paren.to, to: end.from };
          let raw = source.slice(destination.from, destination.to);
          if (raw.startsWith("<") && raw.endsWith(">")) raw = raw.slice(1, -1);
          const href = raw === "" ? null : safeHref(raw);
          const provider = fileProvider(raw);
          out.push({
            kind: "link", from: node.from, to: node.to,
            marks: [{ from: open.from, to: open.to }, { from: close.from, to: node.to }],
            alias: { from: open.to, to: close.from }, destination,
            ...(href === null ? {} : { href }), ...(provider === undefined ? {} : { provider }),
          });
          skip.push(destination);
          return true;
        }
        case "URL": {
          const parent = node.parent?.name;
          if (parent === "Link" || parent === "Image" || parent === "Autolink") return true;
          const text = source.slice(node.from, node.to);
          // Yalnız açık http(s) şemalı ham URL; `www.x` göreli yola dönüşmesin.
          if (!/^https?:\/\//i.test(text)) return true;
          const href = safeHref(text);
          out.push({ kind: "url", from: node.from, to: node.to, ...(href === null ? {} : { href }) });
          skip.push({ from: node.from, to: node.to });
          return true;
        }
        case "ATXHeading1":
        case "ATXHeading2":
        case "ATXHeading3": {
          const mark = node.getChild("HeaderMark");
          if (!mark) return true;
          const marks = withSpaces(source, mark.from, mark.to);
          // Ürün politikası: ilk gerçek başlık karakterine kadar literal.
          if (source.slice(marks.to, node.to).trim() === "") return true;
          out.push({
            kind: "heading", level: Number(ref.name.slice(-1)) as 1 | 2 | 3,
            from: lineStart(source, node.from), to: lineEnd(source, node.from), marks: [marks],
          });
          return true;
        }
        case "QuoteMark": {
          const marks = withSpaces(source, node.from, node.to, 1);
          out.push({ kind: "quote", from: lineStart(source, node.from), to: lineEnd(source, node.from), marks: [marks] });
          return true;
        }
        case "ListMark": {
          const marks = withSpaces(source, node.from, node.to);
          const start = lineStart(source, node.from);
          out.push({
            kind: "list", ordered: node.parent?.parent?.name === "OrderedList",
            from: start, to: lineEnd(source, node.from), marks: [marks], hang: marks.to - marks.from,
          });
          return true;
        }
        case "HorizontalRule":
          out.push({ kind: "rule", from: node.from, to: node.to });
          return true;
        case "FencedCode": {
          const marks = node.getChildren("CodeMark");
          const first = marks[0];
          const last = marks[marks.length - 1];
          skip.push({ from: node.from, to: node.to });
          // Kapanmamış çit literal kalır (yarım sözdizimi politikası).
          if (marks.length >= 2 && first && last && last.from > first.to) {
            out.push({
              kind: "fence", from: node.from, to: node.to,
              open: { from: first.from, to: lineEnd(source, first.to) }, close: { from: last.from, to: last.to },
            });
          }
          return false;
        }
        default:
          return true;
      }
    },
  });

  for (const m of source.matchAll(MENTION)) {
    const text = m[0].replace(/[.-]+$/, "");
    const from = m.index;
    const to = from + text.length;
    if (text.length > 1 && !skip.some((r) => from < r.to && to > r.from)) out.push({ kind: "mention", from, to });
  }
  return out.sort((a, b) => a.from - b.from || a.to - b.to);
}

export function analyze(source: string): Construct[] {
  return analyzeTree(markdownParser.parse(source), source);
}

/** [from,to] kapalı aralığı bir ya da birden çok aralığa değiyor mu? */
export function touches(ranges: readonly Range[], marks: readonly Range[]): boolean {
  return ranges.some((r) => marks.some((m) => r.from <= m.to && r.to >= m.from));
}

/** Gizlenebilir ayraç aralıkları. Boş yapılar (görünmez kalırdı) hiç gizlenmez. */
export function delimiters(c: Construct): Range[] {
  switch (c.kind) {
    case "strong": case "em": case "code":
      return c.marks[0].to === c.marks[1].from ? [] : [...c.marks];
    case "link":
      return c.alias.from === c.alias.to ? [] : [...c.marks];
    case "heading": case "quote": case "list":
      return [...c.marks];
    case "rule":
      return [{ from: c.from, to: c.to }];
    default:
      return [];
  }
}

