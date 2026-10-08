// Malzeme detayi: pano karti da liste satiri da bunu acar. Alanlar duzenlenir
// (ad ve not odak kaybinda yazilir), adimlar etiketli, teklifler etkinlik gunune
// gore karsilastirilir. Sponsor teklifler arasinda bir SECENEKTIR; sponsorun
// sureci burada yok, son secim yetkilidir. Satin alinmis kalemde tedarik donar.

import { useState } from "react";
import { eventOps } from "../../api/hooks";
import type { Material, MaterialProvider, MaterialType, Priority } from "../../api/types";
import { ago, formatDay, PRIORITY, PRIORITY_ORDER, toIsoDay } from "../../lib/labels";
import { DateField } from "../../ui/DateField";
import { Icon } from "../../ui/icons";
import { Button, cx, Dialog, IconButton, Picker, ui } from "../../ui/ui";
import { bestOffer, daysBefore, isPhone, MATERIAL_STEPS, MATERIAL_TYPE, money, OVERAGE_MARK, overPct, unitPrice } from "./eventModel";
import type { Run } from "./purchaseParts";
import s from "./purchases.module.css";

const TYPES = Object.keys(MATERIAL_TYPE) as MaterialType[];
type Kind = "link" | "phone";

/** Mevcut teklif: telefon ise isim ya da telefon kalibi; yoksa baglanti. */
const kindOf = (p: Pick<MaterialProvider, "contact" | "name">): Kind => (p.name !== null || isPhone(p.contact) ? "phone" : "link");
const hrefOf = (c: string) => (/^https?:\/\//.test(c) ? c : `https://${c}`);

export function MaterialDetail({ m, eventDate, canEdit, canBudget, busy, run, onClose }: {
  m: Material;
  eventDate: string | null;
  canEdit: boolean;
  /** `manage_budgets`: butce yazilir. Yoksa alan okunur kalir. */
  canBudget: boolean;
  busy: boolean;
  run: Run;
  onClose: () => void;
}) {
  const [name, setName] = useState(m.name);
  const [notes, setNotes] = useState(m.notes ?? "");
  const [qty, setQty] = useState(m.qty > 1 ? String(m.qty) : "");
  const [budget, setBudget] = useState(m.budget === null ? "" : String(m.budget));
  const [editing, setEditing] = useState<string | null>(null); // teklif id'si ya da "sponsor"
  const [confirmDel, setConfirmDel] = useState(false);

  const locked = m.purchased;
  const can = canEdit && !busy;
  const canProcure = can && !locked;
  const patch = (p: Parameters<typeof eventOps.material>[1], ok?: () => void) => run(eventOps.material(m.id, p), ok);

  return (
    <Dialog open onClose={onClose} title="Malzeme" wide>
      <div className={s.sec} style={{ gap: "var(--s-4)" }}>
        <input className={s.nameInput} value={name} maxLength={200} aria-label="Malzeme adı" readOnly={!canProcure}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            const n = name.trim();
            if (n === "") setName(m.name);
            else if (n !== m.name) patch({ name: n });
          }} />

        {locked && (
          <p className={s.locked}><Icon name="lock" size={14} /> Maliye satın alındı olarak işaretledi. Ad, adet, adımlar, bütçe ve teklifler kilitli; not, öncelik ve teslim işareti düzenlenebilir.</p>
        )}

        <div className={cx(s.row, s.chipRow)}>
          <Picker<Priority> look="chip" className={s.chip} label="Öncelik" value={m.priority} disabled={!can}
            options={PRIORITY_ORDER.map((p) => ({ value: p, label: PRIORITY[p] }))}
            onChange={(p) => patch({ priority: p })} />
          <Picker<MaterialType> look="chip" className={s.chip} label="Tür" value={m.type} disabled={!canProcure}
            options={TYPES.map((t) => ({ value: t, label: MATERIAL_TYPE[t] }))}
            onChange={(t) => patch({ type: t })} />
          <label className={cx(s.chip, s.chipField)}>Adet
            <input className={s.chipInput} type="number" min={1} step={1} placeholder="isteğe bağlı" value={qty}
              readOnly={!canProcure} onChange={(e) => setQty(e.target.value)}
              onBlur={() => {
                const n = qty === "" ? 1 : Math.max(1, Math.round(Number(qty)));
                setQty(n > 1 ? String(n) : "");
                if (n !== m.qty) patch({ qty: n });
              }} />
          </label>
          <label className={cx(s.chip, s.chipField)}>Bütçe ₺
            <input className={s.chipInput} type="number" min={0} step="0.01" placeholder="isteğe bağlı" value={budget}
              readOnly={!canProcure || !canBudget} onChange={(e) => setBudget(e.target.value)}
              onBlur={() => {
                const v = budget.trim() === "" ? null : Number(budget);
                if (v !== null && !(v > 0)) { setBudget(m.budget === null ? "" : String(m.budget)); return; }
                if (v !== m.budget) patch({ budget: v });
              }} />
          </label>
          <button type="button" className={s.chip} aria-pressed={m.has_sponsor} disabled={!canProcure || m.owned}
            onClick={() => { setEditing(null); patch({ has_sponsor: !m.has_sponsor }); }}>
            <Icon name="send" size={13} />{m.has_sponsor ? "Sponsordan istendi · kaldır" : "Sponsordan iste"}
          </button>
          <button type="button" className={s.chip} aria-pressed={m.owned} disabled={!canProcure}
            onClick={() => patch({ owned: !m.owned })}>
            <Icon name="home" size={13} />Zaten var
          </button>
        </div>

        <div className={s.sec}>
          <div className={s.label}>Süreç</div>
          <div className={s.road} role="group" aria-label="Süreç adımları">
            {MATERIAL_STEPS.map((label, i) => {
              const done = i < m.state;
              return (
                <button key={label} type="button" className={s.pt} aria-pressed={done} disabled={!canProcure || m.owned}
                  aria-label={`${label}${done ? ", tamam, geri al" : ", işaretle"}`}
                  onClick={() => patch({ state: done ? i : i + 1 })}>
                  <span className={s.dot}>{done && <Icon name="check" size={11} />}</span>
                  <span className={s.ptLabel}>{label}</span>
                </button>
              );
            })}
            <button type="button" className={cx(s.pt, s.ptDelivered)} aria-pressed={m.delivered} disabled={!can || m.state !== 3 || m.owned}
              aria-label={m.delivered ? "Teslim edildi, geri al" : "Teslim edildi, işaretle"}
              onClick={() => patch({ delivered: !m.delivered })}>
              <span className={s.dot}>{m.delivered && <Icon name="truck" size={11} />}</span>
              <span className={s.ptLabel}>Teslim edildi</span>
            </button>
          </div>
          {!m.owned && m.state !== 3 && <p className={s.note}>Onaylanan kalem teslim edilebilir.</p>}
        </div>

        <div className={s.sec}>
          <label className={s.label} htmlFor="mat-notes">Not</label>
          <textarea id="mat-notes" className={s.textarea} rows={2} value={notes} readOnly={!can}
            placeholder="Ölçü, marka, kimle konuşuldu…" onChange={(e) => setNotes(e.target.value)}
            onBlur={() => { if (notes.trim() !== (m.notes ?? "")) patch({ notes: notes.trim() === "" ? null : notes }); }} />
        </div>

        <div className={s.sec}>
          <div className={s.label}>Teklifler <small>son seçim sende</small></div>
          <Timeline m={m} eventDate={eventDate} />
          <Offers m={m} eventDate={eventDate} can={canProcure} run={run} editing={editing} setEditing={setEditing} />
          {canProcure && <ProviderForm m={m} run={run} />}
        </div>

        <div className={s.foot}>
          {confirmDel ? (
            <span className={s.confirm}>Bu kalem ve teklifleri silinecek.
              <Button size="sm" variant="danger" disabled={!canProcure} onClick={() => run(eventOps.dropMaterial(m.id), onClose)}>Evet, sil</Button>
              <Button size="sm" onClick={() => setConfirmDel(false)}>Vazgeç</Button>
            </span>
          ) : (
            <Button size="sm" variant="ghost" disabled={!canProcure} onClick={() => setConfirmDel(true)}><Icon name="trash" size={14} /> Sil</Button>
          )}
          <span className={s.stamp}>son güncelleme {ago(m.updated_at)}</span>
        </div>
      </div>
    </Dialog>
  );
}

