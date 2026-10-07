import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Bold, Code, Heading1, Heading2, Heading3, Italic, Link, List, ListOrdered, Minus, Quote, SquareCode, type LucideIcon } from "lucide-react";
import type { MetaUser } from "../api/types";
import { handle } from "../lib/mentions";
import { useLookup } from "../lib/lookup";
import { commands, formatLink, linkEditFor, markdownExtensions, type LinkEdit } from "./MarkdownEditor";
import { safeHref } from "./markdown";
import { renderLines, type RenderedLine, type Segment } from "./markdownLines";
import { formatsAt, type Formats } from "./markdownCommands";
import s from "./markdown.module.css";

const NO_FORMATS: Formats = { strong: false, em: false, code: false, link: false, quote: false, bullet: false, ordered: false, fence: false, heading: 0 };

function segment(part: Segment, i: number, users: MetaUser[], linkTextOnly: boolean): ReactNode {
  const classes = part.styles.map((style) => style === "code" ? s.inlineCode : s[style]);
  if (part.provider) classes.push(s.file);
  if (part.fallback) classes.push(s.fallback);
  const className = classes.join(" ") || undefined;
  if (part.styles.includes("link")) {
    return linkTextOnly || part.href === undefined
      ? <span key={i} className={className} title={part.href}>{part.text}</span>
      : <a key={i} className={className} href={part.href} target="_blank" rel="noopener noreferrer" title={part.href}>{part.text}</a>;
  }
  const title = part.styles.includes("mention") ? users.find((u) => handle(u.name) === handle(part.text.slice(1)))?.name : undefined;
  return className === undefined && title === undefined ? part.text : <span key={i} className={className} title={title}>{part.text}</span>;
}

export function MarkdownText({ value, className, linkTextOnly = false }: { value: string; className?: string; linkTextOnly?: boolean }) {
  const L = useLookup();
  const lines = useMemo(() => renderLines(value), [value]);
  const flat = lines.length === 1 && lines[0]?.kind === undefined;
  const body = (line: RenderedLine) => line.segments.map((part, i) => segment(part, i, L.meta.users, linkTextOnly));
  return (
    <span className={`${s.rendered} ${flat ? "" : s.block} ${className ?? ""}`}>
      {flat ? body(lines[0] ?? { segments: [] }) : lines.map((line, i) => (
        <span key={i} className={`${s.line} ${line.kind === undefined ? "" : s[line.kind]}`}
          {...(line.kind === "list" ? { style: { "--md-hang": line.segments[0]?.text.length ?? 2 } as React.CSSProperties } : {})}>
          {body(line)}
        </span>
      ))}
    </span>
  );
}

type ToolButton = { label: string; hint: string; icon: LucideIcon; pressed: (f: Formats) => boolean; run: (view: EditorView) => void };

