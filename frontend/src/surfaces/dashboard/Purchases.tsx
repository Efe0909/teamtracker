// Satin alimlar widget'i (spec/73 §5): malzeme listesi, her satirda elle
// ilerletilen surec adimlari, tikla-ac tedarikci tablosu. Baslik noktasi
// "gerekli" adimini gecmislerin durumunu ozetler. Yazmak `manage_purchases`
// ister; yetkisiz goruntu salt okunur.
//
// ponytail: degisiklikler ust bilesenin belleginde (sahte veri) — API gelince
// her islem tek PATCH/POST.

import { useState } from "react";
import type { Priority } from "../../api/types";
import r from "../../features/record/record.module.css";
import { ago, formatDay, PRIORITY } from "../../lib/labels";
import { useLookup } from "../../lib/lookup";
import { Icon, type IconName } from "../../ui/icons";
import { Button, cx, IconButton, Menu, MenuItem, MenuSep, ui } from "../../ui/ui";
import s from "./dashboard.module.css";
import {
  bestOffer, MATERIAL_TYPE, materialSteps, purchaseHealth, type Material, type MaterialProvider, type PurchaseHealth,
} from "./eventModel";

const PRIO_ICON: Record<Priority, IconName> = { critical: "alert", high: "prHigh", medium: "prMedium", low: "prLow" };

const HEALTH: Record<PurchaseHealth, string> = {
  none: "Henüz gerekli görülen yok",
  ok: "Gerekenlerin hepsi onaylı",
  warn: "Onay bekleyen var",
  err: "Kritik malzeme onay bekliyor",
};

const money = new Intl.NumberFormat("tr", { style: "currency", currency: "TRY", maximumFractionDigits: 2 });

export function Purchases({ items, onChange, onRemove }: {
  items: Material[];
  onChange: (next: Material[]) => void;
  /** Yoksa kaldirma dugmesi cizilmez (sablon widget'i, scope yok). */
  onRemove?: (() => void) | undefined;
}) {
  const L = useLookup();
  const canEdit = L.can("manage_purchases");
  const [open, setOpen] = useState<string | null>(null);
  const [name, setName] = useState("");

  const patch = (id: string, p: Partial<Material>) =>
    onChange(items.map((m) => (m.id === id ? { ...m, ...p, updated_at: new Date().toISOString() } : m)));
  const health = purchaseHealth(items);
  const last = items.reduce((a, m) => (m.updated_at > a ? m.updated_at : a), "");
  // Elde olanlar sona; gerisi eklenme sirasinda.
  const rows = [...items.filter((m) => !m.owned), ...items.filter((m) => m.owned)];

  return (
    <div className={cx(r.card, r.cardHover, s.evWide)}>
      <div className={r.cardHead}>
        <Icon name="box" size={18} />
        <b>Satın alımlar</b>
        <span className={s.mHealth} data-health={health} title={HEALTH[health]}>
          <span className={s.mHealthDot} aria-hidden="true" />
          {HEALTH[health]}
        </span>
        {last !== "" && <span className={r.muted}>son güncelleme {ago(last)}</span>}
        {onRemove !== undefined && (
          <span className={r.cardActs}>
            <IconButton icon="trash" label="Widget'ı kaldır (veri silinmez)" onClick={onRemove} />
          </span>
        )}
      </div>

      {rows.length === 0 ? <span className={r.muted}>Malzeme yok.</span> : (
        <ul className={s.mList}>
          {rows.map((m) => (
            <Row key={m.id} m={m} canEdit={canEdit} open={open === m.id}
              onToggle={() => setOpen(open === m.id ? null : m.id)}
              onPatch={(p) => patch(m.id, p)}
              onDelete={() => onChange(items.filter((x) => x.id !== m.id))} />
          ))}
        </ul>
      )}

      {canEdit ? (
        <form className={s.mAdd} onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() === "") return;
          onChange([...items, {
            id: `m${Date.now()}`, name: name.trim(), notes: null, type: "consumable", priority: "medium", state: 0,
            has_sponsor: false, owned: false, updated_at: new Date().toISOString(), providers: [],
          }]);
          setName("");
        }}>
          <input className={ui.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Malzeme ya da hizmet adı…"
            aria-label="Yeni malzeme" maxLength={200} />
          <Button size="sm" type="submit" disabled={name.trim() === ""}><Icon name="plus" size={14} /> Ekle</Button>
        </form>
      ) : (
        <span className={r.muted}><Icon name="lock" size={13} /> Düzenlemek için “Satın alımları yönet” yetkisi gerekir.</span>
      )}
    </div>
  );
}

