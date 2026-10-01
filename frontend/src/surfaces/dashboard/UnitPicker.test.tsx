import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { MetaNode } from "../../api/types";
import { UnitPicker } from "./UnitPicker";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const node = (id: string, name: string, depth: number, parent_id: string | null): MetaNode =>
  ({ id, name, depth, parent_id, node_type: "generic", is_active: true });
const UNITS = [node("a", "Maliye", 0, null), node("a1", "Bütçe", 1, "a"), node("b", "Hukuk", 0, null), node("b1", "Sözleşme", 1, "b")];

it("bagli birimin dali acik, digeri kapali", () => {
  render(<UnitPicker units={UNITS} linked={["a1"]} onLink={() => {}} />);
  expect(screen.getByText("Bütçe")).toBeTruthy();
  expect(screen.queryByText("Sözleşme")).toBeNull();
  fireEvent.click(screen.getByLabelText("Hukuk dalını aç/kapat"));
  expect(screen.getByText("Sözleşme")).toBeTruthy();
});

it("favoriler suzgeci yalniz yildizlilari gosterir", () => {
  render(<UnitPicker units={UNITS} linked={[]} onLink={() => {}} />);
  fireEvent.click(screen.getByLabelText("Maliye favori"));
  fireEvent.click(screen.getByRole("button", { name: /Favoriler/ }));
  expect(screen.getByText("Maliye")).toBeTruthy();
  expect(screen.queryByText("Hukuk")).toBeNull();
});
