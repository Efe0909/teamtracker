// Fatura ekle / duzelt (spec/81 §5). Form basina BIR fatura; fatura yalniz
// kaleme baglanir (D-3), etkinlik kalemden turetilir. Kalem basina tutar:
// toplami faturanin tutarina esit olmali (bolunmus fatura, D-4). Iki yuzde ayni
// bilesen; yuze ozgu adresler (`hrefs`) disaridan gelir.

import { useEffect, useMemo, useRef, useState } from "react";
import { errorText, upload } from "../../api/client";
import { fetchFx, useBankAccounts, usePurchasable, useSaveInvoice } from "../../api/hooks";
import type { Attachment, InvoiceIn, InvoiceView, IsoDate, Purchasable, Uuid } from "../../api/types";
import { formatBytes } from "../media/Media";
import { useLookup } from "../../lib/lookup";
import { cents, money, parseAmount, parseRate } from "../../lib/money";
import { onLinkClick } from "../../lib/router";
import { Icon } from "../../ui/icons";
import { Button, cx, Loading, Picker, Req, ui } from "../../ui/ui";
import s from "./finance.module.css";

const NONE = "none";
const CURRENCIES = ["TRY", "USD", "EUR"] as const;
const SYMBOL: Record<string, string> = { TRY: "₺", USD: "$", EUR: "€" };
const DRAFT_KEY = "ekiptakip.invoiceDraft";

function todayIso(): IsoDate {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface Draft {
  files: Attachment[];
  purchasedOn: IsoDate;
  currency: string;
  total: string;
  rate: string;
  rateOn: IsoDate | null;
  rateSource: "tcmb" | "manual";
  groups: string[];
  picked: Record<Uuid, string>;
  paidBy: "member" | "club";
  accountId: Uuid | null;
  note: string;
}

function emptyDraft(): Draft {
  return {
    files: [], purchasedOn: todayIso(), currency: "TRY", total: "", rate: "", rateOn: null, rateSource: "tcmb",
    groups: [], picked: {}, paidBy: "member", accountId: null, note: "",
  };
}

function fromInvoice(v: InvoiceView): Draft {
  const groups = [...new Set(v.items.map((i) => i.event_id ?? NONE))];
  return {
    files: v.attachments, purchasedOn: v.purchased_on, currency: v.currency, total: String(v.total).replace(".", ","),
    rate: v.fx_rate === null ? "" : String(v.fx_rate).replace(".", ","), rateOn: v.fx_on,
    rateSource: v.fx_source ?? "tcmb", groups,
    picked: Object.fromEntries(v.items.map((i) => [i.material_id, String(i.amount).replace(".", ",")])),
    paidBy: v.paid_by, accountId: v.payee?.id ?? null, note: v.note ?? "",
  };
}

function readDraft(): Draft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw === null ? null : (JSON.parse(raw) as Draft);
  } catch {
    return null;
  }
}

