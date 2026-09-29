// Takimlar: liste + takim sayfasi (uyeler, acik kayitlar, takim duvari).

import { useEffect, useState } from "react";
import { ApiError, errorText } from "../../api/client";
import { useNodeTree, usePatchNode, useRecords, useTeam, useTeamMember, useTeams } from "../../api/hooks";
import type { TeamRole, TeamView, Uuid } from "../../api/types";
import { Chat } from "../../features/chat/Chat";
import { NewRecordForm } from "../../features/record/NewRecordForm";
import { TEAM_ROLE } from "../../lib/labels";
import { useLookup } from "../../lib/lookup";
import { navigate } from "../../lib/router";
import { Icon } from "../../ui/icons";
import { Avatar, Button, Dialog, Empty, IconButton, Link, Loading, Picker, Req, Segmented, ui, useToast, Who } from "../../ui/ui";
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
        <Empty title="Henüz takım yok">
          <Link href={href({ name: "tree" })}>Veri Yönetimi</Link>'nde <b>takım</b> türünde bir düğüm aç, kartı burada
          kendiliğinden belirir.
        </Empty>
      ) : (
        <div className={s.teamGrid}>
          {[...q.data]
            .sort((a, b) => Number(mine.has(b.id)) - Number(mine.has(a.id)))
            .map((t) => {
              const team = L.team(t.id);
              return (
                <Link key={t.id} href={href({ name: "team", id: t.id })} className={s.teamCard}>
                  <span className={s.teamCardHead}>
                    <TeamMark name={team?.name ?? "?"} color={team?.color ?? null} />
                    <h2>{team?.name ?? "?"}</h2>
                    {mine.has(t.id) && <span className={s.mine}>Üyesin</span>}
                  </span>
                  <p>{team?.description ?? "Açıklama yok."}</p>
                  <span className={s.teamFoot}>
                    <span className={s.avStack}>
                      {t.members.slice(0, 6).map((m) => (
                        <Avatar key={m.user_id} user={L.user(m.user_id)} size={22} />
                      ))}
                    </span>
                    {t.members.length} üye
                    <span>{t.open_records} açık</span>
                  </span>
                </Link>
              );
            })}
        </div>
      )}
    </div>
  );
}

/** Ad/aciklama DUGUME yazilir, takim karti oradan tazelenir (KNOW-262: tek
 *  gercek, iki gorunum). Yetki de dugumun: `edit_nodes` + dal — Python burada
 *  `manage_teams` istiyordu, ama degisen sey agac. */
