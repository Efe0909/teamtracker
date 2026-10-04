// Kisinin kendi profili (sol-alt menuden). Telefon zorunlu: bossa pencere
// kapatilamaz (`profile_complete`), diger alanlar istege bagli.

import { useRef, useState } from "react";
import { errorText, upload } from "../../api/client";
import { usePatchProfile } from "../../api/hooks";
import { privacyUrl } from "../../api/session";
import type { Attachment } from "../../api/types";
import { useLookup } from "../../lib/lookup";
import { Icon } from "../../ui/icons";
import { Avatar, Button, Dialog, Req, ui, useToast } from "../../ui/ui";
import s from "./profile.module.css";

/** Yazarken telefon: yalniz rakam, basta hep 0, `0532 000 00 00` gruplari.
 *  Kullanicinin bosluk/tire yazmasi yok sayilir; `+90` ile yapistirilan da 0'a doner. */
export function formatPhone(v: string): string {
  let d = v.replace(/\D/g, "");
  if (v.trimStart().startsWith("+90")) d = d.slice(2);
  d = `0${d.replace(/^0+/, "")}`.slice(0, 11);
  return [d.slice(0, 4), d.slice(4, 7), d.slice(7, 9), d.slice(9, 11)].filter(Boolean).join(" ");
}
const PHONE_PATTERN = "0\\d{3} \\d{3} \\d{2} \\d{2}";

const MONTHS =["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

export function ProfileDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const L = useLookup();
  const complete = L.meta.me.profile_complete;
  // Telefonsuz profil kapatilamaz: kapatma isteklerini yutar.
  return (
    <Dialog open={open} onClose={() => { if (complete) onClose(); }} title="Profilim"
      {...(complete ? {} : { hint: "Devam etmeden önce telefon numaranı gir; ekip arkadaşların sana ulaşabilsin." })}>
      <ProfileForm onDone={onClose} />
    </Dialog>
  );
}

function ProfileForm({ onDone }: { onDone: () => void }) {
  const L = useLookup();
  const me = L.me;
  const m = usePatchProfile();
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [nickname, setNickname] = useState(me.nickname ?? "");
  const [phone, setPhone] = useState(me.phone ?? "0");
  const [day, setDay] = useState(me.birth_day?.toString() ?? "");
  const [month, setMonth] = useState(me.birth_month?.toString() ?? "");
  const [year, setYear] = useState(me.birth_year?.toString() ?? "");
  const [avatar, setAvatar] = useState(me.avatar_id);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pick = (f: File) => {
    setBusy(true);
    upload<Attachment>(f)
      .then((a) => setAvatar(a.id))
      .catch((e: unknown) => setErr(errorText(e)))
      .finally(() => setBusy(false));
  };

  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  return (
    <form
      className={ui.formStack}
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        m.mutate(
          {
            nickname: nickname.trim() === "" ? null : nickname,
            phone: phone.trim() === "" ? null : phone,
            birth_day: num(day), birth_month: num(month), birth_year: num(year),
            avatar_id: avatar,
          },
          {
            onSuccess: () => { toast({ text: "Profil kaydedildi", error: false }); onDone(); },
            onError: (x) => setErr(errorText(x)),
          },
        );
      }}
    >
      {err !== null && <p className={ui.error} role="alert">{err}</p>}
      <div className={s.photo}>
        <Avatar user={{ ...me, avatar_id: avatar }} size={64} />
        <button type="button" className={s.photoBtn} onClick={() => file.current?.click()} disabled={busy}>
          <Icon name="camera" size={14} /> {busy ? "Yükleniyor…" : "Fotoğraf yükle"}
        </button>
        {avatar !== null && (
          <button type="button" className={s.photoBtn} onClick={() => setAvatar(null)}>Kaldır</button>
        )}
        <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f !== undefined) pick(f); e.target.value = ""; }} />
      </div>
      <label className={ui.field}>
        <span>Takma ad <span className={ui.fieldHint}>— sohbette adının altında görünür</span></span>
        <input className={ui.input} value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={40} />
      </label>
      <label className={ui.field}>
        <span>Telefon<Req /></span>
        {/* Kayitli eski bicimli numara dokunulmadikca kaydi engellemez. */}
        <input className={ui.input} type="tel" inputMode="numeric" value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))}
          required pattern={phone === me.phone ? undefined : PHONE_PATTERN} title="0532 000 00 00 biçiminde 11 hane"
          placeholder="0532 000 00 00" autoComplete="tel" />
      </label>
      <fieldset className={ui.field}>
        <legend>Doğum günü <span className={ui.fieldHint}>— yıl isteğe bağlı</span></legend>
        <div className={s.birth}>
          <input className={ui.input} type="number" min={1} max={31} placeholder="Gün" aria-label="Gün"
            value={day} onChange={(e) => setDay(e.target.value)} />
          <select className={ui.input} aria-label="Ay" value={month} onChange={(e) => setMonth(e.target.value)}>
            <option value="">Ay</option>
            {MONTHS.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
          </select>
          <input className={ui.input} type="number" min={1900} max={2100} placeholder="Yıl" aria-label="Yıl"
            value={year} onChange={(e) => setYear(e.target.value)} />
        </div>
      </fieldset>
      <p className={ui.fieldHint}>
        Telefon ve doğum günün yalnız ekip arkadaşlarına görünür; nasıl saklandığını{" "}
        <a href={privacyUrl()} target="_blank" rel="noreferrer">Gizlilik sayfasında</a> okuyabilirsin.
      </p>
      <div className={ui.dact}>
        <Button type="submit" variant="primary" disabled={m.isPending || busy}>Kaydet</Button>
      </div>
    </form>
  );
}
