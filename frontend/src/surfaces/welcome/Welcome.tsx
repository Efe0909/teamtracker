import { useCallback, useEffect, useState } from "react";
import "./welcome.css";
import { deviceDefault, fetchMe, loginErrorText, logout, surfaceUrl, type Dest, type Me } from "../../api/session";

type Load = { kind: "loading" } | { kind: "ready"; me: Me } | { kind: "error" };

// Rust giris hatasinda `/welcome?error=<kod>` ile doner. Bir kez okunur, adres
// cubugundan silinir: yenileyince ayni hata tekrar gorunmesin.
function takeLoginError(): string | null {
  const params = new URLSearchParams(location.search);
  const code = params.get("error");
  if (code !== null) history.replaceState(null, "", location.pathname);
  return loginErrorText(code);
}

export function Welcome() {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [dest, setDest] = useState<Dest>(deviceDefault);
  const [error] = useState(takeLoginError);

  const refresh = useCallback(() => {
    fetchMe().then(
      (me) => setLoad({ kind: "ready", me }),
      () => setLoad({ kind: "error" }),
    );
  }, []);
  useEffect(refresh, [refresh]);

  return (
    <div className="welcome">
      <header className="topbar">
        <Brand />
      </header>

      <main className="welcome-grid">
        <section className="hero" aria-labelledby="hero-title">
          <p className="eyebrow">Ekip içi iş takibi</p>
          <h1 id="hero-title">
            Ekibin işi, <span className="accent">tek yerde.</span>
          </h1>
          <p className="lede">
            Kayıtlar, eylemler ve kart içi sohbet. Masaüstünde panel, cepte uygulama — aynı hesapla.
          </p>
          <ul className="points">
            <li>Birimden birime tek ağaç</li>
            <li>Her karta bağlı sohbet</li>
            <li>Telefona anında bildirim</li>
          </ul>
        </section>

        <section className="card" aria-labelledby="card-title" aria-busy={load.kind === "loading"}>
          {load.kind === "loading" && <p className="muted">Yükleniyor…</p>}
          {load.kind === "error" && (
            <p className="alert" role="alert">
              Sunucuya ulaşılamadı. Sayfayı yenile.
            </p>
          )}
          {load.kind === "ready" &&
            (load.me.user === null ? (
              <LoginForm me={load.me} dest={dest} onDest={setDest} error={error} />
            ) : (
              <SignedIn me={load.me} name={load.me.user.name} preferred={dest} onLogout={refresh} />
            ))}
        </section>
      </main>

      <footer className="foot">EkipTakip · alpha 0.2</footer>
    </div>
  );
}

function LoginForm(props: { me: Me; dest: Dest; onDest: (d: Dest) => void; error: string | null }) {
  const { me, dest, onDest, error } = props;
  return (
    <>
      <h2 id="card-title">Giriş yap</h2>
      {error !== null && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      <fieldset className="dest">
        <legend>Nereden devam edeceksin?</legend>
        <DestOption value="dashboard" current={dest} onPick={onDest} title="Masaüstü paneli" hint="Tablo, kart, ağaç" />
        <DestOption value="app" current={dest} onPick={onDest} title="Mobil uygulama" hint="Yapılacaklar, bildirim" />
      </fieldset>

      {me.auth === "google" ? (
        <a className="btn btn-google" href={`/api/auth/google?next=${dest}`}>
          <GoogleMark />
          Google ile devam et
        </a>
      ) : (
        <DevLogin me={me} dest={dest} />
      )}

      <p className="fine">Yalnızca ekibe davet edilmiş hesaplar girebilir.</p>
    </>
  );
}

function DestOption(props: { value: Dest; current: Dest; onPick: (d: Dest) => void; title: string; hint: string }) {
  const { value, current, onPick, title, hint } = props;
  return (
    <label className="dest-option">
      <input type="radio" name="dest" value={value} checked={current === value} onChange={() => onPick(value)} />
      <span className="dest-icon" aria-hidden="true">
        {value === "dashboard" ? <MonitorIcon /> : <PhoneIcon />}
      </span>
      <span className="dest-text">
        <span className="dest-title">{title}</span>
        <span className="dest-hint">{hint}</span>
      </span>
    </label>
  );
}

// Sahte kimlik (yalniz gelistirme): kullanici secilir, hedef host'ta oturum
// acilir. Yayinda Rust bu modu acilista reddediyor.
function DevLogin({ me, dest }: { me: Me; dest: Dest }) {
  const users = me.dev_users ?? [];
  const [userId, setUserId] = useState(users[0]?.id ?? "");
  return (
    <form
      className="dev"
      onSubmit={(e) => {
        e.preventDefault();
        location.assign(surfaceUrl(dest, `/api/auth/dev-login?user_id=${encodeURIComponent(userId)}`));
      }}
    >
      <label htmlFor="dev-user">Kullanıcı (geliştirme modu)</label>
      <select id="dev-user" value={userId} onChange={(e) => setUserId(e.target.value)}>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
      <button className="btn btn-primary" type="submit" disabled={userId === ""}>
        Giriş yap
      </button>
    </form>
  );
}

function SignedIn(props: { me: Me; name: string; preferred: Dest; onLogout: () => void }) {
  const { me, name, preferred, onLogout } = props;
  const [busy, setBusy] = useState(false);
  const other: Dest = preferred === "app" ? "dashboard" : "app";
  const label: Record<Dest, string> = { dashboard: "Masaüstü paneline git", app: "Mobil uygulamaya git" };
  return (
    <>
      <h2 id="card-title">Hoş geldin, {name}</h2>
      <p className="muted">Oturumun açık. Nereden devam edeceksin?</p>
      <div className="stack">
        <a className="btn btn-primary" href={surfaceUrl(preferred)}>
          {label[preferred]}
        </a>
        <a className="btn btn-ghost" href={surfaceUrl(other)}>
          {label[other]}
        </a>
      </div>
      <button
        className="link"
        type="button"
        disabled={busy || me.csrf === null}
        onClick={() => {
          if (me.csrf === null) return;
          setBusy(true);
          logout(me.csrf).finally(() => {
            setBusy(false);
            onLogout();
          });
        }}
      >
        Çıkış yap
      </button>
    </>
  );
}

// --- simgeler ------------------------------------------------------------

function Brand() {
  return (
    <span className="brand">
      <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="9" />
        <path d="M9 11h9M9 16h14M9 21h6" />
        <path className="tick" d="m19 21 2 2 4-5" />
      </svg>
      EkipTakip
    </span>
  );
}

function MonitorIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M11 18.5h2" />
    </svg>
  );
}

function GoogleMark() {
  return (
    <svg className="g" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.2 5.3-4.6 7l7.1 5.5c4.2-3.9 7.2-9.6 7.2-16.9z" />
      <path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.6 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.1-5.5c-2 1.4-4.6 2.2-8.8 2.2-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}
