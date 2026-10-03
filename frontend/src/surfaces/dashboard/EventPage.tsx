// Etkinlik sayfasi — kayit sayfasinin AYNI iskeleti ve stilleri (RecordPage):
// sol is (baslik, ozellikler, widget'lar), sag sutun (zaman cizelgesi, kisiler,
// takimlar). Widget'lar kayit kartlarina benzer ama blob degil (spec/73 §3):
// widget sayfadaki YUVA, veri turun tablosunda ve etkinlige bagli — widget
// kaldirmak veriyi silmez. Widget/checkpoint'ler turun sablonundan gelir.
//
// Veri /api/events/{id} (Rust api/events.rs); her yazis guncel ayrintiyi doner
// ve onbellege yazilir (useEventWrite). Duzenleme yalniz `can_edit` ile.

import { useEffect, useState, type ReactNode } from "react";
import { ApiError, errorText } from "../../api/client";
import { eventOps, useEvent, useEventWrite, useRecord, useRecords } from "../../api/hooks";
import type { CheckpointAction, EventDetail, EventStatus, Uuid } from "../../api/types";
import { NodeListPicker } from "../../features/nodes/NodePicker";
import { NewRecordForm } from "../../features/record/NewRecordForm";
import { BallLine } from "../../features/record/parts";
import r from "../../features/record/record.module.css";
import { ago, formatDay, isDone, parseDay, PRIORITY, PRIORITY_ORDER, toIsoDay } from "../../lib/labels";
import { useLookup } from "../../lib/lookup";
import { handle } from "../../lib/mentions";
import { navigate } from "../../lib/router";
import { useStored } from "../../lib/stored";
import { Icon, type IconName } from "../../ui/icons";
import {
  Avatar, Button, cx, Dialog, Due, IconButton, KindTag, Link, Loading, Menu, MenuItem, MenuLabel, MenuSep, Picker, Popover,
  PriorityTag, Status, Tag, TeamName, ui, useToast, Who,
} from "../../ui/ui";
import { ErrorScreen } from "../errors/ErrorScreen";
import s from "./dashboard.module.css";
import { EVENT_STATUS, nodeName, placeLabel, WIDGET, WIDGET_TYPES } from "./eventModel";
import { Otf } from "./Otf";
import { Purchases } from "./Purchases";
import { href } from "./routes";

const whenFmt = new Intl.DateTimeFormat("tr", { day: "numeric", month: "long", weekday: "long" });
const STATUS_ORDER = Object.keys(EVENT_STATUS) as EventStatus[];

type Op = ReturnType<typeof eventOps.patch>;

/** Etkinlige yazis: hata toast'a, basarida istege bagli devam. */
function useRun() {
  const w = useEventWrite();
  const toast = useToast();
  const run = (op: Op, ok?: () => void) =>
    w.mutate(op, { onSuccess: () => ok?.(), onError: (x) => toast({ text: errorText(x), error: true }) });
  return { run, busy: w.isPending };
}

export function EventPage({ id }: { id: string }) {
  const q = useEvent(id);
  const title = q.data?.title;
  useEffect(() => {
    if (title !== undefined) document.title = `${title} — EkipTakip`;
  }, [title]);
  if (q.error !== null) {
    return <ErrorScreen code={q.error instanceof ApiError && q.error.code === "not_found" ? "not_found" : "network"} />;
  }
  if (q.data === undefined) return <Loading />;
  return <EventView key={q.data.id} e={q.data} />;
}

