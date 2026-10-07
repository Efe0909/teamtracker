import { EditorState, StateEffect, StateField, Transaction, type Extension, type Range as DecoRange } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, drawSelection, keymap, placeholder, type DecorationSet } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { deleteMarkupBackward, insertNewlineContinueMarkupCommand } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { analyze, delimiters, touches } from "./markdown";
import { constructsOf, emptyPairAt, formatsAt, insertRule, markdownLanguage, toggleCodeBlock, toggleInline, toggleLines, type Formats, type LineTarget } from "./markdownCommands";
import s from "./markdown.module.css";

export type LinkEdit = { from: number; to: number; alias: string; url: string };

/** `[ad](adres)`: boşluk/dengesiz parantez içeren hedef `<…>` ile sarılır. */
export function formatLink(alias: string, url: string): string {
  const open = (url.match(/\(/g) ?? []).length;
  const close = (url.match(/\)/g) ?? []).length;
  const target = /\s/.test(url) || open !== close ? `<${url.replace(/[<>]/g, "")}>` : url;
  return `[${alias.replace(/\r?\n/g, " ")}](${target.replace(/\r?\n/g, "")})`;
}

export function linkAt(source: string, position: number): LinkEdit | null {
  for (const c of analyze(source)) {
    if (c.kind !== "link" || c.from > position || position > c.to) continue;
    let url = source.slice(c.destination.from, c.destination.to);
    if (url.startsWith("<") && url.endsWith(">")) url = url.slice(1, -1);
    return { from: c.from, to: c.to, alias: source.slice(c.alias.from, c.alias.to), url };
  }
  return null;
}

/** Araç çubuğu / ⌘K: imleç bir bağlantıdaysa onu, değilse seçimden yeni bağlantı. */
export function linkEditFor(state: EditorState): LinkEdit {
  const { from, to, head } = state.selection.main;
  const existing = linkAt(state.doc.toString(), head);
  if (existing) return existing;
  const raw = constructsOf(state).find((c) => c.kind === "url" && c.from <= head && head <= c.to);
  if (raw) return { from: raw.from, to: raw.to, alias: "", url: state.sliceDoc(raw.from, raw.to) };
  return { from, to, alias: state.sliceDoc(from, to), url: "https://" };
}

// --- odak / fare durumu ------------------------------------------------
// İşaretler yalnız odaktayken ve bitişikken açılır; fare sürüklerken yeniden
// akış seçimi bozmasın diye açılma bırakılana kadar dondurulur.
const setFocus = StateEffect.define<boolean>();
const setPointer = StateEffect.define<boolean>();
const interaction = StateField.define<{ focus: boolean; pointer: boolean }>({
  create: () => ({ focus: false, pointer: false }),
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setFocus)) value = { ...value, focus: e.value };
      if (e.is(setPointer)) value = { ...value, pointer: e.value };
    }
    return value;
  },
});

// --- widget'lar --------------------------------------------------------
// Yalnız iki widget var ve ikisi de yer kaplamaz ya da kaynakla birebir:
// sıfır genişlikli ad-ver noktası ve madde simgesi (kaynak "- " ile aynı yazı boyu).
class UrlDot extends WidgetType {
  constructor(readonly from: number, readonly to: number, readonly url: string, readonly active: boolean) { super(); }
  override eq(other: UrlDot) { return this.from === other.from && this.to === other.to && this.url === other.url && this.active === other.active; }
  override toDOM(view: EditorView) {
    const slot = document.createElement("span");
    slot.className = `${s.dotSlot} ${this.active ? s.dotActive : ""}`;
    const button = document.createElement("button");
    button.type = "button";
    button.tabIndex = -1;
    button.className = s.dot;
    button.setAttribute("aria-label", "Bağlantıya ad ver");
    button.title = "Bağlantıya ad ver";
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      view.dispatch({ changes: { from: this.from, to: this.to, insert: `[](${this.url})` },
        selection: { anchor: this.from + 1 }, annotations: Transaction.userEvent.of("input.link") });
      view.focus();
    });
    slot.append(button);
    return slot;
  }
}

