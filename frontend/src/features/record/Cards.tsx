// Kart bloklari (R4-F01, F02): kayit govdesindeki medya / toplanti / havuz
// kutulari. Iki yuz AYNI bileseni cizer. Tur listesi `lib/cards.ts`;
// davranis ve beyaz liste Rust'ta. Taninmayan tur BOZUK kutusu (KNOW-280):
// veri gitmez, yalniz silinebilir.

import { useState } from "react";
import { errorText, upload } from "../../api/client";
import { useCardWrite } from "../../api/hooks";
import type { Attachment, CardView, RecordDetail, SignupAnswer } from "../../api/types";
import { CARD, CARD_TYPES, type CardType, isCardType, whenLabel } from "../../lib/cards";
import { useLookup } from "../../lib/lookup";
import { Icon } from "../../ui/icons";
import { Avatar, Button, Dialog, ui, useToast } from "../../ui/ui";
import { Attachments, ImagePicker } from "../media/Media";
import s from "./record.module.css";

export function Cards({ d }: { d: RecordDetail }) {
  const w = useCardWrite();
  const toast = useToast();
  const [adding, setAdding] = useState<CardType | "">("");
  if (d.cards.length === 0 && !d.access.can_edit) return null;
  return (
    <section className={s.section} aria-labelledby="cards-h">
      <div className={s.secHead}>
        <h2 id="cards-h">Kartlar</h2>
        {d.cards.length > 0 && <span className={s.count}>{d.cards.length}</span>}
      </div>
      {d.cards.map((c) => <Card key={c.id} d={d} c={c} />)}
      {d.access.can_edit && (
        <div className={s.addForm}>
          <select className={ui.input} value={adding} aria-label="Eklenecek kart türü"
            onChange={(e) => setAdding(e.target.value as CardType | "")}>
            <option value="">Kart ekle…</option>
            {CARD_TYPES.map((t) => <option key={t} value={t}>{CARD[t].label}</option>)}
          </select>
          <Button disabled={adding === "" || w.isPending} onClick={() =>
            w.mutate({ method: "POST", path: `/api/records/${d.record.id}/cards`, body: { card_type: adding } },
              { onSuccess: () => setAdding(""), onError: (e) => toast({ text: errorText(e), error: true }) })}>
            <Icon name="plus" size={16} /> Ekle
          </Button>
        </div>
      )}
    </section>
  );
}

function Card({ d, c }: { d: RecordDetail; c: CardView }) {
  const w = useCardWrite();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const fail = (e: unknown) => toast({ text: errorText(e), error: true });
  const remove = () => {
    if (!window.confirm("Kart silinecek; içindeki bilgiler ve katılım gider.")) return;
    w.mutate({ method: "DELETE", path: `/api/cards/${c.id}` }, { onError: fail });
  };

  if (!c.known || !isCardType(c.card_type)) {
    return (
      <div className={s.card}>
        <div className={s.readonly}>
          <Icon name="alert" size={16} /> Bu kart türü tanınmıyor ({c.card_type}). Bilgisi duruyor ama çizilemiyor.
        </div>
        {d.access.can_edit && <Button variant="danger" onClick={remove}>Kartı sil</Button>}
      </div>
    );
  }
  const t = CARD[c.card_type];
  const v = (k: string) => c.data[k] ?? "";

  return (
    <div className={s.card}>
      <div className={s.cardHead}>
        <Icon name={t.icon} size={18} />
        <b>{v("title") !== "" ? v("title") : t.label}</b>
        {v("title") !== "" && <span className={s.hint}>{t.label}</span>}
        {d.access.can_edit && (
          <span className={s.cardActs}>
            <Button variant="ghost" onClick={() => setEditing(true)} aria-label="Kartı düzenle">
              <Icon name="edit" size={16} />
            </Button>
            <Button variant="ghost" onClick={remove} aria-label="Kartı sil"><Icon name="trash" size={16} /></Button>
          </span>
        )}
      </div>

      {c.card_type === "meeting" && (
        <dl className={s.cardFields}>
          {v("when") !== "" && <><dt>Ne zaman</dt><dd>{whenLabel(v("when"))}</dd></>}
          {v("place") !== "" && <><dt>Yer</dt><dd>{v("place")}</dd></>}
          {v("link") !== "" && (
            <><dt>Bağlantı</dt><dd><a href={v("link")} target="_blank" rel="noopener noreferrer">{v("link")}</a></dd></>
          )}
        </dl>
      )}
      {c.card_type === "pool" && v("need") !== "" && <p className={s.hint}>{v("need")} kişi lazım</p>}
      {["description", "agenda", "detail"].map((k) => v(k) !== "" && <p key={k} className={s.desc}>{v(k)}</p>)}
      {Object.keys(c.data).length === 0 && <p className={s.hint}>{t.hint}</p>}

      {c.card_type === "media" && <MediaBody d={d} c={c} />}
      {Object.keys(t.answers).length > 0 && <Signups c={c} answers={t.answers} />}

      {editing && <CardForm c={c} type={c.card_type} onClose={() => setEditing(false)} />}
    </div>
  );
}

