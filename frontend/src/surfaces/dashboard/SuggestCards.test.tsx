// Hayalet öneri kartları: istek reddedilenlerle gider, üçlü kabul/retle bitmeden sıradaki gelmez,
// kabul açıklamayı not olarak taşır.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { EventOp } from "../../api/hooks";
import { SuggestCards } from "./SuggestCards";

beforeEach(() => sessionStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const items = ["Havya", "Servo motor", "USB kablosu", "Makas"].map((name) => ({ name, description: `${name} neden` }));

function setup(existing: string[] = []) {
  const bodies: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: { body?: string }) => {
    bodies.push(JSON.parse(init?.body ?? "{}"));
    return { ok: true, status: 200, json: async () => ({ items, batch_id: "b1" }) };
  }));
  const run = vi.fn((_op: EventOp, ok?: () => void) => ok?.());
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <SuggestCards eventId="e1" existing={existing} run={run} busy={false} />
    </QueryClientProvider>,
  );
  return { bodies, run };
}

const ask = () => fireEvent.click(screen.getByRole("button", { name: /öneri al/ }));
const names = () => screen.getAllByRole("group").map((g) => g.getAttribute("aria-label"));

it("öneri düğmesi bir parti çeker, üçlü gösterilir", async () => {
  const { bodies } = setup();
  ask();
  await screen.findByRole("group", { name: "Öneri: Havya" });
  expect(names()).toEqual(["Öneri: Havya", "Öneri: Servo motor", "Öneri: USB kablosu"]);
  expect(bodies).toEqual([{ rejected: [] }]);
});

it("ret sıradaki öneriyi getirir; kabul açıklamayı not olarak taşıyan kalem ekler", async () => {
  const { run } = setup();
  ask();
  await screen.findByRole("group", { name: "Öneri: Havya" });
  fireEvent.click(screen.getByRole("button", { name: "Reddet: Havya" }));
  expect(names()).toEqual(["Öneri: Servo motor", "Öneri: USB kablosu", "Öneri: Makas"]);
  fireEvent.click(screen.getByRole("button", { name: "Kabul et: Servo motor" }));
  const op = run.mock.calls[0]![0];
  expect(op).toMatchObject({ method: "POST", path: "/api/events/e1/materials", body: { name: "Servo motor", notes: "Servo motor neden" } });
  expect(names()).toEqual(["Öneri: USB kablosu", "Öneri: Makas"]);
});

it("parti bitince düğme döner; yeni istek reddedilenleri taşır", async () => {
  const { bodies } = setup();
  ask();
  await screen.findByRole("group", { name: "Öneri: Havya" });
  fireEvent.click(screen.getByRole("button", { name: "Reddet: Havya" }));
  for (const n of ["Servo motor", "USB kablosu", "Makas"]) fireEvent.click(screen.getByRole("button", { name: `Reddet: ${n}` }));
  expect(screen.queryAllByRole("group")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Yeni öneriler getir" }));
  await waitFor(() => expect(bodies).toHaveLength(2));
  expect(bodies[1]).toEqual({ rejected: ["Havya", "Servo motor", "USB kablosu", "Makas"] });
});

it("listede zaten olan kalem öneri olarak gösterilmez", async () => {
  setup(["havya"]);
  ask();
  await screen.findByRole("group", { name: "Öneri: Servo motor" });
  expect(names()).toEqual(["Öneri: Servo motor", "Öneri: USB kablosu", "Öneri: Makas"]);
});
