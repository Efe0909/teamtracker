// Profil ve ayarlar (spec/82): pencere degil sayfa, iki yuzde ayni icerik.
// Bolum URL'de (`?tab=`); fatura formu `?return=` ile buraya gonderip geri alir.
// Yuze ozgu rota bilgisi (href) disaridan gelir: bu bilesen rotalari bilmez.

import { useEffect } from "react";
import { privacyUrl } from "../../api/session";
import { SCOPE } from "../../lib/labels";
import { useLookup } from "../../lib/lookup";
import { onLinkClick } from "../../lib/router";
import { setTheme, THEMES, useTheme, type Theme } from "../../lib/theme";
import { Icon } from "../../ui/icons";
import { Choices, ui } from "../../ui/ui";
import { BankAccounts } from "./BankAccounts";
import { NotifySection } from "./NotifySection";
import { ProfileForm } from "./ProfileForm";
import s from "./profile.module.css";
import { PROFILE_TABS, type ProfileTab } from "./tabs";

/** Telefonsuz profil (spec/82 P6): profil disindaki her adres profile doner.
 *  Bugunku pencere kapatilamiyordu; sayfa karsiligi bu yonlendirme. */
export function useProfileGate(onProfile: boolean, go: () => void): void {
  const complete = useLookup().meta.me.profile_complete;
  useEffect(() => {
    if (!complete && !onProfile) go();
  }, [complete, onProfile, go]);
}

const THEME_LABEL: Record<Theme, string> = { light: "Açık", dark: "Koyu", system: "Sistem" };

export function ProfilePage({ tab, ret, hrefOf }: {
  tab: ProfileTab; ret: string | null; hrefOf: (t: ProfileTab) => string;
}) {
  const L = useLookup();
  const current = PROFILE_TABS.find((t) => t.tab === tab) ?? PROFILE_TABS[0];
  return (
    <div className={s.page}>
      <nav className={s.side} aria-label="Profil bölümleri">
        {PROFILE_TABS.map((t) => (
          <a key={t.tab} href={hrefOf(t.tab)} className={s.tab} aria-current={t.tab === tab ? "page" : undefined}
            onClick={(e) => onLinkClick(e, hrefOf(t.tab))}>
            <Icon name={t.icon} size={16} /> {t.label}
          </a>
        ))}
      </nav>
      <section className={s.body} aria-labelledby="profile-h">
        {!L.meta.me.profile_complete && (
          <p className={s.notice} role="status">Devam etmeden önce telefon numaranı gir; ekip arkadaşların sana ulaşabilsin.</p>
        )}
        {ret !== null && tab === "accounts" && (
          <p className={s.notice} role="status">
            Fatura yüklemek için önce bir hesap numarası eklemelisin.{" "}
            <a href={ret} onClick={(e) => onLinkClick(e, ret)}>Faturaya dön</a>
          </p>
        )}
        <h2 id="profile-h" className={s.sectionTitle}>{current?.label}</h2>
        {tab === "info" && <Info />}
        {tab === "accounts" && <BankAccounts />}
        {tab === "notifications" && <NotifySection />}
        {tab === "appearance" && <Appearance />}
        {tab === "privacy" && <Privacy />}
      </section>
    </div>
  );
}

function Info() {
  const L = useLookup();
  const teams = L.meta.teams.filter((t) => L.meta.me.team_ids.includes(t.id));
  const scopes = L.meta.me.is_admin ? ["Yönetici: bütün yetkiler"] : L.meta.me.scopes.map((x) => SCOPE[x] ?? x);
  return (
    <div className={ui.formStack}>
      <ProfileForm onDone={() => undefined} />
      <div className={ui.field}>
        <span>Takımlarım</span>
        <div className={s.chips}>
          {teams.length === 0 ? <span className={ui.fieldHint}>Bir takıma üye değilsin.</span>
            : teams.map((t) => <span key={t.id} className={s.chip}>{t.name}</span>)}
        </div>
      </div>
      <div className={ui.field}>
        <span>Yetkilerim <span className={ui.fieldHint}>— yetkileri yöneticiler verir</span></span>
        <div className={s.chips}>
          {scopes.length === 0 ? <span className={ui.fieldHint}>Ek yetkin yok.</span>
            : scopes.map((x) => <span key={x} className={s.chip}>{x}</span>)}
        </div>
      </div>
    </div>
  );
}

function Appearance() {
  const theme = useTheme();
  return (
    <div className={ui.formStack}>
      <div className={ui.field}>
        <span>Tema <span className={ui.fieldHint}>— bu cihazda saklanır; Sistem, cihazın ayarını izler</span></span>
        <Choices<Theme> current={theme} onPick={setTheme}
          options={THEMES.map((t) => ({ value: t, label: THEME_LABEL[t] }))} />
      </div>
    </div>
  );
}

function Privacy() {
  return (
    <div className={`${ui.formStack} ${s.prose}`}>
      <p>
        EkipTakip kulübün işleyişi için gereken kişisel verini saklar: adın, e-postan, telefonun, doğum günün,
        fotoğrafın, takım üyeliklerin, yazdığın kayıt ve mesajlar, geri ödeme için verdiğin hesap numaraları ve
        gönderdiğin faturalar.
      </p>
      <ul>
        <li>Ad, fotoğraf, telefon ve doğum günü oturum açmış ekip üyelerine görünür.</li>
        <li>Hesap numaralarını yalnız sen, yöneticiler ve maliye yetkilisi görür; maliye yalnız fatura ayrıntısında.</li>
        <li>E-posta ve mail şablonlarına tam IBAN yazılmaz. Silinen hesap numarasının geçmiş iadelerde yalnız son dört hanesi kalır.</li>
        <li>Faturalar ve kasa kayıtları yasal saklama süresi boyunca silinmez, yalnız iptal edilir.</li>
        <li>Yapay zekâ özelliklerine kişisel verin gönderilmez.</li>
      </ul>
      <p>
        Ayrıntılı aydınlatma metni: <a href={privacyUrl()} target="_blank" rel="noreferrer">Gizlilik sayfası</a>.
      </p>
      <div>
        <a className={`${ui.btn} ${ui["z-md"]}`} href="/api/me/export" download>
          <Icon name="download" size={16} /> Verilerimi indir
        </a>
      </div>
    </div>
  );
}
