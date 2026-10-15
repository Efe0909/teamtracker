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
  picked: Record<Uuid, string>;
  paidBy: "member" | "club";
  accountId: Uuid | null;
  note: string;
}

function emptyDraft(): Draft {
  return {
    files: [], purchasedOn: todayIso(), currency: "TRY", total: "", rate: "", rateOn: null, rateSource: "tcmb",
    picked: {}, paidBy: "member", accountId: null, note: "",
  };
}

function fromInvoice(v: InvoiceView): Draft {
  return {
    files: v.attachments, purchasedOn: v.purchased_on, currency: v.currency, total: String(v.total).replace(".", ","),
    rate: v.fx_rate === null ? "" : String(v.fx_rate).replace(".", ","), rateOn: v.fx_on,
    rateSource: v.fx_source ?? "tcmb",
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
  /** "Listede yok": etkinlik sayfasi, satin alimlar vurgulu (D-6). Yoksa (mobil: etkinlik
   *  sayfasi masaustunde) baglanti cizilmez. */
  eventHref?: ((eventId: Uuid) => string) | undefined;
}) {
  const L = useLookup();
  const q = usePurchasable();
  const acc = useBankAccounts();
  const save = useSaveInvoice();
  const [d, setD] = useState<Draft>(() => (props.initial !== undefined ? fromInvoice(props.initial) : readDraft() ?? emptyDraft()));
  const [uploading, setUploading] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [fxNote, setFxNote] = useState<string | null>(null);
  const [search, setSearch] = useState("");
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

  // Bilinen kalemler: secilebilir liste + (duzeltmede) faturanin kendi kalemleri.
  const known = useMemo(() => {
    const m = new Map<Uuid, { name: string; eventTitle: string | null; qty: number | null; price: number | null }>();
    for (const i of props.initial?.items ?? []) m.set(i.material_id, { name: i.name, eventTitle: i.event_title, qty: null, price: null });
    for (const p of q.data ?? []) m.set(p.id, { name: p.name, eventTitle: p.event_title, qty: p.qty, price: p.price });
    return m;
  }, [q.data, props.initial]);

  // Arama sonucu: etkinlige gore gruplu, secilenler cikarilmis; "Etkinliksiz" en sonda.
  const results = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("tr");
    const m = new Map<string, Purchasable[]>();
    for (const p of q.data ?? []) {
      if (d.picked[p.id] !== undefined) continue;
      if (needle !== "" && !`${p.name} ${p.event_title ?? "etkinliksiz"}`.toLocaleLowerCase("tr").includes(needle)) continue;
      const k = p.event_id ?? NONE;
      m.set(k, [...(m.get(k) ?? []), p]);
    }
    return [...m.entries()].sort(([a], [b]) => (a === NONE ? 1 : b === NONE ? -1 : 0));
  }, [q.data, search, d.picked]);

  const total = parseAmount(d.total);
  const rate = d.currency === "TRY" ? null : parseRate(d.rate);
  const pickedIds = Object.keys(d.picked);
  const dist = pickedIds.reduce((a, id) => a + cents(parseAmount(d.picked[id] ?? "") ?? 0), 0);
  const diff = total === null ? null : cents(total) - dist;
  const derived = [...new Set(pickedIds.map((id) => known.get(id)?.eventTitle ?? null))];
  const sym = SYMBOL[d.currency] ?? d.currency;
  const accounts = acc.data ?? [];
  const needsAccount = d.paidBy === "member" && acc.data !== undefined && accounts.length === 0;
  const fmt = (c: number) => (c / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2 });

  // Kalem eklenince tutar onerisi: TL faturada kartin fiyati, degilse (ya da fiyat yoksa)
  // dagitilmamis kalan. Kullanici her zaman degistirebilir.
  const add = (p: Purchasable) => setD((x) => {
    const left = parseAmount(x.total);
    const used = Object.values(x.picked).reduce((a, v) => a + cents(parseAmount(v) ?? 0), 0);
    const rest = left === null ? 0 : cents(left) - used;
    const guess = x.currency === "TRY" && p.price !== null && p.price > 0 ? String(p.price).replace(".", ",")
      : rest > 0 ? (rest / 100).toFixed(2).replace(".", ",") : "";
    return { ...x, picked: { ...x.picked, [p.id]: guess } };
  });
  const remove = (id: Uuid) => setD((x) => {
    const picked = { ...x.picked };
    delete picked[id];
    return { ...x, picked };
  });
  /** Bu kaleme dagitilmamis kalanin tamamini yazar. */
  const fillRest = (id: Uuid) => setD((x) => {
    const left = parseAmount(x.total);
    if (left === null) return x;
    const others = Object.entries(x.picked).filter(([k]) => k !== id).reduce((a, [, v]) => a + cents(parseAmount(v) ?? 0), 0);
    const rest = cents(left) - others;
    return rest > 0 ? { ...x, picked: { ...x.picked, [id]: (rest / 100).toFixed(2).replace(".", ",") } } : x;
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
        {pickedIds.length > 0 && (
          <div className={s.group}>
            {pickedIds.map((id) => {
              const k = known.get(id);
              return (
                <div key={id} className={s.itemRow}>
                  <span className={s.itemLabel}>
                    <span>
                      {k?.name ?? "Kalem"}
                      <span className={s.dim}> · {k?.eventTitle ?? "Etkinliksiz"}{k?.qty != null && k.qty > 1 ? ` · ${k.qty} adet` : ""}{k?.price != null ? ` · teklif ${money(k.price)}` : ""}</span>
                    </span>
                  </span>
                  <span className={s.itemTools}>
                    <input className={cx(ui.input, s.num, s.itemAmount)} inputMode="decimal"
                      aria-label={`${k?.name ?? "Kalem"} tutarı`} value={d.picked[id] ?? ""} placeholder={`0,00 ${sym}`}
                      onChange={(e) => setD((x) => ({ ...x, picked: { ...x.picked, [id]: e.target.value } }))} />
                    {diff !== null && diff > 0 && (
                      <button type="button" className={s.x} title="Kalan tutarı bu kaleme yaz" aria-label="Kalan tutarı bu kaleme yaz"
                        onClick={() => fillRest(id)}><Icon name="plus" size={12} /></button>
                    )}
                    <button type="button" className={s.x} aria-label={`${k?.name ?? "Kalem"} kalemini çıkar`}
                      onClick={() => remove(id)}><Icon name="x" size={12} /></button>
                  </span>
                </div>
              );
            })}
          </div>
        )}
        <div className={s.itemSearch}>
          <input className={ui.input} type="search" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Kalem ya da etkinlik ara, listeden seç" aria-label="Kalem ara" autoComplete="off" />
          <div className={s.results} role="listbox" aria-label="Seçilebilir kalemler">
            {results.length === 0 && (
              <p className={s.dim}>{search.trim() === "" ? "Seçilecek onaylı kalem kalmadı." : "Eşleşen onaylı kalem yok."}</p>
            )}
            {results.map(([g, items]) => (
              <div key={g}>
                <div className={s.resHead}>
                  <b>{g === NONE ? "Etkinliksiz" : items[0]?.event_title ?? "Etkinlik"}</b>
                  <span className={s.grow} />
                  {g !== NONE && props.eventHref !== undefined && (
                    <a className={s.link} href={props.eventHref(g)}
                      onClick={(e) => { keepDraft(); onLinkClick(e, props.eventHref?.(g) ?? "/"); }}>Listede yok, kalem ekle</a>
                  )}
                </div>
                {items.map((p) => (
                  <button key={p.id} type="button" role="option" aria-selected={false} className={s.resItem} onClick={() => add(p)}>
                    <span>{p.name}<span className={s.dim}>{p.qty > 1 ? ` · ${p.qty} adet` : ""}{p.purchased ? " · satın alındı" : ""}</span></span>
                    <span className={cx(s.num, s.dim)}>{p.price !== null && p.price > 0 ? money(p.price) : ""}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className={cx(s.sum, diff === 0 && pickedIds.length > 0 ? s.sumOk : s.sumWarn)} aria-live="polite">
          <span>
            {diff === null ? "Önce faturanın tutarını yaz"
              : diff === 0 && pickedIds.length > 0 ? "Tutarlar tamam"
              : diff > 0 ? "Dağıtılacak kalan" : "Fazla dağıtılan"}
          </span>
          <span className={s.num}>
            {diff !== null && diff !== 0 && `${fmt(Math.abs(diff))} ${sym} · `}
            {fmt(dist)} / {total === null ? "—" : fmt(cents(total))} {sym}
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
