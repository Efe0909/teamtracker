// Pillar'lar: liste + pillar sayfasi. Pillar agaca BAGLI DEGIL (spec/22); her
// pillar'in bir OZEL takimi var — uyeleri ve sohbeti o takimdan. Kayitlarla
// bagi `records.pillar_id` (ortogonal: kaydin birimi ayri).

import { useEffect, useState } from "react";
import { ApiError, errorText } from "../../api/client";
import { pillarOps, useRecords, useTeam, useTeams, useTeamWrite } from "../../api/hooks";
import type { MetaPillar, Uuid } from "../../api/types";
import { Chat } from "../../features/chat/Chat";
import { ChatBell } from "../../features/chat/ChatBell";
import { NewRecordForm } from "../../features/record/NewRecordForm";
import { isDone } from "../../lib/labels";
import { useLookup } from "../../lib/lookup";
import { navigate } from "../../lib/router";
import { Icon } from "../../ui/icons";
import { Avatar, Button, Dialog, Empty, Link, Loading, Tag, useToast } from "../../ui/ui";
import { ErrorScreen } from "../errors/ErrorScreen";
import { Banner } from "./Banner";
import { KpiSkeleton } from "./KpiSkeleton";
import s from "./dashboard.module.css";
import { href } from "./routes";
import { MembersWidget, RecordsWidget, TeamForm, TeamMark, useCanManageTeams } from "./Teams";
import { ArrangeButton, useWidgetOrder } from "./Widget";

export function Pillars() {
  const L = useLookup();
  const can = useCanManageTeams();
  const teams = useTeams();
  const open = useRecords({});
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    document.title = "Pillar'lar — EkipTakip";
  }, []);
  const all = L.meta.pillars;
  const openBy = (id: Uuid) => (open.data ?? []).filter((r) => r.pillar_id === id && !isDone(r.status)).length;

  return (
    <div className={s.page}>
      <div className={s.pageHead}>
        <div className={s.pageTitle}>
          <h1>
            Pillar'lar<span className={s.count}>{all.length}</span>
          </h1>
          <p className={s.pageSub}>Kesişen sorumluluk alanları. Her pillar'ın kendi takımı ve sohbeti var; kayıtlar birimden bağımsız bir pillar'a bağlanır.</p>
        </div>
        {can && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={15} /> Yeni pillar
          </Button>
        )}
      </div>
      {all.length === 0 ? (
        <Empty title="Henüz pillar yok" icon="pin">
          {can ? "“Yeni pillar” ile ilkini kur; takımı ve sohbeti birlikte açılır." : "Pillar'ları yönetici kurar."}
        </Empty>
      ) : (
        <div className={s.teamGrid}>
          {all.map((p) => {
            const tv = teams.data?.find((t) => t.id === p.team_id);
            return (
              <Link key={p.id} href={href({ name: "pillar", id: p.id })} className={`${s.teamCard} ${p.is_active ? "" : s.inactiveCard}`}>
                <span className={s.teamCardHead}>
                  <TeamMark name={p.name} color={p.color} square />
                  <h2>{p.name}</h2>
                  {!p.is_active && <Tag tone="neutral">Pasif</Tag>}
                </span>
                <p>{p.description ?? "Açıklama yok."}</p>
                <span className={s.teamFoot}>
                  <span className={s.avStack}>
                    {(tv?.members ?? []).slice(0, 6).map((m) => (
                      <Avatar key={m.user_id} user={L.user(m.user_id)} size={22} />
                    ))}
                  </span>
                  {tv?.members.length ?? 0} kişi
                  <span>{openBy(p.id)} açık kayıt</span>
                </span>
              </Link>
            );
          })}
        </div>
      )}
      {creating && (
        <TeamForm
          kind="pillar"
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false);
            if (id !== undefined) navigate(href({ name: "pillar", id }));
          }}
        />
      )}
    </div>
  );
}

export function PillarPage({ id }: { id: Uuid }) {
  const L = useLookup();
  const p = L.pillar(id);
  useEffect(() => {
    if (p !== undefined) document.title = `${p.name} — EkipTakip`;
  }, [p]);
  if (p === undefined) return <ErrorScreen code="not_found" />;
  return <PillarScreen p={p} />;
}

const PILLAR_WIDGETS = ["members", "records", "kpi"] as const;

