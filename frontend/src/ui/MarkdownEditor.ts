import { EditorSelection, EditorState, StateField, Transaction, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, keymap, placeholder, type DecorationSet } from "@codemirror/view";
import { defaultKeymap, deleteCharBackward, deleteCharForward, history, historyKeymap } from "@codemirror/commands";
import { continueList, parseMarkdownParts, visiblePosition } from "./markdown";
import s from "./markdown.module.css";

export type LinkEdit = { from: number; to: number; alias: string; url: string };

class TextWidget extends WidgetType {
  constructor(readonly text: string, readonly className: string, readonly linkFrom?: number) { super(); }
  override eq(other: TextWidget) { return this.text === other.text && this.className === other.className && this.linkFrom === other.linkFrom; }
  override toDOM(view: EditorView) {
    const span = document.createElement("span");
    span.textContent = this.text;
    span.className = this.className;
    if (this.linkFrom !== undefined) {
      span.setAttribute("data-link-from", String(this.linkFrom));
      span.addEventListener("mousedown", (event) => {
        event.preventDefault();
        view.dispatch({ selection: { anchor: (this.linkFrom ?? 0) + 1 } });
        view.focus();
      });
    }
    return span;
  }
  override ignoreEvent() { return false; }
}

class FileWidget extends WidgetType {
  override eq() { return true; }
  override toDOM() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "14");
    svg.setAttribute("height", "14");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", s.fileIcon);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z M14 2v6h6 M8 13h8 M8 17h6");
    svg.append(path);
    const span = document.createElement("span");
    span.append(svg);
    return span;
  }
}

class UrlDot extends WidgetType {
  constructor(readonly from: number, readonly to: number, readonly url: string) { super(); }
  override eq(other: UrlDot) { return this.from === other.from && this.to === other.to && this.url === other.url; }
  override toDOM(view: EditorView) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = s.urlDot;
    button.setAttribute("aria-label", "Bağlantıya ad ver");
    button.title = "Bağlantıya ad ver";
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      view.dispatch({ changes: { from: this.from, to: this.to, insert: `[](${this.url})` },
        selection: { anchor: this.from + 1 }, annotations: Transaction.userEvent.of("input.link") });
      view.focus();
    });
    return button;
  }
}

function decorations(source: string): { visible: DecorationSet; atomic: DecorationSet } {
  const ranges: Range<Decoration>[] = [];
  const atoms: Range<Decoration>[] = [];
  for (const part of parseMarkdownParts(source)) {
    if (part.hidden) {
      const range = Decoration.replace({}).range(part.from, part.to);
      ranges.push(range);
      atoms.push(range);
    } else if (part.fallback) {
      ranges.push(Decoration.widget({ widget: new TextWidget(part.text, `${s.link} ${s.fallback}`, part.linkFrom), side: 1 }).range(part.from));
    } else if (part.kind === "list" || part.kind === "rule") {
      const range = Decoration.replace({ widget: new TextWidget(part.text, s[part.kind]) }).range(part.from, part.to);
      ranges.push(range);
      atoms.push(range);
    } else if (part.kind !== undefined && part.to > part.from) {
      const attributes: Record<string, string> = {};
      if (part.href !== undefined) {
        attributes["href"] = part.href;
        attributes["target"] = "_blank";
        attributes["rel"] = "noopener noreferrer";
        attributes["title"] = `${part.href} · Aç: ⌘/Ctrl+tık`;
      }
      if (part.linkFrom !== undefined && part.linkTo !== undefined) {
        attributes["data-link-from"] = String(part.linkFrom);
        attributes["data-link-to"] = String(part.linkTo);
        attributes["title"] = `${part.href ?? ""} · Düzenle: çift tık / ⌘K · Aç: ⌘/Ctrl+tık`;
      }
      const className = `${s[part.kind]} ${part.rawUrl ? s.rawLink : ""} ${part.provider ? s.fileLabel : ""}`;
      ranges.push(Decoration.mark({ tagName: part.href === undefined ? "span" : "a", class: className, attributes }).range(part.from, part.to));
      if (part.provider) ranges.push(Decoration.widget({ widget: new FileWidget(), side: -1 }).range(part.from));
      if (part.rawUrl) ranges.push(Decoration.widget({ widget: new UrlDot(part.from, part.to, part.text), side: 1 }).range(part.to));
    }
  }
  return { visible: Decoration.set(ranges, true), atomic: Decoration.set(atoms, true) };
}

const markdownDecorations = StateField.define({
  create: (state) => decorations(state.doc.toString()),
  update: (value, tr) => tr.docChanged ? decorations(tr.newDoc.toString()) : value,
  provide: (field) => [EditorView.decorations.from(field, (value) => value.visible),
    EditorView.atomicRanges.of((view) => view.state.field(field).atomic)],
});

