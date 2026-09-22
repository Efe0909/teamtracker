// Gorev Yoneticisi. Filtre = gezinme DEGIL (KNOW-234): URL'e replaceState
// ile yazilir, geri tusu sismez ama yenilemede ve paylasilan baglantida kalir.
// 3 birincil filtre + "Diger filtreler" (spec/16 P2 #7). Suzme SUNUCUDA.

import { useEffect, useState } from "react";
import { useRecords, type RecordQuery } from "../../api/hooks";
import type { RecordSummary } from "../../api/types";
import { ago, isDone, KIND, PRIORITY, PRIORITY_ORDER, STATUS, STATUS_ORDER } from "../../lib/labels";
import { useLookup } from "../../lib/lookup";
import { navigate } from "../../lib/router";
import { Icon } from "../../ui/icons";
import { Button, Dialog, Due, Empty, KindTag, Link, Loading, PriorityTag, Segmented, Status, TeamName, ui, Who } from "../../ui/ui";
import { NewRecordForm } from "../../features/record/NewRecordForm";
import s from "./dashboard.module.css";
import { href } from "./routes";

const QUICK = [
  { value: "all", label: "Hepsi" },
  { value: "week", label: "Bu hafta" },
  { value: "my_actions", label: "Açık eylemim" },
  { value: "overdue", label: "Geciken" },
  { value: "unassigned", label: "Atanmamış" },
] as const;

const SORTS = [
  { value: "activity", label: "Son hareket" },
  { value: "date", label: "Son tarih" },
  { value: "priority", label: "Öncelik" },
  { value: "newest", label: "En yeni" },
] as const;

