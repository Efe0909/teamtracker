// Yonetim > Aktivite: kisi listesi (basliga tikla: azalan, tekrar: artan) ve
// secilen kisinin katki matrisi + satir satir istatistikleri. Olculerin anlami
// lib/usage.ts basinda: KATKI "ne yapti", SURE "sekme ne kadar acik kaldi".

import { useState } from "react";
import { useAdminActivity } from "../../api/hooks";
import type { PersonUse } from "../../api/types";
import { ago, formatDay } from "../../lib/labels";
import { useLookup } from "../../lib/lookup";
import {
  matrix, personRow, sortPeople, stats, STREAK_MIN, WINDOW_DAYS, type SortDir, type SortKey,
} from "../../lib/usage";
import { Icon } from "../../ui/icons";
import { Avatar, cx, Empty, Loading } from "../../ui/ui";
import s from "./dashboard.module.css";

const hm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} sa ${m % 60} dk` : `${m} dk`);

const COLS: { key: SortKey; label: string; title?: string }[] = [
  { key: "name", label: "Kişi" },
  { key: "login", label: "Son giriş" },
  { key: "seen", label: "Son hareket" },
  { key: "activeDays30", label: "Aktif gün", title: "Son 30 günde uğradığı gün" },
  { key: "minutes7", label: "Süre · 7 gün", title: "Son 7 günde sekmenin açık kaldığı süre" },
  { key: "contrib30", label: "Katkı · 30 gün", title: "Son 30 günde gönderilen mesaj + kayıt, alan, eylem değişikliği" },
];

export function AdminActivity() {
  const L = useLookup();
  const q = useAdminActivity();
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "seen", dir: "desc" });
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  if (q.data === undefined) return <Loading />;

  const today = new Date();
  const needle = search.trim().toLocaleLowerCase("tr");
  const rows = sortPeople(
    q.data.map((u) => personRow(u, L.user(u.user_id)?.name ?? "?", today))
      .filter((r) => r.name.toLocaleLowerCase("tr").includes(needle)),
    sort.key, sort.dir);
  const sel: PersonUse | undefined = q.data.find((u) => u.user_id === (picked ?? rows[0]?.id));
  // Ayni basliga tekrar: yon doner; yeni baslik: azalan baslar.
  const by = (key: SortKey) => setSort(sort.key === key ? { key, dir: sort.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" });

  return (
    <div>
      <div className={s.activityBar}>
        <input className={s.activitySearch} placeholder="Kişi ara…" aria-label="Kişi ara" value={search}
          onChange={(e) => setSearch(e.target.value)} />
      </div>
      {rows.length === 0 ? (
        <Empty title="Kimse yok">Aramana uyan kişi bulunamadı.</Empty>
      ) : (
        <table className={cx(s.surface, s.activityTable)}>
          <thead>
            <tr>
              {COLS.map((c) => {
                const on = sort.key === c.key;
                return (
                  <th key={c.key} aria-sort={on ? (sort.dir === "desc" ? "descending" : "ascending") : "none"}>
                    <button type="button" className={s.sortBtn} data-on={on} title={c.title} onClick={() => by(c.key)}>
                      {c.label}
                      <Icon name={on && sort.dir === "asc" ? "up" : "down"} size={12} />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} aria-selected={sel?.user_id === r.id} onClick={() => setPicked(r.id)}>
                <td><span className={s.activityWho}><Avatar user={L.user(r.id)} size={20} /> {r.name}</span></td>
                <td>{r.login === null ? "—" : ago(r.login)}</td>
                <td>{r.seen === null ? "—" : ago(r.seen)}</td>
                <td>{r.activeDays30}</td>
                <td>{hm(r.minutes7)}</td>
                <td>{r.contrib30}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {sel !== undefined && <Person u={sel} name={L.user(sel.user_id)?.name ?? "?"} today={today} />}
    </div>
  );
}

function Person({ u, name, today }: { u: PersonUse; name: string; today: Date }) {
  const weeks = matrix(u, today);
  const st = stats(u, today);
  return (
    <section className={s.surface} style={{ padding: 16, marginTop: 16 }} aria-label={`${name} aktivitesi`}>
      <div className={s.matrixHead}><b>{name}</b> <span className={s.dim}>· son 17 hafta, gün başına katkı</span></div>
      <div className={s.usageBody}>
        <div>
          <div className={s.matrix} role="img" aria-label={`${name} için günlük katkı matrisi`}>
            {weeks.map((col, i) => (
              <div key={i} className={s.matrixCol}>
                {col.map((c, j) => c === null
                  ? <span key={j} className={s.matrixGap} />
                  : <span key={j} className={cx(s.matrixCell, s[`lv${c.level}`])}
                      title={`${formatDay(c.day)}: ${c.contrib} katkı · ${hm(c.minutes)}`} />)}
              </div>
            ))}
          </div>
          <div className={s.matrixLegend} aria-hidden="true">
            Az
            {([0, 1, 2, 3, 4] as const).map((l) => <span key={l} className={cx(s.matrixCell, s[`lv${l}`])} />)}
            Çok
          </div>
        </div>
        <div className={s.usageLines}>
          <dl>
            <Line k="Katkı · 30 gün" v={String(st.contrib30)} />
            <Line k="Mesaj / değişiklik" v={`${st.messages30} / ${st.changes30}`} />
            <Line k="Katkı · 7 gün" v={String(st.contrib7)} />
            <Line k="En katkılı gün" v={st.bestDay === null ? "—" : `${formatDay(st.bestDay.day)} (${st.bestDay.contrib})`} />
            <Line k="Aktif gün" v={`${st.activeDays30}/30`} />
          </dl>
          <dl>
            <Line k="Süre · bugün" v={hm(st.minutesToday)} />
            <Line k="Süre · 7 / 30 gün" v={`${hm(st.minutes7)} / ${hm(st.minutes30)}`} />
            <Line k="Aktif gün başına" v={hm(st.perActiveDay)} />
            <Line k="Şimdiki seri" v={`${st.current} gün`} />
            <Line k="En uzun seri" v={`${st.longest} gün`} />
          </dl>
          <p className={s.usageNote}>
            Katkı: gönderilen mesaj + kayıt, alan, eylem ve takım değişiklikleri. Süre: sekmenin açık kaldığı
            dakika. Seri: günde {STREAK_MIN} dakikadan fazla açık kalınan ardışık günler (son {WINDOW_DAYS} gün).
          </p>
        </div>
      </div>
    </section>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return <div><dt>{k}</dt><dd>{v}</dd></div>;
}
