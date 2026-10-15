// Yonetim > Kullanicilar yardimcilari: e-postadan ad onerisi, toplu kisi ekleme
// (yapistir → onizleme, ad ve e-posta satir satir duzenlenir → kisi basina tek
// POST), siralama dugmeleri ve kapsamin kisa Turkce adi.

import { useRef, useState } from "react";
import { errorText } from "../../api/client";
import { adminOps, useAdminWrite } from "../../api/hooks";
import { SCOPE } from "../../lib/labels";
import type { Sorter } from "../../lib/sort";
import { Icon } from "../../ui/icons";
import { Button, Tag, ui, useToast } from "../../ui/ui";
import s from "./dashboard.module.css";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Kapsamin kisa adi: "Yapıyı düzenle — düğüm ekle…" → "Yapıyı düzenle". */
export function scopeLabel(k: string): string {
  return (SCOPE[k] ?? k).split(" — ")[0] ?? k;
}

/** "ayse.yilmaz@x" → "Ayse Yilmaz". Oneri yalniz baslangic: ad her zaman elle duzenlenebilir. */
export function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  return local
    .split(/[._+-]+/)
    .filter((w) => w !== "")
    .map((w) => w.charAt(0).toLocaleUpperCase("tr-TR") + w.slice(1))
    .join(" ");
}

/** Serbest metin → (e-posta, ad) listesi. Satir basina bir kisi; "Ad Soyad <e-posta>"
 *  ve virgul/bosluk/noktali virgul ile ayrilmis e-postalar da olur. Ad yoksa bos doner. */
export function parseBatch(text: string): { email: string; name: string }[] {
  const out: { email: string; name: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    for (const m of line.matchAll(/([^,;<>]*?)\s*<([^<>\s]+)>/g)) {
      out.push({ email: m[2] ?? "", name: (m[1] ?? "").trim() });
    }
    const rest = line.replace(/[^,;<>]*?\s*<[^<>]*>/g, " ");
    for (const tok of rest.split(/[\s,;]+/)) {
      if (tok.includes("@")) out.push({ email: tok, name: "" });
    }
  }
  return out;
}

type Row = { id: number; email: string; name: string; serverError: string | null };

/** Onizleme satirinin durumu; her degisiklikte yeniden hesaplanir. Bos = eklenebilir. */
function rowError(r: Row, rows: Row[], existing: ReadonlySet<string>): string | null {
  const lc = r.email.trim().toLowerCase();
  if (!EMAIL.test(r.email.trim())) return "Geçersiz e-posta";
  if (existing.has(lc)) return "Zaten kayıtlı";
  if (rows.findIndex((x) => x.email.trim().toLowerCase() === lc) !== rows.indexOf(r)) return "Listede tekrar";
  if (r.name.trim() === "") return "Ad boş";
  return null;
}

/** Toplu ekleme: her satir icin mevcut "Kullanici ekle" istegi (adminOps.addUser) bir kez atilir. */
export function BatchAdd({ existing }: { existing: ReadonlySet<string> }) {
  const m = useAdminWrite();
  const toast = useToast();
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const patch = (id: number, p: Partial<Row>) => setRows((prev) => prev.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const preview = () => {
    const parsed = parseBatch(text);
    if (parsed.length === 0) {
      toast({ text: "Geçerli e-posta bulunamadı.", error: true });
      return;
    }
    setRows(parsed.map((p) => {
      seq.current += 1;
      return { id: seq.current, email: p.email, name: p.name || nameFromEmail(p.email), serverError: null };
    }));
  };

  const ready = rows.filter((r) => rowError(r, rows, existing) === null);

  const submit = async () => {
    setBusy(true);
    let ok = 0;
    let failed = 0;
    for (const r of ready) {
      try {
        await m.mutateAsync(adminOps.addUser(r.email.trim(), r.name.trim()));
        ok += 1;
        setRows((prev) => prev.filter((x) => x.id !== r.id));
      } catch (e) {
        failed += 1;
        patch(r.id, { serverError: errorText(e) });
      }
    }
    setBusy(false);
    if (failed === 0) setText("");
    toast({ text: `${ok} kişi eklendi${failed > 0 ? `, ${failed} satırda hata` : ""}.`, error: failed > 0 });
  };

  return (
    <div className={ui.formStack}>
      <label className={ui.field}>
        <span>E-postalar</span>
        <textarea className={ui.input} rows={4} value={text} onChange={(e) => setText(e.target.value)}
          placeholder={"ayse.yilmaz@ornek.com\nBora Demir <bora@ornek.com>, cem@ornek.com"} spellCheck={false} />
      </label>
      <div className={ui.dact}>
        <Button size="sm" disabled={busy || text.trim() === ""} onClick={preview}>Önizle</Button>
      </div>
      {rows.length > 0 && (
        <>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr><th>E-posta</th><th>Ad</th><th>Durum</th><th><span className="visually-hidden">Sil</span></th></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const e = rowError(r, rows, existing);
                  return (
                    <tr key={r.id}>
                      <td>
                        <input className={ui.input} aria-label={`${i + 1}. e-posta`} value={r.email} disabled={busy}
                          onChange={(ev) => patch(r.id, { email: ev.target.value, serverError: null })} />
                      </td>
                      <td>
                        <input className={ui.input} aria-label={`${i + 1}. ad`} value={r.name} disabled={busy} maxLength={200}
                          onChange={(ev) => patch(r.id, { name: ev.target.value, serverError: null })} />
                      </td>
                      <td>
                        {r.serverError !== null ? <Tag tone="critical">{r.serverError}</Tag>
                          : e !== null ? <Tag tone="critical">{e}</Tag>
                          : <Tag tone="neutral">Hazır</Tag>}
                      </td>
                      <td>
                        <Button size="sm" variant="ghost" disabled={busy} aria-label={`${i + 1}. satırı kaldır`}
                          onClick={() => setRows((prev) => prev.filter((x) => x.id !== r.id))}>
                          <Icon name="x" size={12} />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className={ui.dact}>
            <span className={s.dim}>{ready.length} kişi eklenecek</span>
            <Button variant="primary" disabled={busy || ready.length === 0} onClick={() => void submit()}>
              {busy ? "Ekleniyor…" : `${ready.length} kişi ekle`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** Siralama dugmeleri: tikla → artan → azalan → kapali (lib/sort.ts). */
export function SortBar<T>({ sorter, keys }: { sorter: Sorter<T>; keys: { key: string; label: string }[] }) {
  return (
    <div className={s.sortBar} role="group" aria-label="Sırala">
      <span className={s.dim}>Sırala</span>
      {keys.map((k) => {
        const dir = sorter.sort?.key === k.key ? sorter.sort.dir : undefined;
        return (
          <button key={k.key} type="button" className={s.sortBtn} data-on={dir !== undefined}
            onClick={() => sorter.toggle(k.key)}>
            {k.label}
            <Icon name={dir === "asc" ? "up" : dir === "desc" ? "down" : "updown"} size={12} />
          </button>
        );
      })}
    </div>
  );
}
