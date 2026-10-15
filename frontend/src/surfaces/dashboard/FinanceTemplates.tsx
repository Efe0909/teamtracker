// Maliye > Mail sablonlari (spec/81 §9): .html / .md yukle, onizle, degiskenleri doldur,
// "mail olarak kopyala". Degiskenler govdeden okunur: {{ad:tur}} (metin, para, tarih,
// matris). Cizim istemcide; HTML izinli etiket listesine indirgenir ve betiksiz
// `iframe sandbox` + `srcdoc` icinde gosterilir. Uygulama mail GONDERMEZ.

import { useMemo, useRef, useState } from "react";
import { errorText } from "../../api/client";
import { useTemplates, useTemplateWrite } from "../../api/hooks";
import type { MailTemplate } from "../../api/types";
import { navigate } from "../../lib/router";
import { Button, cx, Link, Loading, ui, useToast } from "../../ui/ui";
import { MarkdownText } from "../../ui/MarkdownField";
import { fin } from "./Finance";
import s from "./fin.module.css";

type Kind = "metin" | "para" | "tarih" | "matris";
interface Col { name: string; kind: Kind }
interface Variable { name: string; kind: Kind; opts: Record<string, string>; cols: Col[] }

const KINDS: readonly string[] = ["metin", "para", "tarih", "matris"];
const TOKEN = /\{\{\s*([A-Za-z0-9_]+)\s*(?::\s*([A-Za-zçğıöşüÇĞİÖŞÜ]+))?\s*(?:\(([^)]*)\))?\s*\}\}/g;
const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const ALLOWED = new Set(["p", "br", "b", "strong", "i", "em", "u", "a", "ul", "ol", "li", "table", "thead", "tbody", "tr", "th", "td", "h1", "h2", "h3", "h4", "span", "div"]);

function kindOf(raw: string | undefined): Kind {
  return raw !== undefined && KINDS.includes(raw) ? (raw as Kind) : "metin";
}

function parseVar(name: string, rawKind: string | undefined, args: string | undefined): Variable {
  const kind = kindOf(rawKind);
  const opts: Record<string, string> = {};
  const cols: Col[] = [];
  for (const part of (args ?? "").split(",").map((x) => x.trim()).filter((x) => x !== "")) {
    if (kind === "matris") {
      const [n = "", k] = part.split(":").map((x) => x.trim());
      cols.push({ name: n, kind: kindOf(k) });
    } else {
      const [k = "", v = ""] = part.split("=").map((x) => x.trim());
      opts[k] = v;
    }
  }
  return { name, kind, opts, cols };
}

/** Govdedeki degiskenler (ilk gecis kazanir) ve turu celisenler. */
export function readVariables(body: string): { vars: Variable[]; conflicts: string[] } {
  const vars = new Map<string, Variable>();
  const conflicts = new Set<string>();
  for (const m of body.matchAll(TOKEN)) {
    const v = parseVar(m[1] ?? "", m[2], m[3]);
    const prev = vars.get(v.name);
    if (prev === undefined) vars.set(v.name, v);
    else if (prev.kind !== v.kind) conflicts.add(v.name);
  }
  return { vars: [...vars.values()], conflicts: [...conflicts] };
}

function esc(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtMoney(raw: string, opts: Record<string, string>): string {
  const n = Number(raw.replace(/\./g, "").replace(",", "."));
  if (raw.trim() === "" || !Number.isFinite(n)) return "";
  const digits = opts["biçim"] === "yuvarlak" ? 0 : 2;
  const unit = opts["birim"] ?? "₺";
  return `${n.toLocaleString("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${unit}`;
}

function fmtDate(raw: string, opts: Record<string, string>): string {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(raw);
  if (m === null) return raw;
  const month = MONTHS[Number(m[2]) - 1] ?? "";
  return opts["biçim"] === "gün" && m[3] !== undefined ? `${Number(m[3])} ${month} ${m[1]}` : `${month} ${m[1]}`;
}

function cell(kind: Kind, raw: string, opts: Record<string, string>): string {
  return kind === "para" ? fmtMoney(raw, opts) : kind === "tarih" ? fmtDate(raw, opts) : raw;
}

/** Degiskenleri doldurur. HTML'de degerler kacislanir; MD'de boru tablosu. */
export function fill(body: string, format: "html" | "md", values: Record<string, string>, rows: Record<string, string[][]>): string {
  return body.replace(TOKEN, (_all, name: string, k: string | undefined, args: string | undefined) => {
    const v = parseVar(name, k, args);
    const { kind, opts } = v;
    const out = (t: string) => (format === "html" ? esc(t) : t);
    if (kind === "matris") {
      const cols = v.cols;
      const data = rows[name] ?? [];
      if (format === "html") {
        const head = cols.map((c) => `<th>${esc(c.name)}</th>`).join("");
        const body = data.map((r) => `<tr>${cols.map((c, i) => `<td>${esc(cell(c.kind, r[i] ?? "", {}))}</td>`).join("")}</tr>`).join("");
        return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
      }
      const line = (xs: string[]) => `| ${xs.map((x) => x.replace(/\|/g, "\\|")).join(" | ")} |`;
      return [line(cols.map((c) => c.name)), line(cols.map(() => "---")),
        ...data.map((r) => line(cols.map((c, i) => cell(c.kind, r[i] ?? "", {}))))].join("\n");
    }
    return out(cell(kind, values[name] ?? "", opts));
  });
}

/** Izinli etiket listesine indirger; stil ve olay oznitelikleri atilir. */
export function sanitize(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out = document.createElement("div");
  const walk = (src: Node, dst: Node) => {
    src.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) {
        dst.appendChild(document.createTextNode(n.textContent ?? ""));
      } else if (n instanceof Element) {
        const tag = n.tagName.toLowerCase();
        if (tag === "script" || tag === "style" || tag === "iframe" || tag === "object") return;
        if (!ALLOWED.has(tag)) { walk(n, dst); return; }
        const el = document.createElement(tag);
        if (tag === "a") {
          const h = n.getAttribute("href") ?? "";
          if (/^(https?:|mailto:)/i.test(h)) {
            el.setAttribute("href", h);
            el.setAttribute("rel", "noopener noreferrer");
            el.setAttribute("target", "_blank");
          }
        }
        if (tag === "td" || tag === "th") {
          for (const a of ["colspan", "rowspan"]) {
            const v = n.getAttribute(a);
            if (v !== null && /^\d{1,2}$/.test(v)) el.setAttribute(a, v);
          }
        }
        walk(n, el);
        dst.appendChild(el);
      }
    });
  };
  walk(doc.body, out);
  return out.innerHTML;
}

