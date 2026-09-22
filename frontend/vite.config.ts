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
  build: { sourcemap: false },
  test: { environment: "jsdom" },
});