export function linkAt(source: string, position: number): LinkEdit | null {
  const part = parseMarkdownParts(source).find((p) => p.linkFrom !== undefined && p.linkTo !== undefined && p.linkFrom <= position && position <= p.linkTo);
  if (part?.linkFrom === undefined || part.linkTo === undefined) return null;
  const raw = source.slice(part.linkFrom, part.linkTo);
  const aliasLength = part.to - part.from;
  return { from: part.linkFrom, to: part.linkTo, alias: raw.slice(1, 1 + aliasLength), url: raw.slice(aliasLength + 3, -1) };
}

// CM atomları oklar/silme için kullanır; fare ve programatik seçimler de
// gizli delimiter'ın ortasına düşmesin. Belge hâlâ özgün Markdown kaynağıdır.
const visibleSelection = EditorState.transactionFilter.of((tr) => {
  const parts = parseMarkdownParts(tr.newDoc.toString());
  const old = tr.startState.selection.main;
  const main = tr.newSelection.main;
  const direction = tr.isUserEvent("select.pointer") ? 0 : main.head - old.head;
  const anchor = visiblePosition(parts, main.anchor, main.empty ? direction : main.anchor < main.head ? -1 : 1);
  const head = visiblePosition(parts, main.head, main.empty ? direction : main.head < main.anchor ? -1 : 1);
  if (anchor === main.anchor && head === main.head) return tr;
  return [tr, { selection: EditorSelection.single(anchor, head), sequential: true }];
});

function deleteVisible(view: EditorView, direction: number): boolean {
  if (!view.state.selection.main.empty || view.compositionStarted) return false;
  const parts = parseMarkdownParts(view.state.doc.toString());
  let head = view.state.selection.main.head;
  let delimiter;
  while ((delimiter = parts.find((p) => p.hidden && (direction < 0 ? p.to === head : p.from === head))) !== undefined) {
    head = direction < 0 ? delimiter.from : delimiter.to;
  }
  if (head === view.state.selection.main.head) return false;
  view.dispatch({ selection: { anchor: head } });
  return direction < 0 ? deleteCharBackward(view) : deleteCharForward(view);
}

export function markdownEnter(view: EditorView): boolean {
  const selection = view.state.selection.main;
  if (!selection.empty || view.compositionStarted) return false;
  const change = continueList(view.state.doc.toString(), selection.head);
  if (change === null) return false;
  view.dispatch({ changes: { from: change.from, to: change.to, insert: change.insert }, selection: { anchor: change.caret },
    annotations: Transaction.userEvent.of("input.list") });
  return true;
}

export function pairBold(view: EditorView, from: number, to: number, text: string): boolean {
  if (view.compositionStarted || from !== to || (text !== "*" && text !== "**")) return false;
  const source = view.state.doc.toString();
  const secondStar = text === "*" && source[from - 1] === "*" && source[from - 2] !== "*" && source[from] !== "*";
  if (text !== "**" && !secondStar) return false;
  const insert = secondStar ? "***" : "****";
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + (secondStar ? 1 : 2) },
    annotations: Transaction.userEvent.of("input.type") });
  return true;
}

export function markdownExtensions(options: {
  label: string;
  placeholder?: string;
  onChange: (source: string) => void;
  onSelection: (position: number) => void;
  onEditLink: (link: LinkEdit) => void;
  completeMention: () => boolean;
}): Extension[] {
  return [
    history(), markdownDecorations, visibleSelection, EditorView.lineWrapping,
    EditorView.contentAttributes.of({ "aria-label": options.label, "aria-multiline": "true", role: "textbox", spellcheck: "true" }),
    ...(options.placeholder === undefined ? [] : [placeholder(options.placeholder)]),
    EditorView.inputHandler.of(pairBold),
    keymap.of([
      { key: "Enter", run: markdownEnter },
      { key: "Backspace", run: (view) => deleteVisible(view, -1) },
      { key: "Delete", run: (view) => deleteVisible(view, 1) },
      { key: "Tab", run: options.completeMention },
      { key: "Mod-k", run: (view) => { const link = linkAt(view.state.doc.toString(), view.state.selection.main.head); if (!link) return false; options.onEditLink(link); return true; } },
      ...defaultKeymap, ...historyKeymap,
    ]),
    EditorView.domEventHandlers({
      click: (event) => {
        if (event.target instanceof Element && event.target.closest("a") && !event.metaKey && !event.ctrlKey) event.preventDefault();
        return false;
      },
      dblclick: (event, view) => {
        if (!(event.target instanceof Element)) return false;
        const target = event.target.closest("[data-link-from]");
        const from = target?.getAttribute("data-link-from");
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
    }),
  ];
}

