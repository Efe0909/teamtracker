// Etkinlik Planlama. Gorevler sayfasinin dili: Segmented sekme, filtre cipi,
// tablo; filtreler URL'de (KNOW-234). Sagda daraltilir ray: ay takvimi +
// aylara gore yaklasan etkinlikler.
//
// ponytail: veri SAHTE (eventModel.ts) ve suzme istemcide — /api/events
// gelince suzme sunucuya.

import { useEffect, useState } from "react";
import type { IsoDate, RecordSummary, Uuid } from "../../api/types";
import { daysFromToday, parseDay, PRIORITY, PRIORITY_ORDER, toIsoDay } from "../../lib/labels";
import { useLookup } from "../../lib/lookup";
import { navigate } from "../../lib/router";
import { useStored } from "../../lib/stored";
import { Icon } from "../../ui/icons";
import {
  Button, cx, Dialog, Empty, IconButton, KindTag, Link, Picker, PriorityTag, Segmented, Status, Tag, ui, Who, type Option,
} from "../../ui/ui";
import s from "./dashboard.module.css";
import { EVENT_KIND, EVENT_STATUS, EVENT_TEMPLATE, useMockEvents, useMockRecords, WIDGET, type EventItem, type EventKind } from "./eventModel";
import { href, type EventQuery } from "./routes";

type EventSummary = EventItem;

const TABS = [
  { value: "past", label: "Geçmiş" },
  { value: "planned", label: "Planlanan" },
  { value: "pool", label: "Havuz" },
] as const;
type Tab = (typeof TABS)[number]["value"];

const SORTS: Option<string>[] = [
  { value: "", label: "Tarih" },
  { value: "priority", label: "Önem" },
  { value: "links", label: "Bağlantı" },
];

function tabOf(e: EventSummary): Tab {
  if (e.date === null) return "pool";
  return daysFromToday(e.date) < 0 ? "past" : "planned";
}