function Row({ m, canEdit, open, onToggle, onPatch, onDelete }: {
  m: Material; canEdit: boolean; open: boolean; onToggle: () => void; onPatch: (p: Partial<Material>) => void; onDelete: () => void;
}) {
  const steps = materialSteps(m);
  const best = bestOffer(m);
  return (
    <li className={s.mRow} data-owned={m.owned}>
      <div className={s.mLine}>
        <button type="button" className={s.mToggle} aria-expanded={open} onClick={onToggle}>
          <span className={cx(r.caret, open && r.caretOpen)}><Icon name="chevron" size={13} /></span>
          <span className={s.mPrio} data-p={m.priority} title={`Öncelik: ${PRIORITY[m.priority]}`}>
            <Icon name={PRIO_ICON[m.priority]} size={14} />
          </span>
          <span className={s.mName}>{m.name}</span>
          <span className={s.mType}>{MATERIAL_TYPE[m.type]}</span>
        </button>

        {m.owned ? (
          <span className={s.mOwned}><Icon name="check" size={13} /> Zaten var</span>
        ) : (
          // Adim noktalari: tamam olana tikla → o adim ve sonrasi geri alinir; tamam olmayana → oraya kadar ilerler.
          <span className={s.mPipe} role="group" aria-label={`${m.name} süreci: ${m.state}/${steps.length}`}>
            {steps.map((label, i) => (
              <button key={label} type="button" className={s.mStep} data-done={i < m.state}
                disabled={!canEdit} title={`${label}${i < m.state ? " — tamam" : ""}`}
                aria-label={`${label}${i < m.state ? " — tamam, geri al" : " — işaretle"}`}
                onClick={() => onPatch({ state: i < m.state ? i : i + 1 })} />
            ))}
          </span>
        )}

        <span className={s.mPrice}>{best.price === null ? "—" : money.format(best.price)}</span>
        <span className={s.mDate}>{best.date === null ? "" : formatDay(best.date)}</span>

        {canEdit ? (
          <Menu align="end" trigger={<IconButton icon="more" label={`${m.name} seçenekleri`} />}>
            <MenuItem icon="check" onSelect={() => onPatch({ owned: !m.owned })}>
              {m.owned ? "Zaten var işaretini kaldır" : "Zaten var olarak işaretle"}
            </MenuItem>
            <MenuItem icon="wallet" onSelect={() => onPatch(m.has_sponsor
              ? { has_sponsor: false, state: Math.min(m.state, 3) }
              : { has_sponsor: true })}>
              {m.has_sponsor ? "Sponsor adımını kaldır" : "Sponsorlu (adım ekle)"}
            </MenuItem>
            <MenuSep />
            <MenuItem icon="trash" danger onSelect={onDelete}>Sil</MenuItem>
          </Menu>
        ) : <span className={s.mMoreGap} />}
      </div>

      {open && <Providers m={m} canEdit={canEdit} onPatch={onPatch} best={best.price} />}
    </li>
  );
}

function Providers({ m, canEdit, onPatch, best }: {
  m: Material; canEdit: boolean; onPatch: (p: Partial<Material>) => void; best: number | null;
}) {
  const [contact, setContact] = useState("");
  const [price, setPrice] = useState("");
  const [date, setDate] = useState("");
  const link = (c: string) => /^https?:\/\//.test(c);
  return (
    <div className={s.mDetail}>
      {m.notes !== null && <p className={r.muted}>{m.notes}</p>}
      {m.providers.length === 0 ? <span className={r.muted}>Tedarikçi yok.</span> : (
        <table className={s.mProv}>
          <thead>
            <tr><th scope="col">Tedarikçi</th><th scope="col">Fiyat</th><th scope="col">Varış</th>{canEdit && <th />}</tr>
          </thead>
          <tbody>
            {m.providers.map((p) => (
              <tr key={p.id} data-best={p.price !== null && p.price === best}>
                <td>{link(p.contact) ? <a href={p.contact} target="_blank" rel="noopener noreferrer">{p.contact.replace(/^https?:\/\/(www\.)?/, "")}</a> : p.contact}</td>
                <td>{p.price === null ? "—" : money.format(p.price)}</td>
                <td>{p.arrival_date === null ? "—" : formatDay(p.arrival_date)}</td>
                {canEdit && (
                  <td>
                    <IconButton icon="x" label="Tedarikçiyi sil"
                      onClick={() => onPatch({ providers: m.providers.filter((x) => x.id !== p.id) })} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canEdit && (
        <form className={s.mProvAdd} onSubmit={(e) => {
          e.preventDefault();
          const p: MaterialProvider = {
            id: `p${Date.now()}`, contact: contact.trim(),
            price: price === "" ? null : Number(price), arrival_date: date === "" ? null : date,
          };
          onPatch({ providers: [...m.providers, p] });
          setContact(""); setPrice(""); setDate("");
        }}>
          <input className={ui.input} value={contact} onChange={(e) => setContact(e.target.value)} required
            placeholder="Bağlantı ya da telefon" aria-label="Tedarikçi" />
          <input className={ui.input} type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)}
            placeholder="Fiyat ₺" aria-label="Fiyat" />
          <input className={ui.input} type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Varış tarihi" />
          <Button size="sm" type="submit"><Icon name="plus" size={14} /> Tedarikçi</Button>
        </form>
      )}
    </div>
  );
}
