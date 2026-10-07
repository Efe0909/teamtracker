import { useState } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Transaction } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { redo, undo } from "@codemirror/commands";
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
function key(view: EditorView, value: string, init: KeyboardEventInit = {}) {
  act(() => { runScopeHandlers(view, new KeyboardEvent("keydown", { key: value, ...init }), "editor"); });
}
// CodeMirror odak değişimini 10ms sonra bildirir (focusChangeEffect).
async function focus(view: EditorView) {
  await act(async () => { view.contentDOM.focus(); await new Promise((r) => setTimeout(r, 30)); });
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

it("reveals a construct's marker pair only while the caret touches it, keeping the content formatted", async () => {
  const { container } = render(<Field initial="a **kalın** b" />);
  const view = viewIn(container);
  expect(view.contentDOM.textContent).toBe("a kalın b"); // odaksızken sakin
  await focus(view);
  act(() => { view.dispatch({ selection: { anchor: 7 } }); }); // kalı|n: ortada
  expect(view.contentDOM.textContent).toBe("a kalın b");
  act(() => { view.dispatch({ selection: { anchor: 4 } }); }); // **|kalın: açılışa bitişik
  expect(view.contentDOM.textContent).toBe("a **kalın** b");
  expect(view.contentDOM.querySelectorAll(`.${s.syntax}`)).toHaveLength(2);
  expect(view.contentDOM.querySelector(`.${s.strong}`)?.textContent).toContain("kalın");
  act(() => { view.dispatch({ selection: { anchor: 9 } }); }); // kalın|**: kapanışa bitişik
  expect(view.contentDOM.querySelectorAll(`.${s.syntax}`)).toHaveLength(2);
  act(() => { view.dispatch({ selection: { anchor: 0 } }); }); // başka yere
  expect(view.contentDOM.textContent).toBe("a kalın b");
});

it("does not reveal independent constructs the caret does not touch", async () => {
  const { container } = render(<Field initial="**a** *b* [c](https://x.com)" />);
  const view = viewIn(container);
  await focus(view);
  act(() => { view.dispatch({ selection: { anchor: 8 } }); }); // *|b*
  expect(view.contentDOM.querySelectorAll(`.${s.syntax}`)).toHaveLength(2);
  expect(view.contentDOM.textContent).toBe("a *b* c");
});

it("pairs the second bold star, keeps the caret between pairs, and overtypes the closer", () => {
  const { container } = render(<Field />);
  const view = viewIn(container);
  type(view, "**");
  expect(view.state.doc.toString()).toBe("****");
  expect(view.state.selection.main.head).toBe(2);
  type(view, "word");
  expect(view.state.doc.toString()).toBe("**word**");
  type(view, "**");
  expect(view.state.doc.toString()).toBe("**word**");
  expect(view.state.selection.main.head).toBe(8);
});

it("pairs only before a boundary and removes an empty pair with one Backspace", () => {
  const { container } = render(<Field initial="word" />);
  const view = viewIn(container);
  act(() => { view.dispatch({ selection: { anchor: 0 } }); });
  type(view, "**");
  expect(view.state.doc.toString()).toBe("**word");
  act(() => { view.dispatch({ changes: { from: 0, to: 6, insert: "" } }); });
  type(view, "**");
  expect(view.state.doc.toString()).toBe("****");
  key(view, "Backspace");
  expect(view.state.doc.toString()).toBe("");
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

it("toolbar bold toggles the selection, shows pressed state, keeps the selection", () => {
  const { container, getByRole } = render(<Field initial="hello world" />);
  const view = viewIn(container);
  act(() => { view.dispatch({ selection: { anchor: 0, head: 5 } }); });
  const bold = getByRole("button", { name: "Kalın" });
  expect(bold.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(bold);
  expect(view.state.doc.toString()).toBe("**hello** world");
  expect(getByRole("button", { name: "Kalın" }).getAttribute("aria-pressed")).toBe("true");
  expect(view.state.selection.main).toMatchObject({ from: 2, to: 7 });
  fireEvent.click(getByRole("button", { name: "Kalın" }));
  expect(view.state.doc.toString()).toBe("hello world");
});

it("Ctrl/Cmd+B and heading shortcuts run the same commands", () => {
  const { container } = render(<Field initial="title" />);
  const view = viewIn(container);
  act(() => { view.dispatch({ selection: { anchor: 0, head: 5 } }); });
  key(view, "b", { ctrlKey: true });
  expect(view.state.doc.toString()).toBe("**title**");
  key(view, "b", { ctrlKey: true });
  key(view, "2", { ctrlKey: true, altKey: true });
  expect(view.state.doc.toString()).toBe("## title");
});

it("retains handle-based mention suggestions and Tab completion", () => {
  const { container, getByRole } = render(<Field />);
  const view = viewIn(container);
  type(view, "@se");
  expect(getByRole("option", { name: "Selin" })).toBeTruthy();
  key(view, "Tab");
  expect(view.state.doc.toString()).toBe("@selin ");
});

it("starts a heading on its first title character, with a distinct size per level", () => {
  const { container } = render(<Field />);
  const view = viewIn(container);
  type(view, "### ");
  expect(view.contentDOM.querySelector(`.${s.h3}`)).toBeNull();
  type(view, "t");
  expect(view.contentDOM.querySelector(`.${s.h3}`)?.textContent).toBe("t");
  act(() => { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "# a\n## b\n### c" } }); });
  expect(view.contentDOM.querySelector(`.${s.h1}`)).not.toBeNull();
  expect(view.contentDOM.querySelector(`.${s.h2}`)).not.toBeNull();
  expect(view.contentDOM.querySelector(`.${s.h3}`)).not.toBeNull();
});

it("dot click creates an empty alias that keeps the destination visible as dim source", () => {
  const url = "https://example.com/a(b)";
  const { container, getByRole } = render(<Field initial={url} />);
  const view = viewIn(container);
  const dot = getByRole("button", { name: "Bağlantıya ad ver" });
  fireEvent.mouseEnter(dot);
  expect(view.state.doc.toString()).toBe(url);
  fireEvent.click(dot);
  expect(view.state.doc.toString()).toBe(`[](${url})`);
  expect(view.state.selection.main.head).toBe(1);
  // Görünen metin = kaynak (widget yok): hedef gerçek karakterlerle, silik işaret sınıfıyla.
  expect(view.contentDOM.textContent).toBe(`[](${url})`);
  expect(view.contentDOM.querySelectorAll(`.${s.syntax}`).length).toBeGreaterThan(0);
  type(view, "P");
  expect(view.state.doc.toString()).toBe(`[P](${url})`);
  expect(container.querySelector(`.${s.dot}`)).toBeNull();
});

it("the dot takes no inline width and does not change the source", () => {
  const { container } = render(<Field initial="https://a.com" />);
  const view = viewIn(container);
  const slot = view.contentDOM.querySelector(`.${s.dotSlot}`);
  expect(slot).not.toBeNull();
  expect(slot?.previousElementSibling?.tagName === "A" || slot?.parentElement?.querySelector("a")).toBeTruthy();
  expect(view.state.doc.toString()).toBe("https://a.com");
  expect(view.contentDOM.textContent).toBe("https://a.com");
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

it("provides native undo/redo for dot conversion", () => {
  const url = "https://example.com";
  const { container, getByRole } = render(<Field initial={url} />);
  const view = viewIn(container);
  fireEvent.click(getByRole("button", { name: "Bağlantıya ad ver" }));
  act(() => { undo(view); });
  expect(view.state.doc.toString()).toBe(url);
  act(() => { redo(view); });
  expect(view.state.doc.toString()).toBe(`[](${url})`);
});

it("continues bullet/ordered lists, exits the empty item without an extra blank line, and Shift+Enter stays in the item", () => {
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
  act(() => { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "- item" }, selection: { anchor: 6 } }); });
  key(view, "Enter", { shiftKey: true });
  expect(view.state.doc.toString()).toBe("- item\n  ");
});

