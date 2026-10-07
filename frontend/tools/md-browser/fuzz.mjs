import { chromium } from "playwright";
const BASE = process.env.MD_HARNESS ?? "http://localhost:5199/tools/md-browser/index.html";
const b = await chromium.launch({ args: ["--no-sandbox"] });
const TOK = ["**", "*", "`", "[", "]", "(", ")", "https://a.com", " ", "word", "kelime", "# ", "## ", "- ", "1. ", "> ", "---", "===", "@se", "_", "```", "\\*", "<b>"];
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const mk = () => { const lines = 2 + Math.floor(rnd() * 4); const out = []; for (let l = 0; l < lines; l++) { let s = ""; const n = 2 + Math.floor(rnd() * 7); for (let i = 0; i < n; i++) s += TOK[Math.floor(rnd() * TOK.length)]; out.push(s.slice(0, 40)); } return out.join("\n"); };
const ctx = await b.newContext({ viewport: { width: 700, height: 900 } });
const page = await ctx.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(e.message));
let bad = 0, N = 60;
for (let k = 0; k < N; k++) {
  const doc = mk();
  await page.goto(`${BASE}?value=${encodeURIComponent(doc)}`);
  await page.waitForSelector(".cm-content");
  await page.click(".cm-content");
  await page.keyboard.press("Control+Home");
  const snap = () => page.evaluate(() => { const v = window.__view(); return { h: v.state.selection.main.head, ls: [...document.querySelectorAll(".cm-content .cm-line")].map((l) => Math.round(l.getBoundingClientRect().height * 10) / 10), n: v.state.doc.length }; });
  const first = await snap();
  let prev = first.h, problem = null;
  for (let i = 0; i < first.n && !problem; i++) {
    await page.keyboard.press("ArrowRight");
    const s = await snap();
    if (s.h !== prev + 1) problem = `ArrowRight takıldı/atladı @${i}: ${prev}→${s.h}`;
    else if (JSON.stringify(s.ls) !== JSON.stringify(first.ls)) problem = `satır yüksekliği değişti @${i}: ${first.ls} → ${s.ls}`;
    prev = s.h;
  }
  for (let i = 0; i < first.n && !problem; i++) {
    await page.keyboard.press("ArrowLeft");
    const s = await snap();
    if (s.h !== prev - 1) problem = `ArrowLeft takıldı/atladı @${i}: ${prev}→${s.h}`;
    prev = s.h;
  }
  if (problem) { bad++; console.log("FAIL", JSON.stringify(doc), problem); }
}
console.log(`${N - bad}/${N} belge temiz; sayfa hataları: ${errors.length}`, errors.slice(0, 3));
await b.close(); process.exit(bad || errors.length ? 1 : 0);