// --- butce asimi -------------------------------------------------------------------

/** Teklifin butceye gore kademesi ($, $$, $$$) ve yuzdesi. Kademe sunucudan gelir. */
function OfferMark({ m, p }: { m: Material; p: MaterialProvider }) {
  if (m.budget === null || p.overage_level === null) return null;
  const pct = overPct(p.price, m.budget);
  const tone = p.overage_level === 0 ? s.tagOk : p.overage_level === 1 ? s.tagWarn : s.tagErr;
  return (
    <span className={s.overage} title={`Bütçe ${money.format(m.budget)}`}>
      <span className={cx(s.tag, tone)}>{OVERAGE_MARK[p.overage_level]}</span>
      <span className={s.ln}>{pct !== null && pct > 0 ? `%${pct} üstünde` : "içinde"}</span>
    </span>
  );
}

// --- zaman cizgisi ----------------------------------------------------------------

type Mark = { id: string; letter: string; date: string };

function Timeline({ m, eventDate }: { m: Material; eventDate: string | null }) {
  const marks: Mark[] = m.providers.flatMap((p, i) =>
    p.arrival_date === null ? [] : [{ id: p.id, letter: String.fromCharCode(65 + i), date: p.arrival_date }]);
  if (m.has_sponsor && m.sponsor_date !== null) marks.push({ id: "sponsor", letter: "S", date: m.sponsor_date });
  if (eventDate === null || marks.length === 0) return null;

  const today = toIsoDay(new Date());
  const times = [today, eventDate, ...marks.map((x) => x.date)].map((d) => Date.parse(d)).sort((a, b) => a - b);
  const from = times[0]! - 864e5, to = times[times.length - 1]! + 864e5;
  const pos = (d: string) => ((Date.parse(d) - from) / (to - from)) * 100;
  const rowTop = [52, 68, 84];
  const last = [-99, -99, -99];
  const placed = [...marks].sort((a, b) => pos(a.date) - pos(b.date)).map((x) => {
    const px = pos(x.date);
    let row = 0;
    while (row < 2 && px - last[row]! < 15) row++;
    last[row] = px;
    return { ...x, px, row };
  });
  const ev = pos(eventDate);
  return (
    <div className={s.tl} role="img" aria-label="Teklif varış tarihleri ve etkinlik günü">
      <div className={s.tlTrack} />
      <div className={s.tlLate} style={{ left: `${ev}%` }} />
      <span className={s.tlTop} style={{ left: `${pos(today)}%` }}>bugün</span>
      <span className={cx(s.tlTop, s.tlTopEvent)} style={{ left: `${ev}%` }}>Etkinlik · {formatDay(eventDate)}</span>
      <span className={s.tlEvent} style={{ left: `${ev}%` }} />
      {placed.map((x) => (
        <span key={x.id}>
          <span className={cx(s.tlDot, x.date > eventDate && s.tlDotLate, (x.id === m.chosen_provider_id || (x.id === "sponsor" && m.sponsor_chosen)) && s.tlDotSel)}
            style={{ left: `${x.px}%` }} />
          <span className={s.tlLabel} style={{ left: `${x.px}%`, top: rowTop[x.row] }}>{x.letter} · {formatDay(x.date)}</span>
        </span>
      ))}
    </div>
  );
}

