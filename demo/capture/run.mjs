// Yuruyus yakalayici. Kullanim:
//   node demo/capture/run.mjs [--only giris,gorevler] [--out demo/guide]
// Onkosul: `demo/stack.sh up` (API + Vite) ve `demo/stack.sh seed` (tohumlu veritabani).
// Her calistirmadan once `demo/stack.sh restore` ile ayni durumdan baslanir.

import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Recorder, loadPlaywright, openUser } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const only = arg("only", "")?.split(",").filter(Boolean);
// Kismi calistirma (`--only`) tam rehberin ustune yazmasin: varsayilan cikti `out/dev`; tam kosu `demo/guide`.
const out = resolve(arg("out", join(here, "..", only.length > 0 ? join("out", "dev") : "guide")));

const files = readdirSync(join(here, "chapters")).filter((f) => f.endsWith(".mjs")).sort();
const chapters = [];
for (const f of files) chapters.push((await import(pathToFileURL(join(here, "chapters", f)))).default);

const { chromium } = loadPlaywright();
// Tarayicinin kendi saat/tarih kutulari (input[type=time]) Turkce biciminde (24 saat) gorunsun:
// yalniz `--lang` yetmiyor, surecin yerel ayari da Turkce olmali.
const browser = await chromium.launch({
  args: ["--lang=tr-TR"],
  env: { ...process.env, LANGUAGE: "tr_TR:tr", LC_ALL: "tr_TR.UTF-8", LANG: "tr_TR.UTF-8" },
});
const R = new Recorder(out);
const open = (name, opts) => openUser(browser, name, opts);
let failed = 0;
for (const ch of chapters) {
  if (only.length > 0 && !only.includes(ch.id)) continue;
  R.chapter(ch);
  try {
    await ch.run({ R, browser, open });
  } catch (e) {
    failed += 1;
    console.error(`  !! ${ch.id}: ${e.message}`);
  }
}
R.write();
await browser.close();
console.log(`\n${R.steps.length} adim -> ${out}`);
if (failed > 0) process.exit(1);
