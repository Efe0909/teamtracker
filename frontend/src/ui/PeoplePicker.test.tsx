import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import type { MetaUser } from "../api/types";
import { PeoplePicker } from "./PeoplePicker";

afterEach(cleanup);

const users: MetaUser[] = ["Efe", "Ayşe", "İpek"].map((name) => ({
  id: name, name, color: null, is_admin: false, last_seen_at: null, nickname: null,
  phone: null, avatar_id: null, birth_day: null, birth_month: null, birth_year: null, roles: [],
}));

function setup() {
  const onChange = vi.fn();
  function Example() {
    const [value, setValue] = useState(["Efe"]);
    return <PeoplePicker label="Sorumlular" users={users} value={value}
      onChange={(next) => { setValue(next); onChange(next); }} />;
  }
  render(<Example />);
  fireEvent.click(screen.getByRole("button", { name: /^Sorumlular:/ }));
  return { onChange, search: screen.getByRole("combobox", { name: "Kullanıcı ara" }) };
}

test("searching preserves selected people and saves all changes once on close", () => {
  const { search, onChange } = setup();
  expect(document.activeElement).toBe(search);
  expect(screen.getByRole("listbox").getAttribute("aria-multiselectable")).toBe("true");
  fireEvent.change(search, { target: { value: "İPEK" } });
  expect(screen.queryByRole("option", { name: "Efe" })).toBeNull();
  fireEvent.click(screen.getByRole("option", { name: "İpek" }));
  expect(screen.getByRole("option", { name: "İpek" }).getAttribute("aria-selected")).toBe("true");
  fireEvent.change(search, { target: { value: "" } });
  expect(screen.getByRole("option", { name: "Efe" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("option", { name: "İpek" }).getAttribute("aria-selected")).toBe("true");
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.keyDown(search, { key: "Escape" });
  expect(onChange).toHaveBeenCalledExactlyOnceWith(["Efe", "İpek"]);
  fireEvent.click(screen.getByRole("button", { name: /^Sorumlular:/ }));
  expect(screen.getByRole("combobox").getAttribute("value")).toBe("");
  expect(screen.getAllByRole("option", { selected: true })).toHaveLength(2);
});

test("keyboard toggles people without closing and clearing returns the action to the pool", () => {
  const { search, onChange } = setup();
  fireEvent.keyDown(search, { key: "ArrowUp" });
  fireEvent.keyDown(search, { key: "Enter" });
  expect(screen.getByRole("option", { name: "İpek" }).getAttribute("aria-selected")).toBe("true");
  fireEvent.keyDown(search, { key: "Enter" });
  expect(screen.getByRole("option", { name: "İpek" }).getAttribute("aria-selected")).toBe("false");
  fireEvent.keyDown(search, { key: "Escape" });
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /^Sorumlular:/ }));
  fireEvent.click(screen.getByRole("option", { name: "Havuza bırak" }));
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
  expect(onChange).toHaveBeenCalledExactlyOnceWith([]);
});