// --- teklif kartlari ---------------------------------------------------------------

function arrivalLine(eventDate: string | null, date: string | null) {
  if (date === null) return <span className={s.ln}>varış tarihi yok</span>;
  if (eventDate === null) return <span className={s.ln}>{formatDay(date)}</span>;
  const d = daysBefore(eventDate, date);
  return (
    <span className={s.ln}>{formatDay(date)} · {d > 0 ? <span className={s.okT}>{d} gün önce</span>
      : d === 0 ? <span className={s.warnT}>etkinlik günü</span> : <span className={s.errT}>{-d} gün geç</span>}</span>
  );
}

function Offers({ m, eventDate, can, run, editing, setEditing }: {
  m: Material; eventDate: string | null; can: boolean; run: Run; editing: string | null; setEditing: (id: string | null) => void;
}) {
  const bestPrice = bestOffer(m).price;
  const choose = (id: string, sel: boolean) => run(eventOps.material(m.id, { chosen: sel ? null : id }));
  if (m.providers.length === 0 && !m.has_sponsor) return <p className={s.note}>Henüz teklif yok.</p>;
  return (
    <div className={s.pvs}>
      {m.has_sponsor && (editing === "sponsor"
        ? <SponsorEdit m={m} run={run} done={() => setEditing(null)} />
        : (
          <div className={cx(s.pv, s.pvSponsor, m.sponsor_chosen && s.pvSel)}>
            <div className={s.pvTop}>
              <span className={s.letter}><Icon name="send" size={11} /></span><span className={s.pvName}>Sponsor</span>
              {can && <IconButton icon="edit" label="Sponsor bilgilerini düzenle" onClick={() => setEditing("sponsor")} />}
            </div>
            <div className={s.bigRow}><span className={s.big}>{money.format(0)}</span>{m.sponsor_chosen && <span className={cx(s.tag, s.tagOk)}>Seçildi</span>}</div>
            <span className={s.ln}>
              {m.sponsor_qty === null ? "Adet girilmedi, tümünü karşılar"
                : m.sponsor_qty >= m.qty ? `${m.sponsor_qty} adet karşılar`
                : <>{m.sponsor_qty} adet karşılar, <span className={s.warnT}>kalan {m.qty - m.sponsor_qty} adet sende</span></>}
            </span>
            {arrivalLine(eventDate, m.sponsor_date)}
            <span className={s.pvGap} />
            <Button size="sm" disabled={!can} onClick={() => choose("sponsor", m.sponsor_chosen)}>{m.sponsor_chosen ? "Seçimi kaldır" : "Bunu seç"}</Button>
          </div>
        ))}
      {m.providers.map((p, i) => editing === p.id
        ? <ProviderEdit key={p.id} p={p} letter={String.fromCharCode(65 + i)} run={run} done={() => setEditing(null)} />
        : <ProviderCard key={p.id} m={m} p={p} letter={String.fromCharCode(65 + i)} bestPrice={bestPrice} eventDate={eventDate} can={can}
            run={run} edit={() => setEditing(p.id)} choose={() => choose(p.id, m.chosen_provider_id === p.id)} />)}
    </div>
  );
}