function EventView({ e }: { e: EventDetail }) {
  const L = useLookup();
  const { run } = useRun();
  // Kayit secilmemis kayit widget'i sunucuya GITMEZ (record_id sart); kayit
  // secilince/olusunca eklenir, gecici yuva duser.
  const [pending, setPending] = useState<string[]>([]);
  // Sablon widget'lari etkinlik acilirken gelir; eklemek/kaldirmak scope ister.
  // Kayit widget'i serbest (etkinligi duzenleyebilen herkes).
  const canStructure = L.can("manage_event_widgets");
  // Kayit disindaki turlerden etkinlikte en cok bir tane (spec/73 §3).
  const missing = WIDGET_TYPES.filter((t) => t !== "record" && !e.widgets.some((w) => w.type === t));
  const link = (rid: Uuid, temp?: string) =>
    run(eventOps.addWidget(e.id, "record", rid), () => {
      if (temp !== undefined) setPending((p) => p.filter((x) => x !== temp));
    });
  // Etkinligin kendi kaydi da "bagli" sayilir: widget olarak eklenemez.
  const linked = new Set([...e.widgets.flatMap((w) => (w.record_id === null ? [] : [w.record_id])), e.record_id]);
  const count = e.widgets.length + pending.length;

  return (
    <div className={s.recordPage}>
      <nav className={s.crumb} aria-label="Konum">
        <Link href={href({ name: "events", query: {} })}>Etkinlikler</Link>
        <Icon name="chevron" size={13} />
        <Link href={href({ name: "events", query: { kind: e.kind_id, ...(e.date === null ? { tab: "pool" } : {}) } })}>{nodeName(L.meta.nodes, e.kind_id)}</Link>
        <Icon name="chevron" size={13} />
        <b>{e.title}</b>
      </nav>
      <div className={s.recordBody}>
        <div className={s.recordMain}>
          <div className={s.recordInner}>
            <Requests e={e} />
            <Head e={e} />
            {/* Kayit sayfasiyla ayni blok: ozellikler + "top kimde" (ikiz kaydin eylemlerinden). */}
            <div className={s.fieldsBlock}>
              <Props e={e} />
              <TwinBall recordId={e.record_id} />
            </div>
            <section className={r.section} aria-labelledby="widgets-h">
              <div className={r.secHead}>
                <h2 id="widgets-h">Widget'lar</h2>
                <span className={r.count}>{count}</span>
                {e.can_edit && (
                  <span style={{ marginLeft: "auto" }}>
                    <Menu align="end" trigger={<Button size="sm"><Icon name="plus" size={14} /> Widget ekle</Button>}>
                      <MenuItem icon={WIDGET.record.icon} onSelect={() => setPending((p) => [...p, String(Date.now())])}>
                        {WIDGET.record.label}
                      </MenuItem>
                      {missing.length > 0 && <MenuSep />}
                      {canStructure
                        ? missing.map((t) => (
                          <MenuItem key={t} icon={WIDGET[t].icon} onSelect={() => run(eventOps.addWidget(e.id, t))}>{WIDGET[t].label}</MenuItem>
                        ))
                        : missing.length > 0 && <MenuLabel>Diğer widget'lar için “Etkinlik widget'larını düzenle” yetkisi gerekir</MenuLabel>}
                    </Menu>
                  </span>
                )}
              </div>
              {count === 0 ? (
                <div className={r.box}>
                  <span className={r.boxEmpty}>
                    Widget yok.{e.can_edit && " Bağlı kayıt ya da satın alım takibi için “Widget ekle”."}
                  </span>
                </div>
              ) : (
                <div className={s.evWidgets}>
                  {e.widgets.map((w) => {
                    const drop = () => run(eventOps.dropWidget(w.id));
                    if (w.type === "record") {
                      // Sunucuda kayit widget'inin kaydi hep dolu.
                      return w.record_id === null ? null
                        : <LinkedRecord key={w.id} id={w.record_id} onRemove={e.can_edit ? drop : undefined} />;
                    }
                    if (w.type === "otf") {
                      return <Otf key={w.id} eventId={e.id} event={e} canEdit={e.can_edit}
                        onRemove={canStructure && e.can_edit ? drop : undefined} />;
                    }
                    return <Purchases key={w.id} eventId={e.id} items={e.materials}
                      onRemove={canStructure && e.can_edit ? drop : undefined} />;
                  })}
                  {pending.map((tid) => (
                    <PendingRecord key={tid} linked={linked} onPick={(rid) => link(rid, tid)}
                      onRemove={() => setPending((p) => p.filter((x) => x !== tid))} />
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
        <aside className={cx(s.recordSide, s.evSide)} aria-label="Etkinlik özeti">
          <Timeline e={e} />
          <People e={e} />
          <Teams e={e} onCreated={(rid) => link(rid)} />
        </aside>
      </div>
    </div>
  );
}

// --- etkinlik | kayit anahtari ------------------------------------------------------

/** Etkinlik sayfasi ile etkinligin kendi kaydi (sohbet + arsiv) arasinda gecis
 *  (spec/73 §3a). TEK baglanti: neresine basilsa obur yuze gider; hangi yuzde
 *  olundugunu dolu parca gosterir. Iki sayfada da baslik satirinin EN SAGINDA,
 *  yeri gidip gelirken kaymaz. */
export function EventSwitch({ eventId, recordId, at }: { eventId: string; recordId: Uuid; at: "event" | "record" }) {
  const label = at === "event" ? "Etkinliğin kaydına geç (sohbet ve arşiv)" : "Etkinlik sayfasına geç";
  return (
    <Link href={at === "event" ? href({ name: "record", id: recordId }) : href({ name: "event", id: eventId })}
      className={cx(ui.seg, s.evSwitch)} title={label}>
      <span className={ui.segBtn} data-on={at === "event"}><Icon name="calendar" size={15} /></span>
      <span className={ui.segBtn} data-on={at === "record"}><Icon name="chat" size={15} /></span>
      <span className="visually-hidden">{label}</span>
    </Link>
  );
}

// --- baslik (RecordHead ile ayni siniflar) --------------------------------------

function Head({ e }: { e: EventDetail }) {
  const L = useLookup();
  const [edit, setEdit] = useState<"title" | "description" | null>(null);
  const creator = L.user(e.created_by);
  const shown = e.participants.slice(0, 4);
  const stack = (
    <span className={r.stack}>
      {shown.map((p) => (
        <span key={p.user_id} title={L.user(p.user_id)?.name} className={r.stackItem}>
          <Avatar user={L.user(p.user_id)} size={24} />
        </span>
      ))}
      {e.participants.length > shown.length && <span className={r.stackMore}>+{e.participants.length - shown.length}</span>}
      {e.can_edit && <span className={r.stackAdd}><Icon name="plus" size={12} /></span>}
    </span>
  );
  return (
    <div className={r.head}>
      <div className={r.titleRow}>
        <h1 className={r.title}>{e.title}</h1>
        {e.can_edit && <IconButton icon="edit" label="Başlığı düzenle" onClick={() => setEdit("title")} />}
        <EventSwitch eventId={e.id} recordId={e.record_id} at="event" />
      </div>
      <div className={r.byline}>
        <Tag tone={EVENT_STATUS[e.status].tone}>{EVENT_STATUS[e.status].label}</Tag>
        {e.can_edit ? <AddPerson e={e} className={r.stackBtn}>{stack}</AddPerson> : stack}
        {creator !== undefined && (
          <span>
            {creator.name} açtı · <time dateTime={e.created_at}>{ago(e.created_at)}</time>
          </span>
        )}
      </div>
      <div className={r.descWrap}>
        {e.description !== null ? <p className={r.desc}>{e.description}</p> : <p className={cx(r.desc, r.descEmpty)}>Açıklama yok.</p>}
        {e.can_edit && (
          <button type="button" className={r.editLink} onClick={() => setEdit("description")}>
            <Icon name="edit" size={13} /> {e.description === null ? "Açıklama ekle" : "Açıklamayı düzenle"}
          </button>
        )}
      </div>
      {edit !== null && <TextEdit e={e} field={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

/** parts.tsx TextEdit'in etkinlik karsiligi: baslik ya da aciklama. */
function TextEdit({ e, field, onClose }: { e: EventDetail; field: "title" | "description"; onClose: () => void }) {
  const { run, busy } = useRun();
  const [v, setV] = useState((field === "title" ? e.title : e.description) ?? "");
  return (
    <Dialog open onClose={onClose} title={field === "title" ? "Başlığı düzenle" : "Açıklamayı düzenle"} wide>
      <form
        className={ui.formStack}
        onSubmit={(ev) => {
          ev.preventDefault();
          run(eventOps.patch(e.id, field === "title"
            ? { field: "title", value: v.trim() }
            : { field: "description", value: v.trim() === "" ? null : v }), onClose);
        }}
      >
        {field === "title" ? (
          <input className={ui.input} aria-labelledby="dlg-title" value={v} onChange={(ev) => setV(ev.target.value)}
            maxLength={200} required autoFocus />
        ) : (
          <textarea className={ui.input} aria-labelledby="dlg-title" value={v} onChange={(ev) => setV(ev.target.value)}
            rows={8} autoFocus />
        )}
        <div className={ui.dact}>
          <Button onClick={onClose}>Vazgeç</Button>
          <Button type="submit" variant="primary" aria-busy={busy} disabled={busy || (field === "title" && v.trim() === "")}>
            {busy ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// --- ozellikler (CollapsibleProps + fields.tsx Properties ile ayni dil) -------------

function Prop({ icon, label, children }: { icon: IconName; label: string; children: ReactNode }) {
  return (
    <div className={r.prop}>
      <span className={r.propKey}><Icon name={icon} size={14} /> {label}</span>
      <span className={r.propVal}>{children}</span>
    </div>
  );
}

/** Serbest alan (tarih, saat, yer, sayi): tik → kucuk form. Bos kaydetmek = kaldir. */
function FieldEdit({ label, type, value, disabled, busy, onSave, children }: {
  label: string; type: "date" | "time" | "text" | "number"; value: string | null; disabled: boolean; busy: boolean;
  onSave: (v: string | null) => void; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState("");
  const pick = (x: string | null) => {
    setOpen(false);
    if (x !== value) onSave(x);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setV(value ?? "");
      }}
      trigger={
        <button type="button" className={r.dueTrigger} disabled={disabled} aria-label={`${label}: ${value ?? "yok"}`}>
          {children}
        </button>
      }
    >
      <form className={r.dueForm} onSubmit={(ev) => { ev.preventDefault(); pick(v.trim() === "" ? null : v.trim()); }}>
        <input className={ui.input} type={type} value={v} onChange={(ev) => setV(ev.target.value)} aria-label={label} autoFocus
          {...(type === "number" ? { min: 0, max: 100000, step: 1 } : type === "text" ? { maxLength: 200 } : {})} />
        <div className={ui.dact}>
          {value !== null && <Button variant="ghost" size="sm" onClick={() => pick(null)}>Kaldır</Button>}
          <Button type="submit" variant="primary" size="sm" disabled={busy}>Kaydet</Button>
        </div>
      </form>
    </Popover>
  );
}

function Props({ e }: { e: EventDetail }) {
  const L = useLookup();
  const { run, busy } = useRun();
  const ro = !e.can_edit;
  const save = (p: Parameters<typeof eventOps.patch>[1]) => run(eventOps.patch(e.id, p));
  const muted = (t: string) => <span className={r.muted}>{t}</span>;
  const place = placeLabel(L.meta.nodes, e);
  // Kayitla AYNI anahtar: birinde katlayinca obur yuzde de katli — gecis zıplamasin.
  const [open, setOpen] = useStored("record.props.open", true);
  return (
    <div className={r.propsPanel}>
      <button type="button" className={r.propsToggle} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={cx(r.caret, open && r.caretOpen)}><Icon name="chevron" size={14} /></span>
        {open ? <span>Özellikler</span> : (
          // Kayittaki CollapsibleProps ile ayni sira: durum EN SONDA (gidip gelirken kaymasin).
          <span className={r.propsSummary}>
            <PriorityTag priority={e.priority} bare />
            <Who user={L.user(e.owner_id)} empty="Sorumlusuz" size={18} />
            <span className={r.muted}>{e.date === null ? "Tarihsiz" : formatDay(e.date)}</span>
            <Tag tone={EVENT_STATUS[e.status].tone}>{EVENT_STATUS[e.status].label}</Tag>
          </span>
        )}
      </button>
      {open && (
        <div className={r.props}>
          <Prop icon="stOpen" label="Durum">
            <Picker look="prop" label="Durum" disabled={ro} busy={busy} value={e.status}
              options={STATUS_ORDER.map((v) => ({
                value: v,
                label: EVENT_STATUS[v].label,
                render: <Tag tone={EVENT_STATUS[v].tone}>{EVENT_STATUS[v].label}</Tag>,
                // Kesin/yapildi tarih ister (sunucu event_needs_date); onden soylenir.
                ...((v === "confirmed" || v === "done") && e.date === null ? { disabled: true, hint: "tarih gerekli" } : {}),
              }))}
              onChange={(v) => save({ field: "status", value: v })} />
          </Prop>
          <Prop icon="tasks" label="Tür"><span className={r.propStatic}>{nodeName(L.meta.nodes, e.kind_id)}</span></Prop>
          <Prop icon="calendar" label="Ne zaman">
            <FieldEdit label="Tarih" type="date" value={e.date} disabled={ro} busy={busy}
              onSave={(v) => save({ field: "date", value: v })}>
              {e.date === null ? muted(ro ? "Tarih yok (havuzda)" : "Tarih ekle") : whenFmt.format(parseDay(e.date))}
            </FieldEdit>
            {/* Tarihsiz etkinligin saati olmaz (sema check'i). */}
            {e.date !== null && (!ro || e.start_time !== null) && (
              <FieldEdit label="Başlangıç saati" type="time" value={e.start_time} disabled={ro} busy={busy}
                onSave={(v) => save({ field: "start_time", value: v })}>
                {e.start_time ?? muted("Saat ekle")}
              </FieldEdit>
            )}
          </Prop>
          <Prop icon="venue" label="Yer">
            {/* Listeden yer ya da "Diger…" metni; biri yazilinca sunucu digerini temizler (spec/74 §5b). */}
            {ro ? <span className={r.propStatic}>{place ?? muted("Belirsiz")}</span> : (
              <NodeListPicker rootKey="event_locations" look="prop" label="Yer" value={e.location_id} disabled={busy}
                onChange={(v) => save({ field: "location_id", value: v })}
                text={{ value: e.place, onText: (t) => save({ field: "place", value: t.trim() === "" ? null : t.trim() }) }}>
                {place ?? muted("Belirsiz")}
              </NodeListPicker>
            )}
          </Prop>
          <Prop icon="prHigh" label="Önem">
            <Picker look="prop" label="Önem" disabled={ro} busy={busy} value={e.priority}
              options={PRIORITY_ORDER.map((v) => ({ value: v, label: PRIORITY[v], render: <PriorityTag priority={v} bare /> }))}
              onChange={(v) => save({ field: "priority", value: v })} />
          </Prop>
          <Prop icon="user" label="Sorumlu">
            <Picker look="prop" label="Sorumlu" disabled={ro} busy={busy} value={e.owner_id}
              options={[
                { value: null, label: "Sorumlusuz", render: muted("Sorumlusuz") },
                ...L.meta.users.map((u) => ({ value: u.id as string | null, label: u.name, render: <Who user={u} />, ...(u.id === L.me.id ? { hint: "sen" } : {}) })),
              ]}
              onChange={(v) => save({ field: "owner_id", value: v })} />
          </Prop>
          <Prop icon="teams" label="Katılım">
            <FieldEdit label="Beklenen kişi sayısı" type="number" value={e.attendees === null ? null : String(e.attendees)}
              disabled={ro} busy={busy} onSave={(v) => save({ field: "attendees", value: v === null ? null : Number(v) })}>
              {e.attendees === null ? muted("Bilinmiyor") : `${e.attendees} kişi bekleniyor`}
            </FieldEdit>
          </Prop>
        </div>
      )}
    </div>
  );
}

/** Etkinligin eylemleri ikiz kayitta: "top kimde" satiri oradan, kayittakiyle ayni bilesen. */
function TwinBall({ recordId }: { recordId: Uuid }) {
  const q = useRecord(recordId);
  return q.data === undefined ? null : <BallLine d={q.data} />;
}

// --- widget ------------------------------------------------------------------------

/** Kaydi secilmemis kayit widget'i (yalniz istemcide): "yeni / var olani ekle". */
function PendingRecord({ linked, onPick, onRemove }: { linked: Set<Uuid>; onPick: (id: Uuid) => void; onRemove: () => void }) {
  const records = useRecords({}).data ?? [];
  const [creating, setCreating] = useState(false);
  const options = records.filter((x) => !linked.has(x.id))
    .map((x) => ({ value: x.id, label: x.title, render: <span className={s.evPick}>{x.title} <KindTag kind={x.kind} /></span> }));
  return (
    <div className={cx(r.card, r.cardHover, s.evPending)}>
      <div className={r.cardHead}>
        <Icon name="tasks" size={18} />
        <b>Kayıt</b>
        <span className={r.cardActs}>
          <IconButton icon="trash" label="Widget'ı kaldır" onClick={onRemove} />
        </span>
      </div>
      <div className={s.evChoice}>
        <Button size="sm" variant="primary" onClick={() => setCreating(true)}><Icon name="plus" size={14} /> Yeni kayıt</Button>
        <Picker look="chip" label="Var olan kaydı bağla" value="" options={options} onChange={onPick} search
          placeholder="Kayıt ara…" empty="Bağlanacak kayıt yok">
          <Icon name="search" size={13} /> Var olanı ekle
        </Picker>
      </div>
      <Dialog open={creating} onClose={() => setCreating(false)} title="Yeni kayıt" wide>
        <NewRecordForm onCancel={() => setCreating(false)} onCreated={(id) => { setCreating(false); onPick(id); }} />
      </Dialog>
    </div>
  );
}

function LinkedRecord({ id, onRemove }: { id: Uuid; onRemove: (() => void) | undefined }) {
  const L = useLookup();
  const q = useRecord(id);
  const to = href({ name: "record", id });
  const head = (title: ReactNode) => (
    <div className={r.cardHead}>
      <Icon name="tasks" size={18} />
      {title}
      {onRemove !== undefined && (
        <span className={r.cardActs}>
          <IconButton icon="x" label="Bağlantıyı kaldır (kayıt silinmez)" onClick={onRemove} />
        </span>
      )}
    </div>
  );
  if (q.data === undefined) {
    return (
      <div className={cx(r.card, r.cardHover)}>
        {head(<b>Kayıt</b>)}
        <span className={r.muted}>{q.error !== null ? "Kayıt açılamadı — silinmiş ya da görme yetkin yok." : "Yükleniyor…"}</span>
      </div>
    );
  }
  const { record, actions } = q.data;
  // Acik eylemler once; en cok 5, fazlasi kayda baglanti.
  const sorted = [...actions.filter((a) => !isDone(a.status)), ...actions.filter((a) => isDone(a.status))];
  const shown = sorted.slice(0, 5);
  return (
    <div className={cx(r.card, r.cardHover)}>
      {head(
        <>
          <Link href={to} className={s.evRecTitle}>{record.title}</Link>
          <KindTag kind={record.kind} />
          <Status status={record.status} />
        </>,
      )}
      {actions.length === 0 ? <span className={r.muted}>Eylem yok.</span> : (
        <ul className={s.evActs}>
          {shown.map((a) => (
            <li key={a.id} data-done={isDone(a.status)}>
              <Status status={a.status} action />
              <span className={s.evActTitle}>{a.title}</span>
              <Due date={a.due_date} done={isDone(a.status)} />
              <Avatar user={L.user(a.owner_id)} size={20} />
            </li>
          ))}
        </ul>
      )}
      {sorted.length > shown.length && <Link href={to} className={s.evMore}>+{sorted.length - shown.length} eylem daha</Link>}
    </div>
  );
}

// --- sag sutun ---------------------------------------------------------------------

function SideSec({ icon, title, action, children }: { icon: IconName; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className={s.evSideSec}>
      <h2 className={s.evSideHead}>
        <Icon name={icon} size={15} /> {title}
        {action}
      </h2>
      {children}
    </section>
  );
}

/** Checkpoint'ler: gecen dolu nokta, siradaki halka, kalanlar kesikli cizgi.
 *  Sira sunucudan (tamamlananlar uste, sonra tarih); "siradaki" ilk acik adim.
 *  Noktaya/X'e basmak: onaylayici dogrudan isaretler/kaldirir, diger duzenleyen
 *  ONAY ISTER (spec/73 §6). */
function Timeline({ e }: { e: EventDetail }) {
  const L = useLookup();
  const { run, busy } = useRun();
  const toast = useToast();
  const today = toIsoDay(new Date());
  const next = e.checkpoints.findIndex((c) => !c.done);
  const waiting = new Set(e.requests.filter((q) => q.user_id === L.meta.me.id).map((q) => q.checkpoint_id));
  const ask = (cid: Uuid, action: CheckpointAction) =>
    run(eventOps.requestCheckpoint(cid, action), () => toast({ text: "Onay istendi", error: false }));
  return (
    <SideSec icon="flag" title="Zaman çizelgesi" action={e.can_manage ? <AddCheckpoint e={e} /> : undefined}>
      {e.checkpoints.length === 0 ? <span className={r.muted}>Checkpoint yok.</span> : (
        <ol className={s.evTimeline}>
          {e.checkpoints.map((c, i) => (
            <li key={c.id} data-state={c.done ? "done" : i === next ? "next" : "todo"}>
              {e.can_edit ? (
                <button type="button" className={s.evDot} disabled={busy} aria-pressed={c.done}
                  aria-label={c.done ? `${c.label}: tamamlanmadı olarak işaretle` : `${c.label}: tamamlandı olarak işaretle`}
                  onClick={() => (e.can_approve ? run(eventOps.checkpoint(c.id, !c.done)) : ask(c.id, c.done ? "undone" : "done"))} />
              ) : <span className={s.evDot} aria-hidden="true" />}
              <span className={s.evStep}>
                <span>{c.label}</span>
                <span className={r.muted}>
                  {e.can_manage ? <CheckpointDate id={c.id} date={c.date} today={today} /> : dayText(c.date, today)}
                  {c.done ? " · tamam" : ""}
                  {waiting.has(c.id) && <span className={s.evWaiting}> · onay bekliyor</span>}
                </span>
              </span>
              {e.can_edit && <IconButton icon="x" size={13} label={`${c.label} checkpoint'ini kaldır`} disabled={busy}
                onClick={() => (e.can_approve ? run(eventOps.dropCheckpoint(c.id)) : ask(c.id, "delete"))} />}
            </li>
          ))}
        </ol>
      )}
    </SideSec>
  );
}

const REQUEST_TEXT: Record<CheckpointAction, string> = {
  done: "adımını tamamlamak",
  undone: "adımını tamamlanmadı olarak işaretlemek",
  delete: "adımını kaldırmak",
};

/** Onaylayicinin kutusu: bekleyen istekler, Onayla / Reddet. Yalniz onaylayiciya
 *  ve istek varsa gorunur (sunucu digerine yalniz kendi isteklerini verir). */
function Requests({ e }: { e: EventDetail }) {
  const L = useLookup();
  const { run, busy } = useRun();
  if (!e.can_approve || e.requests.length === 0) return null;
  return (
    <ul className={s.evRequests} aria-label="Bekleyen onay istekleri">
      {e.requests.map((q) => (
        <li key={q.id}>
          <span>
            <b>{L.user(q.user_id)?.name ?? "Biri"}</b> “{e.checkpoints.find((c) => c.id === q.checkpoint_id)?.label ?? ""}”{" "}
            {REQUEST_TEXT[q.action]} istiyor
          </span>
          <span className={s.evRequestBtns}>
            <Button size="sm" disabled={busy} onClick={() => run(eventOps.resolveRequest(q.id, false))}>Reddet</Button>
            <Button size="sm" variant="primary" disabled={busy} onClick={() => run(eventOps.resolveRequest(q.id, true))}>Onayla</Button>
          </span>
        </li>
      ))}
    </ul>
  );
}

const dayText = (d: string | null, today: string) => (d === null ? "tarih yok" : d === today ? "bugün" : formatDay(d));

/** Son tarih (yalniz `manage_events`). Varsayilan: etkinlikten 7 gun once, etkinlikle kayar. */
function CheckpointDate({ id, date, today }: { id: string; date: string | null; today: string }) {
  const { run, busy } = useRun();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState("");
  return (
    <Popover align="start" open={open}
      onOpenChange={(o) => { setOpen(o); if (o) setV(date ?? ""); }}
      trigger={<button type="button" className={r.editLink} aria-label="Son tarihi değiştir">{dayText(date, today)}</button>}>
      <form className={r.dueForm} onSubmit={(ev) => {
        ev.preventDefault();
        if (v !== "") run(eventOps.checkpointDate(id, v), () => setOpen(false));
      }}>
        <input className={ui.input} type="date" value={v} onChange={(ev) => setV(ev.target.value)} aria-label="Son tarih" autoFocus />
        <div className={ui.dact}>
          <Button size="sm" disabled={busy} onClick={() => run(eventOps.checkpointDate(id, null), () => setOpen(false))}>
            Varsayılan (7 gün önce)
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={busy || v === ""}>Kaydet</Button>
        </div>
      </form>
    </Popover>
  );
}

function AddCheckpoint({ e }: { e: EventDetail }) {
  const { run, busy } = useRun();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [date, setDate] = useState("");
  return (
    <Popover align="end" open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) { setLabel(""); setDate(""); }
      }}
      trigger={<button type="button" className={ui.iconBtn} aria-label="Checkpoint ekle"><Icon name="plus" size={16} /></button>}>
      <form className={r.dueForm}
        onSubmit={(ev) => {
          ev.preventDefault();
          run(eventOps.addCheckpoint(e.id, label.trim(), date === "" ? null : date), () => setOpen(false));
        }}>
        <input className={ui.input} value={label} onChange={(ev) => setLabel(ev.target.value)} aria-label="Checkpoint adı"
          placeholder="Checkpoint adı" maxLength={200} required autoFocus />
        <input className={ui.input} type="date" value={date} onChange={(ev) => setDate(ev.target.value)} aria-label="Tarih (boşsa etkinlikten 7 gün önce)" title="Boş bırakılırsa etkinlikten 7 gün önce" />
        <div className={ui.dact}>
          <Button type="submit" variant="primary" size="sm" disabled={busy || label.trim() === ""}>Ekle</Button>
        </div>
      </form>
    </Popover>
  );
}

/** Katilimci olmayan kullanicilardan secip ekler; tetik icerigi cagirandan. */
function AddPerson({ e, className, children }: { e: EventDetail; className: string; children: ReactNode }) {
  const L = useLookup();
  const { run, busy } = useRun();
  const options = L.meta.users.filter((u) => !e.participants.some((p) => p.user_id === u.id))
    .map((u) => ({ value: u.id, label: u.name, render: <Who user={u} /> }));
  return (
    <Picker look="bare" className={className} label="Kişi ekle" value="" options={options} search busy={busy}
      empty="Eklenecek kişi yok" onChange={(u) => run(eventOps.participant(e.id, u, true, null))}>
      {children}
    </Picker>
  );
}

/** Sohbet dugmesi: DM yok — ikiz kaydin sohbetine, kisinin anmasi hazir ve
 *  odak kutuda (`?mention=`, RecordPage okur). Kendine yazis yok. */
function People({ e }: { e: EventDetail }) {
  const L = useLookup();
  const { run, busy } = useRun();
  const talk = (name: string) => navigate(`${href({ name: "record", id: e.record_id })}?mention=${handle(name)}`);
  return (
    <SideSec icon="user" title="Kişiler"
      action={e.can_edit ? <AddPerson e={e} className={ui.iconBtn}><Icon name="plus" size={16} /></AddPerson> : undefined}>
      {e.participants.length === 0 ? <span className={r.muted}>Kişi yok.</span> : (
        <ul className={s.evSideList}>
          {e.participants.map((p) => {
            const u = L.user(p.user_id);
            return (
              <li key={p.user_id}>
                <Avatar user={u} size={24} />
                <span className={s.evSideName}>
                  <span>{u?.name ?? "?"}</span>
                  {p.role !== null && <span className={r.muted}>{p.role}</span>}
                </span>
                {u !== undefined && u.id !== L.me.id ? (
                  <IconButton icon="chat" label={`${u.name} ile etkinlik sohbetinde yazış`} onClick={() => talk(u.name)} />
                ) : <span className={s.evSideGap} />}
                {e.can_edit && <IconButton icon="x" size={13} label={`${u?.name ?? "Kişiyi"} etkinlikten çıkar`} disabled={busy}
                  onClick={() => run(eventOps.participant(e.id, p.user_id, false))} />}
              </li>
            );
          })}
        </ul>
      )}
    </SideSec>
  );
}

/** Takim basina "+ Kayıt": takimi dolu yeni kayit formu; olusan kayit etkinlige
 *  kayit widget'i olarak baglanir. */
function Teams({ e, onCreated }: { e: EventDetail; onCreated: (id: Uuid) => void }) {
  const L = useLookup();
  const { run, busy } = useRun();
  const [team, setTeam] = useState<Uuid | null>(null);
  const options = L.plainTeams.filter((t) => !e.team_ids.includes(t.id))
    .map((t) => ({ value: t.id, label: t.name, render: <TeamName team={t} /> }));
  const add = (
    <Picker look="bare" className={ui.iconBtn} label="Takım ekle" value="" options={options} busy={busy}
      empty="Eklenecek takım yok" onChange={(t) => run(eventOps.team(e.id, t, true))}>
      <Icon name="plus" size={16} />
    </Picker>
  );
  return (
    <SideSec icon="teams" title="Takımlar" action={e.can_edit ? add : undefined}>
      {e.team_ids.length === 0 ? <span className={r.muted}>Takım yok.</span> : (
        <ul className={s.evSideList}>
          {e.team_ids.map((t) => (
            <li key={t}>
              <span className={s.evSideName}><TeamName team={L.team(t)} /></span>
              {e.can_edit && (
                <>
                  <Button size="sm" onClick={() => setTeam(t)}><Icon name="plus" size={13} /> Kayıt</Button>
                  <IconButton icon="x" size={13} label={`${L.team(t)?.name ?? "Takımı"} etkinlikten çıkar`} disabled={busy}
                    onClick={() => run(eventOps.team(e.id, t, false))} />
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <Dialog open={team !== null} onClose={() => setTeam(null)} title={`Yeni kayıt — ${L.team(team)?.name ?? ""}`} wide>
        {team !== null && (
          <NewRecordForm defaults={{ team_id: team }} onCancel={() => setTeam(null)}
            onCreated={(id) => { setTeam(null); onCreated(id); }} />
        )}
      </Dialog>
    </SideSec>
  );
}
