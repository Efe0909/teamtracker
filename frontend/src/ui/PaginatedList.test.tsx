import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { PaginatedList } from "./PaginatedList";

afterEach(cleanup);

const rows = (prefix: string, count: number) => Array.from({ length: count }, (_, index) =>
  <div key={`${prefix}-${index}`}>{prefix} {index + 1}</div>);

it("paginates mixed row groups as one list with numbered pages and correct boundaries", () => {
  render(<PaginatedList label="Yaklaşan ödemeler">
    {rows("İade", 3)}{false}{rows("Malzeme", 8)}
  </PaginatedList>);
  const pager = screen.getByRole("navigation", { name: "Yaklaşan ödemeler sayfaları" });
  expect(within(pager).getByText("1–5 / 11")).toBeTruthy();
  expect(within(pager).getByRole("button", { name: "Önceki sayfa" })).toHaveProperty("disabled", true);
  expect(screen.getByText("Malzeme 2")).toBeTruthy();
  expect(screen.queryByText("Malzeme 3")).toBeNull();
  fireEvent.click(within(pager).getByRole("button", { name: "2. sayfa" }));
  expect(within(pager).getByRole("button", { name: "2. sayfa" }).getAttribute("aria-current")).toBe("page");
  expect(within(pager).getByText("6–10 / 11")).toBeTruthy();
  expect(screen.getByText("Malzeme 3")).toBeTruthy();
  expect(screen.getByText("Malzeme 7")).toBeTruthy();
  expect(screen.queryByText("İade 1")).toBeNull();
  fireEvent.click(within(pager).getByRole("button", { name: "Sonraki sayfa" }));
  expect(within(pager).getByText("11–11 / 11")).toBeTruthy();
  expect(screen.getByText("Malzeme 8")).toBeTruthy();
  expect(within(pager).getByRole("button", { name: "Sonraki sayfa" })).toHaveProperty("disabled", true);
});

it("resets to the first page when the row count changes without changing another list", () => {
  render(<>
    <PaginatedList label="Ödemeler">{rows("Ödeme", 12)}</PaginatedList>
    <PaginatedList label="Borçlar">{rows("Üye", 8)}</PaginatedList>
  </>);
  const payments = screen.getByRole("navigation", { name: "Ödemeler sayfaları" });
  const debts = screen.getByRole("navigation", { name: "Borçlar sayfaları" });
  fireEvent.click(within(payments).getByRole("button", { name: "3. sayfa" }));
  fireEvent.click(within(debts).getByRole("button", { name: "2. sayfa" }));
  fireEvent.change(within(payments).getByRole("combobox"), { target: { value: "10" } });
  expect(within(payments).getByText("1–10 / 12")).toBeTruthy();
  expect(screen.getByText("Ödeme 1")).toBeTruthy();
  expect(screen.queryByText("Ödeme 11")).toBeNull();
  expect(within(debts).getByText("6–8 / 8")).toBeTruthy();
  expect(within(debts).getByRole("combobox")).toHaveProperty("value", "5");
  expect(screen.getByText("Üye 6")).toBeTruthy();
  expect(screen.queryByText("Üye 1")).toBeNull();
});

it("keeps a valid page after rows are removed and disables navigation for an empty list", () => {
  const { rerender } = render(<PaginatedList label="Borçlar">{rows("Üye", 12)}</PaginatedList>);
  const pager = screen.getByRole("navigation", { name: "Borçlar sayfaları" });
  fireEvent.click(within(pager).getByRole("button", { name: "3. sayfa" }));
  rerender(<PaginatedList label="Borçlar">{rows("Üye", 6)}</PaginatedList>);
  expect(within(pager).getByText("6–6 / 6")).toBeTruthy();
  expect(screen.getByText("Üye 6")).toBeTruthy();
  rerender(<PaginatedList label="Borçlar" empty="Borç kalmadı">{[]}</PaginatedList>);
  expect(screen.getByText("Borç kalmadı")).toBeTruthy();
  expect(within(pager).getByText("0 kayıt")).toBeTruthy();
  expect(within(pager).getByRole("button", { name: "Önceki sayfa" })).toHaveProperty("disabled", true);
  expect(within(pager).getByRole("button", { name: "Sonraki sayfa" })).toHaveProperty("disabled", true);
});
