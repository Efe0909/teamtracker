// Maliye > Mail sablonlari (spec/81 §9): .html / .md yukle, onizle, degiskenleri doldur,
// "mail olarak kopyala". Degiskenler govdeden okunur: {{ad:tur}} (metin, para, tarih,
// matris). Cizim istemcide; HTML izinli etiket listesine indirgenir ve betiksiz
// `iframe sandbox` + `srcdoc` icinde gosterilir. Uygulama mail GONDERMEZ.

import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { errorText } from "../../api/client";
import { useClaim, useClaims, useTemplates, useTemplateWrite } from "../../api/hooks";
import type { MailTemplate } from "../../api/types";
import { navigate } from "../../lib/router";
import { useLookup } from "../../lib/lookup";
import { useTheme } from "../../lib/theme";
import { Button, cx, Dialog, Link, Loading, Picker, ui, useToast } from "../../ui/ui";
import { MarkdownText } from "../../ui/MarkdownField";
import { fin } from "./Finance";
import { claimTitle } from "./FinanceClaims";
import { useFinancePeriod } from "./FinancePeriod";
import p from "./financePages.module.css";
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

function fmtMoney(raw: string, opts: Record<string, string>, currency?: string): string {
  const n = Number(raw.replace(/\./g, "").replace(",", "."));
  if (raw.trim() === "" || !Number.isFinite(n)) return "";
  const digits = opts["biçim"] === "yuvarlak" ? 0 : 2;
  const unit = currency ?? opts["birim"] ?? "₺";
  return `${n.toLocaleString("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${unit}`;
}

function fmtDate(raw: string, opts: Record<string, string>): string {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(raw);
  if (m === null) return raw;
  const month = MONTHS[Number(m[2]) - 1] ?? "";
  return opts["biçim"] === "gün" && m[3] !== undefined ? `${Number(m[3])} ${month} ${m[1]}` : `${month} ${m[1]}`;
}

function cell(kind: Kind, raw: string, opts: Record<string, string>, currency?: string): string {
  return kind === "para" ? fmtMoney(raw, opts, currency) : kind === "tarih" ? fmtDate(raw, opts) : raw;
}

/** Degiskenleri doldurur. HTML'de degerler kacislanir; MD'de boru tablosu. */
export function fill(body: string, format: "html" | "md", values: Record<string, string>, rows: Record<string, string[][]>, currencies: Record<string, string> = {}): string {
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
    return out(cell(kind, values[name] ?? "", opts, currencies[name]));
  });
}

