// Alan seridi: her hap bir dialog acar (dropdown yok — tek dokunusla yanlis
// atama bedava, kullanici istegi). Yetki API'den (`access`), on yuz karar
// vermez yalniz gosterir.

import { useState, type ReactNode } from "react";
import { errorText } from "../../api/client";
import { usePatchRecord } from "../../api/hooks";
import type { RecordDetail, RecordPatch } from "../../api/types";
import { isDone, PRIORITY, PRIORITY_ORDER, STATUS, STATUS_ORDER } from "../../lib/labels";
import { useLookup } from "../../lib/lookup";
import { Icon } from "../../ui/icons";
import { Button, Choices, cx, Dialog, Due, PriorityTag, Status, TeamName, ui, useToast, Who, type Choice } from "../../ui/ui";
import s from "./record.module.css";

type FieldKey = "status" | "priority" | "owner_id" | "due_date" | "team_id" | "unit_id" | "pillar_id";

function Pill(props: { k: string; disabled: boolean; onOpen: () => void; children: ReactNode }) {
  return (
    <button type="button" className={s.pill} disabled={props.disabled} onClick={props.onOpen}>
      <span className={s.pillKey}>{props.k}</span>
      <span className={s.pillVal}>{props.children}</span>
    </button>
  );
}

function Empty({ text }: { text: string }) {
  return <span className={s.pillEmpty}>{text}</span>;
}

export function FieldStrip({ d, compact = false }: { d: RecordDetail; compact?: boolean }) {
  const L = useLookup();
  const r = d.record;
  const [open, setOpen] = useState<FieldKey | null>(null);
  const ro = !d.access.can_edit;
  const node = L.node(r.unit_id);
  const pillar = L.node(r.pillar_id);

  return (
    <>
      <div className={cx(s.strip, !compact && s.primaryStrip)}>
        <Pill k="Durum" disabled={ro} onOpen={() => setOpen("status")}>
          <Status status={r.status} />
        </Pill>
        <Pill k="Sorumlu" disabled={ro} onOpen={() => setOpen("owner_id")}>
          <Who user={L.user(r.owner_id)} empty="Sorumlusuz" />
        </Pill>
        <Pill k="Son tarih" disabled={!d.access.can_edit_deadline} onOpen={() => setOpen("due_date")}>
          {r.due_date === null ? <Empty text="Yok" /> : <Due date={r.due_date} done={isDone(r.status)} />}
        </Pill>
        <Pill k="Öncelik" disabled={ro} onOpen={() => setOpen("priority")}>
          <PriorityTag priority={r.priority} />
        </Pill>
      </div>
      <div className={s.strip}>
        <Pill k="Takım" disabled={ro} onOpen={() => setOpen("team_id")}>
          <TeamName team={L.team(r.team_id)} empty="Takım yok" />
        </Pill>
        <Pill k="Birim" disabled={ro} onOpen={() => setOpen("unit_id")}>
          {node?.name ?? <Empty text="?" />}
        </Pill>
        <Pill k="Pillar" disabled={ro} onOpen={() => setOpen("pillar_id")}>
          {pillar?.name ?? <Empty text="+ Pillar" />}
        </Pill>
      </div>
      {open !== null && <FieldDialog d={d} field={open} onClose={() => setOpen(null)} />}
    </>
  );
}

const TITLES: Record<FieldKey, string> = {
  status: "Durumu değiştir",
  priority: "Önceliği değiştir",
  owner_id: "Sorumluyu değiştir",
  due_date: "Son tarihi değiştir",
  team_id: "Takımı değiştir",
  unit_id: "Birimi değiştir",
  pillar_id: "Pillar seç",
};