function PillarScreen({ p }: { p: MetaPillar }) {
  const L = useLookup();
  const can = useCanManageTeams();
  const toast = useToast();
  const w = useTeamWrite();
  const q = useTeam(p.team_id);
  const team = L.team(p.team_id);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [arranging, setArranging] = useState(false);
  const W = useWidgetOrder("pillar", PILLAR_WIDGETS, arranging);

  if (q.error !== null || team === undefined) {
    return <ErrorScreen code={q.error instanceof ApiError && q.error.code !== "not_found" ? "network" : "not_found"} />;
  }
  if (q.data === undefined) return <Loading />;
  const member = q.data.members.some((m) => m.user_id === L.me.id);
  const fail = (e: unknown) => toast({ text: errorText(e), error: true });

  const remove = () => {
    if (!window.confirm(`${p.name} silinecek: pillar, takımı ve sohbeti gider. Kayıtlar kalır, pillar'sız olur. Emin misin?`)) return;
    w.mutate(pillarOps.remove(p.id), { onSuccess: () => navigate(href({ name: "pillars" })), onError: fail });
  };

  return (
    <div className={s.recordPage}>
      <nav className={s.crumb} aria-label="Konum">
        <Link href={href({ name: "pillars" })}>Pillar'lar</Link>
        <Icon name="chevron" size={13} />
        <b>{p.name}</b>
      </nav>
      <div className={s.recordBody}>
        <div className={s.recordMain}>
          <Banner team={team} can={can} />
          <div className={s.pageHead} style={{ marginBottom: 0, alignItems: "center" }}>
            <div className={s.teamHero} style={{ flex: 1, minWidth: 0 }}>
              <TeamMark name={p.name} color={p.color} square />
              <div className={s.pageTitle}>
                <h1>
                  {p.name} {!p.is_active && <Tag tone="neutral">Pasif</Tag>}
                </h1>
                {p.description !== null && <p className={s.pageSub}>{p.description}</p>}
              </div>
            </div>
            <ArrangeButton on={arranging} onChange={setArranging} />
            {can && (
              <Button onClick={() => setEditing(true)}>
                <Icon name="edit" size={15} /> Düzenle
              </Button>
            )}
            {p.is_active && (
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Icon name="plus" size={15} /> Kayıt aç
              </Button>
            )}
          </div>

          {W.order.map((w) =>
            w === "members" ? <MembersWidget key={w} team={q.data} chat={team.chat_id} move={W.moveOf(w)} />
            : w === "records" ? <RecordsWidget key={w} query={{ pillar: p.id }} showTeam move={W.moveOf(w)} />
            : <KpiSkeleton key={w} move={W.moveOf(w)} />,
          )}
        </div>
        <aside className={s.recordSide} aria-label="Pillar sohbeti">
          <div className={s.sideHead}>
            <Icon name="chat" size={16} /> Pillar sohbeti
            <ChatBell chatId={team.chat_id} />
          </div>
          <div className={s.sideBody}>
            <Chat
              chatId={team.chat_id}
              canPost={member || L.meta.me.is_admin}
              lockedText="Bu sohbete yalnız pillar takımı yazar."
              empty="Sohbet boş. Pillar takımına bir not bırak."
            />
          </div>
        </aside>
      </div>
      <Dialog open={creating} onClose={() => setCreating(false)} title={`Yeni kayıt — ${p.name}`} wide>
        <NewRecordForm
          defaults={{ pillar_id: p.id }}
          onCancel={() => setCreating(false)}
          onCreated={(rid) => navigate(href({ name: "record", id: rid }))}
        />
      </Dialog>
      {editing && (
        <TeamForm
          kind="pillar"
          initial={p}
          onClose={() => setEditing(false)}
          onSaved={() => setEditing(false)}
          extra={
            <>
              <div className={s.dangerZone}>
                <span>
                  <b>{p.is_active ? "Pasifleştir" : "Yeniden aç"}</b>
                  <span className={s.dim}>
                    {p.is_active
                      ? "Yeni kayıtlarda seçilemez; mevcut kayıtlar ve sohbet kalır."
                      : "Pillar yeniden seçilebilir olur."}
                  </span>
                </span>
                <Button size="sm" disabled={w.isPending}
                  onClick={() => w.mutate(pillarOps.patch(p.id, { is_active: !p.is_active }), { onSuccess: () => setEditing(false), onError: fail })}>
                  {p.is_active ? "Pasifleştir" : "Aç"}
                </Button>
              </div>
              {L.meta.me.is_admin && (
                <div className={s.dangerZone}>
                  <span>
                    <b>Pillar'ı sil</b>
                    <span className={s.dim}>Takımı ve sohbeti de gider. Kayıtlar pillar'sız kalır.</span>
                  </span>
                  <Button variant="danger" size="sm" onClick={remove} disabled={w.isPending}>Sil</Button>
                </div>
              )}
            </>
          }
        />
      )}
    </div>
  );
}
