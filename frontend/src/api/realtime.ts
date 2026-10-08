// Gercek zamanli kanal: sekme basina TEK WebSocket (Rust realtime.rs).
//
// Olay VERI tasimaz, yalniz "su degisti" der; veriyi yine REST ceker. Bu
// dosya React Query'yi bilmez: olay -> hangi sorgu bayat eşlemesi hooks.ts'te
// (`onRealtimeEvent`), anahtarlar orada tanimli.
//
// Konu abonelikleri modul duzeyinde (`wanted`) ve baglantidan BAGIMSIZ: bir
// cocuk bilesen soket acilmadan once `useTopic` cagirabilir (cocuk efektleri
// ebeveynden once calisir); soket acilinca hepsi gonderilir.
//
// Kopma: ustel bekleme + rastgelelik (deploy sonrasi herkes ayni anda
// gelmesin). Yeniden baglaninca `onResync`: kopukken kacirilan olaylar
// tekrar oynatilmaz, bunun yerine acik sorgularin hepsi tazelenir. Ilk
// acilista resync YOK: sayfa yuklenirken yapilan okumalar zaten taze (acilisla
// abonelik arasindaki milisaniyelik pencere bilerek kabul edildi).
//
// Soket kapaliyken `useRealtimeUp()` false: yoklama (refetchInterval) geri doner.

import { useEffect, useSyncExternalStore } from "react";
import type { Uuid } from "./types";

/** Rust `realtime::Event` ile ayni bicim. */
export type RealtimeEvent =
  | { t: "record"; id: Uuid }
  | { t: "chat"; id: Uuid }
  | { t: "lists" };

export type Topic = `record:${Uuid}` | `chat:${Uuid}`;

const wanted = new Map<Topic, number>();
let socket: WebSocket | null = null;
let isUp = false;
const upListeners = new Set<() => void>();

function setUp(v: boolean): void {
  if (isUp === v) return;
  isUp = v;
  upListeners.forEach((l) => l());
}

function send(op: "sub" | "unsub", topic: Topic): void {
  if (socket !== null && isUp) socket.send(JSON.stringify({ op, topic }));
}

/** Konuya abone ol; donen islev aboneligi birakir. Ayni konu sayilir (sayac). */
export function watch(topic: Topic): () => void {
  const n = wanted.get(topic) ?? 0;
  wanted.set(topic, n + 1);
  if (n === 0) send("sub", topic);
  return () => {
    const left = (wanted.get(topic) ?? 1) - 1;
    if (left > 0) {
      wanted.set(topic, left);
    } else {
      wanted.delete(topic);
      send("unsub", topic);
    }
  };
}

/** Bilesen acikken konuya abone kal. `undefined` = henuz konu yok. */
export function useTopic(topic: Topic | undefined): void {
  useEffect(() => (topic === undefined ? undefined : watch(topic)), [topic]);
}

/** Soket su an acik mi: kapaliyken yoklama geri doner. */
export function useRealtimeUp(): boolean {
  return useSyncExternalStore(
    (l) => {
      upListeners.add(l);
      return () => upListeners.delete(l);
    },
    () => isUp,
  );
}

function parse(data: unknown): RealtimeEvent | null {
  if (typeof data !== "string") return null;
  try {
    const e: unknown = JSON.parse(data);
    if (typeof e !== "object" || e === null || !("t" in e)) return null;
    if (e.t === "lists") return { t: "lists" };
    if ((e.t === "record" || e.t === "chat") && "id" in e && typeof e.id === "string") return { t: e.t, id: e.id };
  } catch {
    // Bozuk cerceve: yoksay, baglanti kalir.
  }
  return null;
}

function backoff(attempt: number): number {
  return Math.min(30_000, 1_000 * 2 ** attempt) * (0.5 + Math.random() / 2);
}

function defaultUrl(): string {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws`;
}

export interface RealtimeOptions {
  onEvent: (e: RealtimeEvent) => void;
  /** Yeniden baglandi: kacirilmis olay olabilir, her seyi tazele. */
  onResync: () => void;
  url?: string;
}

/** Baglantiyi baslatir; donen islev durdurur (cikis, test). */
export function startRealtime(opts: RealtimeOptions): () => void {
  let stopped = false;
  let attempt = 0;
  let everOpened = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const connect = () => {
    const ws = new WebSocket(opts.url ?? defaultUrl());
    socket = ws;
    ws.onopen = () => {
      attempt = 0;
      setUp(true);
      for (const topic of wanted.keys()) ws.send(JSON.stringify({ op: "sub", topic }));
      if (everOpened) opts.onResync();
      everOpened = true;
    };
    ws.onmessage = (m: MessageEvent) => {
      const e = parse(m.data);
      if (e !== null) opts.onEvent(e);
    };
    ws.onclose = () => {
      if (socket === ws) {
        socket = null;
        setUp(false);
      }
      if (!stopped) timer = setTimeout(connect, backoff(attempt++));
    };
    // Hata ardindan tarayici `close` da yollar; yeniden deneme orada.
    ws.onerror = () => ws.close();
  };
  connect();

  return () => {
    stopped = true;
    clearTimeout(timer);
    const ws = socket;
    socket = null;
    setUp(false);
    ws?.close();
  };
}
