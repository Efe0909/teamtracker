// Kayit ozellikleri: etiket | deger satirlari (Linear/Notion dili). Her deger
// bir secici — tik → aranabilir liste → sec. Iki adim: kaydirmayla degisen
// select yok (eski dialog kararinin amaci korunur, kutu kalabaligi gider).
// Yetki API'den (`access`), on yuz karar vermez yalniz gosterir.

import { useState, type ReactNode } from "react";
import { errorText } from "../../api/client";
import { usePatchRecord } from "../../api/hooks";
import type { IsoDate, RecordDetail, RecordPatch } from "../../api/types";
import { isDone, KIND, PRIORITY, PRIORITY_ORDER, STATUS, STATUS_ORDER, toIsoDay } from "../../lib/labels";
import { useLookup } from "../../lib/lookup";
import { Icon, type IconName } from "../../ui/icons";
import { Button, cx, Due, Picker, Popover, PriorityTag, Status, TeamName, Tip, ui, useToast, Who } from "../../ui/ui";
import s from "./record.module.css";

function Row(props: { icon: IconName; label: string; children: ReactNode }) {
  return (
    <div className={s.prop}>
      <span className={s.propKey}>
        <Icon name={props.icon} size={14} />
        {props.label}
      </span>
      <span className={s.propVal}>{props.children}</span>
    </div>
  );
}

export function Properties({ d }: { d: RecordDetail }) {
  const L = useLookup();
  const r = d.record;
  const toast = useToast();
  const m = usePatchRecord(r.id);
  const ro = !d.access.can_edit;

  // Geri al: ayni alani onceki degerine dondur (spec/16 Y6).
  const save = (p: RecordPatch, undo: RecordPatch) =>
    m.mutate(p, {
      onSuccess: () =>
        toast({
          text: "Kaydedildi",
          error: false,
          undo: () => m.mutate(undo, { onError: (e) => toast({ text: errorText(e), error: true }) }),
        }),
      onError: (e) => toast({ text: errorText(e), error: true }),
    });

  // Kapatma engeli ONDEN soylenir, reddedilince degil (spec/17 I5).
  const openActs = d.actions.filter((a) => !isDone(a.status)).length;

  return (
    <div className={s.props}>
      <Row icon="stProgress" label="Durum">
        <Picker look="prop" label="Durum" disabled={ro} busy={m.isPending} value={r.status}
          options={STATUS_ORDER.map((v) => ({
            value: v,
            label: STATUS[v],
            render: <Status status={v} />,
            ...(v === "closed" && openActs > 0 ? { disabled: true, hint: `${openActs} açık eylem` } : {}),
          }))}
          onChange={(v) => save({ field: "status", value: v }, { field: "status", value: r.status })} />
      </Row>
      <Row icon="user" label="Sorumlu">
        <Picker look="prop" label="Sorumlu" disabled={ro} busy={m.isPending} value={r.owner_id}
          options={[
            { value: null, label: "Sorumlusuz", render: <span className={s.muted}>Sorumlusuz</span> },
            ...L.meta.users.map((u) => ({ value: u.id as string | null, label: u.name, render: <Who user={u} />, ...(u.id === L.me.id ? { hint: "sen" } : {}) })),
          ]}
          onChange={(v) => save({ field: "owner_id", value: v }, { field: "owner_id", value: r.owner_id })} />
      </Row>
      <Row icon="calendar" label="Son tarih">
        {d.access.can_edit_deadline ? (
          <DueField value={r.due_date} done={isDone(r.status)} disabled={ro} busy={m.isPending}
            onSave={(v) => save({ field: "due_date", value: v }, { field: "due_date", value: r.due_date })} />
        ) : (
          <Tip label="Son tarihi değiştirmek edit_deadline kapsamı ister">
            <span className={s.propStatic}>
              <Due date={r.due_date} done={isDone(r.status)} />
            </span>
          </Tip>
        )}
      </Row>
      <Row icon="prHigh" label="Öncelik">
        <Picker look="prop" label="Öncelik" disabled={ro} busy={m.isPending} value={r.priority}
          options={PRIORITY_ORDER.map((v) => ({ value: v, label: PRIORITY[v], render: <PriorityTag priority={v} bare /> }))}
          onChange={(v) => save({ field: "priority", value: v }, { field: "priority", value: r.priority })} />
      </Row>
      <Row icon="teams" label="Takım">
        <Picker look="prop" label="Takım" disabled={ro} busy={m.isPending} value={r.team_id}
          options={[
            { value: null, label: "Takım yok", render: <span className={s.muted}>Takım yok</span> },
            ...L.meta.teams.map((t) => ({ value: t.id as string | null, label: t.name, render: <TeamName team={t} /> })),
          ]}
          onChange={(v) => save({ field: "team_id", value: v }, { field: "team_id", value: r.team_id })} />
      </Row>
      <Row icon="tree" label="Birim">
        <Picker look="prop" label="Birim" disabled={ro} busy={m.isPending} value={r.unit_id} search
          options={L.units.map((n) => ({ value: n.id, label: n.name, depth: n.depth }))}
          onChange={(v) => save({ field: "unit_id", value: v }, { field: "unit_id", value: r.unit_id })} />
      </Row>
      {/* Pillar ORTOGONAL (KNOW-261): kaydin atasi olmak zorunda degil. */}
      <Row icon="pin" label="Pillar">
        <Picker look="prop" label="Pillar" disabled={ro} busy={m.isPending} value={r.pillar_id}
          options={[
            { value: null, label: "Pillar yok", render: <span className={s.muted}>{ro ? "Yok" : "Pillar ekle"}</span> },
            ...L.pillars.map((n) => ({ value: n.id as string | null, label: n.name })),
          ]}
          onChange={(v) => save({ field: "pillar_id", value: v }, { field: "pillar_id", value: r.pillar_id })} />
      </Row>
      <Row icon="inbox" label="Tür">
        <span className={s.propStatic}>{KIND[r.kind]}</span>
      </Row>
    </div>
  );
}