/** Ortak Markdown cizicisi tablo desteklemez; matrisler mailde gercek tablo olur. */
export function TemplatePreview({ body, values, rows, currencies }: {
  body: string; values: Record<string, string>; rows: Record<string, string[][]>; currencies: Record<string, string>;
}) {
  const blocks: ReactNode[] = [];
  let cursor = 0;
  for (const match of body.matchAll(TOKEN)) {
    const variable = parseVar(match[1] ?? "", match[2], match[3]);
    if (variable.kind !== "matris") continue;
    const before = body.slice(cursor, match.index);
    if (before.trim() !== "") blocks.push(<MarkdownText key={`text-${match.index}`} value={fill(before, "md", values, rows, currencies)} />);
    blocks.push(
      <table key={`matrix-${match.index}`} className={p.previewTable} aria-label={variable.name}>
        <thead><tr>{variable.cols.map((col, index) => <th key={index} scope="col">{col.name}</th>)}</tr></thead>
        <tbody>{(rows[variable.name] ?? []).map((row, index) => <tr key={index}>
          {variable.cols.map((col, column) => <td key={column} data-money={col.kind === "para"}>{cell(col.kind, row[column] ?? "", {})}</td>)}
        </tr>)}</tbody>
      </table>,
    );
    cursor = match.index + match[0].length;
  }
  const after = body.slice(cursor);
  if (after.trim() !== "") blocks.push(<MarkdownText key="remaining" value={fill(after, "md", values, rows, currencies)} />);
  return <>{blocks}</>;
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
  const [dragging, setDragging] = useState(false);
  const claimId = new URLSearchParams(location.search).get("claim");
  const templateHref = (templateId: string) => fin("templates", templateId) + (claimId === null ? "" : `?claim=${encodeURIComponent(claimId)}`);
  const fail = (e: unknown) => toast({ text: errorText(e), error: true });

  const upload = async (f: File) => {
    const lower = f.name.toLowerCase();
    const format = lower.endsWith(".md") || lower.endsWith(".markdown") ? "md" : lower.endsWith(".html") || lower.endsWith(".htm") ? "html" : null;
    if (format === null) return toast({ text: "Yalnız .html ya da .md şablon yüklenir.", error: true });
    if (f.size > 262_144) return toast({ text: "Şablon en fazla 256 KB olabilir.", error: true });
    const body = await f.text();
    const name = f.name.replace(/\.[^.]+$/, "").slice(0, 120);
    w.mutate({ op: "save", id: null, name, format, body }, {
      onSuccess: (t) => { navigate(templateHref((t as MailTemplate).id)); toast({ text: "Şablon yüklendi", error: false }); },
      onError: fail,
    });
  };

  const selected = (id === null ? q.data?.[0] : q.data?.find((t) => t.id === id)) ?? null;
  return (
    <div className={p.templatesLayout}>
      <div className={s.panel}>
        <div className={s.ph}>
          <h2>Taslaklar</h2>
          <span className={s.grow} />
          <input ref={file} type="file" hidden accept=".html,.htm,.md,.markdown"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f !== undefined) void upload(f); }} />
          <Button size="sm" variant="primary" disabled={w.isPending} onClick={() => file.current?.click()}>Yükle</Button>
        </div>
        {q.error !== null ? <div role="alert" className={s.empty}>{errorText(q.error)}</div> : q.data === undefined ? <Loading /> : q.data.length === 0 ? (
          <div className={s.empty}>Henüz şablon yok. SEB'e giden mailin taslağını .html ya da .md olarak yükle; <code>{"{{toplam:para}}"}</code> gibi alanlar forma dönüşür.</div>
        ) : (
          <div className={s.list}>
            {q.data.map((t) => (
              <Link key={t.id} href={templateHref(t.id)} className={cx(s.row, p.fileRow)} aria-current={t.id === selected?.id ? "page" : undefined}>
                <span className={s.t}><b>{t.name}</b><span>{t.format === "md" ? "Markdown" : "HTML"} · {readVariables(t.body).vars.length} değişken</span></span>
              </Link>
            ))}
          </div>
        )}
        <button type="button" className={p.dropzone} data-dragging={dragging} disabled={w.isPending}
          onClick={() => file.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault(); setDragging(false);
            const dropped = e.dataTransfer.files[0];
            if (dropped !== undefined && !w.isPending) void upload(dropped);
          }}>
          Taslağı buraya bırak. .html ve .md dosyaları kabul edilir.
        </button>
      </div>
      {selected !== null ? <TemplatePanel key={selected.id + selected.updated_at + (claimId ?? "")} t={selected} claimId={claimId} /> : (
        <div className={s.panel}><div className={s.empty}>Önizleme için bir şablon seç.</div></div>
      )}
    </div>
  );
}

