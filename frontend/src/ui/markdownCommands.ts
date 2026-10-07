// Toolbar ve klavye biçimlendirmesi: EditorState → TransactionSpec (saf, test edilebilir).
// Kaynak tek gerçektir; "kalıcı işaret" durumu tutulmaz, aktiflik sözdizimi ağacından türer.
import { EditorSelection, type ChangeSpec, type EditorState, type TransactionSpec } from "@codemirror/state";
import { markdown, commonmarkLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { Tree } from "@lezer/common";
import { analyzeTree, markdownExtensions, type Construct, type Range } from "./markdown";

// Basılı kısayollar `lang-markdown` anahtar haritasından değil, editörün kendi
// tuşlarından gelir (koruma: IME, boş çift silme, Shift+Enter).
export const markdownLanguage = markdown({ base: commonmarkLanguage, extensions: markdownExtensions, addKeymap: false, completeHTMLTags: false });

const cache = new WeakMap<Tree, Construct[]>();
export function constructsOf(state: EditorState): Construct[] {
  const tree = ensureSyntaxTree(state, state.doc.length, 100) ?? syntaxTree(state);
  let found = cache.get(tree);
  if (found === undefined) { found = analyzeTree(tree, state.doc.toString()); cache.set(tree, found); }
  return found;
}

export type Inline = "strong" | "em" | "code";
const MARKER: Record<Inline, string> = { strong: "**", em: "*", code: "`" };

/** İmleç tam bir boş çiftin ortasında mı (`**|**`, komşu aynı karakter yok)? */
export function emptyPairAt(state: EditorState, pos: number, marker: string): boolean {
  const n = marker.length;
  return state.sliceDoc(pos - n, pos + n) === marker + marker
    && state.sliceDoc(pos - n - 1, pos - n) !== marker[0]
    && state.sliceDoc(pos + n, pos + n + 1) !== marker[0];
}
type InlineConstruct = Extract<Construct, { kind: Inline }>;

export type Formats = {
  strong: boolean; em: boolean; code: boolean; link: boolean; quote: boolean;
  bullet: boolean; ordered: boolean; fence: boolean; heading: 0 | 1 | 2 | 3;
};

export function formatsAt(state: EditorState): Formats {
  const head = state.selection.main.head;
  const formats: Formats = { strong: false, em: false, code: false, link: false, quote: false, bullet: false, ordered: false, fence: false, heading: 0 };
  for (const c of constructsOf(state)) {
    if (c.kind === "strong" || c.kind === "em" || c.kind === "code") { if (c.marks[0].to <= head && head <= c.marks[1].from) formats[c.kind] = true; }
    else if (c.kind === "link" || c.kind === "url") { if (c.from <= head && head <= c.to) formats.link = true; }
    else if (c.kind === "fence") { if (c.from <= head && head <= c.to) formats.fence = true; }
    else if (c.from <= head && head <= c.to) {
      if (c.kind === "heading") formats.heading = c.level;
      else if (c.kind === "quote") formats.quote = true;
      else if (c.kind === "list") formats[c.ordered ? "ordered" : "bullet"] = true;
    }
  }
  for (const kind of ["strong", "em", "code"] as const) if (emptyPairAt(state, head, MARKER[kind])) formats[kind] = true;
  return formats;
}

const LINE_PREFIX = /^(\s*)((?:>\s?)*)(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)?/;

/** Seçimin satır başına göre kırpılmış, boşluksuz, blok işaretlerinden arınmış parçaları. */
function segmentsOf(state: EditorState, marks: Range[]): Range[] {
  const { doc, selection } = state;
  const { from: start, to: end } = selection.main;
  const out: Range[] = [];
  for (let pos = start; pos <= end;) {
    const line = doc.lineAt(pos);
    const prefix = LINE_PREFIX.exec(line.text)?.[0].length ?? 0;
    let from = Math.max(line.from + prefix, start);
    let to = Math.min(line.to, end);
    for (const m of marks) {
      if (m.from < from && from < m.to) from = m.to;
      if (m.from < to && to < m.to) to = m.from;
    }
    const text = doc.sliceString(from, to);
    from += text.length - text.trimStart().length;
    to -= text.length - text.trimEnd().length;
    if (to > from) out.push({ from, to });
    pos = line.to + 1;
  }
  return out;
}

const trimmed = (state: EditorState, r: Range): Range | null => {
  const text = state.doc.sliceString(r.from, r.to);
  const from = r.from + text.length - text.trimStart().length;
  const to = r.to - (text.length - text.trimEnd().length);
  return to > from ? { from, to } : null;
};

function mapSelection(state: EditorState, changes: ChangeSpec[]): { changes: ChangeSpec[]; selection: EditorSelection } {
  const set = state.changes(changes);
  const { from, to } = state.selection.main;
  const a = set.mapPos(from, 1);
  const b = set.mapPos(to, -1);
  return { changes, selection: EditorSelection.single(Math.min(a, b), Math.max(a, b)) };
}

export function toggleInline(state: EditorState, kind: Inline): TransactionSpec | null {
  const marker = MARKER[kind];
  const items = constructsOf(state).filter((c): c is InlineConstruct => c.kind === kind);
  const range = state.selection.main;

  if (range.empty) {
    const pos = range.head;
    // Boş çift (`**|**`) geçerli vurgu sayılmadığı için ağaçta yoktur; yine de "açık" durumdur.
    if (emptyPairAt(state, pos, marker)) {
      return { changes: { from: pos - marker.length, to: pos + marker.length }, selection: { anchor: pos - marker.length }, userEvent: "delete.format" };
    }
    const inside = items.find((c) => c.marks[0].to <= pos && pos <= c.marks[1].from);
    if (inside === undefined) {
      return { changes: { from: pos, insert: marker + marker }, selection: { anchor: pos + marker.length }, userEvent: "input.format" };
    }
    if (inside.marks[0].to === inside.marks[1].from) {
      return { changes: { from: inside.from, to: inside.to }, selection: { anchor: inside.from }, userEvent: "delete.format" };
    }
    // "Bundan sonra normal yaz": kapanışın dışına çık; ortadaysa metni böl.
    if (pos === inside.marks[1].from) return { selection: { anchor: inside.to }, userEvent: "select.format" };
    if (pos === inside.marks[0].to) return { selection: { anchor: inside.from }, userEvent: "select.format" };
    return { changes: { from: pos, insert: marker + marker }, selection: { anchor: pos + marker.length }, userEvent: "input.format" };
  }

  const segments = segmentsOf(state, items.flatMap((c) => c.marks));
  if (segments.length === 0) return null;
  const covers = (c: InlineConstruct, s: Range) => c.from <= s.from && s.to <= c.to;
  const covered = segments.every((s) => items.some((c) => covers(c, s)));
  const changes: ChangeSpec[] = [];
  const emit = (r: Range | null) => { if (r) changes.push({ from: r.from, insert: marker }, { from: r.to, insert: marker }); };

  if (covered) {
    // Kaldır: yapının işaretlerini sil, seçim dışında kalan parçaları yeniden sar.
    for (const c of items.filter((i) => segments.some((s) => covers(i, s)))) {
      changes.push({ from: c.marks[0].from, to: c.marks[0].to }, { from: c.marks[1].from, to: c.marks[1].to });
      let cursor = c.marks[0].to;
      for (const s of segments.filter((x) => x.to > c.marks[0].to && x.from < c.marks[1].from).sort((a, b) => a.from - b.from)) {
        if (s.from > cursor) emit(trimmed(state, { from: cursor, to: s.from }));
        cursor = Math.max(cursor, s.to);
      }
      if (cursor < c.marks[1].from) emit(trimmed(state, { from: cursor, to: c.marks[1].from }));
    }
  } else {
    // Ekle: üst üste binen aynı tür yapıları birleştir (görsel birleşim aynı), seçimi sar.
    const touched = items.filter((c) => segments.some((s) => c.from < s.to && c.to > s.from));
    const spans: Range[] = [...segments, ...touched.map((c) => ({ from: c.marks[0].to, to: c.marks[1].from }))].sort((a, b) => a.from - b.from);
    const merged: Range[] = [];
    for (const s of spans) {
      const last = merged[merged.length - 1];
      if (last !== undefined && s.from <= last.to) last.to = Math.max(last.to, s.to);
      else merged.push({ ...s });
    }
    for (const c of touched) changes.push({ from: c.marks[0].from, to: c.marks[0].to }, { from: c.marks[1].from, to: c.marks[1].to });
    for (const m of merged) emit(trimmed(state, m));
  }
  return { ...mapSelection(state, changes), userEvent: "input.format" };
}

export type LineTarget = "h1" | "h2" | "h3" | "quote" | "bullet" | "ordered";

export function toggleLines(state: EditorState, target: LineTarget): TransactionSpec | null {
  const { doc, selection } = state;
  const { from, to } = selection.main;
  const first = doc.lineAt(from).number;
  let last = doc.lineAt(to).number;
  if (to > from && last > first && doc.line(last).from === to) last--;
  const lines = [];
  for (let n = first; n <= last; n++) lines.push(doc.line(n));
  const used = first === last ? lines : lines.filter((l) => l.text.trim() !== "");
  if (used.length === 0) return null;

  const has = (text: string) => {
    const m = LINE_PREFIX.exec(text);
    const block = m?.[3]?.trim() ?? "";
    switch (target) {
      case "quote": return (m?.[2] ?? "") !== "";
      case "bullet": return /^[-*+]$/.test(block);
      case "ordered": return /^\d+[.)]$/.test(block);
      default: return block === "#".repeat(Number(target.slice(1)));
    }
  };
  const remove = used.every((l) => has(l.text));
  const changes: ChangeSpec[] = [];
  let index = 0;
  for (const line of used) {
    const m = LINE_PREFIX.exec(line.text);
    const indent = m?.[1] ?? "";
    const quote = m?.[2] ?? "";
    const block = m?.[3] ?? "";
    index++;
    if (target === "quote") {
      if (remove) changes.push({ from: line.from + indent.length, to: line.from + indent.length + quote.length });
      else changes.push({ from: line.from + indent.length, insert: "> " });
    } else {
      const at = line.from + indent.length + quote.length;
      const insert = remove ? "" : target === "bullet" ? "- " : target === "ordered" ? `${index}. ` : `${"#".repeat(Number(target.slice(1)))} `;
      changes.push({ from: at, to: at + block.length, insert });
    }
  }
  const set = state.changes(changes);
  return { changes, selection: EditorSelection.single(set.mapPos(selection.main.anchor, 1), set.mapPos(selection.main.head, 1)), userEvent: "input.format" };
}