function ProviderCard({ m, p, letter, bestPrice, eventDate, can, run, edit, choose }: {
  m: Material; p: MaterialProvider; letter: string; bestPrice: number | null; eventDate: string | null; can: boolean;
  run: Run; edit: () => void; choose: () => void;
}) {
  const sel = m.chosen_provider_id === p.id;
  const phone = kindOf(p) === "phone";
  const unit = unitPrice(p.price, m.qty);
  return (
    <div className={cx(s.pv, sel && s.pvSel)}>
      <div className={s.pvTop}>
        <span className={s.letter}>{letter}</span>
        <span className={s.pvName}>{phone
          ? (p.name ?? p.contact)
          : <a className={s.pvLink} href={hrefOf(p.contact)} target="_blank" rel="noopener noreferrer">{p.contact.replace(/^https?:\/\/(www\.)?/, "")}</a>}</span>
        {can && <IconButton icon="edit" label={`${p.name ?? p.contact} teklifini düzenle`} onClick={edit} />}
        {can && <IconButton icon="x" label={`${p.name ?? p.contact} teklifini sil`} onClick={() => run(eventOps.dropProvider(p.id))} />}
      </div>
      {phone && p.name !== null && <span className={s.ln}>{p.contact}</span>}
      <div className={s.bigRow}>
        <span className={s.big}>{p.price === null ? "—" : money.format(p.price)}</span>
        <OfferMark m={m} p={p} />
        {sel && <span className={cx(s.tag, s.tagOk)}>Seçildi</span>}
      </div>
      {m.qty > 1 && unit !== null && <span className={s.ln}>{money.format(unit)} / adet</span>}
      {p.price === null ? <span className={s.ln}>fiyat girilmemiş</span>
        : bestPrice !== null && p.price === bestPrice ? <span className={cx(s.ln, s.okT)}>en düşük teklif</span>
        : bestPrice !== null && <span className={cx(s.ln, s.warnT)}>+{money.format(p.price - bestPrice)}{bestPrice > 0 ? ` (%${Math.round(((p.price - bestPrice) / bestPrice) * 100)})` : ""}</span>}
      {arrivalLine(eventDate, p.arrival_date)}
      <span className={s.pvGap} />
      <Button size="sm" disabled={!can} onClick={choose}>{sel ? "Seçimi kaldır" : "Bunu seç"}</Button>
    </div>
  );
}

/** Baglanti ya da telefon secici; telefonda isim alani ayrica gelir. */
function ContactFields({ kind, onKind, contact, onContact, name, onName }: {
  kind: Kind; onKind: (k: Kind) => void;
  contact: string; onContact: (v: string) => void;
  name: string; onName: (v: string) => void;
}) {
  return (
    <>
      <div className={cx(s.row, s.kindRow)} role="group" aria-label="Teklif türü">
        <button type="button" className={s.toggle} aria-pressed={kind === "link"} onClick={() => onKind("link")}>Bağlantı</button>
        <button type="button" className={s.toggle} aria-pressed={kind === "phone"} onClick={() => onKind("phone")}>Telefon</button>
      </div>
      {kind === "phone" ? (
        <div className={s.pair}>
          <label>Telefon<input className={ui.input} value={contact} maxLength={300} placeholder="0532…" onChange={(e) => onContact(e.target.value)} /></label>
          <label>İsim<input className={ui.input} value={name} maxLength={200} placeholder="kişi ya da firma" onChange={(e) => onName(e.target.value)} /></label>
        </div>
      ) : (
        <label>Bağlantı<input className={ui.input} value={contact} maxLength={300} placeholder="firma.com" onChange={(e) => onContact(e.target.value)} /></label>
      )}
    </>
  );
}

