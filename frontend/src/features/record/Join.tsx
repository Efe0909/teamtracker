// Erisim kipleri (public | request | private): uye olmayana "katil" bandi,
// sorumluya bekleyen istekler, gizli kayitta iskelet. Sunucu tek kaynak
// (membership); burada yalniz cizim.

import { errorText } from "../../api/client";
import { useDecideJoin, useJoin } from "../../api/hooks";
import type { AccessMode, RecordDetail } from "../../api/types";
import { useLookup } from "../../lib/lookup";
import { Icon } from "../../ui/icons";
import { Avatar, Button, useToast } from "../../ui/ui";
import s from "./record.module.css";

export const ACCESS: Record<AccessMode, { label: string; hint: string }> = {
  public: { label: "Herkese açık", hint: "Herkes salt okunur görür, tek tıkla katılır" },
  request: { label: "İzinle katılım", hint: "Herkes salt okunur görür, katılmak için sorumlunun onayı gerekir" },
  private: { label: "Gizli", hint: "Sohbet, kartlar ve eylemleri yalnız katılımcılar görür" },
};

/** Kaydin ustunde: uye degilsen katil/istek bandi; sorumluysan bekleyen istekler. */
export function JoinBanner({ d }: { d: RecordDetail }) {
  const m = d.membership;
  const join = useJoin(d.record.id);
  const toast = useToast();
  const fail = (e: unknown) => toast({ text: errorText(e), error: true });
  return (
    <>
      {!m.is_member && (
        <div className={s.joinBanner} role="region" aria-label="Kayda katıl">
          <Icon name={m.mode === "private" ? "lock" : "user"} size={18} />
          <span className={s.joinText}>
            {m.mode === "public" && "Bu kayda katılmadın — salt okunur görüyorsun."}
            {m.mode === "request" && "Bu kayda katılmadın — salt okunur görüyorsun. Katılmak için sorumlunun onayı gerekir."}
            {m.mode === "private" && "Bu kayıt gizli: sohbet, kartlar, eylemler ve katılımcılar yalnız katılımcılara açık."}
          </span>
          {m.request === "pending" ? (
            <>
              <span className={s.muted}>İstek gönderildi, onay bekleniyor</span>
              <Button size="sm" disabled={join.isPending} onClick={() => join.mutate(false, { onError: fail })}>Geri çek</Button>
            </>
          ) : (
            <Button variant="primary" size="sm" disabled={join.isPending}
              onClick={() => join.mutate(true, { onError: fail })}>
              {m.mode === "public" ? "Kayda katıl" : m.request === "denied" ? "Yeniden iste" : "Katılma isteği gönder"}
            </Button>
          )}
          {m.request === "denied" && <span className={s.muted}>Önceki isteğin reddedildi</span>}
        </div>
      )}
      <PendingRequests d={d} />
    </>
  );
}

function PendingRequests({ d }: { d: RecordDetail }) {
  const L = useLookup();
  const decide = useDecideJoin(d.record.id);
  const toast = useToast();
  const m = d.membership;
  if (!m.can_decide || m.requests.length === 0) return null;
  const fail = (e: unknown) => toast({ text: errorText(e), error: true });
  return (
    <div className={s.joinBanner} role="region" aria-label="Katılma istekleri">
      <Icon name="user" size={18} />
      <span className={s.joinText}><b>{m.requests.length}</b> kişi bu kayda katılmak istiyor</span>
      <ul className={s.joinList}>
        {m.requests.map((r) => (
          <li key={r.user_id}>
            <Avatar user={L.user(r.user_id)} size={20} /> {L.user(r.user_id)?.name ?? "?"}
            <Button size="sm" variant="primary" disabled={decide.isPending}
              onClick={() => decide.mutate({ user: r.user_id, approve: true }, { onError: fail })}>Onayla</Button>
            <Button size="sm" disabled={decide.isPending}
              onClick={() => decide.mutate({ user: r.user_id, approve: false }, { onError: fail })}>Reddet</Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Gizli kayit, uye degil: eylem/kart/sohbet yerine gri iskelet. */
export function RestrictedSkeleton({ label }: { label: string }) {
  return (
    <div className={s.skeleton} aria-label={`${label} gizli`} role="img">
      <span className={s.skelLine} style={{ width: "40%" }} />
      <span className={s.skelBlock} />
      <span className={s.skelLine} style={{ width: "65%" }} />
      <span className={s.skelBlock} />
    </div>
  );
}
