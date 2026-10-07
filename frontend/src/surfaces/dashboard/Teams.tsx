// Takimlar: liste + takim sayfasi (uyeler, calistigi konular, acik kayitlar,
// takim duvari). Takim agactan BAGIMSIZ (spec/22): /api/teams'ten acilir,
// agacla bagi team_nodes (N:M). Pillar'larin ozel takimlari burada
// listelenmez — onlar pillar sayfasinda.

import { useEffect, useState, type ReactNode } from "react";
import { ApiError, errorText } from "../../api/client";
import { teamOps, useRecords, useTeam, useTeamMember, useTeams, useTeamWrite } from "../../api/hooks";
import type { TeamRole, TeamView, Uuid } from "../../api/types";
import { Chat } from "../../features/chat/Chat";
import { ChatBell } from "../../features/chat/ChatBell";
import { NodeTreePicker } from "../../features/nodes/NodePicker";
import { NewRecordForm } from "../../features/record/NewRecordForm";
import { TEAM_COLORS } from "../../lib/colors";
import { TEAM_ROLE } from "../../lib/labels";
import { useLookup } from "../../lib/lookup";
import { navigate } from "../../lib/router";
import { Icon } from "../../ui/icons";
import { MarkdownField, MarkdownText } from "../../ui/MarkdownField";
import { Avatar, Button, Dialog, Empty, IconButton, Link, Loading, Picker, Segmented, ui, useToast, Who } from "../../ui/ui";
import { ErrorScreen } from "../errors/ErrorScreen";
import { Banner } from "./Banner";
import { ArrangeButton, useRowLimit, useWidgetOrder, Widget, type WidgetMove } from "./Widget";
import s from "./dashboard.module.css";
import { href } from "./routes";
import { RecordTable } from "./Tasks";

/** Takim ve pillar yazmalari ayni kapidan: `manage_teams` ya da admin. */
export function useCanManageTeams(): boolean {
  const L = useLookup();
  return L.meta.me.is_admin || L.can("manage_teams");
}