function ProviderEdit({ p, letter, run, done }: { p: MaterialProvider; letter: string; run: Run; done: () => void }) {
  const [kind, setKind] = useState<Kind>(kindOf(p));
  const [contact, setContact] = useState(p.contact);
  const [name, setName] = useState(p.name ?? "");
  const [price, setPrice] = useState(p.price === null ? "" : String(p.price));
  const [date, setDate] = useState<string | null>(p.arrival_date);
  return (
    <form className={cx(s.pv, s.pvEdit)} onSubmit={(e) => {
      e.preventDefault();
      if (contact.trim() === "") return;
      run(eventOps.provider(p.id, {
        contact: contact.trim(),
        name: kind === "phone" && name.trim() !== "" ? name.trim() : null,
        price: price === "" ? null : Number(price),
        arrival_date: date,
      }), done);
    }}>
      <div className={s.pvTop}><span className={s.letter}>{letter}</span><span className={s.pvName}>Teklifi düzenle</span></div>
      <ContactFields kind={kind} onKind={setKind} contact={contact} onContact={setContact} name={name} onName={setName} />
      <label>Toplam fiyat ₺<input className={ui.input} type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
      <label>Varış tarihi<DateField aria-label="Varış tarihi" placeholder="Seç" value={date} onChange={setDate} clearable /></label>
      <div className={s.pvBtns}><Button size="sm" onClick={done}>Vazgeç</Button><Button size="sm" variant="primary" type="submit" disabled={contact.trim() === ""}>Kaydet</Button></div>
    </form>
  );
}

function SponsorEdit({ m, run, done }: { m: Material; run: Run; done: () => void }) {
  const [qty, setQty] = useState(m.sponsor_qty === null ? "" : String(m.sponsor_qty));
  const [date, setDate] = useState<string | null>(m.sponsor_date);
  return (
    <form className={cx(s.pv, s.pvSponsor, s.pvEdit)} onSubmit={(e) => {
      e.preventDefault();
      const n = qty === "" ? null : Math.max(1, Math.round(Number(qty)));
      run(eventOps.material(m.id, { sponsor_qty: n, sponsor_date: date }), done);
    }}>
      <div className={s.pvTop}><span className={s.letter}><Icon name="send" size={11} /></span><span className={s.pvName}>Sponsor</span></div>
      <label>Karşılayacağı adet<input className={ui.input} type="number" min={1} step={1} value={qty} placeholder="isteğe bağlı" onChange={(e) => setQty(e.target.value)} autoFocus /></label>
      <label>Varış tarihi<DateField aria-label="Sponsor varış tarihi" placeholder="isteğe bağlı" value={date} onChange={setDate} clearable /></label>
      <div className={s.pvBtns}><Button size="sm" onClick={done}>Vazgeç</Button><Button size="sm" variant="primary" type="submit">Kaydet</Button></div>
    </form>
  );
}

function ProviderForm({ m, run }: { m: Material; run: Run }) {
  const [kind, setKind] = useState<Kind>("link");
  const [contact, setContact] = useState("");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [date, setDate] = useState<string | null>(null);
  return (
    <form className={s.pvForm} onSubmit={(e) => {
      e.preventDefault();
      if (contact.trim() === "") return;
      run(eventOps.addProvider(m.id, {
        contact: contact.trim(),
        name: kind === "phone" && name.trim() !== "" ? name.trim() : null,
        price: price === "" ? null : Number(price),
        arrival_date: date,
      }), () => { setContact(""); setName(""); setPrice(""); setDate(null); });
    }}>
      <ContactFields kind={kind} onKind={setKind} contact={contact} onContact={setContact} name={name} onName={setName} />
      <label>Toplam fiyat ₺<input className={ui.input} type="number" min={0} step="0.01" value={price} placeholder="0" onChange={(e) => setPrice(e.target.value)} /></label>
      <label>Varış tarihi<DateField aria-label="Varış tarihi" placeholder="Seç" value={date} onChange={setDate} clearable /></label>
      <Button size="sm" type="submit" disabled={contact.trim() === ""}><Icon name="plus" size={14} /> Teklif ekle</Button>
    </form>
  );
}
