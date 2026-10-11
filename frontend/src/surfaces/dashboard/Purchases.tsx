// Satin alimlar widget'i (spec/73 §5): adim sutunlu pano (varsayilan) ya da liste,
// altta sponsor seridi. Karta/satira basinca ayni detay penceresi acilir. Kart
// sutunlar arasinda suruklenir (state yazar); sponsor seridine birakmak kalemi
// yerinden almaz, "sponsordan istendi" isareti koyar. Yazmak `manage_purchases`
// ister; yetkisiz goruntu salt okunur.

import { useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { errorText } from "../../api/client";
import { eventOps, useEventWrite } from "../../api/hooks";
import type { Material, Uuid } from "../../api/types";
import r from "../../features/record/record.module.css";
import { ago, formatDay } from "../../lib/labels";
import { useLookup } from "../../lib/lookup";
import { Icon } from "../../ui/icons";
import { cx, IconButton, Segmented, ui, useToast } from "../../ui/ui";
import {
  BOARD_COLUMNS, columnOf, dropState, etaOf, isLate, MATERIAL_STAGE, MATERIAL_TYPE, money, priceOf, purchaseHealth,
  purchaseTotals, type PurchaseHealth,
} from "./eventModel";
import d from "./dashboard.module.css";
import { MaterialDetail } from "./MaterialDetail";
import { PrioMark, type Run } from "./purchaseParts";
import s from "./purchases.module.css";
import { SuggestCards } from "./SuggestCards";

const HEALTH: Record<PurchaseHealth, string> = {
  none: "Henüz gerekli görülen yok",
  ok: "Gerekenlerin hepsi onaylı",
  warn: "Onay bekleyen var",
  err: "Kritik malzeme onay bekliyor",
};

type View = "board" | "list";
type DropKey = number | "lane";

/** Satiri klavye ile de acilabilir yapar (role=button). */
function onKey(open: () => void) {
  return (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    }
  };
}

