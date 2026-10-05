import { expect, it } from "vitest";
import { parseMarkdownParts } from "./MarkdownField";

it("renders links only after closing parentheses", () => {
  expect(parseMarkdownParts("[](htt)")).toEqual([
    { text: "[](htt)", hidden: true },
    { text: "htt", kind: "link", href: "htt" },
  ]);
  expect(parseMarkdownParts("[](htt")).toEqual([{ text: "[](htt" }]);
});

it("keeps empty headings literal until title starts", () => {
  expect(parseMarkdownParts("### ")).toEqual([{ text: "### " }]);
  expect(parseMarkdownParts("### title")).toEqual([
    { text: "### ", hidden: true },
    { text: "title", kind: "heading" },
  ]);
});

it("renders the requested formatting without task lists", () => {
  const kinds = parseMarkdownParts("**bold**\n*italic*\n> quote\n===\n- bullet\n2. ordered\n@user")
    .flatMap((p) => p.kind === undefined ? [] : [p.kind]);
  expect(kinds).toEqual(["strong", "em", "quote", "rule", "list", "list", "mention"]);
});

it("does not create task checkboxes", () => {
  expect(parseMarkdownParts("- [x] done")).toEqual([{ text: "- [x] done" }]);
  expect(parseMarkdownParts("- [ ] todo")).toEqual([{ text: "- [ ] todo" }]);
});

it("blocks executable URL schemes", () => {
  expect(parseMarkdownParts("[bad](javascript:alert(1))")).toEqual([
    { text: "[bad](javascript:alert(1))", hidden: true },
    { text: "bad" },
  ]);
});
