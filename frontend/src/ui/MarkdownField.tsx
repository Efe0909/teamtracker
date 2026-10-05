import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { FileText } from "lucide-react";
import type { MetaUser } from "../api/types";
import { handle } from "../lib/mentions";
import { useLookup } from "../lib/lookup";
import { parseMarkdownParts, visiblePosition } from "./markdown";
import { linkAt, markdownExtensions, type LinkEdit } from "./MarkdownEditor";
import s from "./markdown.module.css";
export { parseMarkdownParts } from "./markdown";

function render(text: string, users: MetaUser[], linkTextOnly: boolean): ReactNode[] {
  return parseMarkdownParts(text).map((part, i) => {
    if (part.hidden) return null;
    const title = part.kind === "mention" ? users.find((u) => handle(u.name) === handle(part.text.slice(1)))?.name : undefined;
    if (part.kind === "link") {
      const className = `${s.link} ${part.provider && !part.fallback ? s.file : ""} ${part.fallback ? s.fallback : ""}`;
      const content = <>{part.provider && !part.fallback && <FileText size={14} aria-hidden="true" />}{part.text}</>;
      return linkTextOnly || part.href === undefined
        ? <span key={i} className={className} title={part.href}>{content}</span>
        : <a key={i} className={className} href={part.href} target="_blank" rel="noopener noreferrer" title={part.href}>{content}</a>;
    }
    return <span key={i} className={part.kind === undefined ? undefined : s[part.kind]} title={title}>{part.text}</span>;
  });
}

export function MarkdownText({ value, className, linkTextOnly = false }: { value: string; className?: string; linkTextOnly?: boolean }) {
  const L = useLookup();
  return <span className={`${s.rendered} ${className ?? ""}`}>{render(value, L.meta.users, linkTextOnly)}</span>;
}