export function Events({ query }: { query: EventQuery }) {
  const L = useLookup();
  const records = useMockRecords();
  const events = useMockEvents();
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState(query.search ?? "");
  const [rail, setRail] = useStored("events.rail", true);
  const tab: Tab = TABS.some((t) => t.value === query.tab) ? (query.tab as Tab) : "planned";

  useEffect(() => {
    document.title = "Etkinlik Planlama — EkipTakip";
  }, []);
  useEffect(() => {
    if ((query.search ?? "") === search) return;
    const t = window.setTimeout(() => set({ search }), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  function set(p: { [K in keyof EventQuery]?: string | undefined }) {
    const next: typeof p = { ...query, ...p };
    for (const k of Object.keys(next) as (keyof EventQuery)[]) if (next[k] === undefined || next[k] === "") delete next[k];
    // Bos degerler silindi: kalanlar string.
    navigate(href({ name: "events", query: next as EventQuery }), { replace: true });
  }

  const counts = { past: 0, planned: 0, pool: 0 };
  for (const e of events) counts[tabOf(e)]++;

  const needle = (query.search ?? "").toLocaleLowerCase("tr");
  const rows = events
    .filter((e) => tabOf(e) === tab)
    .filter((e) => query.kind === undefined || e.kind === query.kind)
    .filter((e) => query.priority === undefined || e.priority === query.priority)
    .filter((e) => query.person === undefined || e.owner_id === (query.person === "me" ? L.me.id : query.person))
    .filter((e) => needle === "" || `${e.title} ${e.place ?? ""}`.toLocaleLowerCase("tr").includes(needle))
    .sort((a, b) => {
      if (query.sort === "priority") return PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority);
      if (query.sort === "links") return b.record_ids.length - a.record_ids.length;
      // Gecmis yeniden eskiye, planlanan yakindan uzaga.
      const d = (a.date ?? "").localeCompare(b.date ?? "");
      return tab === "past" ? -d : d;
    });
  const any = query.kind !== undefined || query.priority !== undefined || query.person !== undefined || needle !== "";

  const chip = (k: "kind" | "priority" | "person", label: string, options: Option<string>[]) => {
    const v = query[k] ?? "";
    const cur = options.find((o) => o.value === v);
    return (
      <Picker look="chip" label={label} active={v !== ""} value={v}
        options={[{ value: "", label: "Hepsi" }, ...options]} onChange={(x) => set({ [k]: x })}>
        {v === "" ? <><Icon name="plus" size={13} /> {label}</> : <>{label}: <b>{cur?.label ?? "?"}</b></>}
      </Picker>
    );
  };

  return (
    <div className={s.page}>
      <div className={s.pageHead}>
        <div className={s.pageTitle}>
          <h1>
            Etkinlik Planlama<span className={s.count}>{events.length}</span>
          </h1>
        </div>
        {!rail && <IconButton icon="calendar" label="Takvimi aç" onClick={() => setRail(true)} />}
      </div>
      <Dialog open={creating} onClose={() => setCreating(false)} title="Yeni etkinlik">
        <NewEventForm onCancel={() => setCreating(false)} />
      </Dialog>

      <div className={s.evLayout} data-rail={rail}>
        <div className={s.evMain}>
          <div className={s.toolbar}>
            <Segmented label="Etkinlik sekmesi" options={TABS.map((t) => ({ ...t, count: counts[t.value] }))} value={tab}
              onChange={(v) => set({ tab: v === "planned" ? undefined : v })} />
            {/* Ana sutunda, rayin solunda — rayin ustune binmesin. */}
            <Button variant="primary" onClick={() => setCreating(true)} style={{ marginLeft: "auto" }}>
              <Icon name="plus" size={15} /> Yeni etkinlik
            </Button>
          </div>

          <div className={s.filters}>
            <Icon name="filter" size={15} />
            {chip("kind", "Tür", (Object.keys(EVENT_KIND) as EventKind[]).map((k) => ({ value: k, label: EVENT_KIND[k] })))}
            {chip("priority", "Önem", PRIORITY_ORDER.map((v) => ({ value: v, label: PRIORITY[v], render: <PriorityTag priority={v} bare /> })))}
            {chip("person", "Sorumlu", [
              { value: "me", label: "Ben" },
              ...L.meta.users.map((u) => ({ value: u.id, label: u.name, render: <Who user={u} /> })),
            ])}
            {any && (
              <button type="button" className={s.evClear} onClick={() => { setSearch(""); set({ kind: undefined, priority: undefined, person: undefined, search: undefined }); }}>
                Temizle
              </button>
            )}
            <span className={s.grow} />
            <Picker look="bare" label="Sırala" value={query.sort ?? ""} options={SORTS} onChange={(v) => set({ sort: v })} align="end">
              <Icon name="sliders" size={14} /> {SORTS.find((o) => o.value === (query.sort ?? ""))?.label}
            </Picker>
            <label className={s.search}>
              <Icon name="search" size={15} />
              <span className="visually-hidden">Ara</span>
              <input className={ui.input} type="search" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Etkinlik veya yer ara…" />
            </label>
          </div>

          <EventTable rows={rows} />
          <TopLinked events={events} records={records} />
        </div>

        {rail && <CalendarRail events={events} onClose={() => setRail(false)} />}
      </div>
    </div>
  );
}

// --- tablo -------------------------------------------------------------------

const weekdayFmt = new Intl.DateTimeFormat("tr", { day: "numeric", month: "short", weekday: "short" });

function EventTable({ rows }: { rows: EventSummary[] }) {
  const L = useLookup();
  if (rows.length === 0) {
    return (
      <div className={s.tableWrap}>
        <Empty title="Etkinlik yok" icon="calendar">Bu sekmede ve filtrelerde etkinlik bulunamadı.</Empty>
      </div>
    );
  }
  return (
    <div className={s.tableWrap}>
      <table className={s.table} style={{ tableLayout: "fixed" }}>
        <colgroup>
          <col />
          <col style={{ width: 112 }} />
          <col style={{ width: 112 }} />
          <col style={{ width: 92 }} />
          <col style={{ width: 116 }} />
          <col style={{ width: 64 }} />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Etkinlik</th>
            <th scope="col">Tarih</th>
            <th scope="col">Durum</th>
            <th scope="col">Önem</th>
            <th scope="col">Sorumlu</th>
            <th scope="col">Katılım</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            // Satirin tamami tiklanir; klavye/ekran okuyucu icin baslik bir baglanti.
            <tr key={e.id} onClick={(x) => { if (!(x.target as HTMLElement).closest("a")) navigate(href({ name: "event", id: e.id })); }}>
              <td className={s.evCell}>
                <span className={s.evTitleRow}>
                  <Link href={href({ name: "event", id: e.id })} className={s.evTitle}>{e.title}</Link>
                  {/* Tur ve bagli kayit sayisi sabit sutunlarda: satirlar arasi hizali. */}
                  <span className={s.evKindCol}><Tag tone="neutral">{EVENT_KIND[e.kind]}</Tag></span>
                  <span className={s.evLinksCol}>
                    {e.record_ids.length > 0 && (
                      <span className={s.msgs} title={`${e.record_ids.length} bağlı kayıt`}>
                        <Icon name="tasks" size={13} /> {e.record_ids.length}
                      </span>
                    )}
                  </span>
                </span>
                {e.place !== null && <span className={s.evPlace}><Icon name="venue" size={12} /> {e.place}</span>}
              </td>
              {/* Saat yalniz detayda; tabloda yer baslikta kalsin. */}
              <td className={s.nowrap}>
                {e.date === null ? <span className={s.dim}>Tarih yok</span> : (
                  <span className={s.evWhen}>{weekdayFmt.format(parseDay(e.date))}</span>
                )}
              </td>
              <td><Tag tone={EVENT_STATUS[e.status].tone}>{EVENT_STATUS[e.status].label}</Tag></td>
              <td><PriorityTag priority={e.priority} bare /></td>
              <td><Who user={L.user(e.owner_id)} /></td>
              <td className={s.evNum}>{e.attendees > 0 ? e.attendees : <span className={s.dim}>—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- en cok baglanan kayitlar ---------------------------------------------------

function TopLinked({ events, records }: { events: EventSummary[]; records: RecordSummary[] }) {
  const n = new Map<Uuid, number>();
  for (const e of events) for (const id of e.record_ids) n.set(id, (n.get(id) ?? 0) + 1);
  // Ikiz kayitlar sayilmaz: etkinligin kendisi, "bagli kayit" degil (spec/73 §3a).
  const twins = new Set(events.flatMap((e) => (e.record_id === null ? [] : [e.record_id])));
  const top = records
    .filter((r) => n.has(r.id) && !twins.has(r.id))
    .sort((a, b) => (n.get(b.id) ?? 0) - (n.get(a.id) ?? 0))
    .slice(0, 5);
  return (
    <section className={cx(s.surface, s.evLinked)}>
      <div className={s.surfaceHead}>
        <Icon name="tasks" size={15} /> En çok bağlanan kayıtlar
      </div>
      {top.length === 0 ? (
        <Empty title="Bağlı kayıt yok">Etkinliklere bağlanan görevler burada sıralanır.</Empty>
      ) : (
        <ol className={s.evLinkedList}>
          {top.map((r) => (
            <li key={r.id}>
              <span className={s.rowTitle}>
                <Link href={href({ name: "record", id: r.id })}>{r.title}</Link>
                <KindTag kind={r.kind} />
              </span>
              <Status status={r.status} />
              <span className={s.evLinkedCount}>{n.get(r.id)} etkinlik</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// --- ray: ay takvimi + ajanda -----------------------------------------------------

const monthFmt = new Intl.DateTimeFormat("tr", { month: "long", year: "numeric" });
const monthOnlyFmt = new Intl.DateTimeFormat("tr", { month: "long" });
const WEEKDAYS = ["Pt", "Sa", "Ça", "Pe", "Cu", "Ct", "Pz"];

function CalendarRail({ events, onClose }: { events: EventSummary[]; onClose: () => void }) {
  const now = new Date();
  const [month, setMonth] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const todayIso = toIsoDay(now);

  const byDay = new Map<IsoDate, EventSummary[]>();
  for (const e of events) if (e.date !== null) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);

  const y = month.getFullYear();
  const m = month.getMonth();
  const lead = (month.getDay() + 6) % 7; // Pazartesi basli
  const days = new Date(y, m + 1, 0).getDate();
  const cells: (IsoDate | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: days }, (_, i) => toIsoDay(new Date(y, m, i + 1))),
  ];

  // Ajanda: bugunden sonraki etkinlikler, ay basliklariyla.
  const upcoming = events
    .filter((e) => e.date !== null && e.date >= todayIso && e.status !== "cancelled")
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const groups = new Map<string, EventSummary[]>();
  for (const e of upcoming) {
    const key = monthOnlyFmt.format(parseDay(e.date ?? todayIso));
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }

  return (
    <aside className={s.evRail} aria-label="Takvim">
      <div className={s.evCal}>
        <div className={s.evCalHead}>
          <IconButton icon="chevron" label="Takvimi kapat" onClick={onClose} />
          <strong>{monthFmt.format(month)}</strong>
          <IconButton icon="back" label="Önceki ay" onClick={() => setMonth(new Date(y, m - 1, 1))} />
          <IconButton icon="chevron" label="Sonraki ay" onClick={() => setMonth(new Date(y, m + 1, 1))} />
        </div>
        <div className={s.evGrid}>
          {WEEKDAYS.map((d) => <span key={d} className={s.evWd}>{d}</span>)}
          {cells.map((d, i) => {
            if (d === null) return <span key={`x${i}`} />;
            // Gunun etkinlikleri onem sirasinda: gune basmak en onemlisini acar,
            // her nokta kendi etkinligini.
            const list = [...(byDay.get(d) ?? [])].sort((a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority));
            const day = parseDay(d).getDate();
            const top = list[0];
            if (top === undefined) {
              return <span key={d} className={s.evDay} data-today={d === todayIso}>{day}</span>;
            }
            return (
              <span key={d} className={s.evDay} data-today={d === todayIso} data-has="true">
                <Link href={href({ name: "event", id: top.id })} className={s.evDayLink}
                  title={list.map((e) => `${e.title} (${PRIORITY[e.priority]})`).join("\n")}>
                  {day}
                  <span className="visually-hidden">: {top.title}</span>
                </Link>
                <span className={s.evDots}>
                  {list.slice(0, 3).map((e) => (
                    <Link key={e.id} href={href({ name: "event", id: e.id })} className={s.evCalDot} title={`${e.title} (${PRIORITY[e.priority]})`}>
                      <span data-p={e.priority} />
                      <span className="visually-hidden">{e.title}</span>
                    </Link>
                  ))}
                </span>
              </span>
            );
          })}
        </div>
      </div>

      <div className={s.evAgenda}>
        {groups.size === 0 && <p className={s.dim}>Yaklaşan etkinlik yok.</p>}
        {[...groups].map(([name, list]) => (
          <section key={name}>
            <h3 className={s.evMonth}>{name}</h3>
            <ul>
              {list.map((e) => (
                <li key={e.id} className={s.evItem}>
                  <span className={s.evDate}>
                    <b>{parseDay(e.date ?? todayIso).getDate()}</b>
                    <span>{new Intl.DateTimeFormat("tr", { weekday: "short" }).format(parseDay(e.date ?? todayIso))}</span>
                  </span>
                  <span className={s.evItemText}>
                    <Link href={href({ name: "event", id: e.id })}>{e.title}</Link>
                    <span className={s.dim}>{[e.start, e.place].filter(Boolean).join(" · ")}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </aside>
  );
}

// --- yeni etkinlik ---------------------------------------------------------------

/** Tur secilince sablonun yukleyecegi widget ve checkpoint'ler onizlenir.
 *  ponytail: kaydetme yok — /api/events gelince mutate + detaya git. */
function NewEventForm({ onCancel }: { onCancel: () => void }) {
  const L = useLookup();
  const [kind, setKind] = useState<EventKind>("meeting");
  const tpl = EVENT_TEMPLATE[kind];
  return (
    <form className={ui.formStack} onSubmit={(e) => e.preventDefault()}>
      <label className={ui.field}>
        <span>Ad</span>
        <input className={ui.input} required maxLength={200} autoFocus placeholder="Örn. DC araba atölyesi" />
      </label>
      <label className={ui.field}>
        <span>Tür</span>
        <select className={ui.input} value={kind} onChange={(e) => setKind(e.target.value as EventKind)}>
          {(Object.keys(EVENT_KIND) as EventKind[]).map((k) => <option key={k} value={k}>{EVENT_KIND[k]}</option>)}
        </select>
      </label>
      {/* Etkinligin kaydi ayni islemde acilir; kayit bir birimde durur (spec/73 §3a). */}
      <label className={ui.field}>
        <span>Birim <span className={ui.fieldHint}>— etkinliğin kaydı (sohbet + arşiv) burada açılır</span></span>
        <select className={ui.input} required defaultValue="">
          <option value="" disabled>Birim seç</option>
          {L.meta.nodes.map((n) => <option key={n.id} value={n.id}>{"  ".repeat(n.depth)}{n.name}</option>)}
        </select>
      </label>
      <label className={ui.field}>
        <span>Tarih <span className={ui.fieldHint}>— boş bırakılırsa havuza düşer</span></span>
        <input className={ui.input} type="date" />
      </label>
      <div className={s.evTemplate}>
        <span className={s.dim}>{EVENT_KIND[kind]} şablonu otomatik yükler:</span>
        <div className={s.evTemplateRow}>
          {tpl.widgets.map((w) => (
            <span key={w} className={s.evChip}><Icon name={WIDGET[w].icon} size={13} /> {WIDGET[w].label}</span>
          ))}
        </div>
        <ol className={s.evTemplateSteps}>
          {tpl.checkpoints.map(([label, n]) => (
            <li key={label}>
              <span>{label}</span>
              <span className={s.dim}>{n === 0 ? "etkinlik günü" : n < 0 ? `${-n} gün önce` : `${n} gün sonra`}</span>
            </li>
          ))}
        </ol>
      </div>
      <p className={s.dim}>Tasarım önizlemesi: etkinlik API'si gelince kaydedilecek.</p>
      <div className={ui.dact}>
        <Button onClick={onCancel}>Vazgeç</Button>
        <Button type="submit" variant="primary" disabled>Oluştur</Button>
      </div>
    </form>
  );
}
