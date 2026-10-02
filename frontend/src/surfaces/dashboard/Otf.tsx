// OTF widget'i (spec/73): universitenin etkinlik talep formu (FORM.GN.05).
// Word dosyasini sunucu doldurur (Rust api/otf.rs). Etkinlikten gelenler (ad,
// tarih, saat, yer, kisi sayisi) formda TUTULMAZ, burada salt okunur ozet.
// Form tek parca kaydedilir (PUT); taslak yerelde, "Kaydet"e kadar sunucuya
// gitmez. Indirilen dosya KAYITLI hali yazar.

import { useState } from "react";
import { errorText } from "../../api/client";
import { otfDocxUrl, useAutofillOtf, useOtf, useSaveOtf } from "../../api/hooks";
import type { EventDetail, OtfFields, OtfInput, OtfView, Uuid } from "../../api/types";
import r from "../../features/record/record.module.css";
import { formatDay } from "../../lib/labels";
import { useLookup } from "../../lib/lookup";
import { Icon } from "../../ui/icons";
import { Button, cx, Dialog, IconButton, Loading, Picker, ui, useToast, Who } from "../../ui/ui";
import s from "./dashboard.module.css";

const CONTACTS_MAX = 3;
const RULES = "Kulüp mail adresinden, Word (.docx) olarak, etkinlikten en geç 3 iş günü önce gönderilmeli.";

/** Sunucunun dondurdugu gorunumden formun kendisi; kutular anahtar sirasinda
 *  (sunucu sira vermiyor — kirli karsilastirmasi sirayla bozulmasin). */
function toInput(v: OtfView): OtfInput {
  return {
    purpose: v.purpose, end_time: v.end_time, advisor: v.advisor, age_group: v.age_group, outcomes: v.outcomes,
    layout_notes: v.layout_notes, av_notes: v.av_notes, tech_notes: v.tech_notes,
    host_notes: v.host_notes, care_notes: v.care_notes, other_notes: v.other_notes,
    items: [...v.items].sort((a, b) => a.item.localeCompare(b.item)),
    contacts: v.contacts,
  };
}

export function Otf({ eventId, event, canEdit, onRemove }: {
  eventId: Uuid;
  event: EventDetail;
  canEdit: boolean;
  /** Yoksa kaldirma dugmesi cizilmez. */
  onRemove?: (() => void) | undefined;
}) {
  const q = useOtf(eventId);
  return (
    <div className={cx(r.card, r.cardHover, s.evWide)}>
      <div className={r.cardHead}>
        <Icon name="edit" size={18} />
        <b>Etkinlik talep formu (OTF)</b>
        {q.data !== undefined && <Deadline v={q.data} />}
        {onRemove !== undefined && (
          <span className={r.cardActs}>
            <IconButton icon="trash" label="Widget'ı kaldır (veri silinmez)" onClick={onRemove} />
          </span>
        )}
      </div>
      {q.data !== undefined ? <Form eventId={eventId} event={event} canEdit={canEdit} view={q.data} />
        : q.isError ? <span className={r.muted}>{errorText(q.error)}</span> : <Loading />}
    </div>
  );
}

function Deadline({ v }: { v: OtfView }) {
  if (v.deadline === null) return <span className={r.muted}>Tarih yok — son gün hesaplanamaz</span>;
  return (
    <span className={s.otfDeadline} data-late={v.late}>
      {v.late && <Icon name="alert" size={13} />}
      Son gönderim: {formatDay(v.deadline)} (3 iş günü önce)
    </span>
  );
}

