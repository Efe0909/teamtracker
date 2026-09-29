/// <reference types="node" />
// tokens.css kontrast sozlesmesi (spec/16 §3.4): renk degistiren biri WCAG
// esigini sessizce kiramasin. Metin >= 4.5:1, denetim cercevesi >= 3:1
// (WCAG 1.4.11). Iki tema da ayri ayri olculur.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve("src/tokens.css"), "utf8");
const darkAt = css.indexOf("@media (prefers-color-scheme: dark)");

function tokens(block: string): Map<string, string> {
  return new Map([...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,6})\b/g)].map((m) => [m[1] ?? "", m[2] ?? ""]));
}
const light = tokens(css.slice(0, darkAt));
// Koyu tema yalniz ezdigi token'lari yazar; gerisi acik temadan gelir.
const dark = new Map([...light, ...tokens(css.slice(darkAt))]);

function lum(hex: string): number {
  let h = hex.slice(1);
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

// [on, zemin, esik]
const PAIRS: [string, string, number][] = [
  ["txt", "panel", 4.5],
  ["dim", "panel", 4.5],
  ["dim", "bg", 4.5],
  ["dim", "tint", 4.5],
  ["acc-strong", "panel", 4.5],
  ["acc-strong", "bg", 4.5],
  ["on-acc", "acc-fill", 4.5],
  ["on-acc", "acc-fill-hover", 4.5],
  ["err-text", "err-bg", 4.5],
  ["err-text", "panel", 4.5],
  ["warn-text", "warn-bg", 4.5],
  ["ok-text", "ok-bg", 4.5],
  ["info-text", "info-bg", 4.5],
  ["line-field", "panel", 3],
  ["line-field", "panel2", 3],
  ["line-field", "bg", 3],
];

describe.each([
  ["acik", light],
  ["koyu", dark],
] as const)("%s tema", (_, t) => {
  it.each(PAIRS)("--%s / --%s >= %s", (fg, bg, min) => {
    const a = t.get(fg);
    const b = t.get(bg);
    expect(a, `--${fg} tanimli`).toBeDefined();
    expect(b, `--${bg} tanimli`).toBeDefined();
    expect(ratio(a ?? "", b ?? "")).toBeGreaterThanOrEqual(min);
  });
});
