/// <reference types="node" />
// R1-F01: PWA kurulumu — manifest.json + index.html'deki iOS meta
// (spec/90-geri-tasima.md, 003d86a). Diskteki dosyalari dogrudan okur;
// bilesen agacina girmez.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

interface ManifestIcon {
  src: string;
  sizes: string;
}

const manifest = JSON.parse(readFileSync(path.resolve("public/manifest.json"), "utf8")) as {
  name: string;
  display: string;
  start_url: string;
  icons: ManifestIcon[];
};

describe("PWA kurulumu (R1-F01)", () => {
  it("standalone acilir, kok kapsaminda", () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
  });

  it("192 ve 512 ikon manifestte VE diskte var", () => {
    const sizes = manifest.icons.map((i) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    for (const icon of manifest.icons) {
      expect(existsSync(path.resolve("public", icon.src.replace(/^\//, "")))).toBe(true);
    }
  });

  it("index.html manifesti baglar ve iOS meta'yi tasir", () => {
    const html = readFileSync(path.resolve("index.html"), "utf8");
    expect(html).toMatch(/<link rel="manifest" href="\/manifest\.json"/);
    expect(html).toMatch(/apple-mobile-web-app-capable" content="yes"/);
  });
});
