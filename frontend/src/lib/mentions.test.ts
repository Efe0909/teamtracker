// Katlama Rust `mentions::handle` testleriyle AYNI ornekler: iki taraf
// ayrisirsa davet ve vurgu farkli kisiyi gosterir.

import { expect, it } from "vitest";
import { handle, mentionsMe } from "./mentions";

it("Rust ile ayni katlama", () => {
  expect(handle("Ayşe Yılmaz")).toBe("ayse-yilmaz");
  expect(handle("İlker Öztürk")).toBe("ilker-ozturk");
  expect(handle("Çağrı  Işık")).toBe("cagri-isik");
});

it("beni anan govde: ad ya da grup", () => {
  expect(mentionsMe("@ayse-yilmaz bakar misin", "Ayşe Yılmaz")).toBe(true);
  expect(mentionsMe("@here toplanti", "Efe")).toBe(true);
  expect(mentionsMe("efe@x.org yazdi", "Efe")).toBe(false);
});