export function Tasks({ query }: { query: RecordQuery }) {
  const L = useLookup();
  const [creating, setCreating] = useState(false);
  // Arama kutusu yerel; yazmayi 300ms bekleyip URL'e yazar.
  const [search, setSearch] = useState(query.search ?? "");
  const rows = useRecords(query);

  useEffect(() => {
    document.title = "Görevler — EkipTakip";
  }, []);
  useEffect(() => {
    if ((query.search ?? "") === search) return;
    const t = window.setTimeout(() => set({ search }), 300);
    return () => window.clearTimeout(t);
    // `set` her cizimde yeni; bagimlilik bilerek yalniz arama metni.
  }, [search]);

  function set(p: { [K in keyof RecordQuery]?: string | undefined }) {
    const next: RecordQuery = { ...query };
    for (const [k, v] of Object.entries(p) as [keyof RecordQuery, string | undefined][]) {
      if (v === undefined || v === "") delete next[k];
      else (next as Record<string, string>)[k] = v;
    }
    navigate(href({ name: "tasks", query: next }), { replace: true });
  }

  const data = rows.data ?? [];
  const open = data.filter((r) => !isDone(r.status)).length;
  const secondary = ["kind", "priority", "team", "pillar", "sort"].filter((k) => query[k as keyof RecordQuery] !== undefined).length;

  return (
    <div className={s.page}>
      <div className={s.pageHead}>
        <h1>Görevler</h1>
        <Button variant="primary" big onClick={() => setCreating(true)}>
          <Icon name="plus" size={18} /> Kayıt aç
        </Button>
      </div>

      <div style={{ marginBottom: 12, maxWidth: 640 }}>
        <Segmented label="Hızlı filtre" options={[...QUICK]} value={(query.quick ?? "all") as (typeof QUICK)[number]["value"]}
          onChange={(v) => set({ quick: v === "all" ? undefined : v })} />
      </div>

      <div className={s.bar}>
        <label className={`${ui.field} ${s.searchBox}`}>
          Ara
          <input className={ui.input} type="search" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Başlık veya açıklamada ara…" />
        </label>
        <label className={ui.field}>
          Birim
          <select className={ui.input} value={query.node ?? ""} onChange={(e) => set({ node: e.target.value })}>
            <option value="">Hepsi</option>
            {L.meta.nodes.filter((n) => n.node_type !== "team" && n.node_type !== "pillar").map((n) => (
              <option key={n.id} value={n.id}>{"  ".repeat(n.depth)}{n.name}</option>
            ))}
          </select>
        </label>
        <label className={ui.field}>
          Sorumlu
          <select className={ui.input} value={query.person ?? ""} onChange={(e) => set({ person: e.target.value })}>
            <option value="">Hepsi</option>
            <option value="me">Ben</option>
            <option value="none">Sorumlusuz</option>
            {L.meta.users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </label>
        <label className={ui.field}>
          Durum
          <select className={ui.input} value={query.status ?? ""} onChange={(e) => set({ status: e.target.value })}>
            <option value="">Hepsi</option>
            {STATUS_ORDER.map((v) => (
              <option key={v} value={v}>{STATUS[v]}</option>
            ))}
          </select>
        </label>
      </div>

      <details className={s.more} open={secondary > 0}>
        <summary>Diğer filtreler{secondary > 0 ? ` · ${secondary} etkin` : ""}</summary>
        <div className={s.bar}>
          <label className={ui.field}>
            Tür
            <select className={ui.input} value={query.kind ?? ""} onChange={(e) => set({ kind: e.target.value })}>
              <option value="">Hepsi</option>
              <option value="issue">{KIND.issue}</option>
              <option value="task">{KIND.task}</option>
            </select>
          </label>
          <label className={ui.field}>
            Öncelik
            <select className={ui.input} value={query.priority ?? ""} onChange={(e) => set({ priority: e.target.value })}>
              <option value="">Hepsi</option>
              {PRIORITY_ORDER.map((v) => (
                <option key={v} value={v}>{PRIORITY[v]}</option>
              ))}
            </select>
          </label>
          <label className={ui.field}>
            Takım
            <select className={ui.input} value={query.team ?? ""} onChange={(e) => set({ team: e.target.value })}>
              <option value="">Hepsi</option>
              {L.meta.teams.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </label>
          <label className={ui.field}>
            Pillar
            <select className={ui.input} value={query.pillar ?? ""} onChange={(e) => set({ pillar: e.target.value })}>
              <option value="">Hepsi</option>
              <option value="none">Pillar yok</option>
              {L.pillars.map((n) => (
                <option key={n.id} value={n.id}>{n.name}</option>
              ))}
            </select>
          </label>
          <label className={ui.field}>
            Sırala
            <select className={ui.input} value={query.sort ?? "activity"} onChange={(e) => set({ sort: e.target.value === "activity" ? undefined : e.target.value })}>
              {SORTS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
        </div>
      </details>

      <div className={s.chips}>
        {PRIORITY_ORDER.map((p) => {
          const n = data.filter((r) => r.priority === p && !isDone(r.status)).length;
          return n === 0 ? null : (
            <button key={p} type="button" className={s.chip} onClick={() => set({ priority: query.priority === p ? undefined : p })}
              aria-pressed={query.priority === p}>
              <PriorityTag priority={p} /> <b>{n}</b>
            </button>
          );
        })}
        {Object.keys(query).length > 0 && (
          <Button variant="ghost" onClick={() => { setSearch(""); navigate(href({ name: "tasks", query: {} }), { replace: true }); }}>
            <Icon name="x" size={16} /> Filtreleri temizle
          </Button>
        )}
        <span className={s.summary} aria-live="polite">
          {rows.isFetching ? "Yükleniyor… · " : ""}Açık {open} · Kapalı {data.length - open} · Toplam {data.length}
        </span>
      </div>

      {rows.data === undefined ? <Loading /> : <RecordTable rows={data} />}

      <Dialog open={creating} onClose={() => setCreating(false)} title="Yeni kayıt" wide>
        <NewRecordForm
          onCancel={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            navigate(href({ name: "record", id }));
          }}
        />
      </Dialog>
    </div>
  );
}

/** Tablo: gorev listesi ve takim sayfasi AYNI satiri cizer. */
export function RecordTable({ rows, showTeam = true }: { rows: RecordSummary[]; showTeam?: boolean }) {
  const L = useLookup();
  if (rows.length === 0) {
    return (
      <div className={s.tableWrap}>
        <Empty title="Kayıt yok">Bu filtrelere uyan kayıt bulunamadı.</Empty>
      </div>
    );
  }
  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead>
          <tr>
            <th scope="col">Kayıt</th>
            <th scope="col">Birim</th>
            {showTeam && <th scope="col">Takım</th>}
            <th scope="col">Öncelik</th>
            <th scope="col">Durum</th>
            <th scope="col">Sorumlu</th>
            <th scope="col">Son tarih</th>
            <th scope="col">Hareket</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const to = href({ name: "record", id: r.id });
            const path = L.path(r.unit_id);
            return (
              // Satirin tamami tiklanir; klavye/ekran okuyucu icin baslik bir baglanti.
              <tr key={r.id} onClick={(e) => { if (!(e.target as HTMLElement).closest("a")) navigate(to); }}>
                <td>
                  <span className={s.rowTitle}>
                    <KindTag kind={r.kind} />
                    <Link href={to}>{r.title}</Link>
                    {r.messages > 0 && (
                      <span className={s.msgs} title={`${r.messages} mesaj`}>
                        <Icon name="chat" size={14} /> {r.messages}
                      </span>
                    )}
                  </span>
                </td>
                <td className={s.unit} title={path.join(" › ")}>{path[path.length - 1] ?? "?"}</td>
                {showTeam && <td><TeamName team={L.team(r.team_id)} /></td>}
                <td><PriorityTag priority={r.priority} /></td>
                <td><Status status={r.status} /></td>
                <td><Who user={L.user(r.owner_id)} empty="Sorumlusuz" /></td>
                <td><Due date={r.due_date} done={isDone(r.status)} actionLate={r.action_overdue} /></td>
                <td className={s.nowrap}>{ago(r.updated_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