export function Teams() {
  const L = useLookup();
  const q = useTeams();
  const can = useCanManageTeams();
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    document.title = "Takımlar — EkipTakip";
  }, []);
  if (q.data === undefined) return <Loading />;
  const mine = new Set(L.meta.me.team_ids);
  const rows = q.data.filter((t) => L.team(t.id)?.pillar_id === null);

  return (
    <div className={s.page}>
      <div className={s.pageHead}>
        <div className={s.pageTitle}>
          <h1>
            Takımlar<span className={s.count}>{rows.length}</span>
          </h1>
          <p className={s.pageSub}>Üyeler, çalıştıkları konular, açık kayıtlar ve takım duvarı. Üyesi olduğun takımlar önce.</p>
        </div>
        {can && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={15} /> Yeni takım
          </Button>
        )}
      </div>
      {rows.length === 0 ? (
        <Empty title="Henüz takım yok" icon="teams">
          {can ? "“Yeni takım” ile ilk takımı kur." : "Takımları yönetici ya da takım yöneticisi kurar."}
        </Empty>
      ) : (
        <div className={s.teamGrid}>
          {[...rows]
            .sort((a, b) => Number(mine.has(b.id)) - Number(mine.has(a.id)))
            .map((t) => {
              const team = L.team(t.id);
              const nodes = team?.node_ids ?? [];
              return (
                <Link key={t.id} href={href({ name: "team", id: t.id })} className={s.teamCard}>
                  <span className={s.teamCardHead}>
                    <TeamMark name={team?.name ?? "?"} color={team?.color ?? null} />
                    <h2>{team?.name ?? "?"}</h2>
                    {mine.has(t.id) && <span className={s.mine}>Üyesin</span>}
                  </span>
                  {team?.description !== null && team?.description !== undefined
                    ? <MarkdownText value={team.description} linkTextOnly />
                    : <p>Açıklama yok.</p>}
                  {nodes.length > 0 && (
                    <span className={s.nodeLine}>
                      <Icon name="tree" size={13} />
                      {nodes.map((n) => L.node(n)?.name ?? "?").join(" · ")}
                    </span>
                  )}
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
      {creating && (
        <TeamForm
          kind="team"
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false);
            if (id !== undefined) navigate(href({ name: "team", id }));
          }}
        />
      )}
    </div>
  );
}

/** Takim/pillar isareti: rengin uzerinde bas harf (kenar cubugundaki noktanin buyugu). */
export function TeamMark({ name, color, square = false }: { name: string; color: string | null; square?: boolean }) {
  return (
    <span className={square ? s.pillarMark : s.teamMark} style={color !== null ? { background: color } : undefined} aria-hidden="true">
      {name.slice(0, 1).toLocaleUpperCase("tr")}
    </span>
  );
}

/** Ad + aciklama + renk. Takim ve pillar AYNI form: govde ayni (spec/22 NewTeam). */
export function TeamForm(props: {
  kind: "team" | "pillar";
  initial?: { id: Uuid; name: string; description: string | null; color: string | null };
  onClose: () => void;
  onSaved: (id: Uuid | undefined) => void;
  extra?: ReactNode;
}) {
  const L = useLookup();
  const bypassQuality = L.can("bypass_text_quality");
  const m = useTeamWrite();
  const init = props.initial;
  const [name, setName] = useState(init?.name ?? "");
  const [desc, setDesc] = useState(init?.description ?? "");
  const [color, setColor] = useState<string | null>(init?.color ?? TEAM_COLORS[0] ?? null);
  const [err, setErr] = useState<string | null>(null);
  const noun = props.kind === "team" ? "takım" : "pillar";
  const path = props.kind === "team" ? "/api/teams" : "/api/pillars";
  const body = { name: name.trim(), description: desc.trim() === "" ? null : desc, color };
  const nameValid = Array.from(name.trim()).length >= 5 || name.trim() === init?.name;
  const descValid = bypassQuality || desc.trim() === "" || Array.from(desc.trim()).length >= 30 || desc.trim() === (init?.description ?? "");

  return (
    <Dialog open onClose={props.onClose} title={init === undefined ? `Yeni ${noun}` : `${props.kind === "team" ? "Takımı" : "Pillar'ı"} düzenle`}
      {...(props.kind === "pillar" && init === undefined
        ? { hint: "Pillar'ın kendi takımı ve sohbeti birlikte açılır; üyeleri pillar sayfasından eklersin." }
        : {})}>
      <form className={ui.formStack} onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        m.mutate(
          init === undefined ? { method: "POST", path, body } : { method: "PATCH", path: `${path}/${init.id}`, body },
          { onSuccess: (r) => props.onSaved(init?.id ?? r?.id), onError: (x) => setErr(errorText(x)) },
        );
      }}>
        {err !== null && <p className={ui.error} role="alert">{err}</p>}
        <input className={ui.titleInput} value={name} onChange={(e) => setName(e.target.value)} required maxLength={200}
          autoFocus placeholder={props.kind === "team" ? "Takım adı — ör. Maliye" : "Pillar adı — ör. Kalite"} aria-label="Ad" />
        <small className={ui.fieldHint}>{Array.from(name.trim()).length}/5 karakter</small>
        <div className={ui.propForm}>
          <div className={ui.propField}>
            <span className={ui.propLabel}><Icon name="edit" size={14} /> Açıklama</span>
            <MarkdownField value={desc} onChange={setDesc} label="Açıklama" rows={3}
              placeholder={props.kind === "team" ? "Takım ne iş yapar?" : "Bu pillar neyi kapsar?"} />
            <small className={ui.fieldHint}>{Array.from(desc.trim()).length}{bypassQuality ? " karakter" : "/30 karakter"} · isteğe bağlı</small>
          </div>
          <div className={ui.propField}>
            <span className={ui.propLabel}><Icon name="stOpen" size={14} /> Renk</span>
            <ColorSwatches value={color} onChange={setColor} />
          </div>
        </div>
        {props.extra}
        <div className={ui.dact}>
          <Button onClick={props.onClose}>Vazgeç</Button>
          <Button type="submit" variant="primary" aria-busy={m.isPending} disabled={m.isPending || !nameValid || !descValid}>
            {m.isPending ? "Kaydediliyor…" : init === undefined ? "Oluştur" : "Kaydet"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ColorSwatches({ value, onChange }: { value: string | null; onChange: (c: string) => void }) {
  return (
    <div className={s.swatches} role="radiogroup" aria-label="Renk">
      {TEAM_COLORS.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={c}
          className={s.swatch} style={{ background: c }} onClick={() => onChange(c)} />
      ))}
    </div>
  );
}

const ROLES: TeamRole[] = ["lead", "mentor", "member"];
const ROLE_OPTS = ROLES.map((r) => ({ value: r, label: TEAM_ROLE[r] }));

/** Uyeler widget'i (R4-F09): `manage_teams` ya da admin ekler, rol degistirir,
 *  cikarir — yalniz duzenleme modunda. Uc ayrica kontrol ediyor; bayrak yalniz
 *  kontrolleri gostermek icin. */
