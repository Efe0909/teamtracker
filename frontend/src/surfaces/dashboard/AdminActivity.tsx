// Yonetim > Aktivite: kisi basina ozet (son giris, 30 gunluk istek/sure) ve
// secilen kisinin katki matrisi. Veri: user_activity (sunucu dakikada bir yazar).
// Sure yaklasiktir: istek atilan dakika sayisi.

import { useState } from "react";
import { useAdminActivity } from "../../api/hooks";
import type { PersonUse } from "../../api/types";
import { ago } from "../../lib/labels";
import { useLookup } from "../../lib/lookup";
import { matrix, totals30 } from "../../lib/usage";
import { Avatar, cx, Empty, Loading, Segmented } from "../../ui/ui";
import s from "./dashboard.module.css";

type Sort = "seen" | "requests" | "minutes";

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
    .map((u) => ({ u, t: totals30(u, today), name: L.user(u.user_id)?.name ?? "?" }))
    .filter((r) => r.name.toLocaleLowerCase("tr").includes(search.trim().toLocaleLowerCase("tr")))
    .sort((a, b) =>
      sort === "requests" ? b.t.requests - a.t.requests
      : sort === "minutes" ? b.t.minutes - a.t.minutes
      : (b.u.last_seen_at ?? "").localeCompare(a.u.last_seen_at ?? ""));
  const sel: PersonUse | undefined = q.data.find((u) => u.user_id === (picked ?? rows[0]?.u.user_id));

  return (
    <div>
      <div className={s.activityBar}>
        <input className={s.activitySearch} placeholder="Kişi ara…" aria-label="Kişi ara" value={search}
          onChange={(e) => setSearch(e.target.value)} />
        <Segmented<Sort> label="Sırala" value={sort} onChange={setSort}
          options={[{ value: "seen", label: "Son hareket" }, { value: "requests", label: "İstek" }, { value: "minutes", label: "Süre" }]} />
      </div>
      {rows.length === 0 ? (
        <Empty title="Kimse yok">Aramana uyan kişi bulunamadı.</Empty>
      ) : (
        <table className={cx(s.surface, s.activityTable)}>
          <thead>
            <tr><th>Kişi</th><th>Son giriş</th><th>Son hareket</th><th>30 gün: gün</th><th>İstek</th><th>Süre</th></tr>
          </thead>
          <tbody>
            {rows.map(({ u, t, name }) => (
              <tr key={u.user_id} aria-selected={sel?.user_id === u.user_id} onClick={() => setPicked(u.user_id)}>
                <td><span className={s.activityWho}><Avatar user={L.user(u.user_id)} size={20} /> {name}</span></td>
                <td>{u.last_login_at === null ? "—" : ago(u.last_login_at)}</td>
                <td>{u.last_seen_at === null ? "—" : ago(u.last_seen_at)}</td>
                <td>{t.activeDays}</td>
                <td>{t.requests}</td>
                <td>{hm(t.minutes)}</td>
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
  return (
    <section className={s.surface} style={{ padding: 16, marginTop: 16 }} aria-label={`${name} katkı matrisi`}>
      <div className={s.matrixHead}><b>{name}</b> <span className={s.dim}>· son 17 hafta, gün başına HTTP isteği</span></div>
      <div className={s.matrix} role="img" aria-label={`${name} için günlük etkileşim matrisi`}>
        {weeks.map((col, i) => (
          <div key={i} className={s.matrixCol}>
            {col.map((c, j) => c === null
              ? <span key={j} className={s.matrixGap} />
              : <span key={j} className={cx(s.matrixCell, s[`lv${c.level}`])}
                  title={`${c.day}: ${c.requests} istek, ${hm(c.minutes)}`} />)}
          </div>
        ))}
      </div>
    </section>
  );
}
