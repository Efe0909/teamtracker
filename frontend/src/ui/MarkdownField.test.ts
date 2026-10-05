import { expect, it } from "vitest";
import { continueList, fileProvider, parseMarkdownParts, safeHref, visiblePosition } from "./markdown";

const visible = (source: string) => parseMarkdownParts(source).filter((p) => !p.hidden);

it("keeps incomplete syntax literal and renders complete aliases", () => {
  expect(visible("[](htt)")).toEqual([expect.objectContaining({ text: "htt", kind: "link", href: "htt", fallback: true, from: 1, to: 1 })]);
  expect(visible("[](https://example.com").map((p) => p.text).join("")).toBe("[](https://example.com");
  expect(visible("**bold").map((p) => p.text).join("")).toBe("**bold");
  expect(visible("[alias](madeup:target)")[0]).toMatchObject({ text: "alias", kind: "link" });
  expect(visible("[alias](madeup:target)")[0]?.href).toBeUndefined();
});

it("parses bounded long malformed escaped links without exponential backtracking", () => {
  const start = performance.now();
  for (const prefix of ["[", "[label](", "[label](("]) {
    const source = prefix + "\\a".repeat(2000);
    expect(visible(source).map((p) => p.text).join("")).toBe(source);
  }
  expect(performance.now() - start).toBeLessThan(1000);
}, 1500);

it("keeps unsupported nested emphasis wholly literal and strips punctuation after unmatched URL parentheses", () => {
  for (const source of ["**bold *italic* bold**", "**bold _italic_ bold**", "**bold *incomplete"]) {
    expect(visible(source).map((p) => p.text).join("")).toBe(source);
    expect(parseMarkdownParts(source).some((p) => p.hidden)).toBe(false);
  }
  expect(visible("https://example.com/path!)")[0]).toMatchObject({ text: "https://example.com/path", href: "https://example.com/path" });
});

it("hides only delimiter source spans, never duplicated visible text", () => {
  const parts = parseMarkdownParts("**bold** [alias](url)");
  expect(parts.filter((p) => p.hidden).map((p) => [p.from, p.to])).toEqual([[0, 2], [6, 8], [9, 10], [15, 21]]);
  expect(parts.filter((p) => !p.hidden).map((p) => p.text).join("")).toBe("bold alias");
});

it("keeps empty headings literal until the first title character", () => {
  expect(visible("### ")).toEqual([{ text: "### ", from: 0, to: 4 }]);
  expect(visible("### t")).toEqual([{ text: "t", from: 4, to: 5, kind: "heading" }]);
});

it("renders formatting and raw URLs without task checkboxes", () => {
  const kinds = visible("**bold**\n*italic*\n> quote\n===\n- bullet\n2. ordered\n@user").flatMap((p) => p.kind === undefined ? [] : [p.kind]);
  expect(kinds).toEqual(["strong", "em", "quote", "rule", "list", "list", "mention"]);
  expect(visible("- [x] done")).toEqual([{ text: "- [x] done", from: 0, to: 10 }]);
  expect(visible("- [ ] todo")).toEqual([{ text: "- [ ] todo", from: 0, to: 10 }]);
  expect(visible("See https://example.com/path.")).toEqual([
    expect.objectContaining({ text: "See " }),
    expect.objectContaining({ text: "https://example.com/path", rawUrl: true, href: "https://example.com/path" }),
    expect.objectContaining({ text: "." }),
  ]);
});

it("allowlists active schemes without validating destinations or stripping controls", () => {
  for (const href of ["javascript:alert(1)", "data:text/html,x", "vbscript:x", "blob:x", "file:///tmp/x", "ftp://example.com", "java\tscript:x", "https://x\u0000", "https://x\u0085"]) expect(safeHref(href)).toBeNull();
  for (const href of ["https://", "http:bad", "mailto:a@b", "/path", "../relative", "htt", "#fragment"]) expect(safeHref(href)).toBe(href);
  expect(visible("[bad](javascript:alert(1))")[0]).toMatchObject({ text: "bad", kind: "link" });
  expect(visible("[bad](javascript:alert(1))")[0]?.href).toBeUndefined();
  expect(visible("<img src=x onerror=alert(1)>").map((p) => p.text).join("")).toBe("<img src=x onerror=alert(1)>");
});

it("maps hidden delimiter interiors to visible boundaries", () => {
  const parts = parseMarkdownParts("**word** [name](https://example.com)");
  expect(visiblePosition(parts, 7, 1)).toBe(8);
  expect(visiblePosition(parts, 7, -1)).toBe(6);
  expect(visiblePosition(parts, 1, 1)).toBe(2);
  expect(visiblePosition(parts, 1, -1)).toBe(0);
  expect(visiblePosition(parts, 13, 0)).toBe(13);
  expect(visiblePosition(parts, 20, 1)).toBe(36);
  expect(visiblePosition(parts, 20, -1)).toBe(14);
});

it("continues bullets and increments ordered markers, then exits an empty item without another newline", () => {
  expect(continueList("- item", 6)).toEqual({ from: 6, to: 6, insert: "\n- ", caret: 9 });
  expect(continueList("3) item", 7)).toEqual({ from: 7, to: 7, insert: "\n4) ", caret: 11 });
  expect(continueList("- item\n- ", 9)).toEqual({ from: 7, to: 9, insert: "", caret: 7 });
  expect(continueList("3. item\n4. ", 11)).toEqual({ from: 8, to: 11, insert: "", caret: 8 });
  expect(continueList("plain", 5)).toBeNull();
  expect(continueList("- [x] task", 10)).toBeNull();
});

it("classifies Drive and SharePoint by host regex only", () => {
  expect(fileProvider("https://drive.google.com/file/d/no-check")).toBe("drive");
  expect(fileProvider("https://docs.google.com/document/d/no-check")).toBe("drive");
  expect(fileProvider("https://team.sharepoint.com/a")).toBe("sharepoint");
  for (const raw of ["https://drive.google.com.evil.test/a", "https://evil.test/drive.google.com", "https://user@docs.google.com/a", "https://notsharepoint.com/a"]) expect(fileProvider(raw)).toBeUndefined();
  expect(visible("[Plan](https://docs.google.com/document/d/a)")[0]).toMatchObject({ text: "Plan", provider: "drive" });
  expect(visible("https://docs.google.com/document/d/a")[0]?.provider).toBeUndefined();
});
