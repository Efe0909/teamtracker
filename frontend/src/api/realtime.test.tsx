// Soket istemcisi: abonelikler baglantidan bagimsiz, kopunca yeniden baglanir ve
// tazeler, olay -> sorgu eslemesi toplu. Sunucu tarafi: backend realtime.rs
// birim testleri + backend/tools/check_api.sh websocket_gate.

import { QueryClient } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { keys, onRealtimeEvent } from "./hooks";
import { startRealtime, useRealtimeUp, useTopic, watch } from "./realtime";

class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((m: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) { FakeSocket.all.push(this); }
  send(d: string) { this.sent.push(d); }
  close() { this.readyState = 3; this.onclose?.(); }
  // Test yardimcilari
  open() { this.readyState = 1; this.onopen?.(); }
  push(d: unknown) { this.onmessage?.({ data: typeof d === "string" ? d : JSON.stringify(d) }); }
  ops() { return this.sent.map((s) => JSON.parse(s) as { op: string; topic: string }); }
}
const last = () => FakeSocket.all[FakeSocket.all.length - 1] as FakeSocket;

let stop: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeSocket);
  FakeSocket.all = [];
});
afterEach(() => {
  stop?.();
  stop = undefined;
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const start = (o: Partial<Parameters<typeof startRealtime>[0]> = {}) =>
  (stop = startRealtime({ onEvent: () => undefined, onResync: () => undefined, url: "ws://x/api/ws", ...o }));

it("sends topics subscribed before the socket opened, and later ones live", () => {
  const off = watch("record:r1"); // soketten ONCE (cocuk efekti ebeveynden once calisir)
  start();
  expect(last().sent).toEqual([]);
  act(() => last().open());
  expect(last().ops()).toEqual([{ op: "sub", topic: "record:r1" }]);

  const off2 = watch("chat:c1");
  expect(last().ops().at(-1)).toEqual({ op: "sub", topic: "chat:c1" });
  off();
  off2();
  expect(last().ops().slice(-2)).toEqual([{ op: "unsub", topic: "record:r1" }, { op: "unsub", topic: "chat:c1" }]);
});

it("counts references: the same topic unsubscribes only when the last user leaves", () => {
  start();
  act(() => last().open());
  const a = watch("record:r2");
  const b = watch("record:r2");
  expect(last().ops().filter((o) => o.topic === "record:r2")).toEqual([{ op: "sub", topic: "record:r2" }]);
  a();
  expect(last().ops().some((o) => o.op === "unsub")).toBe(false);
  b();
  expect(last().ops().at(-1)).toEqual({ op: "unsub", topic: "record:r2" });
});

it("useTopic follows the component lifetime", () => {
  start();
  act(() => last().open());
  const { unmount } = renderHook(() => useTopic("chat:c9"));
  expect(last().ops().at(-1)).toEqual({ op: "sub", topic: "chat:c9" });
  unmount();
  expect(last().ops().at(-1)).toEqual({ op: "unsub", topic: "chat:c9" });
});

it("forwards well-formed events and ignores junk", () => {
  const onEvent = vi.fn();
  start({ onEvent });
  act(() => last().open());
  last().push({ t: "record", id: "r1" });
  last().push({ t: "chat", id: "c1" });
  last().push({ t: "lists" });
  last().push("{bozuk");
  last().push({ t: "bilinmeyen" });
  last().push({ t: "record" });
  expect(onEvent.mock.calls.map((c) => c[0])).toEqual([
    { t: "record", id: "r1" }, { t: "chat", id: "c1" }, { t: "lists" },
  ]);
});

it("reports up/down, reconnects with backoff and resyncs only after a reconnect", () => {
  const onResync = vi.fn();
  const up = renderHook(() => useRealtimeUp());
  start({ onResync });
  expect(up.result.current).toBe(false);
  act(() => last().open());
  expect(up.result.current).toBe(true);
  expect(onResync).not.toHaveBeenCalled(); // ilk acilis

  act(() => last().close()); // kopma
  expect(up.result.current).toBe(false);
  expect(FakeSocket.all).toHaveLength(1);
  act(() => { vi.advanceTimersByTime(1_000); }); // en fazla 1 sn (rastgelelik 0.5-1)
  expect(FakeSocket.all).toHaveLength(2);
  act(() => last().open());
  expect(up.result.current).toBe(true);
  expect(onResync).toHaveBeenCalledTimes(1);
});

it("re-sends every wanted topic after a reconnect", () => {
  const off = watch("record:r3");
  start();
  act(() => last().open());
  act(() => last().close());
  act(() => { vi.advanceTimersByTime(1_000); });
  act(() => last().open());
  expect(last().ops()).toEqual([{ op: "sub", topic: "record:r3" }]);
  off();
});

it("stopping closes the socket and never reconnects", () => {
  start();
  act(() => last().open());
  const first = last();
  stop?.();
  stop = undefined;
  expect(first.readyState).toBe(3);
  act(() => { vi.advanceTimersByTime(60_000); });
  expect(FakeSocket.all).toHaveLength(1);
});

it("batches events and invalidates only what each one makes stale", () => {
  const qc = new QueryClient();
  const spy = vi.spyOn(qc, "invalidateQueries");
  const keysOf = () => spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));

  onRealtimeEvent(qc, { t: "record", id: "r1" });
  onRealtimeEvent(qc, { t: "record", id: "r1" }); // ayni olay tek sayilir
  onRealtimeEvent(qc, { t: "lists" });
  onRealtimeEvent(qc, { t: "lists" });
  expect(spy).not.toHaveBeenCalled(); // pencere dolmadan hicbir sey
  act(() => { vi.advanceTimersByTime(250); });

  expect(keysOf().filter((k) => k === JSON.stringify(keys.record("r1")))).toHaveLength(1);
  expect(keysOf()).toContain(JSON.stringify(["feed"])); // kayit olayi akisi da bayatlatir
  for (const k of [keys.recordsAll, keys.home, keys.myActions, keys.inbox, keys.notifications]) {
    expect(keysOf().filter((x) => x === JSON.stringify(k))).toHaveLength(1);
  }

  spy.mockClear();
  onRealtimeEvent(qc, { t: "chat", id: "c1" });
  act(() => { vi.advanceTimersByTime(250); });
  expect(keysOf()).toEqual([JSON.stringify(keys.feed("c1"))]);
});
