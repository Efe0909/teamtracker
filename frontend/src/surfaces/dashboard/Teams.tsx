// Takimlar: liste + takim sayfasi (uyeler, acik kayitlar, takim duvari).

import { useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { useRecords, useTeam, useTeams } from "../../api/hooks";
import type { Uuid } from "../../api/types";
import { Chat } from "../../features/chat/Chat";
import { NewRecordForm } from "../../features/record/NewRecordForm";
import { TEAM_ROLE } from "../../lib/labels";
import { useLookup } from "../../lib/lookup";
import { navigate } from "../../lib/router";
import { Icon } from "../../ui/icons";
import { Avatar, Button, Dialog, Empty, Link, Loading, Segmented } from "../../ui/ui";
import { ErrorScreen } from "../errors/ErrorScreen";
import s from "./dashboard.module.css";
import { href } from "./routes";
import { RecordTable } from "./Tasks";

export function Teams() {
  const L = useLookup();
  const q = useTeams();
  useEffect(() => {
    document.title = "Takımlar — EkipTakip";
  }, []);
  if (q.data === undefined) return <Loading />;
  const mine = new Set(L.meta.me.team_ids);

  return (
    <div className={s.page}>
      <div className={s.pageHead}>
        <h1>Takımlar</h1>
      </div>
      <p className={s.lead}>Her takımın üyeleri, açık kayıtları ve kendi duvarı var. Üyesi olduğun takımlar önce.</p>
      {q.data.length === 0 ? (
        <Empty title="Henüz takım yok">Takımlar yönetim tarafında kurulur.</Empty>
      ) : (
        <div className={s.teamGrid}>
          {[...q.data]
            .sort((a, b) => Number(mine.has(b.id)) - Number(mine.has(a.id)))
            .map((t) => {
              const team = L.team(t.id);
              return (
                <Link key={t.id} href={href({ name: "team", id: t.id })} className={s.teamCard}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 12, height: 12, borderRadius: "50%", background: team?.color ?? "var(--dim)" }} aria-hidden="true" />
                    <h2>{team?.name ?? "?"}</h2>
                    {mine.has(t.id) && <span className={s.mine}>Üyesin</span>}
                  </span>
                  <p>{team?.description ?? "Açıklama yok."}</p>
                  <span className={s.teamFoot}>
                    <span className={s.avStack}>
                      {t.members.slice(0, 6).map((m) => (
                        <Avatar key={m.user_id} user={L.user(m.user_id)} size={26} />
                      ))}
                    </span>
                    {t.members.length} üye · {t.open_records} açık kayıt
                    <Icon name="chevron" size={16} />
                  </span>
                </Link>
              );
            })}
        </div>
      )}
    </div>
  );
}

export function TeamPage({ id }: { id: Uuid }) {
  const L = useLookup();
  const q = useTeam(id);
  const [done, setDone] = useState<"false" | "true">("false");
  const rows = useRecords({ team: id, done });
  const [creating, setCreating] = useState(false);
  const team = L.team(id);
  useEffect(() => {
    if (team !== undefined) document.title = `${team.name} — EkipTakip`;
  }, [team]);

  if (q.error !== null || team === undefined) {
    return <ErrorScreen code={q.error instanceof ApiError && q.error.code !== "not_found" ? "network" : "not_found"} />;
  }
  if (q.data === undefined) return <Loading />;
  const member = q.data.members.some((m) => m.user_id === L.me.id);

  return (
    <div className={s.recordPage}>
      <nav className={s.crumb} aria-label="Konum">
        <Link href={href({ name: "teams" })}>Takımlar</Link> › <b>{team.name}</b>
      </nav>
      <div className={s.recordBody}>
        <div className={s.recordMain}>
          <div className={s.pageHead} style={{ marginBottom: 0 }}>
            <h1>{team.name}</h1>
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Icon name="plus" size={16} /> Bu takıma kayıt aç
            </Button>
          </div>
          {team.description !== null && <p className={s.lead} style={{ margin: 0 }}>{team.description}</p>}

          <section aria-labelledby="members-h">
            <h2 id="members-h" className={s.sectionTitle}>Üyeler · {q.data.members.length}</h2>
            <ul className={s.members}>
              {q.data.members.map((m) => (
                <li key={m.user_id}>
                  <Avatar user={L.user(m.user_id)} size={24} />
                  {L.user(m.user_id)?.name ?? "?"}
                  <span className={s.role}>{TEAM_ROLE[m.role]}</span>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="recs-h">
            <div className={s.pageHead} style={{ marginBottom: 8 }}>
              <h2 id="recs-h" className={s.sectionTitle} style={{ flex: 1, margin: 0 }}>Kayıtlar</h2>
              <Segmented label="Kayıt durumu" value={done} onChange={setDone}
                options={[{ value: "false", label: "Açık" }, { value: "true", label: "Kapanan" }]} />
            </div>
            {rows.data === undefined ? <Loading /> : <RecordTable rows={rows.data} showTeam={false} />}
          </section>
        </div>
        <aside className={s.recordSide} aria-label="Takım duvarı">
          <div className={s.sideHead}>
            <Icon name="chat" size={18} /> Takım duvarı
          </div>
          <div className={s.sideBody}>
            <Chat
              chatId={team.chat_id}
              canPost={member || L.meta.me.is_admin}
              lockedText="Duvara yalnız takım üyeleri yazar."
              empty="Duvar boş. Takıma bir not bırak."
            />
          </div>
        </aside>
      </div>
      <Dialog open={creating} onClose={() => setCreating(false)} title={`Yeni kayıt — ${team.name}`} wide>
        <NewRecordForm
          defaults={{ team_id: id }}
          onCancel={() => setCreating(false)}
          onCreated={(rid) => navigate(href({ name: "record", id: rid }))}
        />
      </Dialog>
    </div>
  );
}