export function MembersWidget({ team, chat, move }: { team: TeamView; chat: Uuid; move: WidgetMove | undefined }) {
  const can = useCanManageTeams();
  return (
    <Widget id="members" title="Üyeler" count={team.members.length} canEdit={can} move={move}>
      {(editing) => <MemberRows team={team} chat={chat} editing={editing} />}
    </Widget>
  );
}

function MemberRows({ team, chat, editing }: { team: TeamView; chat: Uuid; editing: boolean }) {
  const L = useLookup();
  const toast = useToast();
  const m = useTeamMember(team.id, chat);
  const [pick, setPick] = useState<string | null>(null);
  const [role, setRole] = useState<TeamRole>("member");
  const rows = useRowLimit(team.members, editing);
  const write = (user_id: Uuid, r: TeamRole | null) =>
    m.mutate({ user_id, role: r }, { onError: (e) => toast({ text: errorText(e), error: true }) });
  const outside = L.meta.users.filter((u) => !team.members.some((x) => x.user_id === u.id));

  return (
    <>
      {team.members.length === 0 && (
        <p className={s.dim} style={{ padding: "12px 16px", margin: 0 }}>
          Henüz üye yok.{editing ? "" : " Eklemek için kalem simgesi."}
        </p>
      )}
      <ul className={s.members}>
        {rows.shown.map((x) => {
          // Her satirin denetimi kisinin adini tasir: ekran okuyucuda on tane
          // ayni "Rol" / "Takımdan çıkar" duyulmasin.
          const who = L.user(x.user_id)?.name ?? "?";
          return (
            <li key={x.user_id}>
              <Avatar user={L.user(x.user_id)} size={24} />
              <span>{who}</span>
              {editing ? (
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
      {rows.more}
      {editing && outside.length > 0 && (
        <div className={s.memberAdd}>
          <Picker label="Eklenecek kişi" value={pick} placeholder="Kişi ekle…" onChange={setPick}
            options={outside.map((u) => ({ value: u.id as string | null, label: u.name, render: <Who user={u} /> }))} />
          <Picker label="Rol" value={role} options={ROLE_OPTS} onChange={setRole} className={s.roleField} />
          <Button disabled={pick === null || m.isPending} onClick={() => { if (pick !== null) write(pick, role); setPick(null); }}>
            Ekle
          </Button>
        </div>
      )}
    </>
  );
}

/** Calistigi konular: team_nodes (N:M). Bag kopunca kayitlar etkilenmez.
 *  Bagla/kopar yalniz duzenleme modunda. */
function NodesWidget({ teamId, move }: { teamId: Uuid; move: WidgetMove | undefined }) {
  const L = useLookup();
  const can = useCanManageTeams();
  return (
    <Widget id="nodes" title="Çalıştığı konular" count={L.team(teamId)?.node_ids.length ?? 0} canEdit={can} move={move}>
      {(editing) => <NodeRows teamId={teamId} editing={editing} />}
    </Widget>
  );
}

function NodeRows({ teamId, editing }: { teamId: Uuid; editing: boolean }) {
  const L = useLookup();
  const toast = useToast();
  const m = useTeamWrite();
  const linked = L.team(teamId)?.node_ids ?? [];
  const rows = useRowLimit(linked, editing);
  const fail = (e: unknown) => toast({ text: errorText(e), error: true });

  return (
    <>
      {linked.length === 0 ? (
        <p className={s.dim} style={{ padding: "12px 16px", margin: 0 }}>
          Ağaçta hiçbir konuya bağlı değil.{editing ? " Aşağıdan bağla — bir takım birden çok konuda çalışabilir." : ""}
        </p>
      ) : (
        <ul className={s.members}>
          {rows.shown.map((id) => {
            const path = L.path(id);
            return (
              <li key={id}>
                <Icon name="tree" size={15} />
                <span>
                  <Link href={href({ name: "tasks", query: { node: id } })}>{path[path.length - 1] ?? "?"}</Link>
                  {path.length > 1 && <span className={s.dim}> · {path.slice(0, -1).join(" › ")}</span>}
                </span>
                {editing && (
                  <IconButton icon="x" label={`${path[path.length - 1] ?? "?"} bağını kopar`}
                    onClick={() => m.mutate(teamOps.unlink(teamId, id), { onError: fail })} />
                )}
              </li>
            );
          })}
        </ul>
      )}
      {rows.more}
      {editing && (
        <div className={s.unitPicker}>
          <NodeTreePicker rootKey="units" label="Konuya bağla" placeholder="Konuya bağla…" value={null}
            disabled={m.isPending} exclude={(n) => linked.includes(n.id)}
            onChange={(n) => m.mutate(teamOps.link(teamId, n), { onError: fail })} />
        </div>
      )}
    </>
  );
}

/** Takim ve pillar sayfasinin "Kayıtlar" widget'i: Açık/Kapanan + tablo. */
export function RecordsWidget({ query, showTeam, move }: {
  query: { team: Uuid } | { pillar: Uuid }; showTeam: boolean; move: WidgetMove | undefined;
}) {
  const [done, setDone] = useState<"false" | "true">("false");
  const rows = useRecords({ ...query, done });
  return (
    <Widget id="records" title="Kayıtlar" count={rows.data?.length} move={move}
      actions={
        <Segmented label="Kayıt durumu" value={done} onChange={setDone}
          options={[{ value: "false", label: "Açık" }, { value: "true", label: "Kapanan" }]} />
      }>
      {() => (rows.data === undefined ? <Loading /> : <RecordTable rows={rows.data} showTeam={showTeam} sortKey="team-records" />)}
    </Widget>
  );
}

const TEAM_WIDGETS = ["members", "nodes", "records"] as const;

export function TeamPage({ id }: { id: Uuid }) {
  const L = useLookup();
  const q = useTeam(id);
  const can = useCanManageTeams();
  const toast = useToast();
  const del = useTeamWrite();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [arranging, setArranging] = useState(false);
  const W = useWidgetOrder("team", TEAM_WIDGETS, arranging);
  const team = L.team(id);
  useEffect(() => {
    if (team !== undefined) document.title = `${team.name} — EkipTakip`;
  }, [team]);
  // Pillar'in ozel takimi kendi sayfasinda yasar.
  useEffect(() => {
    if (team?.pillar_id != null) navigate(href({ name: "pillar", id: team.pillar_id }), { replace: true });
  }, [team?.pillar_id]);

  if (q.error !== null || team === undefined) {
    return <ErrorScreen code={q.error instanceof ApiError && q.error.code !== "not_found" ? "network" : "not_found"} />;
  }
  if (q.data === undefined) return <Loading />;
  const member = q.data.members.some((m) => m.user_id === L.me.id);

  const remove = () => {
    if (!window.confirm(`${team.name} silinecek. Üyelikler ve takım duvarı gider; kayıtlar kalır ama takımsız olur. Emin misin?`)) return;
    del.mutate(teamOps.remove(id), {
      onSuccess: () => navigate(href({ name: "teams" })),
      onError: (e) => toast({ text: errorText(e), error: true }),
    });
  };

  return (
    <div className={s.recordPage}>
      <nav className={s.crumb} aria-label="Konum">
        <Link href={href({ name: "teams" })}>Takımlar</Link>
        <Icon name="chevron" size={13} />
        <b>{team.name}</b>
      </nav>
      <div className={s.recordBody}>
        <div className={s.recordMain}>
          <Banner team={team} can={can} />
          <div className={s.pageHead} style={{ marginBottom: 0, alignItems: "center" }}>
            <div className={s.teamHero} style={{ flex: 1, minWidth: 0 }}>
              <TeamMark name={team.name} color={team.color} />
              <div className={s.pageTitle}>
                <h1>{team.name}</h1>
                {team.description !== null && <MarkdownText value={team.description} className={s.pageSub} />}
              </div>
            </div>
            <ArrangeButton on={arranging} onChange={setArranging} />
            {can && (
              <Button onClick={() => setEditing(true)}>
                <Icon name="edit" size={15} /> Düzenle
              </Button>
            )}
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Icon name="plus" size={15} /> Kayıt aç
            </Button>
          </div>

          {W.order.map((w) =>
            w === "members" ? <MembersWidget key={w} team={q.data} chat={team.chat_id} move={W.moveOf(w)} />
            : w === "nodes" ? <NodesWidget key={w} teamId={id} move={W.moveOf(w)} />
            : <RecordsWidget key={w} query={{ team: id }} showTeam={false} move={W.moveOf(w)} />,
          )}
        </div>
        <aside className={s.recordSide} aria-label="Takım duvarı">
          <div className={s.sideHead}>
            <Icon name="chat" size={16} /> Takım duvarı
            <ChatBell chatId={team.chat_id} />
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
      {editing && (
        <TeamForm
          kind="team"
          initial={team}
          onClose={() => setEditing(false)}
          onSaved={() => setEditing(false)}
          extra={
            <div className={s.dangerZone}>
              <span>
                <b>Takımı sil</b>
                <span className={s.dim}>Üyelikler, konu bağları ve takım duvarı gider. Kayıtlar takımsız kalır.</span>
              </span>
              <Button variant="danger" size="sm" onClick={remove} disabled={del.isPending}>Sil</Button>
            </div>
          }
        />
      )}
    </div>
  );
}
