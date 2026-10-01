// Kendi avatarinin ustunde kucuk kalem: tiklaninca profil penceresi (foto
// yukleme orada). Baskasinin avatarinda kalem yok — profil yalniz sahibince
// duzenlenir (PATCH /api/me/profile).

import { useState } from "react";
import type { MetaUser } from "../../api/types";
import { useLookup } from "../../lib/lookup";
import { Icon } from "../../ui/icons";
import { Avatar } from "../../ui/ui";
import { ProfileDialog } from "./ProfileDialog";
import s from "./profile.module.css";

export function EditableAvatar({ user, size = 40 }: { user: MetaUser; size?: number }) {
  const L = useLookup();
  const [open, setOpen] = useState(false);
  if (user.id !== L.me.id) return <Avatar user={user} size={size} />;
  return (
    <>
      <button type="button" className={s.editAv} aria-label="Profil fotoğrafını değiştir" onClick={() => setOpen(true)}>
        <Avatar user={user} size={size} />
        <span className={s.pen}><Icon name="edit" size={11} /></span>
      </button>
      <ProfileDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
