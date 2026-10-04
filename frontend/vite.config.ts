/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

// Surum tek kaynaktan: package.json (backend/manifest.json ve Cargo.toml ile
// ayni olmak zorunda, `cargo test` denetler). Oturumsuz sayfalar (karsilama,
// home.html) /api/meta'ya erisemez; surumu derlemede gomer.
const { version } = JSON.parse(readFileSync("./package.json", "utf8")) as { version: string };

// Gelistirme: /api Rust'a (cargo run, 127.0.0.1:8000). Host basligi KORUNUR
// (changeOrigin yok): Google donus adresi ve cerezler istegin host'una gore.
// Yayinda ayni isi nginx yapiyor (~/nix modules/nginx/ekiptakip.nix).
export default defineConfig({
  plugins: [
    react(),
    // JS'siz statik sayfalar (home.html): `%APP_VERSION%` derlemede doldurulur.
    { name: "app-version-html", transformIndexHtml: (html) => html.replaceAll("%APP_VERSION%", version) },
  ],
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
  // home/privacy/terms.html: apex'in JS'siz statik sayfalari (Google marka
  // dogrulamasi ham HTML okur). nginx yalniz polonyum.com'da `/`, `/privacy`,
  // `/terms`'u bunlara verir; gelistirmede /home.html, /privacy.html ile ac.
  build: {
    sourcemap: false,
    rollupOptions: { input: ["index.html", "home.html", "privacy.html", "terms.html"] },
  },
  test: { environment: "jsdom", setupFiles: ["./src/test-setup.ts"] },
});
