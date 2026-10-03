import { expect, it } from "vitest";
import { mergeOrder, moveTo } from "./order";

it("kayitli sirayi korur, bilinmeyeni atar, yeniyi sona ekler", () => {
  const keys = ["a", "b", "c"];
  expect(mergeOrder(["c", "x", "a", "a"], keys)).toEqual(["c", "a", "b"]);
  expect(mergeOrder("bozuk", keys)).toEqual(keys);
  expect(moveTo(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
  expect(moveTo(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
});