export function MarkdownField({ value, onChange, label, placeholder, rows = 4 }: {
  value: string; onChange: (value: string) => void; label: string; placeholder?: string; rows?: number;
}) {
  const L = useLookup();
  const mount = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const syncing = useRef(false);
  const [caret, setCaret] = useState(0);
  const [linkEdit, setLinkEdit] = useState<LinkEdit | null>(null);
  const latest = useRef({ value, onChange, L });
  latest.current = { value, onChange, L };
  const partial = useMemo(() => /(?:^|\s)@([\p{L}\p{N}_.-]*)$/u.exec(value.slice(0, caret))?.[1], [caret, value]);
  const suggestions = partial === undefined ? [] : L.meta.users
    .filter((u) => u.id !== L.me.id && handle(u.name).startsWith(handle(partial))).slice(0, 5);

  const replaceMention = (user: MetaUser) => {
    const view = editor.current;
    if (view === null) return;
    const source = view.state.doc.toString();
    const end = view.state.selection.main.head;
    const start = source.slice(0, end).search(/@[^\s@]*$/u);
    if (start < 0) return;
    const insert = `@${handle(user.name)} `;
    view.dispatch({ changes: { from: start, to: end, insert }, selection: { anchor: start + insert.length }, annotations: Transaction.userEvent.of("input.complete") });
    view.focus();
  };

  useEffect(() => {
    if (mount.current === null) return;
    const view = new EditorView({ parent: mount.current, state: EditorState.create({
      doc: latest.current.value,
      extensions: markdownExtensions({
        label, ...(placeholder === undefined ? {} : { placeholder }),
        onChange: (source) => { if (!syncing.current) latest.current.onChange(source); setLinkEdit(null); },
        onSelection: setCaret,
        onEditLink: setLinkEdit,
        completeMention: () => {
          const source = view.state.doc.toString();
          const pos = view.state.selection.main.head;
          const query = /(?:^|\s)@([\p{L}\p{N}_.-]*)$/u.exec(source.slice(0, pos))?.[1];
          if (query === undefined) return false;
          const { L: lookup } = latest.current;
          const user = lookup.meta.users.find((u) => u.id !== lookup.me.id && handle(u.name).startsWith(handle(query)));
          if (!user) return false;
          replaceMention(user);
          return true;
        },
      }),
    }) });
    editor.current = view;
    return () => { editor.current = null; view.destroy(); };
  }, [label, placeholder]);

  useEffect(() => {
    const view = editor.current;
    if (!view || view.state.doc.toString() === value) return;
    syncing.current = true;
    const position = visiblePosition(parseMarkdownParts(value), Math.min(view.state.selection.main.head, value.length), 0);
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value }, selection: { anchor: position }, annotations: Transaction.addToHistory.of(false) });
    syncing.current = false;
  }, [value]);

  const insert = (before: string, after = "") => {
    const view = editor.current;
    if (view === null) return;
    const { from, to } = view.state.selection.main;
    const selected = view.state.sliceDoc(from, to);
    view.dispatch({ changes: { from, to, insert: before + selected + after },
      selection: { anchor: from + before.length + selected.length + (selected === "" ? 0 : after.length) },
      annotations: Transaction.userEvent.of("input.format") });
    view.focus();
  };
  const prefixLine = (prefix: string) => {
    const view = editor.current;
    if (view === null) return;
    const { from, to } = view.state.selection.main;
    const start = view.state.doc.lineAt(from).from;
    view.dispatch({ changes: { from: start, insert: prefix }, selection: { anchor: from + prefix.length, head: to + prefix.length }, annotations: Transaction.userEvent.of("input.format") });
    view.focus();
  };
  const editLink = () => {
    const view = editor.current;
    if (view === null) return;
    const { from, to, head } = view.state.selection.main;
    const existing = linkAt(view.state.doc.toString(), head);
    setLinkEdit(existing ?? { from, to, alias: view.state.sliceDoc(from, to), url: "https://" });
  };
  const applyLink = () => {
    const view = editor.current;
    if (!view || !linkEdit) return;
    const alias = linkEdit.alias.replace(/\r?\n/g, " ");
    const url = linkEdit.url.replace(/\r?\n/g, "");
    view.dispatch({ changes: { from: linkEdit.from, to: linkEdit.to, insert: `[${alias}](${url})` },
      selection: { anchor: linkEdit.from + 1 + alias.length }, annotations: Transaction.userEvent.of("input.link") });
    setLinkEdit(null);
    view.focus();
  };
  return (
    <div className={s.field}>
      <div className={s.toolbar} role="toolbar" aria-label="Metin biçimlendirme" onMouseDown={(e) => e.preventDefault()}>
        <button type="button" aria-label="Kalın" title="Kalın" onClick={() => insert("**", "**")}><b>B</b></button>
        <button type="button" aria-label="İtalik" title="İtalik" onClick={() => insert("*", "*")}><i>I</i></button>
        <button type="button" aria-label="Başlık biçimi" title="Başlık" onClick={() => prefixLine("### ")}>H</button>
        <button type="button" aria-label="Bağlantı" title="Bağlantı · Düzenle: çift tık / ⌘K" onClick={editLink}>↗</button>
        <button type="button" aria-label="Alıntı" title="Alıntı" onClick={() => prefixLine("> ")}>❯</button>
        <button type="button" aria-label="Madde işaretli liste" title="Madde işaretli liste" onClick={() => prefixLine("- ")}>•</button>
        <button type="button" aria-label="Numaralı liste" title="Numaralı liste" onClick={() => prefixLine("1. ")}>1.</button>
        <button type="button" aria-label="Yatay çizgi" title="Yatay çizgi" onClick={() => prefixLine("---\n")}>―</button>
      </div>
      {linkEdit !== null && <div className={s.linkEditor} role="group" aria-label="Bağlantıyı düzenle" onKeyDown={(e) => {
        if (e.key === "Escape") { e.preventDefault(); setLinkEdit(null); editor.current?.focus(); }
        if (e.key === "Enter") { e.preventDefault(); applyLink(); }
      }}>
        <label>Ad<input aria-label="Bağlantı adı" value={linkEdit.alias} onChange={(e) => setLinkEdit({ ...linkEdit, alias: e.target.value })} autoFocus /></label>
        <label>Adres<input aria-label="Bağlantı adresi" value={linkEdit.url} onChange={(e) => setLinkEdit({ ...linkEdit, url: e.target.value })} /></label>
        <button type="button" onClick={applyLink}>Uygula</button>
        <button type="button" onClick={() => { setLinkEdit(null); editor.current?.focus(); }}>Vazgeç</button>
      </div>}
      <div className={s.input}>
        <div ref={mount} className={s.editor} style={{ minHeight: `${Math.max(2, rows) * 1.55 + 1.2}em` }} />
        {suggestions.length > 0 && <ul className={s.suggestions} role="listbox" aria-label="Kişi önerileri">
          {suggestions.map((u) => <li key={u.id}><button type="button" role="option" onMouseDown={(e) => e.preventDefault()} onClick={() => replaceMention(u)}>{u.name}</button></li>)}
        </ul>}
      </div>
    </div>
  );
}