export function toggleCodeBlock(state: EditorState): TransactionSpec | null {
  const { doc, selection } = state;
  const head = selection.main.head;
  const fence = constructsOf(state).find((c) => c.kind === "fence" && c.from <= head && head <= c.to);
  if (fence?.kind === "fence") {
    const open = doc.lineAt(fence.open.from);
    const close = doc.lineAt(fence.close.from);
    const closing = close.to >= doc.length && close.from > 0
      ? { from: close.from - 1, to: close.to }
      : { from: close.from, to: Math.min(close.to + 1, doc.length) };
    return { changes: [{ from: open.from, to: Math.min(open.to + 1, doc.length) }, closing], userEvent: "input.format" };
  }
  const { from, to } = selection.main;
  const firstLine = doc.lineAt(from);
  let lastLine = doc.lineAt(to);
  if (to > from && lastLine.number > firstLine.number && lastLine.from === to) lastLine = doc.line(lastLine.number - 1);
  const empty = firstLine.number === lastLine.number && firstLine.text === "";
  if (empty) {
    return { changes: { from: firstLine.from, insert: "```\n\n```" }, selection: { anchor: firstLine.from + 4 }, userEvent: "input.format" };
  }
  const changes: ChangeSpec[] = [{ from: firstLine.from, insert: "```\n" }, { from: lastLine.to, insert: "\n```" }];
  return { changes, selection: EditorSelection.single(from + 4, to + 4), userEvent: "input.format" };
}

export function insertRule(state: EditorState): TransactionSpec {
  const line = state.doc.lineAt(state.selection.main.head);
  if (line.text === "") return { changes: { from: line.from, insert: "---\n" }, selection: { anchor: line.from + 4 }, userEvent: "input.format" };
  return { changes: { from: line.to, insert: "\n---\n" }, selection: { anchor: line.to + 5 }, userEvent: "input.format" };
}