export function InvoiceForm(props: {
  initial?: InvoiceView;
  onDone: (inv: InvoiceView) => void;
  /** Hesap yoksa gidilecek yer; `ret` bu formun adresi. */
  accountsHref: string;
  /** "Listede yok": etkinlik sayfasi, satin alimlar vurgulu (D-6). */
  eventHref: (eventId: Uuid) => string;
}) {
  const L = useLookup();
  const q = usePurchasable();
  const acc = useBankAccounts();
  const save = useSaveInvoice();
  const [d, setD] = useState<Draft>(() => (props.initial !== undefined ? fromInvoice(props.initial) : readDraft() ?? emptyDraft()));
  const [uploading, setUploading] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [fxNote, setFxNote] = useState<string | null>(null);
  const [addEvent, setAddEvent] = useState<string>("");
  const file = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  // Varsayilan hesap: hesaplar gelince bir kez.
  useEffect(() => {
    if (d.accountId === null && acc.data !== undefined) {
      const def = acc.data.find((a) => a.is_default) ?? acc.data[0];
      if (def !== undefined) set("accountId", def.id);
    }
  }, [acc.data, d.accountId]);

  // Dovizde kur: tarih ya da birim degisince TCMB'den (elle duzeltilmediyse).
  useEffect(() => {
    if (d.currency === "TRY" || d.rateSource === "manual") return;
    let live = true;
    setFxNote("Kur alınıyor…");
    fetchFx(d.currency, d.purchasedOn)
      .then((r) => {
        if (!live) return;
        setD((x) => ({ ...x, rate: String(r.rate).replace(".", ","), rateOn: r.on, rateSource: "tcmb" }));
        setFxNote(null);
      })
      .catch((e: unknown) => {
        if (!live) return;
        setD((x) => ({ ...x, rateSource: "manual", rateOn: x.purchasedOn }));
        setFxNote(errorText(e));
      });
    return () => { live = false; };
  }, [d.currency, d.purchasedOn, d.rateSource]);

  const byGroup = useMemo(() => {
    const m = new Map<string, Purchasable[]>();
    for (const p of q.data ?? []) {
      const k = p.event_id ?? NONE;
      m.set(k, [...(m.get(k) ?? []), p]);
    }
    return m;
  }, [q.data]);

  const groupTitle = (k: string) => {
    if (k === NONE) return "Etkinliğe bağlı olmayan kalemler";
    const p = byGroup.get(k)?.[0];
    return p?.event_title ?? "Etkinlik";
  };

  const total = parseAmount(d.total);
  const rate = d.currency === "TRY" ? null : parseRate(d.rate);
  const pickedIds = Object.keys(d.picked);
  const dist = pickedIds.reduce((a, id) => a + cents(parseAmount(d.picked[id] ?? "") ?? 0), 0);
  const diff = total === null ? null : cents(total) - dist;
  const derived = [...new Set(pickedIds.map((id) => q.data?.find((p) => p.id === id)?.event_title ?? null))];
  const sym = SYMBOL[d.currency] ?? d.currency;
  const accounts = acc.data ?? [];
  const needsAccount = d.paidBy === "member" && acc.data !== undefined && accounts.length === 0;

  // Ilk secilen kalem faturanin tamamini alir (tek kalemli fatura en sik durum).
  const toggle = (p: Purchasable, on: boolean) => setD((x) => {
    const picked = { ...x.picked };
    if (on) picked[p.id] = Object.keys(picked).length === 0 ? x.total : "";
    else delete picked[p.id];
    return { ...x, picked };
  });

  const addFiles = (files: File[]) => {
    for (const f of files) {
      setUploading((n) => n + 1);
      upload<Attachment>(f, "invoice")
        .then((a) => setD((x) => ({ ...x, files: [...x.files, a] })))
        .catch((e: unknown) => setErr(`${f.name}: ${errorText(e)}`))
        .finally(() => setUploading((n) => n - 1));
    }
  };

  const keepDraft = () => {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    } catch {
      // gizli pencere: taslak kalmaz, form yine calisir
    }
  };

  const submit = () => {
    setErr(null);
    if (total === null || total <= 0) return setErr("Faturanın tutarını yaz.");
    if (d.files.length === 0) return setErr("Fatura ya da fişin en az bir dosyasını ekle.");
    if (pickedIds.length === 0) return setErr("Faturayı en az bir kaleme bağla.");
    if (diff !== 0) return setErr("Kalemlere dağıtılan tutarların toplamı faturanın tutarına eşit olmalı.");
    if (d.currency !== "TRY" && rate === null) return setErr("Dövizli faturada kur gerekli.");
    if (d.paidBy === "member" && d.accountId === null) return setErr("İade edilecek hesabı seç.");
    const body: InvoiceIn = {
      purchased_on: d.purchasedOn, currency: d.currency, total, paid_by: d.paidBy,
      items: pickedIds.map((id) => ({ material_id: id, amount: parseAmount(d.picked[id] ?? "") ?? 0 })),
      attachment_ids: d.files.map((f) => f.id),
      ...(d.note.trim() !== "" ? { note: d.note.trim() } : {}),
      ...(d.paidBy === "member" && d.accountId !== null ? { payee_account_id: d.accountId } : {}),
      ...(rate !== null ? { fx_rate: rate, fx_on: d.rateOn ?? d.purchasedOn, fx_source: d.rateSource } : {}),
    };
    save.mutate({ id: props.initial?.id ?? null, body }, {
      onSuccess: (inv) => {
        try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* yok */ }
        props.onDone(inv);
      },
      onError: (x) => setErr(errorText(x)),
    });
  };

  if (q.data === undefined) return <Loading />;
  const left = [...byGroup.keys()].filter((k) => !d.groups.includes(k));
  const accept = L.meta.upload_limits?.invoice?.accept;

  return (
    <form className={cx(ui.formStack, s.form)} onSubmit={(e) => { e.preventDefault(); submit(); }}>
      {err !== null && <p className={ui.error} role="alert">{err}</p>}

      <div className={ui.field}>
        <span>Alan kişi</span>
        <span className={s.readonly}>{L.me.name}</span>
      </div>

      <div className={ui.field}>
        <span>Fatura / fiş<Req /></span>
        <div className={s.drop}>
          {d.files.map((f) => (
            <div key={f.id} className={s.file}>
              <Icon name="file" size={14} />
              <span className={s.fileName}>{f.original_name ?? "dosya"}</span>
              <span className={s.dim}>{formatBytes(f.byte_size)}</span>
              <button type="button" className={s.x} aria-label={`${f.original_name ?? "dosya"} çıkar`}
                onClick={() => set("files", d.files.filter((x) => x.id !== f.id))}><Icon name="x" size={12} /></button>
            </div>
          ))}
          <div>
            <input ref={file} type="file" hidden multiple accept={accept} onChange={(e) => {
              addFiles([...(e.target.files ?? [])]);
              e.target.value = "";
            }} />
            <Button type="button" onClick={() => file.current?.click()} disabled={uploading > 0}>
              <Icon name="attach" size={16} /> {uploading > 0 ? "Yükleniyor…" : "Dosya ekle"}
            </Button>
          </div>
          <span className={ui.fieldHint}>
            Fotoğraf, PDF, Excel ya da CSV. Dosya başına en fazla {formatBytes(L.meta.upload_limits?.invoice?.max_bytes ?? 10 * 1024 * 1024)}.
          </span>
        </div>
      </div>

      <div className={ui.field}>
        <span>Alışveriş tarihi ve tutar<Req /></span>
        <div className={s.amountRow}>
          <input className={ui.input} type="date" value={d.purchasedOn} max={todayIso()} aria-label="Alışveriş tarihi"
            onChange={(e) => setD((x) => ({ ...x, purchasedOn: e.target.value, rateSource: x.currency === "TRY" ? x.rateSource : "tcmb" }))} required />
          <input className={cx(ui.input, s.num)} inputMode="decimal" value={d.total} placeholder="0,00" aria-label="Tutar"
            onChange={(e) => set("total", e.target.value)} required />
          <Picker label="Para birimi" value={d.currency}
            onChange={(c) => setD((x) => ({ ...x, currency: c, rate: "", rateSource: "tcmb" }))}
            options={CURRENCIES.map((c) => ({ value: c, label: SYMBOL[c] ?? c }))} />
        </div>
        {d.currency !== "TRY" && (
          <div className={s.rate}>
            {d.rateSource === "tcmb" && rate !== null ? (
              <>
                <span className={s.pinTag}>Kur sabitlendi</span>
                <span className={s.num}>1 {sym} = {d.rate} ₺</span>
                <span className={s.dim}>{d.rateOn ?? d.purchasedOn} · TCMB döviz satış</span>
                <Button type="button" size="sm" variant="ghost"
                  onClick={() => setD((x) => ({ ...x, rateSource: "manual", rateOn: x.purchasedOn }))}>Elle düzelt</Button>
              </>
            ) : (
              <label className={s.rateManual}>
                <span>1 {sym} =</span>
                <input className={cx(ui.input, s.num)} inputMode="decimal" value={d.rate} aria-label="Kur"
                  onChange={(e) => setD((x) => ({ ...x, rate: e.target.value, rateSource: "manual" }))} placeholder="41,82" />
                <span>₺</span>
                {d.rateSource === "manual" && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => set("rateSource", "tcmb")}>TCMB kurunu al</Button>
                )}
              </label>
            )}
            {total !== null && rate !== null && <span className={s.dim}>karşılık <b className={s.num}>{money(total * rate)}</b></span>}
          </div>
        )}
        {fxNote !== null && <span className={ui.fieldHint}>{fxNote}</span>}
        {d.currency !== "TRY" && (
          <span className={ui.fieldHint}>SEB işlemin yapıldığı günkü kuru ister; kur alışveriş tarihine göre bir kez alınır ve faturaya yazılır.</span>
        )}
      </div>

      <div className={ui.field}>
        <span>Bu fatura hangi kalemler için?<Req /></span>
        <div className={s.evPick}>
          <Picker label="Eklenecek etkinlik" value={addEvent} onChange={setAddEvent}
            options={[{ value: "", label: left.length === 0 ? "Eklenecek etkinlik yok" : "Etkinlik seç…" },
              ...left.map((k) => ({ value: k, label: groupTitle(k) }))]} />
          <Button type="button" size="sm" disabled={addEvent === ""}
            onClick={() => { set("groups", [...d.groups, addEvent]); setAddEvent(""); }}>Etkinlik ekle</Button>
        </div>
        {d.groups.map((g) => {
          const items = byGroup.get(g) ?? [];
          return (
            <div key={g} className={s.group}>
              <div className={s.groupHead}>
                <b>{groupTitle(g)}</b>
                <span className={s.dim}>{items.filter((p) => d.picked[p.id] !== undefined).length} kalem seçili</span>
                <span className={s.grow} />
                {g !== NONE && (
                  <a className={s.link} href={props.eventHref(g)}
                    onClick={(e) => { keepDraft(); onLinkClick(e, props.eventHref(g)); }}>Listede yok, kalem ekle</a>
                )}
                <Button type="button" size="sm" variant="ghost" onClick={() => setD((x) => {
                  const picked = { ...x.picked };
                  for (const p of items) delete picked[p.id];
                  return { ...x, groups: x.groups.filter((y) => y !== g), picked };
                })}>Kaldır</Button>
              </div>
              {items.length === 0 && <p className={s.dim}>Bu etkinlikte onaylı kalem yok.</p>}
              {items.map((p) => {
                const on = d.picked[p.id] !== undefined;
                return (
                  <div key={p.id} className={s.itemRow}>
                    <label className={s.itemLabel}>
                      <input type="checkbox" checked={on} onChange={(e) => toggle(p, e.target.checked)} />
                      <span>
                        {p.name}
                        <span className={s.dim}> · {p.qty} adet{p.price !== null ? ` · teklif ${money(p.price)}` : ""}{p.purchased ? " · satın alındı" : ""}</span>
                      </span>
                    </label>
                    <input className={cx(ui.input, s.num, s.itemAmount)} inputMode="decimal" disabled={!on}
                      aria-label={`${p.name} tutarı`} value={d.picked[p.id] ?? ""} placeholder={on ? `0,00 ${sym}` : ""}
                      onChange={(e) => setD((x) => ({ ...x, picked: { ...x.picked, [p.id]: e.target.value } }))} />
                  </div>
                );
              })}
            </div>
          );
        })}
        <div className={cx(s.sum, diff === 0 && pickedIds.length > 0 ? s.sumOk : s.sumWarn)} aria-live="polite">
          <span>Dağıtılan</span>
          <span className={s.num}>
            {(dist / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} / {total === null ? "—" : total.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} {sym}
            {diff !== null && diff !== 0 && ` · fark ${(diff / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${sym}`}
          </span>
        </div>
        <span className={ui.fieldHint}>
          {derived.length === 0 ? "Henüz kalem seçilmedi." : `İlişkili etkinlikler (kalemlerden): ${derived.map((t) => t ?? "etkinliğe bağlı olmayan kalemler").join(", ")}.`}
          {" "}Fatura yalnız kaleme bağlanır; kalemin sayfasında da bu fatura görünür.
        </span>
      </div>

      <div className={ui.field}>
        <span>Ödemeyi kim yaptı?</span>
        <div className={s.choices}>
          <label className={cx(s.choice, d.paidBy === "member" && s.choiceOn)}>
            <input type="radio" name="paidBy" checked={d.paidBy === "member"} onChange={() => set("paidBy", "member")} />
            Ben ödedim, bana iade edilsin
          </label>
          <label className={cx(s.choice, d.paidBy === "club" && s.choiceOn)}>
            <input type="radio" name="paidBy" checked={d.paidBy === "club"} onChange={() => set("paidBy", "club")} />
            Kulüp kasasından ödendi
          </label>
        </div>
      </div>

      {d.paidBy === "member" && (
        <div className={ui.field}>
          <span>İade edilecek hesap<Req /></span>
          {needsAccount ? (
            <p className={s.notice}>
              Fatura yüklemek için önce bir hesap numarası eklemelisin.{" "}
              <a href={props.accountsHref} onClick={(e) => { keepDraft(); onLinkClick(e, props.accountsHref); }}>
                Hesap numaralarım
              </a>
            </p>
          ) : (
            <Picker label="İade edilecek hesap" value={d.accountId ?? ""} onChange={(v) => set("accountId", v)}
              options={accounts.map((a) => ({ value: a.id, label: `${a.label} · ${a.holder_name} · …${a.iban_last4}${a.is_default ? " (varsayılan)" : ""}` }))} />
          )}
        </div>
      )}

      <label className={ui.field}>
        <span>Not <span className={ui.fieldHint}>— isteğe bağlı</span></span>
        <textarea className={ui.input} rows={2} maxLength={2000} value={d.note} onChange={(e) => set("note", e.target.value)} />
      </label>

      <div className={ui.dact}>
        <Button type="submit" variant="primary" disabled={save.isPending || uploading > 0}>
          {props.initial !== undefined ? "Düzeltip yeniden gönder" : "Onaya gönder"}
        </Button>
      </div>
    </form>
  );
}
