// Kayit ekraninin baslik, "top kimde" satiri, salt okunur notu ve eylemleri.

import { useState } from "react";
import { errorText } from "../../api/client";
import { useAddAction, usePatchAction, usePatchRecord } from "../../api/hooks";
import type { Action, ActionPatch, RecordDetail } from "../../api/types";
import { ACTION_STATUS, ACTION_STATUS_ORDER, ago, isDone } from "../../lib/labels";
import { useLookup } from "../../lib/lookup";
import { Icon } from "../../ui/icons";
import { Button, Choices, cx, Dialog, Due, KindTag, Status, ui, useToast, Who } from "../../ui/ui";
import { DueForm } from "./fields";
import s from "./record.module.css";

// --- baslik ----------------------------------------------------------------

export function RecordHead({ d, showPath = true }: { d: RecordDetail; showPath?: boolean }) {
  const L = useLookup();
  const r = d.record;
  const creator = L.user(r.created_by);
  const [edit, setEdit] = useState<"title" | "description" | null>(null);
  return (
    <div className={s.head}>
      {showPath && <div className={s.path}>{L.path(r.unit_id).join(" › ")}</div>}
      <div className={s.titleRow}>
        <h1 className={s.title}>{r.title}</h1>
        <KindTag kind={r.kind} />
      </div>
      {creator !== undefined && (
        <div className={s.byline}>
          Açan: {creator.name} · <time dateTime={r.created_at}>{ago(r.created_at)}</time>
        </div>
      )}
      {r.description !== null ? (
        <p className={s.desc}>{r.description}</p>
      ) : (
        <p className={cx(s.desc, s.descEmpty)}>Açıklama yok.</p>
      )}
      {d.access.can_edit && (
        <div className={s.strip}>
          <button type="button" className={s.editLink} onClick={() => setEdit("title")}>Başlığı düzenle</button>
          <button type="button" className={s.editLink} onClick={() => setEdit("description")}>Açıklamayı düzenle</button>
        </div>
      )}
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
        {field === "title" ? (
          <input className={ui.input} value={v} onChange={(e) => setV(e.target.value)} maxLength={200} required autoFocus />
        ) : (
          <textarea className={ui.input} value={v} onChange={(e) => setV(e.target.value)} rows={6} autoFocus />
        )}
        <div className={ui.dact}>
          <Button onClick={onClose}>Vazgeç</Button>
          <Button type="submit" variant="primary" disabled={m.isPending}>Kaydet</Button>
        </div>
      </form>
    </Dialog>
  );
}

// --- "top kimde" -----------------------------------------------------------

/** Acik eylem sahipleri + son hareket: admin'in "neden durdu" sorusu (spec/17 I1). */
export function BallLine({ d }: { d: RecordDetail }) {
  const L = useLookup();
  const open = d.actions.filter((a) => !isDone(a.status));
  const owners = [...new Set(open.map((a) => a.owner_id))];
  if (isDone(d.record.status)) return null;
  return (
    <div className={s.ball}>
      <Icon name="user" size={16} />
      {open.length === 0 ? (
        <span>
          Top <b>{L.user(d.record.owner_id)?.name ?? "kimsede değil"}</b>
          {d.record.owner_id === null ? " — sorumlu atanmamış" : " (sorumlu)"}
        </span>
      ) : (
        <span>
          Açık eylem: {owners.map((o, i) => (
            <span key={o ?? "none"}>
              {i > 0 && ", "}
              <b>{o === null ? "sahipsiz" : (L.user(o)?.name ?? "?")}</b>
            </span>
          ))}
        </span>
      )}
      <span>· son hareket {ago(d.record.updated_at)}</span>
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
      <Icon name="lock" size={16} />
      <span>
        Bu kayıtta yazma yetkin yok{team !== undefined ? ` — ${team} takımında değilsin` : ""}.
        {contact !== undefined ? ` ${role}: ${contact.name}; dahil olmak için ona yaz.` : ""}
      </span>
    </div>
  );
}

// --- eylemler --------------------------------------------------------------

