// Kendi avatarinin ustunde kucuk kalem: tiklaninca profil sayfasi (foto
// yukleme orada, spec/82). Baskasinin avatarinda kalem yok — profil yalniz
// sahibince duzenlenir (PATCH /api/me/profile).

import { useRef } from "react";
import { errorText, upload } from "../../api/client";
import type { Attachment, MetaUser } from "../../api/types";
import { useLookup } from "../../lib/lookup";
import { navigate } from "../../lib/router";
import { Icon } from "../../ui/icons";
import { Avatar, useToast } from "../../ui/ui";
import s from "./profile.module.css";
import { profileHref } from "./tabs";

export function EditableAvatar({ user, size = 40 }: { user: MetaUser; size?: number }) {
  const L = useLookup();
  if (user.id !== L.me.id) return <Avatar user={user} size={size} />;
  return (
    <button type="button" className={s.editAv} aria-label="Profil fotoğrafını değiştir"
      onClick={() => navigate(profileHref("info", null))}>
      <Avatar user={user} size={size} />
      <span className={s.pen}><Icon name="edit" size={11} /></span>
    </button>
  );
}

/** Yonetim listesinde baska birinin avatari: kalem foto yukletir ve
 *  `onPick(ek kimligi)` ile kisinin profil fotografi olarak yazilir. */
export function AdminAvatar({ user, size = 32, onPick, busy }: {
  user: MetaUser; size?: number; onPick: (attachmentId: string) => void; busy: boolean;
}) {
  const file = useRef<HTMLInputElement>(null);
  const toast = useToast();
  return (
    <>
      <button type="button" className={s.editAv} aria-label={`${user.name} için fotoğraf yükle`} disabled={busy}
        onClick={() => file.current?.click()}>
        <Avatar user={user} size={size} />
        <span className={s.pen}><Icon name="edit" size={11} /></span>
      </button>
      <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (f !== undefined) upload<Attachment>(f, "avatar").then((a) => onPick(a.id)).catch((x: unknown) => toast({ text: errorText(x), error: true }));
      }} />
    </>
  );
}