function MediaBody({ d, c }: { d: RecordDetail; c: CardView }) {
  const w = useCardWrite();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const add = (files: File[]) => {
    setBusy(true);
    Promise.all(files.map((f) => upload<Attachment>(f)))
      .then((as) => w.mutateAsync({ method: "POST", path: `/api/cards/${c.id}/attachments`,
        body: { attachment_ids: as.map((a) => a.id) } }))
      .catch((e: unknown) => toast({ text: errorText(e), error: true }))
      .finally(() => setBusy(false));
  };
  return (
    <>
      <Attachments items={c.attachments} />
      {d.access.can_edit && <ImagePicker onFiles={add} busy={busy} label={busy ? "Yükleniyor…" : "Görsel ekle"} />}
    </>
  );
}

/** Katilim: kendi cevabina tekrar basmak geri ceker (Python bos cevap = sil). */
function Signups({ c, answers }: { c: CardView; answers: Partial<Record<SignupAnswer, string>> }) {
  const L = useLookup();
  const w = useCardWrite();
  const toast = useToast();
  const mine = c.signups.find((x) => x.user_id === L.me.id)?.answer;
  const keys = Object.keys(answers) as SignupAnswer[];
  return (
    <div className={s.signups}>
      <div className={s.addForm}>
        {keys.map((a) => (
          <Button key={a} variant={mine === a ? "primary" : "default"} aria-pressed={mine === a} disabled={w.isPending}
            onClick={() => w.mutate({ method: "PUT", path: `/api/cards/${c.id}/signup`, body: { answer: mine === a ? null : a } },
              { onError: (e) => toast({ text: errorText(e), error: true }) })}>
            {answers[a]}
          </Button>
        ))}
      </div>
      {keys.map((a) => {
        const who = c.signups.filter((x) => x.answer === a);
        return who.length === 0 ? null : (
          <div key={a} className={s.hint}>
            <b>{answers[a]} · {who.length}</b>{" "}
            {who.map((x) => (
              <span key={x.user_id} className={s.who} title={x.note ?? undefined}>
                <Avatar user={L.user(x.user_id)} size={20} /> {L.user(x.user_id)?.name ?? "?"}
                {x.note !== null && ` (${x.note})`}
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function CardForm({ c, type, onClose }: { c: CardView; type: CardType; onClose: () => void }) {
  const w = useCardWrite();
  const [err, setErr] = useState<string | null>(null);
  const [vals, setVals] = useState<Record<string, string>>(() => ({ title: c.data["title"] ?? "",
    ...Object.fromEntries(CARD[type].fields.map((f) => [f.key, c.data[f.key] ?? ""])) }));
  const set = (k: string, v: string) => setVals((p) => ({ ...p, [k]: v }));
  return (
    <Dialog open onClose={onClose} title={`${CARD[type].label} düzenle`} hint={CARD[type].hint}>
      <form className={ui.formStack} onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        const { title, ...data } = vals;
        w.mutate({ method: "PATCH", path: `/api/cards/${c.id}`, body: { title, data } },
          { onSuccess: onClose, onError: (x) => setErr(errorText(x)) });
      }}>
        {err !== null && <p className={ui.error} role="alert">{err}</p>}
        <label className={ui.field}>
          Başlık
          <input className={ui.input} value={vals["title"] ?? ""} onChange={(e) => set("title", e.target.value)}
            maxLength={200} placeholder={CARD[type].label} />
        </label>
        {CARD[type].fields.map((f) => (
          <label key={f.key} className={ui.field}>
            {f.label}
            {f.kind === "textarea" ? (
              <textarea className={ui.input} rows={3} value={vals[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} />
            ) : (
              <input className={ui.input} type={f.kind} min={f.kind === "number" ? 1 : undefined}
                value={vals[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} />
            )}
          </label>
        ))}
        <div className={ui.dact}>
          <Button onClick={onClose}>Vazgeç</Button>
          <Button type="submit" variant="primary" disabled={w.isPending}>Kaydet</Button>
        </div>
      </form>
    </Dialog>
  );
}
