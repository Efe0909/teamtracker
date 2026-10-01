// Kayit ekraninin baslik, "top kimde" satiri, salt okunur notu ve eylemleri.

import { useState, type ReactNode } from "react";
import { errorText } from "../../api/client";
import { useAddAction, useParticipant, usePin, usePatchAction, usePatchRecord } from "../../api/hooks";
import type { Action, ActionPatch, RecordDetail } from "../../api/types";
import { ACTION_STATUS, ACTION_STATUS_ORDER, ago, isDone } from "../../lib/labels";
import { useLookup } from "../../lib/lookup";
import { useStored } from "../../lib/stored";
import { Icon } from "../../ui/icons";
import { Avatar, Button, cx, Dialog, IconButton, KindTag, Picker, Popover, PriorityTag, Status, ui, useToast, Who, type Option } from "../../ui/ui";
import { DueField } from "./fields";
import s from "./record.module.css";

// --- baslik ----------------------------------------------------------------

export function RecordHead({ d, showPath = true }: { d: RecordDetail; showPath?: boolean }) {
  const L = useLookup();
  const r = d.record;
  const creator = L.user(r.created_by);
  const [edit, setEdit] = useState<"title" | "description" | null>(null);
  const pin = usePin(r.id);
  return (
    <div className={s.head}>
      {showPath && <div className={s.path}>{L.path(r.unit_id).join(" › ")}</div>}
      <div className={s.titleRow}>
        <h1 className={s.title}>{r.title}</h1>
        {d.access.can_edit && <IconButton icon="edit" label="Başlığı düzenle" onClick={() => setEdit("title")} />}
        <IconButton icon="star" className={d.pinned ? s.pinnedBtn : ""} label={d.pinned ? "Sabitlemeyi kaldır" : "Panolara sabitle"}
          disabled={pin.isPending} onClick={() => pin.mutate(!d.pinned)} />
      </div>
      <div className={s.byline}>
        <KindTag kind={r.kind} />
        <ParticipantStack d={d} />
        {creator !== undefined && (
          <span>
            {creator.name} açtı · <time dateTime={r.created_at}>{ago(r.created_at)}</time>
          </span>
        )}
      </div>
      <div className={s.descWrap}>
        {r.description !== null ? (
          <p className={s.desc}>{r.description}</p>
        ) : (
          <p className={cx(s.desc, s.descEmpty)}>Açıklama yok.</p>
        )}
        {d.access.can_edit && (
          <button type="button" className={s.editLink} onClick={() => setEdit("description")}>
            <Icon name="edit" size={13} /> {r.description === null ? "Açıklama ekle" : "Açıklamayı düzenle"}
          </button>
        )}
      </div>
      {edit !== null && <TextEdit d={d} field={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function TextEdit({ d, field, onClose }: { d: RecordDetail; field: "title" | "description"; onClose: () => void }) {
  const m = usePatchRecord(d.record.id);
  const [v, setV] = useState((field === "title" ? d.record.title : d.record.description) ?? "");
  const [err, setErr] = useState<string | null>(null);
  return (
    <Dialog open onClose={onClose} title={field === "title" ? "Başlığı düzenle" : "Açıklamayı düzenle"} wide>
      <form
        className={ui.formStack}
        onSubmit={(e) => {
          e.preventDefault();
          const patch = field === "title"
            ? ({ field: "title", value: v } as const)
            : ({ field: "description", value: v.trim() === "" ? null : v } as const);
          m.mutate(patch, { onSuccess: onClose, onError: (x) => setErr(errorText(x)) });
        }}
      >
        {err !== null && <p className={ui.error} role="alert">{err}</p>}
        {/* Gorunur etiket dialog basligi; alan adini ondan alir. */}
        {field === "title" ? (
          <input className={ui.input} aria-labelledby="dlg-title" value={v} onChange={(e) => setV(e.target.value)}
            maxLength={200} required autoFocus />
        ) : (
          <textarea className={ui.input} aria-labelledby="dlg-title" value={v} onChange={(e) => setV(e.target.value)}
            rows={8} autoFocus placeholder="Ne oldu, nerede, ne zaman?" />
        )}
        <div className={ui.dact}>
          <Button onClick={onClose}>Vazgeç</Button>
          <Button type="submit" variant="primary" aria-busy={m.isPending}
            disabled={m.isPending || (field === "title" && v.trim() === "")}>
            {m.isPending ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// --- "top kimde" -----------------------------------------------------------

/** Acik eylem sahipleri + son hareket: admin'in "neden durdu" sorusu (spec/17 I1). */
export function BallLine({ d }: { d: RecordDetail }) {
  const L = useLookup();
  const [open, setOpen] = useState(false);
  const openActs = d.actions.filter((a) => !isDone(a.status));
  const owners = [...new Set(openActs.map((a) => a.owner_id))];
  if (isDone(d.record.status)) return null;
  // Son guncellemeler: eylemlerin ve kaydin en yeni hareketleri (yeniden eskiye).
  const updates = [
    ...d.actions.map((a) => ({ key: a.id, text: a.title, at: a.resolved_at ?? a.created_at })),
    { key: "record", text: "Kayıt güncellendi", at: d.record.updated_at },
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 5);
  return (
    <div className={s.ballWrap}>
      <button type="button" className={s.ball} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="user" size={14} />
        {openActs.length === 0 ? (
          <span>
            Top <b>{L.user(d.record.owner_id)?.name ?? "kimsede değil"}</b>
            {d.record.owner_id === null ? " — sorumlu atanmamış" : " (sorumlu)"}
          </span>
        ) : (
          <span>
            Top: {owners.map((o, i) => (
              <span key={o ?? "none"}>
                {i > 0 && ", "}
                <b>{o === null ? "havuzda" : (L.user(o)?.name ?? "?")}</b>
              </span>
            ))}
          </span>
        )}
        <span className={s.muted}>· son hareket {ago(d.record.updated_at)}</span>
        <span className={cx(s.caret, open && s.caretOpen)}>
          <Icon name="chevron" size={14} />
        </span>
      </button>
      {open && (
        <ul className={s.ballUpdates}>
          {updates.map((u) => (
            <li key={u.key}>
              <span>{u.text}</span>
              <time dateTime={u.at} className={s.muted}>{ago(u.at)}</time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Basliktaki katilimci avatarlari; 4'ten fazlasi +N. Yazma yetkisi varsa
 *  tiklaninca kisi ekle/cikar listesi acilir. */
export function ParticipantStack({ d }: { d: RecordDetail }) {
  const L = useLookup();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const m = useParticipant(d.record.id);
  const toast = useToast();
  const shown = d.participants.slice(0, 4);
  const rest = d.participants.length - shown.length;
  const stack = (
    <span className={s.stack} aria-label={`${d.participants.length} katılımcı`}>
      {shown.map((id) => (
        <span key={id} title={L.user(id)?.name} className={s.stackItem}>
          <Avatar user={L.user(id)} size={24} />
        </span>
      ))}
      {rest > 0 && <span className={s.stackMore}>+{rest}</span>}
      {d.access.can_edit && <span className={s.stackAdd}><Icon name="plus" size={12} /></span>}
    </span>
  );
  if (!d.access.can_edit) return d.participants.length === 0 ? null : stack;
  const inRecord = new Set(d.participants);
  const people = L.meta.users.filter((u) => u.name.toLocaleLowerCase("tr").includes(q.trim().toLocaleLowerCase("tr")));
  return (
    <Popover open={open} onOpenChange={setOpen}
      trigger={<button type="button" className={s.stackBtn} aria-label="Katılımcıları düzenle">{stack}</button>}>
      <div className={s.people}>
        <input className={ui.input} placeholder="Kişi ara…" aria-label="Kişi ara" value={q} onChange={(e) => setQ(e.target.value)} />
        <ul>
          {people.map((u) => (
            <li key={u.id}>
              <label className={ui.check}>
                <input type="checkbox" checked={inRecord.has(u.id)} disabled={m.isPending}
                  onChange={(e) => m.mutate({ user: u.id, on: e.target.checked },
                    { onError: (x) => toast({ text: errorText(x), error: true }) })} />
                <Avatar user={u} size={20} /> {u.name}
              </label>
            </li>
          ))}
        </ul>
      </div>
    </Popover>
  );
}

// --- ozellik paneli: kapaliyken tek satir --------------------------------

/** Kapali hali durum/oncelik ikonu, sorumlu, tarih ve pillar adini tek satirda
 *  gosterir; acilinca tam alan listesi. Durum cihazda hatirlanir. */
export function CollapsibleProps({ d, children }: { d: RecordDetail; children: ReactNode }) {
  const L = useLookup();
  const [open, setOpen] = useStored("record.props.open", true);
  const r = d.record;
  const owner = L.user(r.owner_id);
  const pillar = L.pillar(r.pillar_id)?.name;
  return (
    <div className={s.propsPanel}>
      <button type="button" className={s.propsToggle} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={cx(s.caret, open && s.caretOpen)}>
          <Icon name="chevron" size={14} />
        </span>
        {open ? (
          <span>Özellikler</span>
        ) : (
          <span className={s.propsSummary}>
            <Status status={r.status} />
            <KindTag kind={r.kind} />
            <PriorityTag priority={r.priority} bare />
            <Who user={owner} empty="Sorumlusuz" size={18} />
            <span className={s.muted}>{r.due_date ?? "Tarihsiz"}</span>
            {pillar !== undefined && <span className={s.muted}>{pillar}</span>}
          </span>
        )}
      </button>
      {open && children}
    </div>
  );
}

// --- salt okunur -----------------------------------------------------------

/** Yazma yetkisi yok: NEDENI tek cumle (spec/17 etki 4). */
export function ReadOnlyNote({ d }: { d: RecordDetail }) {
  const L = useLookup();
  if (d.access.can_edit) return null;
  const team = L.team(d.record.team_id)?.name;
  // Kime yazilacak: sorumlu, yoksa kaydi acan.
  const contact = L.user(d.record.owner_id) ?? L.user(d.record.created_by);
  const role = d.record.owner_id !== null ? "Sorumlu" : "Kaydı açan";
  return (
    <div className={s.readonly} role="note">
      <Icon name="lock" size={15} />
      <span>
        Bu kayıtta yazma yetkin yok{team !== undefined ? ` — ${team} takımında değilsin` : ""}.
        {contact !== undefined ? ` ${role}: ${contact.name}; dahil olmak için ona yaz.` : ""}
      </span>
    </div>
  );
}

// --- eylemler --------------------------------------------------------------
// Her satir kendi ozelliklerini satir icinde degistirir: durum, sahip, tarih.

export function ActionList({ d }: { d: RecordDetail }) {
  const L = useLookup();
  const toast = useToast();
  const patch = usePatchAction();
  const open = d.actions.filter((a) => !isDone(a.status));
  const done = d.actions.filter((a) => isDone(a.status));
  const ro = !d.access.can_edit;

  const change = (a: Action, p: ActionPatch, undo: ActionPatch, text: string) =>
    patch.mutate(
      { id: a.id, patch: p },
      {
        onSuccess: () => toast({ text, error: false, undo: () => patch.mutate({ id: a.id, patch: undo }) }),
        onError: (e) => toast({ text: errorText(e), error: true }),
      },
    );

  const owners: Option<string | null>[] = [
    { value: null, label: "Havuzda", render: <span className={s.muted}>Havuzda</span> },
    ...L.meta.users.map((u) => ({ value: u.id as string | null, label: u.name, render: <Who user={u} /> })),
  ];

  const row = (a: Action) => (
    <li key={a.id} className={cx(s.action, isDone(a.status) && s.actionDone)}>
      <Picker look="bare" label={`${a.title} — durum`} disabled={ro} value={a.status}
        options={ACTION_STATUS_ORDER.map((v) => ({ value: v, label: ACTION_STATUS[v], render: <Status status={v} action /> }))}
        onChange={(v) => change(a, { field: "status", value: v }, { field: "status", value: a.status }, "Durum değişti")}>
        <Status status={a.status} action />
      </Picker>
      <span className={s.actionTitle}>{a.title}</span>
      <span className={s.actionMeta}>
        {!ro && !isDone(a.status) && a.owner_id === null && (
          // Havuzdaki eylemi tek dokunusla ustlen (spec/17 etki 8).
          <Button size="sm" onClick={() => change(a, { field: "owner_id", value: L.me.id }, { field: "owner_id", value: null }, "Eylemi üstlendin")}>
            Üstlen
          </Button>
        )}
        {d.access.can_edit_deadline ? (
          <DueField look="bare" value={a.due_date} done={isDone(a.status)} disabled={ro}
            onSave={(v) => change(a, { field: "due_date", value: v }, { field: "due_date", value: a.due_date }, "Tarih değişti")} />
        ) : null}
        <Picker look="bare" label={`${a.title} — sahip`} disabled={ro} value={a.owner_id} options={owners} align="end"
          onChange={(v) => change(a, { field: "owner_id", value: v }, { field: "owner_id", value: a.owner_id }, "Sahip değişti")}>
          <Who user={L.user(a.owner_id)} empty="Havuzda" />
        </Picker>
        {!ro && !isDone(a.status) && (
          <IconButton icon="check" label={`${a.title} — bitti`}
            onClick={() => change(a, { field: "status", value: "closed" }, { field: "status", value: a.status }, "Eylem kapatıldı")} />
        )}
      </span>
    </li>
  );

  return (
    <section className={s.section} aria-labelledby="acts-h">
      <div className={s.secHead}>
        <h2 id="acts-h">Eylemler</h2>
        <span className={s.count}>
          {open.length} açık{done.length > 0 ? ` · ${done.length} bitti` : ""}
        </span>
      </div>
      <div className={s.box}>
        {d.actions.length === 0 && (
          <span className={s.boxEmpty}>{ro ? "Henüz eylem yok." : "Henüz eylem yok. Kim ne yapacaksa aşağıya ekle."}</span>
        )}
        {d.actions.length > 0 && <ul className={s.actions}>{[...open, ...done].map(row)}</ul>}
        {!ro && <AddAction d={d} />}
      </div>
    </section>
  );
}

/** ⚡ Hizli eylem (R4-F14): sohbetten cikmadan "kim ne yapacak" — eylem
 *  seridindeki AYNI form, pencerede. Yeni uc yok. */
export function QuickAction({ d }: { d: RecordDetail }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Icon name="bolt" size={14} /> Hızlı eylem
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Hızlı eylem"
        hint="Sohbetten çıkmadan: kim ne yapacak? Eylemler listesine eklenir.">
        <div className={s.box}>
          <AddAction d={d} onDone={() => setOpen(false)} />
        </div>
      </Dialog>
    </>
  );
}

function AddAction({ d, onDone }: { d: RecordDetail; onDone?: () => void }) {
  const L = useLookup();
  const m = useAddAction(d.record.id);
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState<string | null>(null);
  const [due, setDue] = useState<string | null>(null);
  return (
    <form
      className={s.addForm}
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate(
          { title, owner_id: owner, due_date: due },
          {
            onSuccess: () => {
              setTitle("");
              setDue(null);
              onDone?.();
            },
            onError: (x) => toast({ text: errorText(x), error: true }),
          },
        );
      }}
    >
      <Icon name="plus" size={15} />
      <input className={s.addInput} placeholder="Yeni eylem ekle…" value={title} onChange={(e) => setTitle(e.target.value)}
        required maxLength={200} aria-label="Eylem başlığı" />
      {d.access.can_edit_deadline && <DueField look="bare" value={due} onSave={setDue} />}
      <Picker look="bare" label="Eylemin sahibi" value={owner} align="end"
        options={[
          { value: null, label: "Havuzda", render: <span className={s.muted}>Havuzda</span> },
          ...L.meta.users.map((u) => ({ value: u.id as string | null, label: u.name, render: <Who user={u} /> })),
        ]}
        onChange={setOwner}>
        <Who user={L.user(owner)} empty="Havuzda" />
      </Picker>
      <Button type="submit" variant="primary" size="sm" aria-busy={m.isPending} disabled={m.isPending || title.trim() === ""}>
        {m.isPending ? "Ekleniyor…" : "Ekle"}
      </Button>
    </form>
  );
}