export function FinanceTemplates({ id }: { id: string | null }) {
  const q = useTemplates();
  const w = useTemplateWrite();
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const fail = (e: unknown) => toast({ text: errorText(e), error: true });

  const upload = async (f: File) => {
    const lower = f.name.toLowerCase();
    const format = lower.endsWith(".md") || lower.endsWith(".markdown") ? "md" : lower.endsWith(".html") || lower.endsWith(".htm") ? "html" : null;
    if (format === null) return toast({ text: "Yalnız .html ya da .md şablon yüklenir.", error: true });
    if (f.size > 262_144) return toast({ text: "Şablon en fazla 256 KB olabilir.", error: true });
    const body = await f.text();
    const name = f.name.replace(/\.[^.]+$/, "").slice(0, 120);
    w.mutate({ op: "save", id: null, name, format, body }, {
      onSuccess: (t) => { navigate(fin("templates", (t as MailTemplate).id)); toast({ text: "Şablon yüklendi", error: false }); },
      onError: fail,
    });
  };

  const selected = q.data?.find((t) => t.id === id) ?? null;
  return (
    <div className={s.split}>
      <div className={s.panel}>
        <div className={s.ph}>
          <h2>Şablonlar</h2>
          <span className={s.grow} />
          <input ref={file} type="file" hidden accept=".html,.htm,.md,.markdown"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f !== undefined) void upload(f); }} />
          <Button size="sm" variant="primary" disabled={w.isPending} onClick={() => file.current?.click()}>Yükle</Button>
        </div>
        {q.data === undefined ? <Loading /> : q.data.length === 0 ? (
          <div className={s.empty}>Henüz şablon yok. SEB'e giden mailin taslağını .html ya da .md olarak yükle; <code>{"{{toplam:para}}"}</code> gibi alanlar forma dönüşür.</div>
        ) : (
          <div className={s.list}>
            {q.data.map((t) => (
              <Link key={t.id} href={fin("templates", t.id)} className={cx(s.row, s.rInv)} aria-current={t.id === id ? "page" : undefined}>
                <span className={s.t}><b>{t.name}</b><span>{t.format === "md" ? "Markdown" : "HTML"} · {readVariables(t.body).vars.length} alan</span></span>
              </Link>
            ))}
          </div>
        )}
      </div>
      {selected !== null ? <TemplatePanel key={selected.id + selected.updated_at} t={selected} /> : (
        <div className={s.panel}><div className={s.empty}>Önizleme için bir şablon seç.</div></div>
      )}
    </div>
  );
}

