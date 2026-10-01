// Oylama karti: govde (oy ver, sonuc, "diger" sekmesi, geri sayim) ve duzenleme
// formu (secenekler, secenek basina foto, "diger", bitis). Sunucu: cards.rs.

import { useEffect, useRef, useState } from "react";
import { errorText, upload } from "../../api/client";
import { useCardWrite } from "../../api/hooks";
import type { Attachment, CardView, PollOption } from "../../api/types";
import { useLookup } from "../../lib/lookup";
import { Icon } from "../../ui/icons";
import { Avatar, Button, cx, Dialog, ui, useToast } from "../../ui/ui";
import s from "./record.module.css";

/** "2 sa 10 dk kaldı" / "Kapandı". Bitis Turkiye saati (UTC+3 sabit). */
export function remaining(closesAt: string, now: number): string {
  const end = Date.parse(`${closesAt}:00+03:00`);
  if (Number.isNaN(end)) return closesAt;
  const mins = Math.floor((end - now) / 60_000);
  if (mins <= 0) return "Kapandı";
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  if (days > 0) return `${days} gün ${hours} sa kaldı`;
  if (hours > 0) return `${hours} sa ${mins % 60} dk kaldı`;
  return `${mins} dk kaldı`;
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function PollBody({ c }: { c: CardView }) {
  const L = useLookup();
  const w = useCardWrite();
  const toast = useToast();
  const now = useNow();
  const [tab, setTab] = useState<"votes" | "other">("votes");
  const [other, setOther] = useState("");
  const mine = c.votes.find((v) => v.user_id === L.me.id);
  const closed = c.closed || (c.closes_at !== null && remaining(c.closes_at, now) === "Kapandı");
  const others = c.votes.filter((v) => v.option === null);
  const total = c.votes.length;
  const send = (body: { option?: number; other?: string }) =>
    w.mutate({ method: "PUT", path: `/api/cards/${c.id}/vote`, body },
      { onError: (e) => toast({ text: errorText(e), error: true }) });

  if (c.options.length === 0) return <p className={s.hint}>Henüz seçenek yok. Kartı düzenleyip seçenekleri ekle.</p>;
  return (
    <div className={s.poll}>
      {c.closes_at !== null && (
        <p className={cx(s.hint, closed && s.pollClosed)}>
          <Icon name="calendar" size={13} /> {remaining(c.closes_at, now)}
        </p>
      )}
      {c.allow_other && (
        <div className={s.pollTabs} role="tablist">
          <button type="button" role="tab" aria-selected={tab === "votes"} onClick={() => setTab("votes")}>Oylar</button>
          <button type="button" role="tab" aria-selected={tab === "other"} onClick={() => setTab("other")}>
            Diğer cevaplar · {others.length}
          </button>
        </div>
      )}
      {tab === "votes" ? (
        <ul className={s.pollList}>
          {c.options.map((o: PollOption, i) => {
            const n = c.votes.filter((v) => v.option === i).length;
            const on = mine?.option === i;
            return (
              <li key={i}>
                <button type="button" className={cx(s.pollOpt, on && s.pollOptOn)} aria-pressed={on}
                  disabled={w.isPending || closed} onClick={() => send(on ? {} : { option: i })}>
                  {o.attachment_id !== undefined && (
                    <img className={s.pollImg} src={`/api/attachments/${o.attachment_id}/thumb`} alt="" loading="lazy" />
                  )}
                  <span className={s.pollLabel}>{o.label}</span>
                  <span className={s.pollCount}>{n}</span>
                  <span className={s.pollBar} style={{ width: total === 0 ? 0 : `${(n / total) * 100}%` }} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className={s.pollOthers}>
          {others.length === 0 && <li className={s.hint}>Henüz “diğer” cevap yok.</li>}
          {others.map((v) => (
            <li key={v.user_id}>
              <Avatar user={L.user(v.user_id)} size={20} /> <b>{L.user(v.user_id)?.name ?? "?"}:</b> {v.text}
            </li>
          ))}
        </ul>
      )}
      {c.allow_other && !closed && tab === "votes" && (
        <form className={s.addForm} onSubmit={(e) => {
          e.preventDefault();
          if (other.trim() !== "") { send({ other }); setOther(""); setTab("other"); }
        }}>
          <input className={ui.input} value={other} onChange={(e) => setOther(e.target.value)} maxLength={200}
            placeholder="Diğer: ne istiyorsun?" aria-label="Diğer cevap" />
          <Button type="submit" disabled={w.isPending || other.trim() === ""}>Gönder</Button>
        </form>
      )}
    </div>
  );
}

export function PollForm({ c, onClose }: { c: CardView; onClose: () => void }) {
  const w = useCardWrite();
  const file = useRef<HTMLInputElement>(null);
  const photoFor = useRef(0);
  const [err, setErr] = useState<string | null>(null);
  const [title, setTitle] = useState(c.data["title"] ?? "");
  const [options, setOptions] = useState<PollOption[]>(c.options.length > 0 ? c.options : [{ label: "" }, { label: "" }]);
  const [allowOther, setAllowOther] = useState(c.allow_other);
  const [askMedia, setAskMedia] = useState(c.options.some((o) => o.attachment_id !== undefined));
  const [closesAt, setClosesAt] = useState(c.closes_at ?? "");
  const set = (i: number, o: PollOption) => setOptions((p) => p.map((x, j) => (j === i ? o : x)));

  const pick = (f: File) => {
    const i = photoFor.current;
    upload<Attachment>(f)
      .then((a) => setOptions((p) => p.map((x, j) => (j === i ? { ...x, attachment_id: a.id } : x))))
      .catch((e: unknown) => setErr(errorText(e)));
  };

  return (
    <Dialog open onClose={onClose} title="Oylamayı düzenle" wide>
      <form className={ui.formStack} onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        const kept = options.filter((o) => o.label.trim() !== "")
          .map((o) => (askMedia && o.attachment_id !== undefined ? o : { label: o.label }));
        w.mutate({ method: "PATCH", path: `/api/cards/${c.id}`,
          body: { title, data: { options: kept, allow_other: allowOther, closes_at: closesAt } } },
          { onSuccess: onClose, onError: (x) => setErr(errorText(x)) });
      }}>
        {err !== null && <p className={ui.error} role="alert">{err}</p>}
        <input className={ui.titleInput} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200}
          placeholder="Soru" aria-label="Soru" />
        <div className={s.pollEdit}>
          {options.map((o, i) => (
            <div key={i} className={s.pollEditRow}>
              <input className={ui.input} value={o.label} maxLength={100} aria-label={`Seçenek ${i + 1}`}
                placeholder={`Seçenek ${i + 1}`} onChange={(e) => set(i, { ...o, label: e.target.value })} />
              {askMedia && (
                <button type="button" className={s.pollPhoto} onClick={() => { photoFor.current = i; file.current?.click(); }}>
                  {o.attachment_id !== undefined
                    ? <img src={`/api/attachments/${o.attachment_id}/thumb`} alt="" />
                    : <Icon name="camera" size={14} />}
                  <span>{o.attachment_id !== undefined ? "Değiştir" : "Foto"}</span>
                </button>
              )}
              <button type="button" className={s.pollPhoto} aria-label={`Seçenek ${i + 1} sil`}
                disabled={options.length <= 2} onClick={() => setOptions((p) => p.filter((_, j) => j !== i))}>
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
          {options.length < 10 && (
            <Button size="sm" onClick={() => setOptions((p) => [...p, { label: "" }])}>
              <Icon name="plus" size={14} /> Seçenek ekle
            </Button>
          )}
          <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f !== undefined) pick(f); }} />
        </div>
        <label className={ui.check}>
          <input type="checkbox" checked={allowOther} onChange={(e) => setAllowOther(e.target.checked)} />
          “Diğer” seçeneği — kişi ne istediğini yazar, ayrı sekmede görünür
        </label>
        <label className={ui.check}>
          <input type="checkbox" checked={askMedia} onChange={(e) => setAskMedia(e.target.checked)} />
          Seçenek başına fotoğraf
        </label>
        <label className={ui.field}>
          <span>Bitiş <span className={ui.fieldHint}>— boşsa süresiz; geri sayım kartta görünür</span></span>
          <input className={ui.input} type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />
        </label>
        <div className={ui.dact}>
          <Button onClick={onClose}>Vazgeç</Button>
          <Button type="submit" variant="primary" disabled={w.isPending}>{w.isPending ? "Kaydediliyor…" : "Kaydet"}</Button>
        </div>
      </form>
    </Dialog>
  );
}
