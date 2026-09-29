// Ekler — sohbet balonu ve medya karti AYNI parcalari cizer (R3-F09, F10, F13).
// Kucuk resim izgarasi; tiklayinca pencerede tam boyut + etiketler + sil.
// Silinmis ek mezar tasidir: mesaj metni durur, gorsel "(gorsel silindi)".

import { useId, useRef, useState } from "react";
import { errorText } from "../../api/client";
import { attachmentUrl, useDeleteAttachment, useTagAttachment, useTags } from "../../api/hooks";
import type { Attachment } from "../../api/types";
import { Icon } from "../../ui/icons";
import { Button, Dialog, ui, useToast } from "../../ui/ui";
import s from "./media.module.css";

export const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

export function Attachments({ items }: { items: Attachment[] }) {
  const [open, setOpen] = useState<Attachment | null>(null);
  if (items.length === 0) return null;
  return (
    <div className={s.grid}>
      {items.map((a) =>
        a.deleted ? (
          <span key={a.id} className={s.tomb}>(görsel silindi)</span>
        ) : (
          <button key={a.id} type="button" className={s.thumb} onClick={() => setOpen(a)}
            aria-label={`Görseli aç${a.original_name !== null ? `: ${a.original_name}` : ""}`}>
            <img src={attachmentUrl(a.id, true)} alt={a.original_name ?? "görsel"} loading="lazy" />
            {a.tags.length > 0 && <span className={s.tagCount}>{a.tags.length} etiket</span>}
          </button>
        ),
      )}
      {open !== null && (
        <Lightbox a={items.find((x) => x.id === open.id) ?? open} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}

function Lightbox({ a, onClose }: { a: Attachment; onClose: () => void }) {
  const toast = useToast();
  const del = useDeleteAttachment();
  const tag = useTagAttachment();
  const tags = useTags(a.can_tag);
  const [name, setName] = useState("");
  const list = useId();
  const fail = (e: unknown) => toast({ text: errorText(e), error: true });

  return (
    <Dialog open onClose={onClose} title={a.original_name ?? "Görsel"} wide>
      <img className={s.full} src={attachmentUrl(a.id)} alt={a.original_name ?? "görsel"} />
      <div className={s.meta}>
        {a.tags.map((t) => (
          <span key={t.id} className={s.tag}>
            {t.name}
            {a.can_tag && (
              <button type="button" aria-label={`${t.name} etiketini çıkar`}
                onClick={() => tag.mutate({ id: a.id, tagId: t.id }, { onError: fail })}>✕</button>
            )}
          </span>
        ))}
        {a.can_tag && (
          <form className={s.tagForm} onSubmit={(e) => {
            e.preventDefault();
            tag.mutate({ id: a.id, name }, { onSuccess: () => setName(""), onError: fail });
          }}>
            <input className={ui.input} list={list} value={name} onChange={(e) => setName(e.target.value)}
              placeholder="etiket ekle…" aria-label="Etiket" maxLength={60} />
            <datalist id={list}>{tags.data?.map((t) => <option key={t.id} value={t.name} />)}</datalist>
            <Button type="submit" disabled={name.trim() === "" || tag.isPending}>Ekle</Button>
          </form>
        )}
      </div>
      <div className={ui.dact}>
        <a className={`${ui.btn} ${ui["z-md"]}`} href={attachmentUrl(a.id)} target="_blank" rel="noopener">Tam boyut</a>
        {a.can_delete && (
          <Button variant="danger" onClick={() => {
            if (!window.confirm("Görsel silinecek. Mesaj kalır, yerinde “görsel silindi” yazar.")) return;
            del.mutate(a.id, { onSuccess: onClose, onError: fail });
          }}>
            <Icon name="trash" size={16} /> Sil
          </Button>
        )}
      </div>
    </Dialog>
  );
}

/** Gorsel secme dugmesi: gizli dosya kutusu + ikon. Yuklemeyi cagiran yapar. */
export function ImagePicker(props: { onFiles: (files: File[]) => void; busy: boolean; label?: string }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={input} type="file" accept={IMAGE_ACCEPT} multiple hidden onChange={(e) => {
        props.onFiles([...(e.target.files ?? [])]);
        e.target.value = "";
      }} />
      <Button variant="ghost" disabled={props.busy} onClick={() => input.current?.click()}
        aria-label={props.label ?? "Görsel ekle"} title={props.label ?? "Görsel ekle"}>
        <Icon name="image" size={16} />{props.label !== undefined && ` ${props.label}`}
      </Button>
    </>
  );
}