export function Purchases({ eventId, eventDate, items, onRemove }: {
  eventId: Uuid;
  /** Etkinlik gunu; havuzdaki (tarihsiz) etkinlikte null: gecikme uyarisi yok. */
  eventDate: string | null;
  items: Material[];
  /** Yoksa kaldirma dugmesi cizilmez (sablon widget'i, scope yok). */
  onRemove?: (() => void) | undefined;
}) {
  const L = useLookup();
  const canEdit = L.can("manage_purchases");
  // Öneriyi kabul edemeyene ya da kapsamı olmayana pasif öneri bile gösterilmez (spec/79 §9).
  const canSuggest = canEdit && L.can("use_generative_ai") && !(L.meta.external_off ?? []).includes("suggest");
  const [view, setView] = useState<View>("board");
  const [openId, setOpenId] = useState<Uuid | null>(null);
  const [over, setOver] = useState<DropKey | null>(null);
  const dragging = useRef<Uuid | null>(null);
  const w = useEventWrite();
  const toast = useToast();
  const run: Run = (op, ok) =>
    w.mutate(op, { onSuccess: () => ok?.(), onError: (e) => toast({ text: errorText(e), error: true }) });

  const health = purchaseHealth(items);
  const { total, approved } = purchaseTotals(items);
  const lateN = items.filter((m) => isLate(m, eventDate)).length;
  const last = items.reduce((a, m) => (m.updated_at > a ? m.updated_at : a), "");
  const open = items.find((m) => m.id === openId) ?? null;
  const names = items.map((m) => m.name);

  const move = (id: Uuid, to: DropKey) => {
    const m = items.find((x) => x.id === id);
    if (m === undefined) return;
    if (to === "lane") {
      if (m.owned) toast({ text: "Elinde olan kalem sponsordan istenmez.", error: true });
      else if (!m.has_sponsor) run(eventOps.material(id, { has_sponsor: true }));
    } else if (columnOf(m) !== to) {
      const state = dropState(to, m);
      run(eventOps.material(id, m.owned ? { owned: false, state } : { state }));
    }
  };

  /** Birakma hedefi: yalniz yetkili kullanici suruklerken. */
  const target = (key: DropKey) => ({
    "data-drop": String(key),
    onDragOver: (e: DragEvent) => {
      if (!canEdit || dragging.current === null) return;
      e.preventDefault();
      setOver(key);
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === key ? null : o));
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      const id = dragging.current;
      dragging.current = null;
      setOver(null);
      if (canEdit && id !== null) move(id, key);
    },
  });

  const card = (m: Material, showStage: boolean) => {
    const price = m.owned ? "" : m.sponsor_chosen ? "Sponsor" : (() => { const p = priceOf(m); return p === null ? "—" : money.format(p); })();
    return (
      <div key={m.id} role="button" tabIndex={0} draggable={canEdit} aria-label={`${m.name}, ayrıntıyı aç`}
        className={cx(s.mcard, m.owned && s.mcardOwn, !m.owned && m.priority === "critical" && m.state < 3 && s.mcardCrit)}
        onClick={() => setOpenId(m.id)} onKeyDown={onKey(() => setOpenId(m.id))}
        onDragStart={(e) => {
          dragging.current = m.id;
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", m.id);
          e.currentTarget.classList.add(s.dragging);
        }}
        onDragEnd={(e) => {
          dragging.current = null;
          setOver(null);
          e.currentTarget.classList.remove(s.dragging);
        }}>
        <div className={s.mcTop}>
          {m.delivered ? <span className={s.lead} data-kind="delivered" title="Teslim edildi"><Icon name="truck" size={16} /></span>
            : m.owned ? <span className={s.lead} data-kind="owned" title="Zaten var"><Icon name="home" size={16} /></span>
            : <PrioMark p={m.priority} />}
          <span className={s.mcName}>{m.name}</span>
        </div>
        <div className={s.mcMeta}>
          <span className={s.tag}>{MATERIAL_TYPE[m.type]}</span>
          {showStage && !m.owned && <span className={s.tag}>{MATERIAL_STAGE[m.state]}</span>}
          {m.owned && <span className={cx(s.tag, s.tagOk)}>Zaten var</span>}
          {m.has_sponsor && <span className={cx(s.tag, s.tagAcc)} title="Sponsordan istendi"><Icon name="send" size={11} /></span>}
          {isLate(m, eventDate) && <span className={cx(s.tag, s.tagErr)} title="Beklenen varış etkinlikten sonra">Teslim geç</span>}
          <span className={s.price}>{price}</span>
        </div>
      </div>
    );
  };

  const lane = items.filter((m) => m.has_sponsor && !m.owned);

  return (
    <div className={cx(r.card, r.cardHover, d.evWide)}>
      <div className={r.cardHead}>
        <Icon name="box" size={18} />
        <b>Satın alımlar</b>
        <span className={s.health} data-health={health} title={HEALTH[health]}>
          <span className={s.healthDot} aria-hidden="true" />
          {HEALTH[health]}
        </span>
        <span className={s.grow} />
        <a className={cx(ui.btn, ui["z-sm"])} href={`/api/events/${eventId}/purchases.xlsx`} download
          title="Onaylı ve teslim edilen kalemler, Excel">
          <Icon name="download" size={14} /> Excel
        </a>
        <Segmented label="Görünüm" value={view} onChange={setView}
          options={[{ value: "board", label: "Pano" }, { value: "list", label: "Liste" }]} />
        {onRemove !== undefined && (
          <span className={r.cardActs}>
            <IconButton icon="trash" label="Widget'ı kaldır (veri silinmez)" onClick={onRemove} />
          </span>
        )}
      </div>

      <div className={s.sums}>
        <span className={s.chip}>{items.length} kalem</span>
        <span className={s.chip}>Toplam <b>{money.format(total)}</b></span>
        <span className={s.chip}>Onaylı <b>{money.format(approved)}</b></span>
        {lateN > 0 && <span className={cx(s.chip, s.chipErr)}>{lateN} teslimat etkinlikten sonra</span>}
        {last !== "" && <span className={s.chip}>son güncelleme {ago(last)}</span>}
      </div>

      {view === "board" ? (
        <>
          <div className={s.board}>
            {BOARD_COLUMNS.map((c, i) => {
              const its = items.filter((m) => columnOf(m) === i);
              const sum = its.filter((m) => !m.owned).reduce((a, m) => a + (priceOf(m) ?? 0), 0);
              return (
                <section key={c.name} aria-label={c.name} className={cx(s.col, over === i && s.over)} {...target(i)}>
                  <div className={s.colHead}>
                    <b>{c.name}</b><span className={s.colCount}>{its.length}</span>
                    <span className={s.colSum}>{sum > 0 ? money.format(sum) : ""}</span>
                  </div>
                  {its.length === 0 ? <p className={s.empty}>Boş.{canEdit ? " Bir kartı buraya sürükle." : ""}</p> : its.map((m) => card(m, i === 1))}
                  {i === 0 && canSuggest && (
                    <SuggestCards key={eventId} eventId={eventId} existing={names} run={run} busy={w.isPending} />
                  )}
                  {i === 0 && canEdit && <AddForm eventId={eventId} run={run} busy={w.isPending} />}
                </section>
              );
            })}
          </div>
          <section aria-label="Sponsordan istenenler" className={cx(s.lane, over === "lane" && s.laneOver)} {...target("lane")}>
            <div className={s.laneHead}><b>Sponsor</b><span className={s.colCount}>{lane.length}</span></div>
            {lane.length === 0
              ? <span className={s.laneHint}>{canEdit ? "Kartı buraya bırak. Kart sütununda kalır." : "Sponsordan istenen kalem yok."}</span>
              : lane.map((m) => (
                <button key={m.id} type="button" className={s.laneChip} onClick={() => setOpenId(m.id)}>
                  <PrioMark p={m.priority} />{m.name}
                </button>
              ))}
          </section>
        </>
      ) : (
        <>
          <div className={s.list}>
            {items.length === 0 && <span className={r.muted}>Malzeme yok.</span>}
            {[...items.filter((m) => !m.owned), ...items.filter((m) => m.owned)].map((m) => {
              const eta = etaOf(m);
              const price = m.owned ? null : priceOf(m);
              return (
                <div key={m.id} role="button" tabIndex={0} aria-label={`${m.name}, ayrıntıyı aç`}
                  className={cx(s.lrow, m.owned && s.lrowOwn)} onClick={() => setOpenId(m.id)} onKeyDown={onKey(() => setOpenId(m.id))}>
                  <span className={s.lname}>
                    {m.delivered ? <span className={s.lead} data-kind="delivered" title="Teslim edildi"><Icon name="truck" size={16} /></span>
                      : m.owned ? <span className={s.lead} data-kind="owned" title="Zaten var"><Icon name="home" size={16} /></span>
                      : <PrioMark p={m.priority} />}
                    <b>{m.name}</b>
                    {m.qty > 1 && <span className={s.qty}>{m.qty} adet</span>}
                    <span className={s.tag}>{MATERIAL_TYPE[m.type]}</span>
                    {m.has_sponsor && <span className={cx(s.tag, s.tagAcc)}>Sponsor</span>}
                    {isLate(m, eventDate) && <span className={cx(s.tag, s.tagErr)}>Teslim geç</span>}
                  </span>
                  {m.owned ? <span /> : (
                    <span className={s.pipe}>
                      <span className={s.pipeBars} aria-hidden="true">
                        {[0, 1, 2].map((i) => <span key={i} data-done={i < m.state} />)}
                      </span>
                      <span className={s.pipeLabel}>{MATERIAL_STAGE[m.state]}{m.state === 2 ? " · sıradaki: onay" : ""}</span>
                    </span>
                  )}
                  <span className={s.price}>{m.sponsor_chosen ? "Sponsor" : price === null ? "—" : money.format(price)}</span>
                  <span className={s.ldate}>{eta === null ? "" : formatDay(eta)}</span>
                </div>
              );
            })}
          </div>
          {canSuggest && (
            <div className={s.addList}>
              <SuggestCards key={eventId} eventId={eventId} existing={names} run={run} busy={w.isPending} />
            </div>
          )}
          {canEdit && <div className={s.addList}><AddForm eventId={eventId} run={run} busy={w.isPending} /></div>}
        </>
      )}

      {!canEdit && (
        <span className={r.muted}><Icon name="lock" size={13} /> Düzenlemek için “Satın alımları yönet” yetkisi gerekir.</span>
      )}

      {open !== null && (
        <MaterialDetail m={open} eventDate={eventDate} canEdit={canEdit} canBudget={L.can("manage_budgets")} busy={w.isPending} run={run} onClose={() => setOpenId(null)} />
      )}
    </div>
  );
}

/** Tek alan, dugmesiz: Enter ekler. Adet, oncelik ve tur detayda ayarlanir. */
function AddForm({ eventId, run, busy }: { eventId: Uuid; run: Run; busy: boolean }) {
  const [name, setName] = useState("");
  return (
    <form className={s.addForm} onSubmit={(e) => {
      e.preventDefault();
      if (name.trim() === "" || busy) return;
      run(eventOps.addMaterial(eventId, name.trim()), () => setName(""));
    }}>
      <Icon name="plus" size={14} />
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Malzeme ekle" aria-label="Yeni malzeme"
        maxLength={200} autoComplete="off" />
    </form>
  );
}
