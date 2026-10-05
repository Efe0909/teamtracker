import { useState } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Transaction } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { cursorCharLeft, cursorCharRight, redo, undo } from "@codemirror/commands";
import type { Meta } from "../api/types";
import { LookupProvider } from "../lib/lookup";
import { MarkdownField, MarkdownText } from "./MarkdownField";
import { linkAt } from "./MarkdownEditor";
import s from "./markdown.module.css";

const meta: Meta = {
  me: { id: "me", is_admin: false, scopes: [], team_ids: [], profile_complete: true, favorite_nodes: [] },
  users: [{ id: "selin", name: "Selin", color: null, is_admin: false, last_seen_at: null, nickname: null, phone: null, avatar_id: null, birth_day: null, birth_month: null, birth_year: null, roles: [] }], teams: [], pillars: [], nodes: [],
};
afterEach(cleanup);

function Field({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <LookupProvider meta={meta}><MarkdownField value={value} onChange={setValue} label="Açıklama" /><output data-testid="source">{value}</output></LookupProvider>;
}
function viewIn(container: HTMLElement): EditorView {
  const content = container.querySelector<HTMLElement>(".cm-content");
  const view = content ? EditorView.findFromDOM(content) : null;
  if (!view) throw new Error("CodeMirror view not mounted");
  return view;
}
function type(view: EditorView, text: string) {
  act(() => {
    for (const char of text) {
      const { from, to } = view.state.selection.main;
      const insert = () => view.state.update({ changes: { from, to, insert: char }, selection: { anchor: from + char.length }, annotations: Transaction.userEvent.of("input.type") });
      if (!view.state.facet(EditorView.inputHandler).some((handler) => handler(view, from, to, char, insert))) view.dispatch(insert());
    }
  });
}
function key(view: EditorView, value: string) {
  act(() => { runScopeHandlers(view, new KeyboardEvent("keydown", { key: value }), "editor"); });
}

it("uses actual editable rendering with exact DOM/source positions and no transparent textarea", () => {
  const { container } = render(<Field initial="**word** tail" />);
  const view = viewIn(container);
  expect(container.querySelector("textarea")).toBeNull();
  expect(view.contentDOM.textContent).toBe("word tail");
  const word = view.contentDOM.querySelector(`.${s.strong}`)?.firstChild;
  if (!word) throw new Error("Rendered bold text missing");
  expect(view.posAtDOM(word, 0)).toBe(2);
  expect(view.posAtDOM(word, 4)).toBe(6);
});

it("pairs the second bold star, keeps the caret between pairs, and hides nonempty markers", () => {
  const { container } = render(<Field />);
  const view = viewIn(container);
  type(view, "**");
  expect(view.state.doc.toString()).toBe("****");
  expect(view.state.selection.main.head).toBe(2);
  expect(view.contentDOM.textContent).toBe("****");
  type(view, "word");
  expect(view.state.doc.toString()).toBe("**word**");
  expect(view.state.selection.main.head).toBe(6);
  expect(view.contentDOM.textContent).toBe("word");
});

it("does not auto-pair stars while an IME composition is active", () => {
  const { container } = render(<Field initial="*" />);
  const view = viewIn(container);
  act(() => { view.dispatch({ selection: { anchor: 1 } }); });
  fireEvent.compositionStart(view.contentDOM);
  expect(view.compositionStarted).toBe(true);
  type(view, "*");
  expect(view.state.doc.toString()).toBe("**");
  fireEvent.compositionEnd(view.contentDOM);
});

it("skips hidden closing/opening pairs with arrows and normalizes pointer/programmatic selections", () => {
  const { container } = render(<Field initial="**word** tail" />);
  const view = viewIn(container);
  act(() => { view.dispatch({ selection: { anchor: 6 } }); cursorCharRight(view); });
  expect(view.state.selection.main.head).toBe(8);
  act(() => { cursorCharLeft(view); });
  expect(view.state.selection.main.head).toBe(6);
  act(() => { view.dispatch({ selection: { anchor: 7 }, annotations: Transaction.userEvent.of("select.pointer") }); });
  expect([6, 8]).toContain(view.state.selection.main.head);
  act(() => { view.dispatch({ selection: { anchor: 1 } }); });
  expect([0, 2]).toContain(view.state.selection.main.head);
});

it("deletes visible characters across hidden pairs rather than corrupting the delimiters", () => {
  const { container } = render(<Field initial="**word**" />);
  const view = viewIn(container);
  act(() => { view.dispatch({ selection: { anchor: 8 } }); });
  key(view, "Backspace");
  expect(view.state.doc.toString()).toBe("**wor**");
  act(() => { view.dispatch({ selection: { anchor: 0 } }); });
  key(view, "Delete");
  expect(view.state.doc.toString()).toBe("**or**");
});

it("retains handle-based mention suggestions and Tab completion", () => {
  const { container, getByRole } = render(<Field />);
  const view = viewIn(container);
  type(view, "@se");
  expect(getByRole("option", { name: "Selin" })).toBeTruthy();
  key(view, "Tab");
  expect(view.state.doc.toString()).toBe("@selin ");
});

it("starts a heading on its first title character, not on blur or preview", () => {
  const { container } = render(<Field />);
  const view = viewIn(container);
  type(view, "### ");
  expect(view.contentDOM.textContent).toBe("### ");
  type(view, "t");
  expect(view.contentDOM.textContent).toBe("t");
  expect(view.contentDOM.querySelector(`.${s.heading}`)?.textContent).toBe("t");
});

it("dot click creates an empty alias with dim URL context until the first alias character", () => {
  const url = "https://example.com/a(b)";
  const { container, getByRole } = render(<Field initial={url} />);
  const view = viewIn(container);
  const dot = getByRole("button", { name: "Bağlantıya ad ver" });
  fireEvent.mouseEnter(dot);
  expect(view.state.doc.toString()).toBe(url);
  fireEvent.click(dot);
  expect(view.state.doc.toString()).toBe(`[](${url})`);
  expect(view.state.selection.main.head).toBe(1);
  expect(view.contentDOM.querySelector(`.${s.fallback}`)?.textContent).toBe(url);
  type(view, "P");
  expect(view.state.doc.toString()).toBe(`[P](${url})`);
  expect(view.contentDOM.textContent).toBe("P");
  expect(view.contentDOM.querySelector(`.${s.fallback}`)).toBeNull();
  expect(container.querySelector(`.${s.urlDot}`)).toBeNull();
});

it("edits a completed link alias and exact destination through double click", () => {
  const url = "https://example.com/a(b)";
  const { container, getByRole } = render(<Field initial={`[Plan](${url})`} />);
  const view = viewIn(container);
  const alias = view.contentDOM.querySelector("[data-link-from]");
  if (!alias) throw new Error("Alias missing");
  fireEvent.doubleClick(alias);
  const name = getByRole("textbox", { name: "Bağlantı adı" });
  const destination = getByRole("textbox", { name: "Bağlantı adresi" });
  expect((destination as HTMLInputElement).value).toBe(url);
  fireEvent.change(name, { target: { value: "Yeni" } });
  fireEvent.click(getByRole("button", { name: "Uygula" }));
  expect(view.state.doc.toString()).toBe(`[Yeni](${url})`);
  expect(view.contentDOM.textContent).toBe("Yeni");
  expect(linkAt(view.state.doc.toString(), 2)?.url).toBe(url);
});

it("provides native undo/redo for dot conversion and alias edits", () => {
  const url = "https://example.com";
  const { container, getByRole } = render(<Field initial={url} />);
  const view = viewIn(container);
  fireEvent.click(getByRole("button", { name: "Bağlantıya ad ver" }));
  act(() => { undo(view); });
  expect(view.state.doc.toString()).toBe(url);
  act(() => { redo(view); });
  expect(view.state.doc.toString()).toBe(`[](${url})`);
});

it("continues bullet/ordered lists and exits the empty second item without an extra blank line", () => {
  const { container } = render(<Field initial="- item" />);
  const view = viewIn(container);
  act(() => { view.dispatch({ selection: { anchor: 6 } }); });
  key(view, "Enter");
  expect(view.state.doc.toString()).toBe("- item\n- ");
  key(view, "Enter");
  expect(view.state.doc.toString()).toBe("- item\n");
  act(() => { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "3. item" }, selection: { anchor: 7 } }); });
  key(view, "Enter");
  expect(view.state.doc.toString()).toBe("3. item\n4. ");
  key(view, "Enter");
  expect(view.state.doc.toString()).toBe("3. item\n");
});