class Bullet extends WidgetType {
  override eq() { return true; }
  override toDOM() {
    const span = document.createElement("span");
    span.className = s.bullet;
    span.textContent = "• ";
    return span;
  }
}

function build(state: EditorState): DecorationSet {
  const focus = state.field(interaction, false)?.focus ?? false;
  const selection = state.selection.ranges;
  const { doc } = state;
  const out: DecoRange<Decoration>[] = [];
  const mark = (className: string, from: number, to: number, spec: { tagName?: string; attributes?: Record<string, string> } = {}) => {
    if (to > from) out.push(Decoration.mark({ class: className, ...spec }).range(from, to));
  };
  const line = (className: string, pos: number, attributes?: Record<string, string>) =>
    out.push(Decoration.line({ class: className, ...(attributes ? { attributes } : {}) }).range(doc.lineAt(pos).from));

  for (const c of constructsOf(state)) {
    const hideable = delimiters(c);
    const revealed = focus && touches(selection, hideable);
    // Gizli = widget'sız replace; açık = silik işaret. İmleç hiçbir gizli aralığa değmez.
    const delimiter = () => { for (const r of hideable) { if (revealed) mark(s.syntax, r.from, r.to); else out.push(Decoration.replace({}).range(r.from, r.to)); } };
    switch (c.kind) {
      case "strong": case "em": case "code":
        mark(c.kind === "code" ? s.inlineCode : s[c.kind], c.from, c.to);
        if (hideable.length === 0) for (const r of c.marks) mark(s.syntax, r.from, r.to); else delimiter();
        break;
      case "link": {
        const empty = c.alias.from === c.alias.to;
        const attributes: Record<string, string> = { "data-link-from": String(c.from), "data-link-to": String(c.to) };
        if (c.href !== undefined) Object.assign(attributes, { href: c.href, target: "_blank", rel: "noopener noreferrer" });
        attributes["title"] = `${c.href ?? ""} · Düzenle: çift tık / ⌘K · Aç: ⌘/Ctrl+tık`;
        mark(`${s.link} ${c.provider ? s.file : ""}`, c.alias.from, c.alias.to, { tagName: c.href === undefined ? "span" : "a", attributes });
        if (empty) for (const r of c.marks) mark(s.syntax, r.from, r.to); else delimiter();
        break;
      }
      case "url": {
        const attributes: Record<string, string> = {};
        if (c.href !== undefined) Object.assign(attributes, { href: c.href, target: "_blank", rel: "noopener noreferrer", title: `${c.href} · Aç: ⌘/Ctrl+tık` });
        mark(`${s.link} ${s.rawLink}`, c.from, c.to, { tagName: c.href === undefined ? "span" : "a", attributes });
        const active = focus && touches(selection, [c]);
        out.push(Decoration.widget({ widget: new UrlDot(c.from, c.to, doc.sliceString(c.from, c.to), active), side: 1 }).range(c.to));
        break;
      }
      case "mention":
        mark(s.mention, c.from, c.to);
        break;
      case "heading":
        line(s[`h${c.level}`], c.from);
        delimiter();
        break;
      case "quote":
        line(s.quote, c.from);
        delimiter();
        break;
      case "list": {
        line(s.list, c.from, { style: `--md-hang: ${c.hang}` });
        const [r] = c.marks;
        if (c.ordered) mark(s.listMark, r.from, r.to);
        else if (revealed) mark(s.syntax, r.from, r.to);
        else out.push(Decoration.replace({ widget: new Bullet() }).range(r.from, r.to));
        break;
      }
      case "rule":
        line(s.rule, c.from);
        delimiter();
        break;
      case "fence": {
        const first = doc.lineAt(c.from).number;
        const last = doc.lineAt(c.to).number;
        for (let n = first; n <= last; n++) {
          const l = doc.line(n);
          line(`${s.code} ${n === first ? s.codeFirst : ""} ${n === last ? s.codeLast : ""}`, l.from);
        }
        mark(`${s.syntax} ${s.codeFence}`, c.open.from, c.open.to);
        mark(`${s.syntax} ${s.codeFence}`, c.close.from, c.close.to);
        break;
      }
    }
  }
  return Decoration.set(out, true);
}

