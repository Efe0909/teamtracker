import { chromium } from "playwright";
const BASE = process.env.MD_HARNESS ?? "http://localhost:5199/tools/md-browser/index.html";
const b = await chromium.launch({ args: ["--no-sandbox"] });
let bad = 0;
for (const [zoom, scheme] of [[1, "light"], [1, "dark"], [1.25, "light"], [1.5, "dark"], [2, "light"], [2, "dark"], [3, "light"]]) {
  const ctx = await b.newContext({ viewport: { width: Math.round(900 / zoom), height: Math.round(700 / zoom) }, deviceScaleFactor: zoom, colorScheme: scheme });
  const page = await ctx.newPage();
  await page.goto(`${BASE}?dialog=1`);
  await page.waitForSelector(".cm-content");
  await page.click(".cm-content");
  const m = await page.evaluate(() => {
    const v = window.__view(); const c = v.coordsAtPos(0);
    const ph = v.dom.querySelector(".cm-placeholder");
    const rg = document.createRange(); rg.selectNodeContents(ph); const tr = rg.getBoundingClientRect();
    const cs = getComputedStyle(ph), cl = getComputedStyle(v.dom.querySelector(".cm-line"));
    return { cTop: c.top, cBot: c.bottom, pTop: tr.top, pBot: tr.bottom, phFont: cs.fontSize + "/" + cs.lineHeight, lineFont: cl.fontSize + "/" + cl.lineHeight, va: cs.verticalAlign };
  });
  const d = Math.max(Math.abs(m.cTop - m.pTop), Math.abs(m.cBot - m.pBot));
  if (d > 2) bad++;
  console.log(`${d <= 2 ? "PASS" : "FAIL"} zoom=${zoom} ${scheme} Δ=${d.toFixed(2)} caret=[${m.cTop.toFixed(1)},${m.cBot.toFixed(1)}] placeholder=[${m.pTop.toFixed(1)},${m.pBot.toFixed(1)}] ph=${m.phFont} line=${m.lineFont} va=${m.va}`);
  if (zoom === 1 && scheme === "light") await page.screenshot({ path: process.env.MD_SHOT ?? "/tmp/md-dialog-empty.png" });
  await ctx.close();
}
await b.close(); process.exit(bad ? 1 : 0);
