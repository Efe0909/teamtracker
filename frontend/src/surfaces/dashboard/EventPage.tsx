// Etkinlik sayfasi — kayit sayfasinin AYNI iskeleti ve stilleri (RecordPage):
// sol is (baslik, ozellikler, widget'lar), sag sutun (zaman cizelgesi, kisiler,
// takimlar). Widget'lar kayit kartlarina benzer ama blob degil (spec/73 §3):
// widget sayfadaki YUVA, veri turun tablosunda ve etkinlige bagli — widget
// kaldirmak veriyi silmez. Widget/checkpoint'ler turun sablonundan gelir.
//
// ponytail: veri sahte; degistiren dugmeler `soon()` ile "API yok" der.
// Widget ve satin alim duzenlemeleri yalniz bu sayfanin belleginde.

import { useEffect, useState, type ReactNode } from "react";
import { useRecord, useRecords } from "../../api/hooks";
import type { Uuid } from "../../api/types";
import { NewRecordForm } from "../../features/record/NewRecordForm";
import { BallLine } from "../../features/record/parts";
import r from "../../features/record/record.module.css";
import { ago, formatDay, isDone, parseDay, toIsoDay } from "../../lib/labels";
import { useLookup } from "../../lib/lookup";
import { handle } from "../../lib/mentions";
import { navigate } from "../../lib/router";
import { useStored } from "../../lib/stored";
import { Icon, type IconName } from "../../ui/icons";
import {
  Avatar, Button, cx, Dialog, Due, IconButton, KindTag, Link, Loading, Menu, MenuItem, MenuLabel, MenuSep, Picker, PriorityTag,
  Status, Tag, TeamName, ui, useToast, Who,
} from "../../ui/ui";
import { ErrorScreen } from "../errors/ErrorScreen";
import s from "./dashboard.module.css";
import {
  EVENT_KIND, EVENT_STATUS, mockMaterials, useMockEvents, useMockRecords, WIDGET, WIDGET_STATUS, WIDGET_TYPES,
  type EventItem, type EventWidget, type WidgetType,
} from "./eventModel";
import { Purchases } from "./Purchases";
import { href } from "./routes";

const whenFmt = new Intl.DateTimeFormat("tr", { day: "numeric", month: "long", weekday: "long" });

export function EventPage({ id }: { id: string }) {
  const events = useMockEvents();
  // Sahte etkinlikler kayitlardan kurulur; kayitlar gelmeden cizersek widget
  // listesi (yerel durum) kayitsiz kurulup oyle kalir.
  const loaded = useRecords({}).data !== undefined;
  const e = events.find((x) => x.id === id);
  useEffect(() => {
    if (e !== undefined) document.title = `${e.title} — EkipTakip`;
  }, [e?.title]);
  if (!loaded) return <Loading />;
  if (e === undefined) return <ErrorScreen code="not_found" />;
  return <EventView key={e.id} e={e} />;
}

