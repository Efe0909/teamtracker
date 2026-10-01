// Ekip sayfasi: herkesin profili, arama. Alanlari kisi KENDI girer
// (features/profile). Telefon ve dogum gunu herkese acik; yil gosterilmez.

import { useEffect, useMemo, useState } from "react";
import { useTeams } from "../../api/hooks";
import type { MetaUser, Uuid } from "../../api/types";
import { EditableAvatar } from "../../features/profile/EditableAvatar";
import { useLookup } from "../../lib/lookup";
import { Icon } from "../../ui/icons";
import { Empty } from "../../ui/ui";
import s from "./dashboard.module.css";

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

function birthday(u: MetaUser): string | null {
  return u.birth_day === null || u.birth_month === null ? null : `${u.birth_day} ${MONTHS[u.birth_month - 1] ?? ""}`;
}

function isToday(u: MetaUser): boolean {
  const now = new Date();
  return u.birth_day === now.getDate() && u.birth_month === now.getMonth() + 1;
}

export function People() {
  const L = useLookup();
  const teams = useTeams();
  const [q, setQ] = useState("");
  useEffect(() => {
    document.title = "Ekip — EkipTakip";
  }, []);

  // Kisi -> uye oldugu takimlar (pillar'in ozel takimi da dahil).
  const membership = useMemo(() => {
    const m = new Map<Uuid, Uuid[]>();
    for (const t of teams.data ?? []) {
      for (const mem of t.members) m.set(mem.user_id, [...(m.get(mem.user_id) ?? []), t.id]);
    }
    return m;
  }, [teams.data]);

  const term = q.trim().toLocaleLowerCase("tr");
  const rows = L.meta.users.filter((u) =>
    [u.name, u.nickname ?? "", u.phone ?? ""].some((f) => f.toLocaleLowerCase("tr").includes(term)));

  return (
    <div className={s.page}>
      <div className={s.pageHead}>
        <div className={s.pageTitle}>
          <h1>Ekip<span className={s.count}>{L.meta.users.length}</span></h1>
          <p className={s.pageSub}>Herkesin profili. Bilgilerini herkes kendi girer: sol-alttaki menüden “Profilim”.</p>
        </div>
      </div>
      <input className={s.activitySearch} style={{ width: 280, marginBottom: 16 }} placeholder="Kişi ara…" aria-label="Kişi ara"
        value={q} onChange={(e) => setQ(e.target.value)} />
      {rows.length === 0 ? (
        <Empty title="Kimse yok" icon="teams">Aramana uyan kişi bulunamadı.</Empty>
      ) : (
        <ul className={s.peopleGrid}>
          {rows.map((u) => {
            const b = birthday(u);
            const ts = (membership.get(u.id) ?? []).map((id) => L.team(id)?.name).filter((n): n is string => n !== undefined);
            return (
              <li key={u.id} className={s.surface}>
                <div className={s.personCard}>
                  <EditableAvatar user={u} size={48} />
                  <div className={s.personInfo}>
                    <b>{u.name}</b>
                    {u.nickname !== null && <span className={s.dim}>“{u.nickname}”</span>}
                    {u.phone !== null && <a href={`tel:${u.phone.replace(/[^\d+]/g, "")}`}>{u.phone}</a>}
                    {b !== null && (
                      <span className={s.dim}>
                        <Icon name="cake" size={13} /> {b}{isToday(u) ? " · bugün!" : ""}
                      </span>
                    )}
                    {ts.length > 0 && <span className={s.dim}>{ts.join(" · ")}</span>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