it("renders regex-classified file pills without fetching and keeps HTML inert in the editor", () => {
  const { container } = render(<Field initial={'<img src=x onerror=alert(1)> [Plan](https://drive.google.com/file/d/unknown) [Doc](https://team.sharepoint.com/unknown)'} />);
  const view = viewIn(container);
  expect(view.contentDOM.querySelector("img:not(.cm-widgetBuffer), [onerror]")).toBeNull();
  expect(view.contentDOM.textContent).toContain("<img src=x onerror=alert(1)>");
  expect(view.contentDOM.querySelectorAll("svg")).toHaveLength(2);
  expect(view.contentDOM.querySelectorAll(`.${s.fileLabel}`)).toHaveLength(2);
  expect(view.contentDOM.querySelector(`.${s.urlDot}`)).toBeNull();
});

it("creates only allowlisted active hyperlinks in the editor and leaves ordinary clicks for caret placement", () => {
  const { container } = render(<Field initial="[bad](javascript:alert(1)) [ftp](ftp://example.com) [mail](mailto:a@b) [page](/relative) https://example.com" />);
  const view = viewIn(container);
  const links = [...view.contentDOM.querySelectorAll("a")];
  expect(links.map((a) => a.getAttribute("href"))).toEqual(["mailto:a@b", "/relative", "https://example.com"]);
  expect(view.contentDOM.textContent).toBe("bad ftp mail page https://example.com");
  const click = new MouseEvent("click", { bubbles: true, cancelable: true });
  expect(links[0]?.dispatchEvent(click)).toBe(false);
});

