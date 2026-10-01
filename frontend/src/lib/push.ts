// Tarayici tarafi web push: izin, abonelik, sunucuya kayit. Sunucu karari
// (kime/ne zaman) backend push::decide'da; burada yalniz "bu cihaz dinlesin mi".
// iOS'ta izin yalniz ana ekrana eklenmis uygulamada istenebilir (spec/40).

import { request } from "../api/client";

export type PushState = "unsupported" | "denied" | "off" | "on";

export function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function registerWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.register("/sw.js").catch(() => {
    // izin yok / ozel pencere: push kapali kalir, uygulama calisir
  });
}

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const raw = atob((b64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub != null && Notification.permission === "granted" ? "on" : "off";
}

/** Izin ister, abone olur, sunucuya yazar. Sunucuda push kapaliysa hata atar. */
export async function enablePush(): Promise<void> {
  const { public_key } = await request<{ public_key: string | null }>("GET", "/api/push/vapid");
  if (public_key === null) throw new Error("push_disabled");
  if ((await Notification.requestPermission()) !== "granted") throw new Error("permission_denied");
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(public_key) });
  const j = sub.toJSON();
  if (j.endpoint === undefined || j.keys?.["p256dh"] === undefined || j.keys["auth"] === undefined) {
    throw new Error("bad_subscription");
  }
  await request<null>("POST", "/api/push/subscriptions", {
    endpoint: j.endpoint, p256dh: j.keys["p256dh"], auth: j.keys["auth"],
  });
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub == null) return;
  await request<null>("DELETE", "/api/push/subscriptions", { endpoint: sub.endpoint });
  await sub.unsubscribe();
}