it("renders file pills without fetching and keeps HTML inert in the editor", () => {
  const { container } = render(<Field initial={'<img src=x onerror=alert(1)> [Plan](https://drive.google.com/file/d/unknown) [Doc](https://team.sharepoint.com/unknown)'} />);
  const view = viewIn(container);
  expect(view.contentDOM.querySelector("img:not(.cm-widgetBuffer), [onerror]")).toBeNull();
  expect(view.contentDOM.textContent).toContain("<img src=x onerror=alert(1)>");
  expect(view.contentDOM.querySelectorAll(`.${s.file}`)).toHaveLength(2);
  expect(view.contentDOM.querySelector(`.${s.dot}`)).toBeNull();
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

it("draws the horizontal rule as a line decoration, not as short dash text", () => {
  const { container } = render(<Field initial={"a\n---\nb\n===\nc"} />);
  const view = viewIn(container);
  expect(view.contentDOM.querySelectorAll(`.cm-line.${s.rule}`)).toHaveLength(2);
  expect(view.contentDOM.textContent).not.toContain("─");
  expect(view.contentDOM.textContent).toBe("abc");
});

it("renders a fenced code block with line decorations and dim fences", () => {
  const { container } = render(<Field initial={"```\ncode\n```"} />);
  const view = viewIn(container);
  expect(view.contentDOM.querySelectorAll(`.cm-line.${s.code}`)).toHaveLength(3);
  expect(view.contentDOM.textContent).toBe("```code```");
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

it("renders completed provider aliases as file pills without fetching metadata", () => {
  const { container } = render(<LookupProvider meta={meta}>
    <MarkdownText value="[Plan](https://docs.google.com/document/d/unknown) [Sunum](https://team.sharepoint.com/unknown)" />
  </LookupProvider>);
  expect(container.querySelectorAll(`a.${s.file}`)).toHaveLength(2);
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

it("renders multi-line read-only text as block lines with headings, a full-width rule and code", () => {
  const { container } = render(<LookupProvider meta={meta}>
    <MarkdownText value={"# Başlık\n\n- bir\n- iki\n\n---\n```\nkod\n```"} />
  </LookupProvider>);
  expect(container.querySelector(`.${s.h1}`)?.textContent).toBe("Başlık");
  expect(container.querySelectorAll(`.${s.list}`)).toHaveLength(2);
  expect(container.querySelector(`.${s.rule}`)).not.toBeNull();
  expect(container.querySelector(`.${s.code}`)?.textContent).toBe("kod");
});