const markdownDecorations = StateField.define<DecorationSet>({
  create: build,
  update(value, tr) {
    const mode = tr.state.field(interaction, false);
    const interactionChanged = mode !== tr.startState.field(interaction, false);
    const treeChanged = syntaxTree(tr.state) !== syntaxTree(tr.startState);
    if (!tr.docChanged && !tr.selection && !interactionChanged && !treeChanged) return value;
    if (mode?.pointer && !tr.docChanged && !tr.state.selection.main.empty) return value;
    return build(tr.state);
  },
  provide: (field) => EditorView.decorations.from(field),
});

// --- giriş davranışı ---------------------------------------------------
const BOUNDARY = /^(?:$|[\s)\]}.,;:!?])/;

export function pairEmphasis(view: EditorView, from: number, to: number, text: string): boolean {
  if (view.compositionStarted || from !== to || (text !== "*" && text !== "**")) return false;
  const { state } = view;
  const source = state.doc;
  const after = source.sliceString(from, from + 1);

  // Kapanışın üzerinden geç: elle yazılsa da otomatik eklenmiş olsa da aynı kural.
  if (text === "*" && after === "*") {
    const closing = constructsOf(state).some((c) => (c.kind === "strong" || c.kind === "em") && c.marks[1].from <= from && from < c.marks[1].to);
    const emptyPair = source.sliceString(from - 2, from) === "**" && source.sliceString(from, from + 2) === "**";
    if (closing || emptyPair) {
      view.dispatch({ selection: { anchor: from + 1 }, userEvent: "input.type" });
      return true;
    }
  }
  if (!BOUNDARY.test(source.sliceString(from, from + 1))) return false;
  const secondStar = text === "*" && source.sliceString(from - 1, from) === "*" && source.sliceString(from - 2, from - 1) !== "*" && after !== "*";
  if (text !== "**" && !secondStar) return false;
  view.dispatch({ changes: { from, to, insert: secondStar ? "***" : "****" }, selection: { anchor: from + (secondStar ? 1 : 2) },
    annotations: Transaction.userEvent.of("input.type") });
  return true;
}

// Boş çift (`**|**`) geçerli vurgu sayılmadığı için ağaçta yoktur; Backspace ikisini birlikte siler.
function deleteEmptyPair(view: EditorView): boolean {
  const { state } = view;
  const { head, empty } = state.selection.main;
  if (!empty) return false;
  const marker = ["**", "*", "`"].find((m) => emptyPairAt(state, head, m));
  if (marker === undefined) return false;
  view.dispatch({ changes: { from: head - marker.length, to: head + marker.length }, selection: { anchor: head - marker.length }, userEvent: "delete.backward" });
  return true;
}

// Boş maddede Enter hemen listeden çıkar (kütüphanenin "önce gevşet" adımı kapalı).
const continueMarkup = insertNewlineContinueMarkupCommand({ nonTightLists: false });

// Boş alıntı satırında (`> `) Enter alıntıdan çıkar; kütüphane yalnız iki boş satırdan sonra çıkıyor.
function exitEmptyQuote(view: EditorView): boolean {
  const { state } = view;
  const { head, empty } = state.selection.main;
  const line = state.doc.lineAt(head);
  if (!empty || head !== line.to || !/^\s*>\s*$/.test(line.text)) return false;
  const quote = constructsOf(state).find((c) => c.kind === "quote" && c.from === line.from);
  const inList = constructsOf(state).some((c) => c.kind === "list" && c.from === line.from);
  if (!quote || inList) return false;
  view.dispatch({ changes: { from: line.from, to: line.to }, selection: { anchor: line.from }, userEvent: "delete.quote" });
  return true;
}
const enterContinue = (view: EditorView) => exitEmptyQuote(view) || continueMarkup(view);

