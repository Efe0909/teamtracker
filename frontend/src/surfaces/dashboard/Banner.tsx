// Takim/pillar sayfasinin en ustundeki banner fotografi. Yukleme mevcut ek
// hattindan gecer (sunucu boyutlandirir); yetkili `manage_teams` ise kamera
// dugmesi gorunur. Pillar'in banner'i OZEL takimina yazilir.

import { useRef } from "react";
import { errorText, upload } from "../../api/client";
import { teamOps, useTeamWrite } from "../../api/hooks";
import type { Attachment, MetaTeam } from "../../api/types";
import { Icon } from "../../ui/icons";
import { useToast } from "../../ui/ui";
import s from "./dashboard.module.css";

export function Banner({ team, can }: { team: MetaTeam; can: boolean }) {
  const file = useRef<HTMLInputElement>(null);
  const w = useTeamWrite();
  const toast = useToast();
  const fail = (e: unknown) => toast({ text: errorText(e), error: true });
  const set = (banner_id: string | null) => w.mutate(teamOps.patch(team.id, { banner_id }), { onError: fail });

  if (team.banner_id === null && !can) return null;
  return (
    <div className={s.banner} style={team.color !== null && team.banner_id === null ? { background: team.color } : undefined}>
      {team.banner_id !== null && (
        <img className={s.bannerImg} src={`/api/attachments/${team.banner_id}`} alt="" />
      )}
      {can && (
        <div className={s.bannerTools}>
          <button type="button" className={s.bannerBtn} disabled={w.isPending} onClick={() => file.current?.click()}>
            <Icon name="camera" size={14} /> {team.banner_id === null ? "Banner ekle" : "Banner değiştir"}
          </button>
          {team.banner_id !== null && (
            <button type="button" className={s.bannerBtn} disabled={w.isPending} onClick={() => set(null)}>Kaldır</button>
          )}
          <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f !== undefined) upload<Attachment>(f).then((a) => set(a.id)).catch(fail);
            }} />
        </div>
      )}
    </div>
  );
}
