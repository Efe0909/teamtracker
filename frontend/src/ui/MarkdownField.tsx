import { useMemo, useRef, useState, type ReactNode } from "react";
import type { MetaUser } from "../api/types";
import { handle } from "../lib/mentions";
import { useLookup } from "../lib/lookup";
import s from "./markdown.module.css";

type Part = { text: string; hidden?: boolean; kind?: "strong" | "em" | "link" | "mention" | "quote" | "heading" | "list" | "rule"; href?: string };

function safeHref(raw: string): string | null {
  const normalized = raw.trim().replace(/[\u0000- \u007f]/g, "");
  return /^(?:javascript|data|vbscript|blob):/i.test(normalized) ? null : raw;
}

function inlineParts(text: string): Part[] {
  const out: Part[] = [];
  const token = /\[((?:\\.|[^\]\n])*)\]\(((?:\\.|[^()\n]|\([^()\n]*\))*)\)|(\*\*[^*\n]+\*\*|__[^_\n]+__)|(\*[^*\n]+\*|_[^_\n]+_)|@[\p{L}\p{N}_.-]+/gu;
  let at = 0;
  for (const m of text.matchAll(token)) {
    const i = m.index;
    if (i > at) out.push({ text: text.slice(at, i) });
    if (m[1] !== undefined && m[2] !== undefined) {
      const href = safeHref(m[2]);
      out.push({ text: m[0], hidden: true });
      const label = m[1] || m[2];
      out.push(href === null ? { text: label } : { text: label, kind: "link", href });
    } else if (m[3] !== undefined) {
      const value = m[0].slice(2, -2);
      out.push({ text: m[0], hidden: true }, { text: value, kind: "strong" });
    } else if (m[4] !== undefined) {
      out.push({ text: m[0][0] ?? "", hidden: true }, { text: m[0].slice(1, -1), kind: "em" }, { text: m[0].slice(-1), hidden: true });
    } else {
      out.push({ text: m[0], kind: "mention" });
    }
    at = i + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

export function parseMarkdownParts(text: string): Part[] {
  const out: Part[] = [];
  for (const [i, line] of text.split("\n").entries()) {
    const heading = /^(#{1,3})(\s+)(.+)$/.exec(line);
    const quote = /^(> ?)(.*)$/.exec(line);
    const rule = /^\s*(?:-{3,}|={3,})\s*$/.test(line);
    const list = /^(\s*)([-*+]\s+|\d+[.)]\s+)(?!\[[ x]\])/i.exec(line);
    if (i > 0) out.push({ text: "\n" });
    if (rule) {
      out.push({ text: line, hidden: true }, { text: "────────────", kind: "rule" });
    } else if (heading !== null) {
      out.push({ text: `${heading[1] ?? ""}${heading[2] ?? ""}`, hidden: true }, { text: heading[3] ?? "", kind: "heading" });
    } else if (quote !== null) {
      out.push({ text: quote[1] ?? "", hidden: true }, { text: quote[2] ?? "", kind: "quote" });
    } else if (list !== null) {
      const marker = list[2]?.trim() ?? "";
      out.push({ text: list[1] ?? "" }, { text: list[2] ?? "", hidden: true }, { text: /^\d/.test(marker) ? `${marker.replace(/[.)]$/, ".")} ` : "• ", kind: "list" });
      out.push(...inlineParts(line.slice(list[0].length)));
    } else {
      out.push(...inlineParts(line));
    }
  }
  return out;
}

function render(text: string, users: MetaUser[], linkTextOnly = false, preserveSyntax = false): ReactNode[] {
  return parseMarkdownParts(text).map((p, i) => {
    if (p.hidden) return preserveSyntax ? <span key={i} className={s.syntax}>{p.text}</span> : null;
    const title = p.kind === "mention" ? users.find((u) => handle(u.name) === handle(p.text.slice(1)))?.name : undefined;
    if (p.href !== undefined) return linkTextOnly
      ? <span key={i} className={s.link} title={p.href}>{p.text}</span>
      : <a key={i} className={s.link} href={p.href} target="_blank" rel="noopener noreferrer" title={p.href}>{p.text}</a>;
    return <span key={i} className={p.kind === undefined ? undefined : s[p.kind]} title={title}>{p.text}</span>;
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
  const input = useRef<HTMLTextAreaElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const [caret, setCaret] = useState(0);
  const partial = useMemo(() => {
    const m = /(?:^|\s)@([\p{L}\p{N}_.-]*)$/u.exec(value.slice(0, caret));
    return m?.[1];
  }, [caret, value]);
  const suggestions = partial === undefined ? [] : L.meta.users
    .filter((u) => u.id !== L.me.id && handle(u.name).startsWith(handle(partial)))
    .slice(0, 5);
  const replaceMention = (user: MetaUser) => {
    const start = value.slice(0, caret).search(/@[^\s@]*$/u);
    const next = value.slice(0, start) + `@${handle(user.name)} ` + value.slice(caret);
    onChange(next);
    const pos = start + handle(user.name).length + 2;
    setCaret(pos);
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(pos, pos); });
  };
  const insert = (before: string, after = "") => {
    const el = input.current;
    if (el === null) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = value.slice(start, end);
    const next = value.slice(0, start) + before + selected + after + value.slice(end);
    onChange(next);
    const pos = start + before.length + selected.length + (selected === "" ? 0 : after.length);
    setCaret(pos);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(pos, pos); });
  };
  const prefixLine = (prefix: string) => {
    const el = input.current;
    if (el === null) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    onChange(value.slice(0, lineStart) + prefix + value.slice(lineStart));
    const nextStart = start + prefix.length;
    setCaret(nextStart);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(nextStart, end + prefix.length); });
  };
  const insertLink = () => {
    const el = input.current;
    if (el === null) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const label = value.slice(start, end) || "isim";
    const link = `[${label}](https://)`;
    onChange(value.slice(0, start) + link + value.slice(end));
    const pos = start + label.length + 3 + "https://".length;
    setCaret(pos);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(pos, pos); });
  };
  return (
    <div className={s.field}>
      <div className={s.toolbar} role="toolbar" aria-label="Metin biçimlendirme">
        <button type="button" aria-label="Kalın" title="Kalın" onClick={() => insert("**", "**")}><b>B</b></button>
        <button type="button" aria-label="İtalik" title="İtalik" onClick={() => insert("*", "*")}><i>I</i></button>
        <button type="button" aria-label="Başlık biçimi" title="Başlık" onClick={() => prefixLine("### ")}>H</button>
        <button type="button" aria-label="Bağlantı" title="Bağlantı" onClick={insertLink}>↗</button>
        <button type="button" aria-label="Alıntı" title="Alıntı" onClick={() => prefixLine("> ")}>❯</button>
        <button type="button" aria-label="Madde işaretli liste" title="Madde işaretli liste" onClick={() => prefixLine("- ")}>•</button>
        <button type="button" aria-label="Numaralı liste" title="Numaralı liste" onClick={() => prefixLine("1. ")}>1.</button>
        <button type="button" aria-label="Yatay çizgi" title="Yatay çizgi" onClick={() => prefixLine("---\n")}>―</button>
      </div>
      <div className={s.input}>
        <div className={s.overlay} aria-hidden="true">
          <div ref={overlay} className={s.overlayContent}>{render(value, L.meta.users, false, true)}</div>
        </div>
        <textarea ref={input} aria-label={label} placeholder={placeholder} rows={rows} value={value}
          onChange={(e) => { onChange(e.target.value); setCaret(e.target.selectionStart); }}
          onScroll={(e) => { if (overlay.current !== null) overlay.current.style.transform = `translate(${-e.currentTarget.scrollLeft}px, ${-e.currentTarget.scrollTop}px)`; }}
          onClick={(e) => setCaret(e.currentTarget.selectionStart)} onKeyUp={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={(e) => { if (e.key === "Tab" && suggestions[0]) { e.preventDefault(); replaceMention(suggestions[0]); } }} />
        {suggestions.length > 0 && <ul className={s.suggestions} role="listbox" aria-label="Kişi önerileri">
          {suggestions.map((u) => <li key={u.id}><button type="button" role="option" onMouseDown={(e) => e.preventDefault()} onClick={() => replaceMention(u)}>{u.name}</button></li>)}
        </ul>}
      </div>
    </div>
  );
}