function FieldDialog({ d, field, onClose }: { d: RecordDetail; field: FieldKey; onClose: () => void }) {
  const L = useLookup();
  const r = d.record;
  const toast = useToast();
  const m = usePatchRecord(r.id);
  const [err, setErr] = useState<string | null>(null);

  // Geri al: ayni alani onceki degerine dondur (spec/16 Y6).
  const save = (p: RecordPatch, undo: RecordPatch | null) => {
    setErr(null);
    m.mutate(p, {
      onSuccess: () => {
        onClose();
        toast({
          text: "Kaydedildi",
          error: false,
          ...(undo !== null ? { undo: () => m.mutate(undo, { onError: (e) => toast({ text: errorText(e), error: true }) }) } : {}),
        });
      },
      onError: (e) => setErr(errorText(e)),
    });
  };

  let body: ReactNode;
  let hint: string | undefined;
  switch (field) {
    case "status": {
      const openActs = d.actions.filter((a) => !isDone(a.status));
      const opts: Choice<typeof r.status>[] = STATUS_ORDER.map((v) => ({
        value: v,
        label: STATUS[v],
        ...(v === "closed" && openActs.length > 0 ? { disabled: true, note: `${openActs.length} açık eylem` } : {}),
      }));
      body = (
        <>
          {openActs.length > 0 && (
            // Kapatma engeli ONDEN soylenir, reddedilince degil (spec/17 I5).
            <div className={s.warn}>
              Açık eylemi olan kayıt kapanmaz. Kalanlar:
              <ul>
                {openActs.map((a) => (
                  <li key={a.id}>
                    {a.title} — {L.user(a.owner_id)?.name ?? "sahipsiz"}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Choices options={opts} current={r.status} busy={m.isPending}
            onPick={(v) => save({ field: "status", value: v }, { field: "status", value: r.status })} />
        </>
      );
      break;
    }
    case "priority":
      body = (
        <Choices
          options={PRIORITY_ORDER.map((v) => ({ value: v, label: PRIORITY[v] }))}
          current={r.priority}
          busy={m.isPending}
          onPick={(v) => save({ field: "priority", value: v }, { field: "priority", value: r.priority })}
        />
      );
      break;
    case "owner_id":
      body = (
        <Choices
          options={[
            { value: null as string | null, label: "Sorumlusuz" },
            ...L.meta.users.map((u) => ({ value: u.id as string | null, label: <Who user={u} />, ...(u.id === L.me.id ? { note: "sen" } : {}) })),
          ]}
          current={r.owner_id}
          busy={m.isPending}
          onPick={(v) => save({ field: "owner_id", value: v }, { field: "owner_id", value: r.owner_id })}
        />
      );
      break;
    case "team_id":
      body = (
        <Choices
          options={[
            { value: null as string | null, label: "Takım yok" },
            ...L.meta.teams.map((t) => ({ value: t.id as string | null, label: <TeamName team={t} /> })),
          ]}
          current={r.team_id}
          busy={m.isPending}
          onPick={(v) => save({ field: "team_id", value: v }, { field: "team_id", value: r.team_id })}
        />
      );
      break;
    case "pillar_id":
      hint = "Pillar kaydın atası olmak zorunda değil.";
      body = (
        <Choices
          options={[
            { value: null as string | null, label: "Pillar yok" },
            ...L.pillars.map((n) => ({ value: n.id as string | null, label: n.name })),
          ]}
          current={r.pillar_id}
          busy={m.isPending}
          onPick={(v) => save({ field: "pillar_id", value: v }, { field: "pillar_id", value: r.pillar_id })}
        />
      );
      break;
    case "unit_id":
      body = (
        <Choices
          options={L.units.map((n) => ({
            value: n.id,
            label: <span style={{ paddingLeft: n.depth * 14 }}>{n.name}</span>,
          }))}
          current={r.unit_id}
          busy={m.isPending}
          onPick={(v) => save({ field: "unit_id", value: v }, { field: "unit_id", value: r.unit_id })}
        />
      );
      break;
    case "due_date":
      body = <DueForm current={r.due_date} busy={m.isPending}
        onSave={(v) => save({ field: "due_date", value: v }, { field: "due_date", value: r.due_date })} />;
      break;
  }

  return (
    <Dialog open onClose={onClose} title={TITLES[field]} {...(hint !== undefined ? { hint } : {})}>
      {err !== null && <p className={ui.error} role="alert">{err}</p>}
      {body}
    </Dialog>
  );
}

/** Tarih: hizli secimler + serbest tarih. */
export function DueForm(props: { current: string | null; busy: boolean; onSave: (v: string | null) => void }) {
  const [v, setV] = useState(props.current ?? "");
  const plus = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    const p = (x: number) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  return (
    <form
      className={ui.formStack}
      onSubmit={(e) => {
        e.preventDefault();
        props.onSave(v === "" ? null : v);
      }}
    >
      <div className={s.strip}>
        <Button onClick={() => setV(plus(0))}>Bugün</Button>
        <Button onClick={() => setV(plus(1))}>Yarın</Button>
        <Button onClick={() => setV(plus(7))}>+1 hafta</Button>
        <Button variant="ghost" onClick={() => setV("")}>Temizle</Button>
      </div>
      <label className={ui.field}>
        Tarih
        <input className={ui.input} type="date" value={v} onChange={(e) => setV(e.target.value)} />
      </label>
      <div className={ui.dact}>
        <Button type="submit" variant="primary" disabled={props.busy}>
          <Icon name="check" size={16} /> Kaydet
        </Button>
      </div>
    </form>
  );
}