function EventView({ e }: { e: EventItem }) {
  const L = useLookup();
  const toast = useToast();
  const soon = () => toast({ text: "Etkinlik API'si henüz yok — bu bir tasarım önizlemesi.", error: false });
  const [widgets, setWidgets] = useState(e.widgets);
  // Veri yuvadan bagimsiz: widget kaldirilip geri eklenince ayni liste.
  const [materials, setMaterials] = useState(mockMaterials);
  // Sablon widget'lari etkinlik acilirken gelir; eklemek/kaldirmak scope ister.
  // Kayit widget'i serbest (etkinligi duzenleyebilen herkes).
  const canStructure = L.can("manage_event_widgets");
  // Kayit disindaki turlerden etkinlikte en cok bir tane (spec/73 §3).
  const missing = WIDGET_TYPES.filter((t) => t !== "record" && !widgets.some((w) => w.type === t));
  const add = (type: WidgetType, record_id: Uuid | null = null) =>
    setWidgets((ws) => [...ws, { id: `${e.id}-w${Date.now()}`, type, status: "todo", record_id }]);
  const remove = (wid: string) => setWidgets(widgets.filter((w) => w.id !== wid));
  const setRecord = (wid: string, rid: Uuid) => setWidgets(widgets.map((w) => (w.id === wid ? { ...w, record_id: rid } : w)));
  // Etkinligin kendi kaydi da "bagli" sayilir: widget olarak eklenemez.
  const linked = new Set([...widgets.flatMap((w) => (w.record_id === null ? [] : [w.record_id])), ...(e.record_id === null ? [] : [e.record_id])]);

  return (
    <div className={s.recordPage}>
      <nav className={s.crumb} aria-label="Konum">
        <Link href={href({ name: "events", query: {} })}>Etkinlikler</Link>
        <Icon name="chevron" size={13} />
        <Link href={href({ name: "events", query: { kind: e.kind, ...(e.date === null ? { tab: "pool" } : {}) } })}>{EVENT_KIND[e.kind]}</Link>
        <Icon name="chevron" size={13} />
        <b>{e.title}</b>
      </nav>
      <div className={s.recordBody}>
        <div className={s.recordMain}>
          <div className={s.recordInner}>
            <Head e={e} soon={soon} />
            {/* Kayit sayfasiyla ayni blok: ozellikler + "top kimde" (ikiz kaydin eylemlerinden). */}
            <div className={s.fieldsBlock}>
              <Props e={e} />
              {e.record_id !== null && <TwinBall recordId={e.record_id} />}
            </div>
            <section className={r.section} aria-labelledby="widgets-h">
              <div className={r.secHead}>
                <h2 id="widgets-h">Widget'lar</h2>
                <span className={r.count}>{widgets.length}</span>
                <span style={{ marginLeft: "auto" }}>
                  <Menu align="end" trigger={<Button size="sm"><Icon name="plus" size={14} /> Widget ekle</Button>}>
                    <MenuItem icon={WIDGET.record.icon} onSelect={() => add("record")}>{WIDGET.record.label}</MenuItem>
                    {missing.length > 0 && <MenuSep />}
                    {canStructure
                      ? missing.map((t) => <MenuItem key={t} icon={WIDGET[t].icon} onSelect={() => add(t)}>{WIDGET[t].label}</MenuItem>)
                      : missing.length > 0 && <MenuLabel>Diğer widget'lar için “Etkinlik widget'larını düzenle” yetkisi gerekir</MenuLabel>}
                  </Menu>
                </span>
              </div>
              {widgets.length === 0 ? (
                <div className={r.box}>
                  <span className={r.boxEmpty}>Widget yok. Mekan, malzeme ya da bütçe takibi için “Widget ekle”.</span>
                </div>
              ) : (
                <div className={s.evWidgets}>
                  {widgets.map((w) => {
                    if (w.type === "record") {
                      return <RecordWidget key={w.id} recordId={w.record_id} linked={linked}
                        onPick={(rid) => setRecord(w.id, rid)} onRemove={() => remove(w.id)} />;
                    }
                    const onRemove = canStructure ? () => remove(w.id) : undefined;
                    return w.type === "supplies"
                      ? <Purchases key={w.id} items={materials} onChange={setMaterials} onRemove={onRemove} />
                      : <Widget key={w.id} w={w} onRemove={onRemove} />;
                  })}
                </div>
              )}
            </section>
          </div>
        </div>
        <aside className={cx(s.recordSide, s.evSide)} aria-label="Etkinlik özeti">
          <Timeline e={e} soon={soon} />
          <People e={e} soon={soon} />
          <Teams e={e} soon={soon} onCreated={(rid) => add("record", rid)} />
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
export function EventSwitch({ eventId, recordId, at }: { eventId: string; recordId: Uuid | null; at: "event" | "record" }) {
  const parts = (
    <>
      <span className={ui.segBtn} data-on={at === "event"}><Icon name="calendar" size={15} /></span>
      <span className={ui.segBtn} data-on={at === "record"}><Icon name="chat" size={15} /></span>
    </>
  );
  // ponytail: yalniz sahte veride olur — semada her etkinligin kaydi var.
  if (recordId === null) {
    return <span className={cx(ui.seg, s.evSwitch)} aria-disabled="true" title="Bu sahte etkinliğe kayıt düşmedi">{parts}</span>;
  }
  const label = at === "event" ? "Etkinliğin kaydına geç (sohbet ve arşiv)" : "Etkinlik sayfasına geç";
  return (
    <Link href={at === "event" ? href({ name: "record", id: recordId }) : href({ name: "event", id: eventId })}
      className={cx(ui.seg, s.evSwitch)} title={label}>
      {parts}
      <span className="visually-hidden">{label}</span>
    </Link>
  );
}

// --- baslik (RecordHead ile ayni siniflar) --------------------------------------

function Head({ e, soon }: { e: EventItem; soon: () => void }) {
  const L = useLookup();
  const creator = L.user(e.created_by);
  const shown = e.participants.slice(0, 4);
  return (
    <div className={r.head}>
      <div className={r.titleRow}>
        <h1 className={r.title}>{e.title}</h1>
        <IconButton icon="edit" label="Başlığı düzenle" onClick={soon} />
        <EventSwitch eventId={e.id} recordId={e.record_id} at="event" />
      </div>
      <div className={r.byline}>
        <Tag tone={EVENT_STATUS[e.status].tone}>{EVENT_STATUS[e.status].label}</Tag>
        <button type="button" className={r.stackBtn} aria-label="Katılımcıları düzenle" onClick={soon}>
          <span className={r.stack}>
            {shown.map((p) => (
              <span key={p.user_id} title={L.user(p.user_id)?.name} className={r.stackItem}>
                <Avatar user={L.user(p.user_id)} size={24} />
              </span>
            ))}
            {e.participants.length > shown.length && <span className={r.stackMore}>+{e.participants.length - shown.length}</span>}
            <span className={r.stackAdd}><Icon name="plus" size={12} /></span>
          </span>
        </button>
        {creator !== undefined && (
          <span>
            {creator.name} açtı · <time dateTime={e.created_at}>{ago(e.created_at)}</time>
          </span>
        )}
      </div>
      <div className={r.descWrap}>
        {e.description !== null ? <p className={r.desc}>{e.description}</p> : <p className={cx(r.desc, r.descEmpty)}>Açıklama yok.</p>}
        <button type="button" className={r.editLink} onClick={soon}>
          <Icon name="edit" size={13} /> {e.description === null ? "Açıklama ekle" : "Açıklamayı düzenle"}
        </button>
      </div>
    </div>
  );
}

// --- ozellikler (CollapsibleProps ile ayni davranis) -----------------------------

function Prop({ icon, label, children }: { icon: IconName; label: string; children: ReactNode }) {
  return (
    <div className={r.prop}>
      <span className={r.propKey}><Icon name={icon} size={14} /> {label}</span>
      <span className={r.propVal}><span className={r.propStatic}>{children}</span></span>
    </div>
  );
}

function Props({ e }: { e: EventItem }) {
  const L = useLookup();
  // Kayitla AYNI anahtar: birinde katlayinca obur yuzde de katli — gecis zıplamasin.
  const [open, setOpen] = useStored("record.props.open", true);
  const when = e.date === null ? "Tarih yok (havuzda)" : `${whenFmt.format(parseDay(e.date))}${e.start !== null ? ` · ${e.start}` : ""}`;
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
          <Prop icon="stOpen" label="Durum"><Tag tone={EVENT_STATUS[e.status].tone}>{EVENT_STATUS[e.status].label}</Tag></Prop>
          <Prop icon="tasks" label="Tür">{EVENT_KIND[e.kind]}</Prop>
          <Prop icon="calendar" label="Ne zaman">{when}</Prop>
          <Prop icon="venue" label="Yer">{e.place ?? <span className={r.muted}>Belirsiz</span>}</Prop>
          <Prop icon="prHigh" label="Önem"><PriorityTag priority={e.priority} bare /></Prop>
          <Prop icon="user" label="Sorumlu"><Who user={L.user(e.owner_id)} empty="Sorumlusuz" /></Prop>
          <Prop icon="teams" label="Katılım">{e.attendees > 0 ? `${e.attendees} kişi bekleniyor` : <span className={r.muted}>Bilinmiyor</span>}</Prop>
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

/** Alanlari henuz tanimlanmamis sablon widget'i. `onRemove` yoksa (scope yok) kaldirilamaz. */
function Widget({ w, onRemove }: { w: EventWidget; onRemove?: (() => void) | undefined }) {
  const t = WIDGET[w.type];
  return (
    <div className={cx(r.card, r.cardHover)}>
      <div className={r.cardHead}>
        <Icon name={t.icon} size={18} />
        <b>{t.label}</b>
        <Tag tone={WIDGET_STATUS[w.status].tone}>{WIDGET_STATUS[w.status].label}</Tag>
        {onRemove !== undefined && (
          <span className={r.cardActs}>
            <IconButton icon="trash" label="Widget'ı kaldır (veri silinmez)" onClick={onRemove} />
          </span>
        )}
      </div>
      {/* ponytail: alanlar tanimlanmadi — iskelet. Turun tablosu gelince doldurulur. */}
      <div className={s.evSkeleton} aria-label="Henüz alanı yok">
        <span /><span /><span />
        <small className={r.muted}>Alanlar henüz tanımlanmadı.</small>
      </div>
    </div>
  );
}

/** Tek kayitlik widget. Kayit secilmeden once "yeni / var olani ekle" sorar;
 *  secilince kaydin basligini ve eylemlerini gosterir. */
function RecordWidget({ recordId, linked, onPick, onRemove }: {
  recordId: Uuid | null; linked: Set<Uuid>; onPick: (id: Uuid) => void; onRemove: () => void;
}) {
  const records = useMockRecords();
  const [creating, setCreating] = useState(false);
  if (recordId !== null) return <LinkedRecord id={recordId} onRemove={onRemove} />;
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

function LinkedRecord({ id, onRemove }: { id: Uuid; onRemove: () => void }) {
  const L = useLookup();
  const q = useRecord(id);
  const to = href({ name: "record", id });
  const head = (title: ReactNode) => (
    <div className={r.cardHead}>
      <Icon name="tasks" size={18} />
      {title}
      <span className={r.cardActs}>
        <IconButton icon="x" label="Bağlantıyı kaldır (kayıt silinmez)" onClick={onRemove} />
      </span>
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

/** Checkpoint'ler: gecen dolu nokta, siradaki halka, kalanlar kesikli cizgi. */
function Timeline({ e, soon }: { e: EventItem; soon: () => void }) {
  const today = toIsoDay(new Date());
  const next = e.checkpoints.findIndex((c) => !c.done);
  return (
    <SideSec icon="flag" title="Zaman çizelgesi" action={<IconButton icon="plus" label="Checkpoint ekle" onClick={soon} />}>
      <ol className={s.evTimeline}>
        {e.checkpoints.map((c, i) => (
          <li key={c.id} data-state={c.done ? "done" : i === next ? "next" : "todo"}>
            <span className={s.evDot} aria-hidden="true" />
            <span className={s.evStep}>
              <span>{c.label}</span>
              <span className={r.muted}>
                {c.date === null ? "tarih yok" : c.date === today ? "bugün" : formatDay(c.date)}
                {c.done ? " · tamam" : ""}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </SideSec>
  );
}

/** Sohbet dugmesi: DM yok — ikiz kaydin sohbetine, kisinin anmasi hazir ve
 *  odak kutuda (`?mention=`, RecordPage okur). Kendine yazis yok. */
function People({ e, soon }: { e: EventItem; soon: () => void }) {
  const L = useLookup();
  const talk = (name: string) => {
    if (e.record_id !== null) navigate(`${href({ name: "record", id: e.record_id })}?mention=${handle(name)}`);
  };
  return (
    <SideSec icon="user" title="Kişiler" action={<IconButton icon="plus" label="Kişi ekle" onClick={soon} />}>
      <ul className={s.evSideList}>
        {e.participants.map((p) => {
          const u = L.user(p.user_id);
          return (
            <li key={p.user_id}>
              <Avatar user={u} size={24} />
              <span className={s.evSideName}>
                <span>{u?.name ?? "?"}</span>
                <span className={r.muted}>{p.role}</span>
              </span>
              {u !== undefined && u.id !== L.me.id ? (
                <IconButton icon="chat" label={`${u.name} ile etkinlik sohbetinde yazış`} disabled={e.record_id === null}
                  onClick={() => talk(u.name)} />
              ) : <span className={s.evSideGap} />}
            </li>
          );
        })}
      </ul>
    </SideSec>
  );
}

/** Takim basina "+ Kayıt": takimi dolu yeni kayit formu; olusan kayit etkinlige
 *  kayit widget'i olarak baglanir. */
function Teams({ e, soon, onCreated }: { e: EventItem; soon: () => void; onCreated: (id: Uuid) => void }) {
  const L = useLookup();
  const [team, setTeam] = useState<Uuid | null>(null);
  return (
    <SideSec icon="teams" title="Takımlar" action={<IconButton icon="plus" label="Takım ekle" onClick={soon} />}>
      {e.team_ids.length === 0 ? <span className={r.muted}>Takım yok.</span> : (
        <ul className={s.evSideList}>
          {e.team_ids.map((t) => (
            <li key={t}>
              <span className={s.evSideName}><TeamName team={L.team(t)} /></span>
              <Button size="sm" onClick={() => setTeam(t)}><Icon name="plus" size={13} /> Kayıt</Button>
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