/** Tarih secici: hizli secimler + serbest tarih, acilir yuzeyde. Kayit ve
 *  eylem ayni bileseni kullanir. */
export function DueField(props: {
  value: IsoDate | null;
  done?: boolean;
  disabled?: boolean;
  busy?: boolean;
  look?: "prop" | "bare";
  onSave: (v: IsoDate | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<string>(props.value ?? "");
  const plus = (n: number) => {
    const x = new Date();
    x.setDate(x.getDate() + n);
    return toIsoDay(x);
  };
  const pick = (x: IsoDate | null) => {
    setOpen(false);
    if (x !== props.value) props.onSave(x);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setV(props.value ?? "");
      }}
      trigger={
        <button type="button" className={cx(s.dueTrigger, props.look === "bare" && s.dueBare)} disabled={props.disabled === true}
          aria-label={`Son tarih: ${props.value ?? "yok"}`}>
          {props.value === null ? <span className={s.muted}>{props.disabled === true ? "Yok" : "Tarih ekle"}</span> : <Due date={props.value} done={props.done === true} />}
        </button>
      }
    >
      <form
        className={s.dueForm}
        onSubmit={(e) => {
          e.preventDefault();
          pick(v === "" ? null : v);
        }}
      >
        <div className={s.dueQuick}>
          <Button size="sm" onClick={() => pick(plus(0))}>Bugün</Button>
          <Button size="sm" onClick={() => pick(plus(1))}>Yarın</Button>
          <Button size="sm" onClick={() => pick(plus(7))}>+1 hafta</Button>
        </div>
        <input className={ui.input} type="date" value={v} onChange={(e) => setV(e.target.value)} aria-label="Tarih" autoFocus />
        <div className={ui.dact}>
          {props.value !== null && (
            <Button variant="ghost" size="sm" onClick={() => pick(null)}>Kaldır</Button>
          )}
          <Button type="submit" variant="primary" size="sm" disabled={props.busy === true}>Kaydet</Button>
        </div>
      </form>
    </Popover>
  );
}