export function MarkdownField({ value, onChange, label, placeholder, rows = 4 }: {
  value: string; onChange: (value: string) => void; label: string; placeholder?: string; rows?: number;
}) {
  const L = useLookup();
  const mount = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const syncing = useRef(false);
  const [caret, setCaret] = useState(0);
  const [formats, setFormats] = useState<Formats>(NO_FORMATS);
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
        onFormats: setFormats,
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
    setFormats(formatsAt(view.state));
    return () => { editor.current = null; view.destroy(); };
  }, [label, placeholder]);

  useEffect(() => {
    const view = editor.current;
    if (!view || view.state.doc.toString() === value) return;
    syncing.current = true;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value }, selection: { anchor: Math.min(view.state.selection.main.head, value.length) }, annotations: Transaction.addToHistory.of(false) });
    syncing.current = false;
  }, [value]);

  // Hedefi açmak ayrı, açık bir eylem: yalnız izinli şemalar (⌘/Ctrl+tık de aynı kuralı kullanır).
  const opened = linkEdit === null || linkEdit.url.trim() === "" || linkEdit.url === "https://" ? null : safeHref(linkEdit.url.trim());

  const applyLink = () => {
    const view = editor.current;
    if (!view || !linkEdit) return;
    const insert = formatLink(linkEdit.alias, linkEdit.url);
    view.dispatch({ changes: { from: linkEdit.from, to: linkEdit.to, insert },
      selection: { anchor: linkEdit.from + 1 + linkEdit.alias.replace(/\r?\n/g, " ").length }, annotations: Transaction.userEvent.of("input.link") });
    setLinkEdit(null);
    view.focus();
  };

  const groups: ToolButton[][] = [
    [
      { label: "Kalın", hint: "Kalın · ⌘/Ctrl+B", icon: Bold, pressed: (f) => f.strong, run: commands.inline("strong") },
      { label: "İtalik", hint: "İtalik · ⌘/Ctrl+I", icon: Italic, pressed: (f) => f.em, run: commands.inline("em") },
      { label: "Satır içi kod", hint: "Satır içi kod", icon: Code, pressed: (f) => f.code, run: commands.inline("code") },
    ],
    [
      { label: "Başlık 1", hint: "Başlık 1 · ⌘/Ctrl+Alt+1", icon: Heading1, pressed: (f) => f.heading === 1, run: commands.lines("h1") },
      { label: "Başlık 2", hint: "Başlık 2 · ⌘/Ctrl+Alt+2", icon: Heading2, pressed: (f) => f.heading === 2, run: commands.lines("h2") },
      { label: "Başlık 3", hint: "Başlık 3 · ⌘/Ctrl+Alt+3", icon: Heading3, pressed: (f) => f.heading === 3, run: commands.lines("h3") },
    ],
    [
      { label: "Bağlantı", hint: "Bağlantı · ⌘/Ctrl+K · Düzenle: çift tık", icon: Link, pressed: (f) => f.link, run: (view) => setLinkEdit(linkEditFor(view.state)) },
      { label: "Alıntı", hint: "Alıntı", icon: Quote, pressed: (f) => f.quote, run: commands.lines("quote") },
      { label: "Madde işaretli liste", hint: "Madde işaretli liste", icon: List, pressed: (f) => f.bullet, run: commands.lines("bullet") },
      { label: "Numaralı liste", hint: "Numaralı liste", icon: ListOrdered, pressed: (f) => f.ordered, run: commands.lines("ordered") },
      { label: "Kod bloğu", hint: "Kod bloğu", icon: SquareCode, pressed: (f) => f.fence, run: commands.codeBlock },
      { label: "Yatay çizgi", hint: "Yatay çizgi", icon: Minus, pressed: () => false, run: commands.rule },
    ],
  ];

  return (
    <div className={s.field}>
      <div className={s.toolbar} role="toolbar" aria-label="Metin biçimlendirme" onMouseDown={(e) => e.preventDefault()}>
        {groups.map((group, g) => (
          <span key={g} style={{ display: "contents" }}>
            {g > 0 && <span className={s.separator} aria-hidden="true" />}
            {group.map(({ label: name, hint, icon: Icon, pressed, run }) => (
              <button key={name} type="button" aria-label={name} title={hint} aria-pressed={pressed(formats)}
                onClick={() => { const view = editor.current; if (view) { run(view); view.focus(); } }}>
                <Icon size={15} aria-hidden="true" />
              </button>
            ))}
          </span>
        ))}
      </div>
      {linkEdit !== null && <div className={s.linkEditor} role="group" aria-label="Bağlantıyı düzenle" onKeyDown={(e) => {
        if (e.key === "Escape") { e.preventDefault(); setLinkEdit(null); editor.current?.focus(); }
        if (e.key === "Enter") { e.preventDefault(); applyLink(); }
      }}>
        <label>Ad<input aria-label="Bağlantı adı" value={linkEdit.alias} onChange={(e) => setLinkEdit({ ...linkEdit, alias: e.target.value })} autoFocus /></label>
        <label>Adres<input aria-label="Bağlantı adresi" value={linkEdit.url} onChange={(e) => setLinkEdit({ ...linkEdit, url: e.target.value })} /></label>
        {opened !== null && <a className={s.linkOpen} href={opened} target="_blank" rel="noopener noreferrer">Aç</a>}
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
