/// <reference types="node" />
// Rust'in dondurdugu her hata kodu ERRORS'ta olmali. Eksik kod istemcide
// "internal"a duser ve kullanici "Sunucuda bir hata oldu" gorur
// (invalid_phone boyle kacmisti). Backend kaynagini dogrudan tarar.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { isErrorCode } from "./errors";

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith(".rs") ? [path.join(dir, e.name)] : []);
}

it("backend'in her hata kodunun Turkce iletisi var", () => {
  const codes = new Set<string>();
  for (const f of walk(path.resolve("../backend/src"))) {
    const src = readFileSync(f, "utf8");
    // AppError::BadRequest("x") / Conflict("x") ve common::text(.., "x")
    for (const m of src.matchAll(/AppError::\w+\("([a-z_]+)"\)|common::text\([^;]*?"([a-z_]+)"\)/g)) codes.add(m[1] ?? m[2] ?? "");
  }
  expect(codes.size).toBeGreaterThan(20);
  expect([...codes].filter((c) => !isErrorCode(c))).toEqual([]);
});