it("renders inert raw HTML and unsafe links without editor controls in cards", () => {
  const { container } = render(<LookupProvider meta={meta}>
    <MarkdownText value={'<img src=x onerror=alert(1)> [bad](javascript:alert(1)) https://example.com'} />
  </LookupProvider>);
  expect(container.querySelector("img")).toBeNull();
  expect(container.textContent).toContain("<img src=x onerror=alert(1)> bad https://example.com");
  expect(container.querySelectorAll("a")).toHaveLength(1);
  expect(container.querySelector("a")?.getAttribute("href")).toBe("https://example.com");
  expect(container.querySelector("button")).toBeNull();
});

it("renders completed provider aliases as file icon pills without fetching metadata", () => {
  const { container } = render(<LookupProvider meta={meta}>
    <MarkdownText value="[Plan](https://docs.google.com/document/d/unknown) [Sunum](https://team.sharepoint.com/unknown)" />
  </LookupProvider>);
  expect(container.querySelectorAll("a svg")).toHaveLength(2);
  expect(container.textContent).toBe("Plan Sunum");
  expect(container.querySelectorAll("button")).toHaveLength(0);
});

it("suppresses navigation when linkTextOnly is requested", () => {
  const { container } = render(<LookupProvider meta={meta}>
    <MarkdownText value="[Plan](https://docs.google.com/document/d/unknown)" linkTextOnly />
  </LookupProvider>);
  expect(container.querySelector("a")).toBeNull();
  expect(container.textContent).toBe("Plan");
});
