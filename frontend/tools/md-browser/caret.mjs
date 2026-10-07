import { chromium } from "playwright";
const BASE = process.env.MD_HARNESS ?? "http://localhost:5199/tools/md-browser/index.html";
const b = await chromium.launch({ args: ["--no-sandbox"] });
let bad = 0;
for (const url of ["", "dialog=1&"]) for (const z of [1, 1.5, 2, 3, 5]) {
  const ctx = await b.newContext({ viewport: { width: Math.round(900 / z), height: Math.round(700 / z) }, deviceScaleFactor: z });
  const page = await ctx.newPage();
  await page.goto(`${BASE}?${url}value=`); await page.waitForSelector(".cm-content"); await page.click(".cm-content"); await page.waitForTimeout(150);
  const m = await page.evaluate(() => {
    const cur = document.querySelector(".cm-cursor"); const r = cur.getBoundingClientRect();
    const ph = document.querySelector(".cm-placeholder"); const g = document.createRange(); g.selectNodeContents(ph); const p = g.getBoundingClientRect();
    return { cTop: r.top, cBot: r.bottom, cLeft: r.left, pTop: p.top, pBot: p.bottom, pLeft: p.left, native: getComputedStyle(document.querySelector(".cm-line")).caretColor };
  });
  const d = Math.max(Math.abs(m.cTop - m.pTop), Math.abs(m.cBot - m.pBot), Math.abs(m.cLeft - m.pLeft));
  if (d > 2) bad++;
  console.log(`${d <= 2 ? "PASS" : "FAIL"} ${url} zoom=${z} Δ=${d.toFixed(2)} cursor=[${m.cTop.toFixed(1)},${m.cBot.toFixed(1)}]@${m.cLeft.toFixed(1)} placeholder=[${m.pTop.toFixed(1)},${m.pBot.toFixed(1)}]@${m.pLeft.toFixed(1)} nativeCaret=${m.native}`);
  if (z === 3 && url === "") await page.locator(".cm-editor").screenshot({ path: process.env.MD_SHOT ?? "/tmp/md-caret-empty.png" });
  await page.keyboard.type("d"); await page.waitForTimeout(100);
  const t = await page.evaluate(() => { const cur = document.querySelector(".cm-cursor").getBoundingClientRect(); const tn = document.querySelector(".cm-line").firstChild; const rg = document.createRange(); rg.selectNodeContents(tn); const q = rg.getBoundingClientRect(); return [cur.top - q.top, cur.bottom - q.bottom, cur.left - q.right]; });
  if (Math.abs(t[0]) > 3 || Math.abs(t[1]) > 3 || Math.abs(t[2]) > 2) { bad++; console.log("FAIL typed d", JSON.stringify(t)); }
  await ctx.close();
}
await b.close(); process.exit(bad ? 1 : 0);