function TemplatePanel({ t, claimId }: { t: MailTemplate; claimId: string | null }) {
  const L = useLookup();
  const period = useFinancePeriod();
  const theme = useTheme();
  const fieldId = useId();
  const toast = useToast();
  const w = useTemplateWrite();
  const preview = useRef<HTMLDivElement>(null);
  const { vars, conflicts } = useMemo(() => readVariables(t.body), [t.body]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<Record<string, string[][]>>({});
  const [currencies, setCurrencies] = useState<Record<string, string>>({});
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(claimId);
  const [excelOpen, setExcelOpen] = useState(false);
  const claims = useClaims();
  const context = useClaim(selectedClaimId);
  const [source, setSource] = useState(t.body);
  const [name, setName] = useState(t.name);
  const fail = (e: unknown) => toast({ text: errorText(e), error: true });

  // Dosyadan yalniz bilinen degerler onerilir; kullanicinin yazdiklari ustun gelir.
  const contextDay = context.data?.claim.month ?? context.data?.invoices[0]?.purchased_on
    ?? period?.from ?? new Date().toLocaleDateString("en-CA");
  const contextMonth = contextDay.slice(0, 7);
  const defaults: Record<string, string> = {};
  const defaultRows: Record<string, string[][]> = {};
  for (const variable of vars) {
    if (["total", "toplam"].includes(variable.name) && context.data !== undefined) {
      defaults[variable.name] = String(context.data.claim.seb_total).replace(".", ",");
    } else if (["period", "month", "donem", "ay"].includes(variable.name)) {
      defaults[variable.name] = variable.kind === "tarih"
        ? variable.opts["biçim"] === "gün" ? contextDay : contextMonth : period?.name ?? "";
    } else if (["event_name", "etkinlik"].includes(variable.name)) {
      defaults[variable.name] = context.data?.claim.event_title ?? "";
    } else if (variable.name === "sender_name") {
      defaults[variable.name] = L.user(L.me.id)?.name ?? "";
    }
    if (variable.kind === "matris" && context.data !== undefined
      && variable.cols.some((col) => ["kişi", "person", "member"].includes(col.name.toLocaleLowerCase("tr")))) {
      const firstText = variable.cols.find((col) => col.kind === "metin");
      defaultRows[variable.name] = context.data.people.map((person) => variable.cols.map((col) =>
        col.kind === "para" ? String(person.amount).replace(".", ",")
          : col.kind === "tarih" ? contextDay
          : col === firstText ? person.user_id === null ? "Kulüp kasası" : L.user(person.user_id)?.name ?? ""
          : "SEB iadesi"));
    }
  }
  const filledValues = { ...defaults, ...values };
  const filledRows = { ...defaultRows, ...rows };

  // `Konu:` ilk satiri mailin konusu olur; govdeden cikarilir.
  const subjectRe = /^\s*Konu:[ \t]*(.+)\r?\n/i;
  const sm = subjectRe.exec(t.body);
  const bodySrc = sm === null ? t.body : t.body.replace(subjectRe, "");
  const subject = sm === null ? null : fill(sm[1] ?? "", "md", filledValues, filledRows, currencies);
  const filled = fill(bodySrc, t.format, filledValues, filledRows, currencies);
  const safe = t.format === "html" ? sanitize(filled) : null;
  const rootStyle = getComputedStyle(document.documentElement);
  const previewDoc = safe === null ? "" : `<!doctype html><html style="color-scheme:${theme === "system" ? "light dark" : theme}"><meta charset="utf-8"><style>
    :root { --text: ${rootStyle.getPropertyValue("--txt")}; --line: ${rootStyle.getPropertyValue("--line")}; }
    body { margin: 0; color: var(--text); font: 14px/1.65 ${getComputedStyle(document.body).fontFamily}; }
    table { width: 100%; border-collapse: collapse; } th, td { padding: 8px 4px; border-bottom: 1px solid var(--line); text-align: left; }
    a { color: inherit; } p:first-child { margin-top: 0; }
    </style><body>${safe}</body></html>`;

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
      <div className={p.templateHeader}>
        <div className={p.templateTop}>
          <h2>{t.name}</h2>
          <span className={s.tag}>{t.format === "html" ? "HTML" : "Markdown"}</span>
          <span className={s.sub}>{vars.length} değişken bulundu</span>
          <span className={s.grow} />
          <Button size="sm" onClick={() => setExcelOpen(true)}>Excel ekini hazırla</Button>
        </div>
        <div className={p.templateTop}>
          <Button size="sm" variant="primary" onClick={() => void copy()}>Mail olarak kopyala</Button>
          {context.data !== undefined && <span className={s.sub}>{claimTitle(context.data.claim)}</span>}
        </div>
      </div>
      <div className={p.templateBody}>
        {context.error !== null && <div role="alert" className={s.callout}>{errorText(context.error)}</div>}
        {conflicts.length > 0 && (
          <div className={cx(s.callout, s.calloutWarn)}>
            Aynı alan farklı türde geçiyor ({conflicts.join(", ")}); ilk geçişin türü kullanılır.
          </div>
        )}
        <div className={p.templateColumns}>
          <section aria-label="Önizleme">
            <h3 className={p.sectionTitle}>Önizleme</h3>
            <div className={p.previewSurface}>
              {subject !== null && <p className={p.previewSubject}><span className={s.sub}>Konu</span><b>{subject}</b></p>}
              <div ref={preview}>
                {safe !== null
                  ? <iframe title="Şablon önizlemesi" sandbox="" srcDoc={previewDoc} className={s.tplFrame} />
                  : <TemplatePreview body={bodySrc} values={filledValues} rows={filledRows} currencies={currencies} />}
              </div>
            </div>
          </section>
          <section aria-label="Değişkenler">
            <h3 className={p.sectionTitle}>Değişkenler</h3>
            {vars.length === 0 ? <p className={s.sub}>Bu taslakta doldurulacak alan yok.</p> : (
              <div className={p.variables}>
                {vars.map((variable) => {
                  if (variable.kind === "matris") return (
                    <MatrixField key={variable.name} v={variable} rows={filledRows[variable.name] ?? []}
                      onChange={(next) => setRows({ ...rows, [variable.name]: next })} />
                  );
                  const input = <input id={`${fieldId}-${variable.name}`} className={ui.input} value={filledValues[variable.name] ?? ""}
                    type={variable.kind === "tarih" ? variable.opts["biçim"] === "gün" ? "date" : "month" : "text"}
                    inputMode={variable.kind === "para" ? "decimal" : undefined}
                    onChange={(e) => setValues({ ...values, [variable.name]: e.target.value })} />;
                  return (
                    <div key={variable.name} className={p.variable}>
                      <label className={p.fieldHeader} htmlFor={`${fieldId}-${variable.name}`}>
                        <span className={p.fieldName}>{variable.name}</span><span className={s.tag}>{variable.kind}</span>
                      </label>
                      {variable.kind === "para" ? <div className={p.moneyField}>{input}
                        <Picker label={`${variable.name} birimi`} value={currencies[variable.name] ?? variable.opts["birim"] ?? "₺"}
                          onChange={(unit) => setCurrencies({ ...currencies, [variable.name]: unit })}
                          options={[...new Set([variable.opts["birim"] ?? "₺", "₺", "USD", "EUR"])].map((unit) => ({ value: unit, label: unit }))} />
                      </div> : input}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
        <details className={p.templateSource}>
          <summary>Taslak kaynağı</summary>
          <div className={s.tplSource}>
            <input className={ui.input} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} aria-label="Şablon adı" />
            <textarea className={ui.input} rows={10} value={source} onChange={(e) => setSource(e.target.value)} spellCheck={false} aria-label="Taslak kaynağı" />
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
      <Dialog open={excelOpen} onClose={() => setExcelOpen(false)} title="Excel eki için iade dosyası seç">
        <div className={ui.formStack}>
          {claims.error !== null ? <p role="alert">{errorText(claims.error)}</p> : claims.data === undefined ? <Loading /> : claims.data.length === 0
            ? <p>Önce SEB iadeleri ekranından bir dosya aç.</p> : (
              <Picker label="İade dosyası" value={selectedClaimId ?? ""} search
                onChange={(next) => { setSelectedClaimId(next === "" ? null : next); setValues({}); setRows({}); }}
                options={[{ value: "", label: "Dosya seç" }, ...claims.data.map((claim) => ({ value: claim.id, label: claimTitle(claim) }))]} />
            )}
          <p className={s.sub}>Seçilen dosyanın tutarı ve dönemi taslağa aktarılır. Excel dosyasını mailine ekleyebilirsin.</p>
          <div className={ui.dact}>
            <Button variant="ghost" onClick={() => setExcelOpen(false)}>Kapat</Button>
            {selectedClaimId === null ? <Button variant="primary" disabled>Excel indir</Button>
              : <a className={cx(ui.btn, ui["v-primary"], ui["z-sm"])} href={`/api/finance/claims/${selectedClaimId}/xlsx`}>Excel indir</a>}
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function MatrixField({ v, rows, onChange }: { v: Variable; rows: string[][]; onChange: (r: string[][]) => void }) {
  const cols = v.cols;
  const set = (r: number, c: number, val: string) =>
    onChange(rows.map((row, i) => (i === r ? cols.map((_, j) => (j === c ? val : row[j] ?? "")) : row)));
  return (
    <div className={cx(ui.field, p.variable)}>
      <div className={p.fieldHeader}><span className={p.fieldName}>{v.name}</span><span className={s.tag}>matris</span></div>
      <div className={s.tplMatrix} style={{ gridTemplateColumns: `repeat(${Math.max(cols.length, 1)}, minmax(0, 1fr)) auto` }}>
        {cols.map((c) => <b key={c.name} className={s.dim}>{c.name}</b>)}
        <span />
        {rows.map((r, i) => (
          <MatrixRow key={i} cols={cols} row={r} onCell={(c, val) => set(i, c, val)}
            onDrop={() => onChange(rows.filter((_, j) => j !== i))} />
        ))}
      </div>
      <div><Button type="button" size="sm" onClick={() => onChange([...rows, cols.map(() => "")])}>Satır ekle</Button></div>
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
