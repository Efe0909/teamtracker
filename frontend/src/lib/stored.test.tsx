import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useStored } from "./stored";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function Toggle({ id }: { id: string }) {
  const [list, setList] = useStored<string[]>("t.list", []);
  return (
    <button type="button" onClick={() => setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])}>
      {id}:{list.join(",")}
    </button>
  );
}

it("ayni anahtari okuyan bilesenler birbirinin yazdigini ezmez", () => {
  render(<><Toggle id="a" /><Toggle id="b" /></>);
  fireEvent.click(screen.getByText(/^a:/));
  fireEvent.click(screen.getByText(/^b:/));
  expect(screen.getByText("a:a,b")).toBeTruthy();
  expect(JSON.parse(localStorage.getItem("ekiptakip.ui.t.list") ?? "null")).toEqual(["a", "b"]);
});

it("depo temizlenince varsayilana doner", () => {
  render(<Toggle id="a" />);
  expect(screen.getByText("a:")).toBeTruthy();
});
