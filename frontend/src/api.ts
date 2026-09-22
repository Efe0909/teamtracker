// Rust API'sinin (backend/src/api) istemci tarafi. Tipler ELLE — uc sayisi
// buyuyunce OpenAPI'den uretilecek; o zamana kadar degisiklik iki yerde.

export type Dest = "app" | "dashboard";

export interface MeUser {
  id: string;
  name: string;
  email: string;
  color: string | null;
  is_admin: boolean;
}

export interface DevUser {
  id: string;
  name: string;
  color: string | null;
}

export interface Me {
  user: MeUser | null;
  auth: "google" | "fake";
  csrf: string | null;
  dev_users?: DevUser[];
}

export async function fetchMe(): Promise<Me> {
  const r = await fetch("/api/me", { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`/api/me ${r.status}`);
  return (await r.json()) as Me;
}

export async function logout(csrf: string): Promise<void> {
  const r = await fetch("/api/auth/logout", { method: "POST", headers: { "X-CSRF-Token": csrf } });
  if (!r.ok) throw new Error(`/api/auth/logout ${r.status}`);
}

// --- hostlar -------------------------------------------------------------
// Ayrim Host'un ILK ETIKETINE bakar (KNOW-79): app. = mobil, dashboard. =
// masaustu, digeri = karsilama (apex). Gelistirmede localhost / app.localhost.

export type Surface = Dest | "welcome";

export function currentSurface(): Surface {
  const label = location.hostname.split(".")[0];
  return label === "app" || label === "dashboard" ? label : "welcome";
}

function apexHost(): string {
  return location.host.replace(/^(app|dashboard)\./, "");
}

export function surfaceUrl(dest: Dest, path = "/"): string {
  return `${location.protocol}//${dest}.${apexHost()}${path}`;
}

export function welcomeUrl(): string {
  return `${location.protocol}//${apexHost()}/welcome`;
}

// Telefon/tablet: mobil uygulama, digeri masaustu paneli.
export function deviceDefault(): Dest {
  return window.matchMedia("(max-width: 720px), (pointer: coarse)").matches ? "app" : "dashboard";
}

// --- giris hatalari ------------------------------------------------------
// Rust `/welcome?error=<kod>` ile doner (backend/src/api/auth.rs `LoginError`);
// metin burada.

const LOGIN_ERRORS = {
  cancelled: "Giriş iptal edildi.",
  failed: "Giriş tamamlanamadı. Tekrar dene.",
  rate_limited: "Çok fazla deneme. Bir dakika sonra tekrar dene.",
  unverified: "Google hesabının e-postası doğrulanmamış.",
  uninvited: "Bu e-posta ekip listesinde yok. Yöneticine söyle, seni eklesin.",
  inactive: "Hesabın kapatılmış. Yöneticine sor.",
  account_mismatch: "Bu e-posta başka bir Google hesabına bağlı. Yöneticine sor.",
} as const;

export type LoginError = keyof typeof LOGIN_ERRORS;

export function loginErrorText(code: string | null): string | null {
  if (code === null) return null;
  return code in LOGIN_ERRORS ? LOGIN_ERRORS[code as LoginError] : LOGIN_ERRORS.failed;
}