export function ActionList({ d }: { d: RecordDetail }) {
  const L = useLookup();
  const toast = useToast();
  const [openId, setOpenId] = useState<string | null>(null);
  const patch = usePatchAction();
  const open = d.actions.filter((a) => !isDone(a.status));
  const done = d.actions.filter((a) => isDone(a.status));
  const current = d.actions.find((a) => a.id === openId);

  const quick = (a: Action, p: ActionPatch, undo: ActionPatch, text: string) =>
    patch.mutate(
      { id: a.id, patch: p },
      {
        onSuccess: () => toast({ text, error: false, undo: () => patch.mutate({ id: a.id, patch: undo }) }),
        onError: (e) => toast({ text: errorText(e), error: true }),
      },
    );

  const row = (a: Action) => (
    <li key={a.id} className={cx(s.action, isDone(a.status) && s.actionDone)}>
      <button type="button" className={s.actionTitle} disabled={!d.access.can_edit} onClick={() => setOpenId(a.id)}>
        {a.title}
      </button>
      <span className={s.actionMeta}>
        <Status status={a.status} action />
        <Who user={L.user(a.owner_id)} empty="Havuzda" />
        {a.due_date !== null && <Due date={a.due_date} done={isDone(a.status)} />}
        {d.access.can_edit && !isDone(a.status) && a.owner_id === null && (
          // Havuzdaki eylemi tek dokunusla ustlen (spec/17 etki 8).
          <Button onClick={() => quick(a, { field: "owner_id", value: L.me.id }, { field: "owner_id", value: null }, "Eylemi üstlendin")}>
            Üstlen
          </Button>
        )}
        {d.access.can_edit && !isDone(a.status) && (
          <Button
            aria-label={`${a.title} — kapat`}
            onClick={() => quick(a, { field: "status", value: "closed" }, { field: "status", value: a.status }, "Eylem kapatıldı")}
          >
            <Icon name="check" size={16} /> Bitti
          </Button>
        )}
      </span>
    </li>
  );

  return (
    <section className={s.section} aria-labelledby="acts-h">
      <div className={s.secHead}>
        <Icon name="bolt" size={18} />
        <h2 id="acts-h">Eylemler</h2>
        <span className={s.count}>{open.length} açık</span>
      </div>
      {d.actions.length === 0 && (
        <span className={s.hint}>{d.access.can_edit ? "Henüz eylem yok. Kim ne yapacaksa buraya ekle." : "Henüz eylem yok."}</span>
      )}
      <ul className={s.actions}>{open.map(row)}</ul>
      {done.length > 0 && (
        <>
          <span className={s.doneSep}>Tamamlanan · {done.length}</span>
          <ul className={s.actions}>{done.map(row)}</ul>
        </>
      )}
      {d.access.can_edit && <AddAction d={d} />}
      {current !== undefined && <ActionDialog d={d} a={current} onClose={() => setOpenId(null)} />}
    </section>
  );
}

/** ⚡ Hizli eylem (R4-F14): sohbetten cikmadan "kim ne yapacak" — eylem
 *  seridindeki AYNI form, pencerede. Yeni uc yok. */
export function QuickAction({ d }: { d: RecordDetail }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        <Icon name="bolt" size={16} /> Hızlı eylem
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Hızlı eylem"
        hint="Sohbetten çıkmadan: kim ne yapacak? Eylemler listesine eklenir.">
        <AddAction d={d} onDone={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

function AddAction({ d, onDone }: { d: RecordDetail; onDone?: () => void }) {
  const L = useLookup();
  const m = useAddAction(d.record.id);
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState("");
  const [due, setDue] = useState("");
  return (
    <form
      className={s.addForm}
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate(
          { title, owner_id: owner === "" ? null : owner, due_date: due === "" ? null : due },
          {
            onSuccess: () => {
              setTitle("");
              setDue("");
              onDone?.();
            },
            onError: (x) => toast({ text: errorText(x), error: true }),
          },
        );
      }}
    >
      <input className={ui.input} placeholder="Yeni eylem…" value={title} onChange={(e) => setTitle(e.target.value)}
        required maxLength={200} aria-label="Eylem başlığı" />
      <select className={ui.input} value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Eylemin sahibi">
        <option value="">Havuzda (sahipsiz)</option>
        {L.meta.users.map((u) => (
          <option key={u.id} value={u.id}>{u.name}</option>
        ))}
      </select>
      {d.access.can_edit_deadline && (
        <input className={ui.input} type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Son tarih" />
      )}
      <Button type="submit" variant="primary" disabled={m.isPending || title.trim() === ""}>
        <Icon name="plus" size={16} /> Ekle
      </Button>
    </form>
  );
}

function ActionDialog({ d, a, onClose }: { d: RecordDetail; a: Action; onClose: () => void }) {
  const L = useLookup();
  const m = usePatchAction();
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"status" | "owner" | "due">("status");
  const save = (p: ActionPatch) =>
    m.mutate({ id: a.id, patch: p }, { onSuccess: onClose, onError: (e) => setErr(errorText(e)) });
  return (
    <Dialog open onClose={onClose} title={a.title}>
      {err !== null && <p className={ui.error} role="alert">{err}</p>}
      <div className={s.strip} style={{ marginBottom: 12 }}>
        <Button variant={tab === "status" ? "primary" : "default"} onClick={() => setTab("status")}>Durum</Button>
        <Button variant={tab === "owner" ? "primary" : "default"} onClick={() => setTab("owner")}>Sahip</Button>
        {d.access.can_edit_deadline && (
          <Button variant={tab === "due" ? "primary" : "default"} onClick={() => setTab("due")}>Son tarih</Button>
        )}
      </div>
      {tab === "status" && (
        <Choices options={ACTION_STATUS_ORDER.map((v) => ({ value: v, label: ACTION_STATUS[v] }))}
          current={a.status} busy={m.isPending} onPick={(v) => save({ field: "status", value: v })} />
      )}
      {tab === "owner" && (
        <Choices
          options={[
            { value: null as string | null, label: "Havuzda (sahipsiz)" },
            ...L.meta.users.map((u) => ({ value: u.id as string | null, label: <Who user={u} /> })),
          ]}
          current={a.owner_id}
          busy={m.isPending}
          onPick={(v) => save({ field: "owner_id", value: v })}
        />
      )}
      {tab === "due" && <DueForm current={a.due_date} busy={m.isPending} onSave={(v) => save({ field: "due_date", value: v })} />}
    </Dialog>
  );
}