function EditTeam({ nodeId, name, description }: { nodeId: Uuid; name: string; description: string | null }) {
  const tree = useNodeTree();
  const m = usePatchNode();
  const [open, setOpen] = useState(false);
  const [n, setN] = useState(name);
  const [d, setD] = useState(description ?? "");
  const [err, setErr] = useState<string | null>(null);
  if (tree.data?.nodes.find((x) => x.id === nodeId)?.can_edit !== true) return null;
  return (
    <>
      <Button onClick={() => { setN(name); setD(description ?? ""); setErr(null); setOpen(true); }}>
        <Icon name="edit" size={16} /> Düzenle
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Takımı düzenle">
        <form className={ui.formStack} onSubmit={(e) => {
          e.preventDefault();
          m.mutate({ id: nodeId, patch: { name: n, description: d.trim() === "" ? null : d } },
            { onSuccess: () => setOpen(false), onError: (x) => setErr(errorText(x)) });
        }}>
          {err !== null && <p className={ui.error} role="alert">{err}</p>}
          <label className={ui.field}>
            <span>Ad<Req /></span>
            <input className={ui.input} value={n} onChange={(e) => setN(e.target.value)} required maxLength={200} />
          </label>
          <label className={ui.field}>
            Açıklama
            <textarea className={ui.input} rows={3} value={d} onChange={(e) => setD(e.target.value)} />
          </label>
          <p className={s.dim}>Ağaçtaki düğümle aynı ad: burada değiştirmek ağacı da değiştirir.</p>
          <div className={ui.dact}>
            <Button onClick={() => setOpen(false)}>Vazgeç</Button>
            <Button type="submit" variant="primary" aria-busy={m.isPending} disabled={m.isPending || n.trim() === ""}>
              {m.isPending ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/** Takim isareti: rengin uzerinde bas harf (kenar cubugundaki noktanin buyugu). */
function TeamMark({ name, color }: { name: string; color: string | null }) {
  return (
    <span className={s.teamMark} style={color !== null ? { background: color } : undefined} aria-hidden="true">
      {name.slice(0, 1).toLocaleUpperCase("tr")}
    </span>
  );
}

const ROLES: TeamRole[] = ["lead", "mentor", "member"];
const ROLE_OPTS = ROLES.map((r) => ({ value: r, label: TEAM_ROLE[r] }));

/** Uyeler (R4-F09): `manage_teams` ya da admin ekler, rol degistirir, cikarir.
 *  Uc ayrica kontrol ediyor; bu bayrak yalniz kontrolleri gostermek icin. */
function Members({ team, chat }: { team: TeamView; chat: Uuid }) {
  const L = useLookup();
  const toast = useToast();
  const m = useTeamMember(team.id, chat);
  const [pick, setPick] = useState<string | null>(null);
  const [role, setRole] = useState<TeamRole>("member");
  const can = L.meta.me.is_admin || L.can("manage_teams");
  const write = (user_id: Uuid, r: TeamRole | null) =>
    m.mutate({ user_id, role: r }, { onError: (e) => toast({ text: errorText(e), error: true }) });
  const outside = L.meta.users.filter((u) => !team.members.some((x) => x.user_id === u.id));

  return (
    <section className={s.surface} aria-labelledby="members-h">
      <div className={s.surfaceHead}>
        <span id="members-h">Üyeler</span>
        <span className={s.count}>{team.members.length}</span>
      </div>
      {team.members.length === 0 && <p className={s.dim} style={{ padding: "12px 16px", margin: 0 }}>Henüz üye yok.</p>}
      <ul className={s.members}>
        {team.members.map((x) => {
          // Her satirin denetimi kisinin adini tasir: ekran okuyucuda on tane
          // ayni "Rol" / "Takımdan çıkar" duyulmasin.
          const who = L.user(x.user_id)?.name ?? "?";
          return (
            <li key={x.user_id}>
              <Avatar user={L.user(x.user_id)} size={24} />
              <span>{who}</span>
              {can ? (
                <>
                  <Picker look="bare" label={`${who} — rol`} value={x.role} options={ROLE_OPTS} align="end"
                    onChange={(r) => write(x.user_id, r)}>
                    <span className={s.role}>{TEAM_ROLE[x.role]}</span>
                  </Picker>
                  <IconButton icon="x" label={`${who} takımdan çıkar`} onClick={() => write(x.user_id, null)} />
                </>
              ) : (
                <span className={s.role}>{TEAM_ROLE[x.role]}</span>
              )}
            </li>
          );
        })}
      </ul>
      {can && outside.length > 0 && (
        <div className={s.memberAdd}>
          <Picker label="Eklenecek kişi" value={pick} placeholder="Kişi ekle…" onChange={setPick}
            options={outside.map((u) => ({ value: u.id as string | null, label: u.name, render: <Who user={u} /> }))} />
          <Picker label="Rol" value={role} options={ROLE_OPTS} onChange={setRole} className={s.roleField} />
          <Button disabled={pick === null || m.isPending} onClick={() => { if (pick !== null) write(pick, role); setPick(null); }}>
            Ekle
          </Button>
        </div>
      )}
    </section>
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
        <Link href={href({ name: "teams" })}>Takımlar</Link>
        <Icon name="chevron" size={13} />
        <b>{team.name}</b>
      </nav>
      <div className={s.recordBody}>
        <div className={s.recordMain}>
          <div className={s.pageHead} style={{ marginBottom: 0, alignItems: "center" }}>
            <div className={s.teamHero} style={{ flex: 1, minWidth: 0 }}>
              <TeamMark name={team.name} color={team.color} />
              <div className={s.pageTitle}>
                <h1>{team.name}</h1>
                {team.description !== null && <p className={s.pageSub}>{team.description}</p>}
              </div>
            </div>
            {team.node_id !== null && <EditTeam nodeId={team.node_id} name={team.name} description={team.description} />}
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Icon name="plus" size={15} /> Kayıt aç
            </Button>
          </div>

          <Members team={q.data} chat={team.chat_id} />

          <section aria-labelledby="recs-h">
            <div className={s.pageHead} style={{ marginBottom: 10, alignItems: "center" }}>
              <h2 id="recs-h" className={s.sectionTitle} style={{ flex: 1, margin: 0 }}>Kayıtlar</h2>
              <Segmented label="Kayıt durumu" value={done} onChange={setDone}
                options={[{ value: "false", label: "Açık" }, { value: "true", label: "Kapanan" }]} />
            </div>
            {rows.data === undefined ? <Loading /> : <RecordTable rows={rows.data} showTeam={false} />}
          </section>
        </div>
        <aside className={s.recordSide} aria-label="Takım duvarı">
          <div className={s.sideHead}>
            <Icon name="chat" size={16} /> Takım duvarı
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
