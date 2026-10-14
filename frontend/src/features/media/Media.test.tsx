// Ekler (spec/83): gorsel kucuk resimle, belge ve metin indirme cipiyle cizilir.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Attachment } from "../../api/types";
import { Attachments, formatBytes } from "./Media";

const base: Omit<Attachment, "id" | "mime" | "kind" | "byte_size" | "original_name"> = {
  width: null, height: null, deleted: false, can_delete: false, can_tag: false, tags: [],
};

describe("Attachments", () => {
  it("belgeyi rozet, ad ve boyutla indirme bağlantısı olarak çizer", () => {
    render(<Attachments items={[
      { ...base, id: "a1", mime: "application/pdf", kind: "document", byte_size: 12_800, original_name: "fatura.pdf" },
      { ...base, id: "a2", mime: "text/markdown", kind: "text", byte_size: 300, original_name: "gündem.md" },
    ]} />);
    const pdf = screen.getByRole("link", { name: /fatura\.pdf/ });
    expect(pdf.getAttribute("href")).toBe("/api/attachments/a1");
    expect(pdf.textContent).toContain("PDF");
    expect(pdf.textContent).toContain("12,5 KB");
    expect(screen.getByRole("link", { name: /gündem\.md/ }).textContent).toContain("MD");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("silinmiş belge için dosya mezar taşı", () => {
    render(<Attachments items={[
      { ...base, id: "a1", mime: "application/pdf", kind: "document", byte_size: 1, original_name: "x.pdf", deleted: true },
    ]} />);
    expect(screen.getByText("(dosya silindi)")).toBeTruthy();
  });

  it("boyut biçimi", () => {
    expect(formatBytes(2 * 1024 * 1024)).toBe("2 MB");
    expect(formatBytes(1536)).toBe("1,5 KB");
  });
});