function softBreak(view: EditorView): boolean {
  if (view.compositionStarted) return false;
  const { state } = view;
  const at = state.doc.lineAt(state.selection.main.head);
  const item = constructsOf(state).find((c) => c.kind === "list" && c.from === at.from);
  const indent = item?.kind === "list" ? " ".repeat(item.hang) : "";
  view.dispatch(state.replaceSelection(`\n${indent}`), { scrollIntoView: true, userEvent: "input" });
  return true;
}

const run = (build: (state: EditorState) => ReturnType<typeof toggleInline>) => (view: EditorView): boolean => {
  const spec = build(view.state);
  if (spec) view.dispatch(spec);
  return spec !== null;
};
export const commands = {
  inline: (kind: "strong" | "em" | "code") => run((state) => toggleInline(state, kind)),
  lines: (target: LineTarget) => run((state) => toggleLines(state, target)),
  codeBlock: run(toggleCodeBlock),
  rule: run(insertRule),
};

export function markdownExtensions(options: {
  label: string;
  placeholder?: string;
  onChange: (source: string) => void;
  onSelection: (position: number) => void;
  onFormats: (formats: Formats) => void;
  onEditLink: (link: LinkEdit) => void;
  completeMention: () => boolean;
}): Extension[] {
  return [
    history(), markdownLanguage, interaction, markdownDecorations, EditorView.lineWrapping,
    // Tarayıcının yerel imleci boş satırda satır-içi widget (placeholder) yüzünden yukarı
    // kayabiliyor; imleci CM kendisi çizer (coordsAtPos ile, tüm tarayıcılarda aynı).
    drawSelection({ cursorBlinkRate: 1000 }),
    EditorView.focusChangeEffect.of((_state, focusing) => setFocus.of(focusing)),
    EditorView.contentAttributes.of({ "aria-label": options.label, "aria-multiline": "true", role: "textbox", spellcheck: "true" }),
    ...(options.placeholder === undefined ? [] : [placeholder(options.placeholder)]),
    EditorView.inputHandler.of(pairEmphasis),
    keymap.of([
      { key: "Enter", run: (view) => !view.compositionStarted && enterContinue(view) },
      { key: "Shift-Enter", run: softBreak },
      { key: "Backspace", run: (view) => !view.compositionStarted && (deleteEmptyPair(view) || deleteMarkupBackward(view)) },
      { key: "Tab", run: options.completeMention },
      { key: "Mod-b", run: commands.inline("strong"), preventDefault: true },
      { key: "Mod-i", run: commands.inline("em"), preventDefault: true },
      { key: "Mod-k", run: (view) => { options.onEditLink(linkEditFor(view.state)); return true; }, preventDefault: true },
      { key: "Mod-Alt-1", run: commands.lines("h1"), preventDefault: true },
      { key: "Mod-Alt-2", run: commands.lines("h2"), preventDefault: true },
      { key: "Mod-Alt-3", run: commands.lines("h3"), preventDefault: true },
      ...defaultKeymap, ...historyKeymap,
    ]),
    EditorView.domEventHandlers({
      mousedown: (_event, view) => {
        view.dispatch({ effects: setPointer.of(true) });
        const release = () => { document.removeEventListener("mouseup", release, true); view.dispatch({ effects: setPointer.of(false) }); };
        document.addEventListener("mouseup", release, true);
        return false;
      },
      click: (event) => {
        if (event.target instanceof Element && event.target.closest("a") && !event.metaKey && !event.ctrlKey) event.preventDefault();
        return false;
      },
      dblclick: (event, view) => {
        if (!(event.target instanceof Element)) return false;
        const from = event.target.closest("[data-link-from]")?.getAttribute("data-link-from");
        if (from == null) return false;
        const link = linkAt(view.state.doc.toString(), Number(from));
        if (!link) return false;
        event.preventDefault();
        options.onEditLink(link);
        return true;
      },
    }),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) options.onChange(update.state.doc.toString());
      if (update.selectionSet || update.docChanged) options.onSelection(update.state.selection.main.head);
      if (update.selectionSet || update.docChanged || update.focusChanged) options.onFormats(formatsAt(update.state));
    }),
  ];
}