function Form({ eventId, event, canEdit, view }: { eventId: Uuid; event: EventDetail; canEdit: boolean; view: OtfView }) {
  const L = useLookup();
  const toast = useToast();
  const save = useSaveOtf(eventId);
  // Taslak acilista sunucudan; yeniden cekim taslagi EZMEZ (yazilan kaybolmasin), kayit ezer.
  const [draft, setDraft] = useState<OtfInput>(() => toInput(view));
  const [open, setOpen] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(toInput(view));
  const ro = !canEdit;

  const setField = (k: keyof OtfFields, v: string) => setDraft((d) => ({ ...d, [k]: v === "" ? null : v }));
  const qty = (item: string) => draft.items.find((i) => i.item === item);
  const toggle = (item: string) => setDraft((d) => ({
    ...d,
    items: d.items.some((i) => i.item === item) ? d.items.filter((i) => i.item !== item)
      : [...d.items, { item, quantity: null }].sort((a, b) => a.item.localeCompare(b.item)),
  }));
  const setQty = (item: string, v: string) => setDraft((d) => ({
    ...d, items: d.items.map((i) => (i.item === item ? { item, quantity: v === "" ? null : Math.trunc(Number(v)) } : i)),
  }));
  // "Yok" secilen yuva duser, arkasindakiler kayar (formdaki sira bosluksuz).
  const setContact = (at: number, id: Uuid | null) => setDraft((d) => {
    const contacts = [...d.contacts];
    if (id === null) contacts.splice(at, 1);
    else contacts[at] = id;
    return { ...d, contacts };
  });
  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(
      () => toast({ text: "Kopyalandı", error: false }),
      () => toast({ text: "Kopyalanamadı", error: true }),
    );
  };
  const onSave = (reviewed = false) => save.mutate({ ...draft, reviewed }, {
    onSuccess: (v) => { setDraft(toInput(v)); toast({ text: reviewed ? "Gözden geçirildi — Word açıldı" : "Kaydedildi", error: false }); },
    onError: (e) => toast({ text: errorText(e), error: true }),
  });
  // Otomatik doldur: etkinlikten gelmeyen her alan en son kaydedilen baska formdan
  // (sunucuda kopyalanir). Kopyadan sonra Word kilitli; "gozden gecirdim" ancak
  // en az bir alan degisince isaretlenir (sunucu da zorlar).
  const autofill = useAutofillOtf(eventId);
  const src = view.autofill_source;
  // Formda kayitli ya da kaydedilmemis bir sey varsa (gozden gecirilmis olsa da)
  // once onay: kopya hepsinin uzerine yazar.
  const hasContent = dirty || Object.values(toInput(view)).some((v) => (Array.isArray(v) ? v.length > 0 : v !== null));
  const [confirming, setConfirming] = useState(false);
  const runAutofill = () => {
    if (src === null) return;
    autofill.mutate(undefined, {
      onSuccess: (v) => {
        setConfirming(false);
        setDraft(toInput(v));
        setOpen(true);
        toast({ text: `“${src.title}” formundan dolduruldu — gözden geçir`, error: false });
      },
      onError: (e) => toast({ text: errorText(e), error: true }),
    });
  };
  const onAutofill = () => (hasContent ? setConfirming(true) : runAutofill());
  const locked = view.review?.needs_review === true;
  const canTick = locked && !ro && (view.review?.edited === true || dirty);

  const text = (k: keyof OtfFields, label: string, long = false) => (
    <label className={ui.field}>
      {label}
      {long
        ? <textarea className={ui.input} value={draft[k] ?? ""} disabled={ro} maxLength={4000} onChange={(e) => setField(k, e.target.value)} />
        : <input className={ui.input} value={draft[k] ?? ""} disabled={ro} maxLength={300} onChange={(e) => setField(k, e.target.value)} />}
    </label>
  );
  // Bos yuva yalniz siniri dolmamissa (sirali: once dolu olanlar, sonra bir bos).
  const slots = Math.min(draft.contacts.length + (ro ? 0 : 1), CONTACTS_MAX);

  return (
    <>
      <div className={s.otfDownload}>
        {locked ? (
          <Button size="sm" variant="primary" disabled title="Kopyalanan form gözden geçirilmeden indirilemez">
            <Icon name="lock" size={14} /> Word indir
          </Button>
        ) : (
          <a className={cx(ui.btn, ui["v-primary"], ui["z-sm"])} href={otfDocxUrl(eventId)} download>
            <Icon name="download" size={14} /> Word indir
          </a>
        )}
        {locked && (
          <label className={s.otfReview} title={canTick ? undefined : "Önce bu etkinliğe göre en az bir alanı güncelle"}>
            <input type="checkbox" checked={false} disabled={!canTick || save.isPending} onChange={() => onSave(true)} />
            Formu gözden geçirdim
          </label>
        )}
        {canEdit && src !== null && (
          <Button size="sm" disabled={autofill.isPending} onClick={onAutofill}
            title={`Etkinlikten gelmeyen alanları “${src.title}” formundan kopyalar`}>
            <Icon name="restore" size={14} /> Otomatik doldur
          </Button>
        )}
        {src !== null && (
          <Dialog open={confirming} onClose={() => setConfirming(false)} title="Otomatik doldurulsun mu?">
            <p>
              “{src.title}” etkinliğinin formu bu formun üzerine kopyalanacak.{" "}
              <b>Bu formdaki düzenlemeleriniz{dirty ? " (kaydedilmemişler dahil)" : ""} silinecek</b> ve form yeniden
              gözden geçirilene kadar Word indirilemeyecek.
            </p>
            <div className={ui.dact}>
              <Button onClick={() => setConfirming(false)}>Vazgeç</Button>
              <Button variant="danger" disabled={autofill.isPending} onClick={runAutofill}>Düzenlemeleri sil ve doldur</Button>
            </div>
          </Dialog>
        )}
        {locked && (
          <span className={s.otfWarn}>
            <Icon name="alert" size={13} />
            {view.review?.copied_title !== null && view.review?.copied_title !== undefined
              ? `“${view.review.copied_title}” formundan kopyalandı. `
              : "Başka bir formdan kopyalandı. "}
            Bu etkinliğe göre en az bir alanı güncelleyip gözden geçirdiğini işaretle.
          </span>
        )}
        <span className={s.otfCopy}>
          <span className={r.muted}>Dosya adı</span> <code>{view.file_name}</code>
          <IconButton icon="copy" size={14} label="Dosya adını kopyala" onClick={() => copy(view.file_name)} />
        </span>
        <span className={s.otfCopy}>
          <span className={r.muted}>Mail konusu</span> <code>{view.subject}</code>
          <IconButton icon="copy" size={14} label="Mail konusunu kopyala" onClick={() => copy(view.subject)} />
        </span>
        <span className={r.muted}><Icon name="info" size={13} /> {RULES}</span>
        {dirty && <span className={s.otfWarn}><Icon name="alert" size={13} /> Kaydedilmemiş değişiklikler indirilen dosyaya girmez</span>}
      </div>

      <button type="button" className={r.cardToggle} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={cx(r.caret, open && r.caretOpen)}><Icon name="chevron" size={13} /></span>
        Formu {open ? "gizle" : "göster"}
      </button>

      {open && (
        <div className={s.otfBody}>
          <dl className={s.otfEvent} aria-label="Etkinlikten gelir">
            <dt>Etkinlik adı</dt><dd>{event.title}</dd>
            <dt>Tarih</dt><dd>{event.date === null ? "—" : formatDay(event.date)}</dd>
            <dt>Başlangıç</dt><dd>{event.start_time ?? "—"}</dd>
            <dt>Yer</dt><dd>{event.place ?? "—"}</dd>
            <dt>Katılımcı sayısı</dt><dd>{event.attendees ?? "—"}</dd>
          </dl>
          <span className={r.muted}>Yukarıdakiler etkinlikten gelir; değiştirmek için etkinliği düzenleyin.</span>

          {text("purpose", "Etkinliğin amacı, içeriği", true)}
          <div className={s.otfGrid}>
            <label className={ui.field}>
              Bitiş saati
              <input className={ui.input} type="time" value={draft.end_time ?? ""} disabled={ro} onChange={(e) => setField("end_time", e.target.value)} />
            </label>
            {text("advisor", "Danışman / Konuşmacı")}
            {text("age_group", "Katılımcı yaş grubu")}
          </div>
          {text("outcomes", "Kazanımlar", true)}

          {view.catalog.map((sec) => (
            <fieldset key={sec.key} className={cx(ui.field, s.otfSection)}>
              <legend>{sec.label}</legend>
              <div className={s.otfItems}>
                {sec.items.map((it) => {
                  const on = qty(it.key);
                  return (
                    <span key={it.key} className={s.otfItem} data-on={on !== undefined}>
                      <label>
                        <input type="checkbox" checked={on !== undefined} disabled={ro} onChange={() => toggle(it.key)} />
                        {it.label}
                      </label>
                      {on !== undefined && (
                        <input className={cx(ui.input, s.otfQty)} type="number" min={1} max={10000} step={1} placeholder="adet"
                          aria-label={`${it.label} adedi`} value={on.quantity ?? ""} disabled={ro}
                          onChange={(e) => setQty(it.key, e.target.value)} />
                      )}
                    </span>
                  );
                })}
              </div>
              {text(`${sec.key}_notes` as const, "Açıklama", true)}
            </fieldset>
          ))}

          <fieldset className={ui.field}>
            <legend>Etkinlik sorumluları</legend>
            <div className={s.otfContacts}>
              {Array.from({ length: slots }, (_, i) => {
                const cur = draft.contacts[i] ?? null;
                return (
                  <Picker key={i} label={`Sorumlu ${i + 1}`} value={cur} disabled={ro} search placeholder="Kişi seç"
                    options={[
                      { value: null, label: "Yok", render: <span className={r.muted}>Yok</span> },
                      ...L.meta.users.filter((u) => u.id === cur || !draft.contacts.includes(u.id))
                        .map((u) => ({ value: u.id as Uuid | null, label: u.name, render: <Who user={u} /> })),
                    ]}
                    onChange={(v) => setContact(i, v)} />
                );
              })}
              {slots === 0 && <span className={r.muted}>Sorumlu yok.</span>}
            </div>
            <span className={ui.fieldHint}>En çok {CONTACTS_MAX} kişi. Telefon kişinin profilinden.</span>
          </fieldset>

          {canEdit && (
            <div className={s.otfActs}>
              <Button variant="primary" size="sm" disabled={!dirty || save.isPending} onClick={() => onSave()}>Kaydet</Button>
              {dirty && <Button variant="ghost" size="sm" disabled={save.isPending} onClick={() => setDraft(toInput(view))}>Vazgeç</Button>}
            </div>
          )}
        </div>
      )}
    </>
  );
}
