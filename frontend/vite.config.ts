/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Gelistirme: /api Rust'a (cargo run, 127.0.0.1:8000). Host basligi KORUNUR
// (changeOrigin yok): Google donus adresi ve cerezler istegin host'una gore.
// Yayinda ayni isi nginx yapiyor (~/nix modules/nginx/ekiptakip.nix).
export default defineConfig({
  plugins: [react()],
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
