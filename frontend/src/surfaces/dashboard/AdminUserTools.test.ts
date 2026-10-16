// Toplu kisi ekleme: yapistirilan metnin ayrisimi ve e-postadan ad onerisi.

import { expect, it } from "vitest";
import { nameFromEmail, parseBatch, scopeLabel } from "./AdminUserTools";

it("e-postadan ad onerisi: nokta/tire ayirir, her kelimeyi buyutur", () => {
  expect(nameFromEmail("ayse.yilmaz@ornek.com")).toBe("Ayse Yilmaz");
  expect(nameFromEmail("bora-demir@x.org")).toBe("Bora Demir");
});

it("satir, virgul ve 'Ad <e-posta>' biçimlerini ayrıştırır", () => {
  expect(parseBatch("a@x.com\nBora Demir <bora@x.com>, cem@x.com; d@x.com")).toEqual([
    { email: "a@x.com", name: "" },
    { email: "bora@x.com", name: "Bora Demir" },
    { email: "cem@x.com", name: "" },
    { email: "d@x.com", name: "" },
  ]);
});

it("kapsam etiketi: ' — ' öncesi kısa ad", () => {
  expect(scopeLabel("edit_nodes")).toBe("Yapıyı düzenle");
  expect(scopeLabel("bilinmeyen")).toBe("bilinmeyen");
});
