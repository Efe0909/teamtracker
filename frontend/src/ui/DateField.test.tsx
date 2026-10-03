import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { DateField, DateTimeField } from "./DateField";

afterEach(cleanup);

test("gune tiklayinca onChange YYYY-MM-DD alir", () => {
  const onChange = vi.fn();
  render(<DateField aria-label="Tarih" value="2026-10-03" onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: /^Tarih:/ }));
  fireEvent.click(screen.getByRole("gridcell", { name: "15 Ekim 2026" }));
  expect(onChange).toHaveBeenCalledWith("2026-10-15");
});

test("Pazartesi'den baslar: 1 Ekim 2026 Persembe, ilk hucre 28 Eylul", () => {
  render(<DateField aria-label="Tarih" value="2026-10-03" onChange={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: /^Tarih:/ }));
  expect(screen.getAllByRole("gridcell")[0]?.getAttribute("aria-label")).toBe("28 Eylül 2026");
});

test("Temizle onChange(null) verir; clearable degilse yok", () => {
  const onChange = vi.fn();
  const { unmount } = render(<DateField aria-label="Tarih" value="2026-10-03" clearable onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: /^Tarih:/ }));
  fireEvent.click(screen.getByRole("button", { name: "Temizle" }));
  expect(onChange).toHaveBeenCalledWith(null);
  unmount();
  render(<DateField aria-label="Tarih" value="2026-10-03" onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: /^Tarih:/ }));
  expect(screen.queryByRole("button", { name: "Temizle" })).toBeNull();
});

test("DateTimeField: gun secince mevcut saati korur", () => {
  const onChange = vi.fn();
  render(<DateTimeField aria-label="Bitiş" value="2026-10-03T14:30" onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: /^Bitiş:/ }));
  fireEvent.click(screen.getByRole("gridcell", { name: "20 Ekim 2026" }));
  expect(onChange).toHaveBeenCalledWith("2026-10-20T14:30");
});
