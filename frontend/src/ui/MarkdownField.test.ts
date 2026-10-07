import { expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { analyze, delimiters, fileProvider, safeHref, touches, type Construct } from "./markdown";
import { renderLines } from "./markdownLines";
import { formatsAt, markdownLanguage, toggleCodeBlock, toggleInline, toggleLines } from "./markdownCommands";

const kinds = (source: string) => analyze(source).map((c) => c.kind);
const find = <K extends Construct["kind"]>(source: string, kind: K) =>
  analyze(source).find((c): c is Extract<Construct, { kind: K }> => c.kind === kind);
const visibleText = (source: string) => renderLines(source).map((l) => l.segments.map((s) => s.text).join("")).join("\n");

function stateOf(doc: string, anchor = doc.length, head = anchor): EditorState {
  return EditorState.create({ doc, selection: EditorSelection.single(anchor, head), extensions: [markdownLanguage] });
}
function apply(state: EditorState, spec: ReturnType<typeof toggleInline>): EditorState {
  if (!spec) throw new Error("command returned null");
  return state.update(spec).state;
}

it("keeps incomplete syntax literal", () => {
  for (const source of ["[isim](htt", "**bold", "*it", "[x]", "###", "### ", "#### deep", "`open"]) {
    expect(kinds(source), source).toEqual([]);
    expect(visibleText(source)).toBe(source);
  }
  expect(kinds("[](https://x.com)")).toEqual(["link"]);
  expect(kinds("[a](https://x.com)")).toEqual(["link"]);
});

it("starts a heading at its first title character, levels 1-3 only", () => {
  expect(find("### t", "heading")).toMatchObject({ level: 3, marks: [{ from: 0, to: 4 }] });
  expect(find("# a", "heading")?.level).toBe(1);
  expect(find("## a", "heading")?.level).toBe(2);
  expect(kinds("###    ")).toEqual([]);
});

it("parses nested emphasis instead of leaving it literal", () => {
  const found = analyze("**bold *italic* bold**");
  expect(found.map((c) => c.kind)).toEqual(["strong", "em"]);
  expect(visibleText("**bold *italic* bold**")).toBe("bold italic bold");
  expect(analyze("***x***").map((c) => c.kind).sort()).toEqual(["em", "strong"]);
});

it("treats === and --- as horizontal rules on their own line; no Setext headings", () => {
  expect(kinds("===")).toEqual(["rule"]);
  expect(kinds("---")).toEqual(["rule"]);
  expect(kinds("text\n===")).toEqual(["rule"]);
  expect(kinds("text\n---")).toEqual(["rule"]);
  expect(kinds("a == b")).toEqual([]);
});

it("recognises raw http(s) URLs without the trailing sentence dot, and nothing else", () => {
  expect(find("See https://example.com/path.", "url")).toMatchObject({ from: 4, to: 28 });
  expect(find("https://a.com", "url")?.href).toBe("https://a.com");
  expect(kinds("www.example.com")).toEqual([]);
  expect(kinds("mail a@b.com")).toEqual([]);
});

it("allowlists active schemes without validating destinations or stripping controls", () => {
  for (const href of ["javascript:alert(1)", "data:text/html,x", "vbscript:x", "blob:x", "file:///tmp/x", "ftp://example.com", "java\tscript:x", "https://x\u0000", "https://x\u0085"]) expect(safeHref(href)).toBeNull();
  for (const href of ["https://", "http:bad", "mailto:a@b", "/path", "../relative", "htt", "#fragment"]) expect(safeHref(href)).toBe(href);
  expect(find("[bad](javascript:alert(1))", "link")?.href).toBeUndefined();
  expect(find("[ok](mailto:a@b)", "link")?.href).toBe("mailto:a@b");
});

it("keeps raw HTML inert and parses long malformed links in bounded time", () => {
  expect(visibleText("<img src=x onerror=alert(1)>")).toBe("<img src=x onerror=alert(1)>");
  const start = performance.now();
  for (const prefix of ["[", "[label](", "[label]((", "**", "["]) {
    const source = prefix + "\\a".repeat(5000);
    expect(visibleText(source)).toBe(source);
  }
  expect(performance.now() - start).toBeLessThan(1500);
}, 3000);

it("classifies Drive/SharePoint hosts only, rejecting spoofed hosts", () => {
  expect(fileProvider("https://drive.google.com/file/d/x")).toBe("drive");
  expect(fileProvider("https://docs.google.com")).toBe("drive");
  expect(fileProvider("https://team.sharepoint.com/x")).toBe("sharepoint");
  for (const url of ["https://drive.google.com.evil.test/x", "https://drive.google.com@evil.test/", "https://evilsharepoint.com/x", "https://sharepoint.com.evil/x", "http://x.sharepoint.com.evil.test"]) {
    expect(fileProvider(url), url).toBeUndefined();
  }
});

it("never hides invisible or empty constructs", () => {
  const empty = find("[](https://x.com)", "link");
  expect(empty && delimiters(empty)).toEqual([]);
  expect(delimiters(analyze("**a**")[0] as Construct)).toHaveLength(2);
});

it("I1: no hidden delimiter ever touches the caret, for every caret position", () => {
  const corpus = ["**bold** and *it* and `c`", "# H1\n## H2\n### H3", "> quote\n- a\n- b\n1. x", "[alias](https://x.com/a(b)) tail", "[](https://x.com) ***both*** ", "a\n---\nb\n===", "**a *b* c**"];
  for (const source of corpus) {
    const constructs = analyze(source);
    for (let pos = 0; pos <= source.length; pos++) {
      for (const c of constructs) {
        const hidden = delimiters(c);
        const revealed = touches([{ from: pos, to: pos }], hidden);
        // hidden ⇔ not touching: assert the complement never leaves a touching range hidden
        for (const r of hidden) {
          const hiddenNow = !revealed;
          if (hiddenNow) expect(r.from <= pos && pos <= r.to, `${source}@${pos}`).toBe(false);
        }
      }
    }
  }
});

it("renders read-only lines without markers; block kinds and empty-alias fallbacks", () => {
  expect(visibleText("**a** [b](https://x.com) `c`")).toBe("a b c");
  const lines = renderLines("# T\n> q\n- i\n\n2. n\n---\n```\ncode\n```");
  expect(lines.map((l) => l.kind)).toEqual(["h1", "quote", "list", undefined, "list", "rule", "code"]);
  expect(lines[2]?.segments[0]?.text).toBe("• ");
  expect(lines[4]?.segments[0]?.text).toBe("2. ");
  expect(renderLines("[](https://drive.google.com/x)")[0]?.segments[0]).toMatchObject({ text: "Dosya", provider: "drive", fallback: true });
  expect(renderLines("[](https://x.com)")[0]?.segments[0]).toMatchObject({ text: "https://x.com", fallback: true });
});

it("toolbar bold: toggles on a selection, idempotently", () => {
  let state = stateOf("hello world", 0, 5);
  state = apply(state, toggleInline(state, "strong"));
  expect(state.doc.toString()).toBe("**hello** world");
  expect(state.selection.main).toMatchObject({ from: 2, to: 7 });
  expect(formatsAt(state).strong).toBe(true);
  state = apply(state, toggleInline(state, "strong"));
  expect(state.doc.toString()).toBe("hello world");
  expect(state.selection.main).toMatchObject({ from: 0, to: 5 });
});

it("toolbar bold: partial unwrap splits the span; bold+italic combine and separate", () => {
  let state = stateOf("**abcdef**", 4, 6);
  state = apply(state, toggleInline(state, "strong"));
  expect(state.doc.toString()).toBe("**ab**cd**ef**");
  state = stateOf("word", 0, 4);
  state = apply(state, toggleInline(state, "strong"));
  state = apply(state, toggleInline(state, "em"));
  expect(state.doc.toString()).toBe("***word***");
  expect(formatsAt(state)).toMatchObject({ strong: true, em: true });
  state = apply(state, toggleInline(state, "strong"));
  expect(state.doc.toString()).toBe("*word*");
});

it("toolbar bold: partly bold selection becomes fully bold without doubling stars", () => {
  let state = stateOf("**ab**cd", 0, 8);
  state = apply(state, toggleInline(state, "strong"));
  expect(state.doc.toString()).toBe("**abcd**");
});

it("toolbar bold: collapsed caret opens a pair, then steps out, then removes an empty pair", () => {
  let state = stateOf("x ", 2);
  state = apply(state, toggleInline(state, "strong"));
  expect(state.doc.toString()).toBe("x ****");
  expect(state.selection.main.head).toBe(4);
  expect(formatsAt(state).strong).toBe(true); // `****` ağaçta yok ama "açık" durumdur
  state = apply(state, toggleInline(state, "strong"));
  expect(state.doc.toString()).toBe("x ");
  expect(state.selection.main.head).toBe(2);
});

it("toolbar bold: stepping out of a typed span", () => {
  let state = stateOf("**ab**", 4);
  state = apply(state, toggleInline(state, "strong"));
  expect(state.selection.main.head).toBe(6);
  state = stateOf("**abcd**", 4);
  state = apply(state, toggleInline(state, "strong"));
  expect(state.doc.toString()).toBe("**ab****cd**");
  expect(state.selection.main.head).toBe(6);
});

it("line toggles are idempotent, multi-line, and replace instead of stacking", () => {
  let state = stateOf("one\ntwo", 0, 7);
  state = apply(state, toggleLines(state, "bullet"));
  expect(state.doc.toString()).toBe("- one\n- two");
  state = apply(state, toggleLines(state, "ordered"));
  expect(state.doc.toString()).toBe("1. one\n2. two");
  state = apply(state, toggleLines(state, "ordered"));
  expect(state.doc.toString()).toBe("one\ntwo");
  state = stateOf("title", 2);
  state = apply(state, toggleLines(state, "h2"));
  state = apply(state, toggleLines(state, "h2"));
  expect(state.doc.toString()).toBe("title");
  state = apply(state, toggleLines(state, "h1"));
  state = apply(state, toggleLines(state, "h3"));
  expect(state.doc.toString()).toBe("### title");
  state = apply(state, toggleLines(state, "quote"));
  expect(state.doc.toString()).toBe("> ### title");
  expect(formatsAt(state)).toMatchObject({ quote: true });
});

it("code block toggles around the selected lines", () => {
  let state = stateOf("a\nb", 0, 3);
  state = apply(state, toggleCodeBlock(state));
  expect(state.doc.toString()).toBe("```\na\nb\n```");
  state = stateOf(state.doc.toString(), 5);
  expect(formatsAt(state).fence).toBe(true);
  state = apply(state, toggleCodeBlock(state));
  expect(state.doc.toString()).toBe("a\nb");
});
