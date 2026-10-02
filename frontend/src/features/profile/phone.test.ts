import { expect, it } from "vitest";
import { formatPhone } from "./ProfileDialog";

it("telefonu 0532 000 00 00 biciminde yazar", () => {
  expect(formatPhone("")).toBe("0");
  expect(formatPhone("05")).toBe("05");
  expect(formatPhone("05321")).toBe("0532 1");
  expect(formatPhone("05321112233")).toBe("0532 111 22 33");
  // kullanicinin boslugu/tiresi yok sayilir, fazlasi kesilir
  expect(formatPhone("0532 ")).toBe("0532");
  expect(formatPhone("0532-111-22-339")).toBe("0532 111 22 33");
  // 0'siz yazilan ve +90'li yapistirilan
  expect(formatPhone("5321112233")).toBe("0532 111 22 33");
  expect(formatPhone("+90 532 111 22 33")).toBe("0532 111 22 33");
  // bas 0 silinemez
  expect(formatPhone("00")).toBe("0");
});