function TemplatePanel({ t }: { t: MailTemplate }) {
  const toast = useToast();
  const w = useTemplateWrite();
  const preview = useRef<HTMLDivElement>(null);
  const { vars, conflicts } = useMemo(() => readVariables(t.body), [t.body]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<Record<string, string[][]>>({});
  const [source, setSource] = useState(t.body);
  const [name, setName] = useState(t.name);
  const fail = (e: unknown) => toast({ text: errorText(e), error: true });

  // `Konu:` ilk satiri mailin konusu olur; govdeden cikarilir.
  const subjectRe = /^\s*Konu:[ \t]*(.+)\r?\n/i;
  const sm = subjectRe.exec(t.body);
  const bodySrc = sm === null ? t.body : t.body.replace(subjectRe, "");
  const subject = sm === null ? null : fill(sm[1] ?? "", "md", values, rows);
  const filled = fill(bodySrc, t.format, values, rows);
  const safe = t.format === "html" ? sanitize(filled) : null;

  const copy = async () => {
    const html = safe ?? preview.current?.innerHTML ?? "";
    const plain = safe !== null
      ? new DOMParser().parseFromString(safe, "text/html").body.textContent ?? ""
      : filled;
    try {
      if (typeof ClipboardItem !== "undefined") {
        await navigator.clipboard.write([new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        })]);
      } else {
        await navigator.clipboard.writeText(plain);
      }
      toast({ text: "Mail olarak kopyalandı; mail uygulamasına yapıştır.", error: false });
    } catch {
      toast({ text: "Panoya yazılamadı. Tarayıcı izni gerekebilir.", error: true });
    }
  };

  return (
    <div className={s.panel}>
      <div className={s.ph}>
        <h2>{t.name}</h2>
        <span className={s.grow} />
        <Button size="sm" variant="primary" onClick={() => void copy()}>Mail olarak kopyala</Button>
      </div>
      <div className={s.pb}>
        {conflicts.length > 0 && (
          <div className={cx(s.callout, s.calloutWarn)}>
            Aynı alan farklı türde geçiyor ({conflicts.join(", ")}); ilk geçişin türü kullanılır.
          </div>
        )}
        {vars.length === 0 ? (
          <p className={s.sub}>Bu şablonda doldurulacak alan yok; olduğu gibi kopyalanır.</p>
        ) : (
          <div className={s.tplFields}>
            {vars.map((v) => v.kind === "matris" ? (
              <MatrixField key={v.name} v={v} rows={rows[v.name] ?? []}
                onChange={(r) => setRows({ ...rows, [v.name]: r })} />
            ) : (
              <label key={v.name} className={ui.field}>
                <span>{v.name.replace(/_/g, " ")} <small className={s.dim}>{v.kind}</small></span>
                <input className={ui.input} value={values[v.name] ?? ""}
                  type={v.kind === "tarih" ? (v.opts["biçim"] === "gün" ? "date" : "month") : "text"}
                  inputMode={v.kind === "para" ? "decimal" : undefined}
                  onChange={(e) => setValues({ ...values, [v.name]: e.target.value })} />
              </label>
            ))}
          </div>
        )}
        {subject !== null && <p className={s.tplSubject}><span className={s.dim}>Konu</span> {subject}</p>}
        <div className={s.tplPreview} ref={preview}>
          {safe !== null
            ? <iframe title="Şablon önizlemesi" sandbox="" srcDoc={safe} className={s.tplFrame} />
            : <MarkdownText value={filled} />}
        </div>
        <details>
          <summary>Şablon kaynağı</summary>
          <div className={s.tplSource}>
            <input className={ui.input} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} aria-label="Şablon adı" />
            <textarea className={ui.input} rows={10} value={source} onChange={(e) => setSource(e.target.value)} spellCheck={false} />
            <div className={ui.dact}>
              <Button variant="ghost" disabled={w.isPending}
                onClick={() => w.mutate({ op: "delete", id: t.id }, { onSuccess: () => navigate(fin("templates")), onError: fail })}>Sil</Button>
              <Button variant="primary" disabled={w.isPending || (source === t.body && name === t.name)}
                onClick={() => w.mutate({ op: "save", id: t.id, name: name.trim(), format: t.format, body: source }, {
                  onSuccess: () => toast({ text: "Kaydedildi", error: false }), onError: fail })}>Kaydet</Button>
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}

function MatrixField({ v, rows, onChange }: { v: Variable; rows: string[][]; onChange: (r: string[][]) => void }) {
  const cols = v.cols;
  const set = (r: number, c: number, val: string) =>
    onChange(rows.map((row, i) => (i === r ? cols.map((_, j) => (j === c ? val : row[j] ?? "")) : row)));
  return (
    <div className={ui.field}>
      <span>{v.name.replace(/_/g, " ")} <small className={s.dim}>tablo</small></span>
      <div className={s.tplMatrix} style={{ gridTemplateColumns: `repeat(${Math.max(cols.length, 1)}, minmax(0, 1fr)) auto` }}>
        {cols.map((c) => <b key={c.name} className={s.dim}>{c.name}</b>)}
        <span />
        {rows.map((r, i) => (
          <MatrixRow key={i} cols={cols} row={r} onCell={(c, val) => set(i, c, val)}
            onDrop={() => onChange(rows.filter((_, j) => j !== i))} />
        ))}
      </div>
      <Button type="button" size="sm" variant="ghost" onClick={() => onChange([...rows, cols.map(() => "")])}>Satır ekle</Button>
    </div>
  );
}

function MatrixRow({ cols, row, onCell, onDrop }: { cols: Col[]; row: string[]; onCell: (c: number, v: string) => void; onDrop: () => void }) {
  return (
    <>
      {cols.map((c, j) => (
        <input key={c.name} className={ui.input} aria-label={c.name} value={row[j] ?? ""}
          inputMode={c.kind === "para" ? "decimal" : undefined}
          type={c.kind === "tarih" ? "date" : "text"} onChange={(e) => onCell(j, e.target.value)} />
      ))}
      <button type="button" className={s.rowX} aria-label="Satırı sil" onClick={onDrop}>×</button>
    </>
  );
}
