// Yonetim > Aktivite: kisi basina ozet (son giris, son hareket, 30 gunde aktif
// gun, son 7 gunun suresi) ve secilen kisinin katki matrisi + istatistikleri.
// Veri: user_activity (sunucu dakikada bir yazar). Sure yaklasiktir: istek
// atilan dakika sayisi — bildirim yoklamasi yuzunden sekmenin ACIK kaldigi sure.

import { useState } from "react";
import { useAdminActivity } from "../../api/hooks";
import type { PersonUse } from "../../api/types";
import { ago } from "../../lib/labels";
import { useLookup } from "../../lib/lookup";
import { matrix, minutesSince, stats, STREAK_MIN, totals30 } from "../../lib/usage";
import { Avatar, cx, Empty, Loading, Segmented } from "../../ui/ui";
import s from "./dashboard.module.css";

type Sort = "seen" | "week";

const hm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} sa ${m % 60} dk` : `${m} dk`);

export function AdminActivity() {
  const L = useLookup();
  const q = useAdminActivity();
  const [sort, setSort] = useState<Sort>("seen");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  if (q.data === undefined) return <Loading />;

  const today = new Date();
  const rows = q.data
    .map((u) => ({ u, days: totals30(u, today).activeDays, week: minutesSince(u, today, 7), name: L.user(u.user_id)?.name ?? "?" }))
    .filter((r) => r.name.toLocaleLowerCase("tr").includes(search.trim().toLocaleLowerCase("tr")))
    .sort((a, b) =>
      sort === "week" ? b.week - a.week : (b.u.last_seen_at ?? "").localeCompare(a.u.last_seen_at ?? ""));
  const sel: PersonUse | undefined = q.data.find((u) => u.user_id === (picked ?? rows[0]?.u.user_id));

  return (
    <div>
      <div className={s.activityBar}>
        <input className={s.activitySearch} placeholder="Kişi ara…" aria-label="Kişi ara" value={search}
          onChange={(e) => setSearch(e.target.value)} />
        <Segmented<Sort> label="Sırala" value={sort} onChange={setSort}
          options={[{ value: "seen", label: "Son hareket" }, { value: "week", label: "Bu hafta" }]} />
      </div>
      {rows.length === 0 ? (
        <Empty title="Kimse yok">Aramana uyan kişi bulunamadı.</Empty>
      ) : (
        <table className={cx(s.surface, s.activityTable)}>
          <thead>
            <tr><th>Kişi</th><th>Son giriş</th><th>Son hareket</th><th>30 gün: gün</th><th>Bu hafta</th></tr>
          </thead>
          <tbody>
            {rows.map(({ u, days, week, name }) => (
              <tr key={u.user_id} aria-selected={sel?.user_id === u.user_id} onClick={() => setPicked(u.user_id)}>
                <td><span className={s.activityWho}><Avatar user={L.user(u.user_id)} size={20} /> {name}</span></td>
                <td>{u.last_login_at === null ? "—" : ago(u.last_login_at)}</td>
                <td>{u.last_seen_at === null ? "—" : ago(u.last_seen_at)}</td>
                <td>{days}</td>
                <td title="Son 7 gün">{hm(week)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {sel !== undefined && <Matrix u={sel} name={L.user(sel.user_id)?.name ?? "?"} today={today} />}
    </div>
  );
}

function Matrix({ u, name, today }: { u: PersonUse; name: string; today: Date }) {
  const weeks = matrix(u, today);
  const st = stats(u, today);
  const gun = (n: number) => `${n} gün`;
  return (
    <section className={s.surface} style={{ padding: 16, marginTop: 16 }} aria-label={`${name} katkı matrisi`}>
      <div className={s.matrixHead}><b>{name}</b> <span className={s.dim}>· son 17 hafta, gün başına süre</span></div>
      <div className={s.usageBody}>
        <div>
          <div className={s.matrix} role="img" aria-label={`${name} için günlük süre matrisi`}>
            {weeks.map((col, i) => (
              <div key={i} className={s.matrixCol}>
                {col.map((c, j) => c === null
                  ? <span key={j} className={s.matrixGap} />
                  : <span key={j} className={cx(s.matrixCell, s[`lv${c.level}`])} title={`${c.day}: ${hm(c.minutes)}`} />)}
              </div>
            ))}
          </div>
          <div className={s.matrixLegend} aria-hidden="true">
            Az
            {([0, 1, 2, 3, 4] as const).map((l) => <span key={l} className={cx(s.matrixCell, s[`lv${l}`])} />)}
            Çok
          </div>
        </div>
        <dl className={s.usageStats}>
          <div><dt>Bugün</dt><dd>{hm(st.today)}</dd></div>
          <div><dt>Son 7 gün</dt><dd>{hm(st.week)}</dd></div>
          <div><dt>Son 30 gün</dt><dd>{hm(st.month)}</dd></div>
          <div><dt>Aktif gün başına</dt><dd>{hm(st.perActiveDay)}</dd></div>
          <div title={`Ardışık gün, günde ${STREAK_MIN} dakikadan fazla`}><dt>Şimdiki seri</dt><dd>{gun(st.current)}</dd></div>
          <div title={`Son 120 günde; ardışık gün, günde ${STREAK_MIN} dakikadan fazla`}><dt>En uzun seri</dt><dd>{gun(st.longest)}</dd></div>
        </dl>
      </div>
    </section>
  );
}
