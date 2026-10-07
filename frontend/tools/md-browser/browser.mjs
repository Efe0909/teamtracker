import { chromium } from "playwright";
const BASE = process.env.MD_HARNESS ?? "http://localhost:5199/tools/md-browser/index.html";

const results = [];
const report = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };

const browser = await chromium.launch({ args: ["--no-sandbox"] });

async function open(value = "", { dsf = 1, scheme = "light", zoom = 1 } = {}) {
  // Tarayıcı yakınlaştırması = DPR artışı + CSS piksel görünüm alanı daralması.
  const ctx = await browser.newContext({ viewport: { width: Math.round(700 / zoom), height: Math.round(900 / zoom) }, deviceScaleFactor: dsf * zoom, colorScheme: scheme });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.goto(`${BASE}?value=${encodeURIComponent(value)}`);
  await page.waitForSelector(".cm-content");
  return { ctx, page };
}
const head = (page) => page.evaluate(() => window.__view().state.selection.main.head);
const lines = (page) => page.evaluate(() => [...document.querySelectorAll(".cm-content .cm-line")].map((l) => { const r = l.getBoundingClientRect(); return [Math.round(r.top * 100) / 100, Math.round(r.height * 100) / 100]; }));
const setSel = (page, anchor, headPos = anchor) => page.evaluate(([a, h]) => { const v = window.__view(); v.dispatch({ selection: { anchor: a, head: h } }); }, [anchor, headPos]);

// --- 1. dikey kararlılık + imleç ilerlemesi ----------------------------
const DOC = [
  "# Başlık bir", "## Başlık iki", "### Başlık üç", "",
  "Normal **kalın** ve *italik* ve ***ikisi*** ve `kod` burada.",
  "[Ad](https://example.com/a(b)) ve https://example.com/yol ve [](https://x.com/z)",
  "> alıntı satırı", "- madde bir", "- madde iki", "1. sıralı", "2. ikinci", "",
  "---", "===", "", "```", "kod satırı", "```", "Son satır @selin",
].join("\n");
{
  const { ctx, page } = await open(DOC);
  await page.click(".cm-content");
  await page.keyboard.press("Control+Home");
  const base = await lines(page);
  const n = await page.evaluate(() => window.__view().state.doc.length);
  let maxDrift = 0, worst = -1, stuck = 0, prev = await head(page);
  let nonUnit = 0;
  for (let i = 0; i < n; i++) {
    await page.keyboard.press("ArrowRight");
    const h = await head(page);
    if (h === prev) stuck++; else if (h !== prev + 1) nonUnit++;
    prev = h;
    const now = await lines(page);
    if (now.length !== base.length) { maxDrift = Infinity; worst = i; break; }
    // Satır YÜKSEKLİKLERİ ve satır araları sabit olmalı (üst sınır: ilk satıra göre göreli).
    for (let k = 0; k < now.length; k++) {
      const d = Math.abs(now[k][1] - base[k][1]) + Math.abs((now[k][0] - now[0][0]) - (base[k][0] - base[0][0]));
      if (d > maxDrift) { maxDrift = d; worst = i; }
    }
  }
  report("1a dikey kayma yok (ArrowRight ile tüm belge)", maxDrift <= 0.5, `maxDrift=${maxDrift.toFixed(2)}px @adım ${worst}/${n}`);
  report("1b imleç tuzağı yok: her ok tam 1 kaynak karakter ilerler", stuck === 0 && nonUnit === 0, `takılma=${stuck} birim-dışı=${nonUnit}`);
  // geri yürü
  let back = 0; let p = await head(page);
  for (let i = 0; i < n; i++) { await page.keyboard.press("ArrowLeft"); const h = await head(page); if (h !== p - 1) back++; p = h; }
  report("1c ArrowLeft ile geri de takılmaz", back === 0, `sorun=${back}`);
  await ctx.close();
}

// --- 2. yatay çizgi tam genişlik, başlık boyutları ----------------------
{
  const { ctx, page } = await open("metin\n---\nbaşka\n===\n# a\n## b\n### c\nd");
  const info = await page.evaluate(() => {
    const rules = [...document.querySelectorAll(".cm-line")].filter((l) => getComputedStyle(l, "::after").content === '""');
    const out = rules.map((l) => { const cs = getComputedStyle(l, "::after"); const lr = l.getBoundingClientRect(); return { line: lr.width, after: parseFloat(cs.width), pad: parseFloat(getComputedStyle(l).paddingLeft), border: cs.borderTopWidth }; });
    const sizes = ["h1", "h2", "h3"].map((_, i) => 0);
    const fs = [...document.querySelectorAll(".cm-line")].map((l) => parseFloat(getComputedStyle(l).fontSize));
    return { out, fs };
  });
  const okRule = info.out.length === 2 && info.out.every((r) => Math.abs(r.after - (r.line - 2 * r.pad)) <= 1.5);
  report("2a yatay çizgi satırın kullanılabilir genişliğini kaplar (---, ===)", okRule, JSON.stringify(info.out));
  const [a, b, c, d, e, f, g, h] = info.fs;
  report("2b H1 > H2 > H3 > gövde yazı boyutu", f > g && e > f && g > h, `h1=${f} h2=${g} h3=${h}`.replace(/h1=\S+/, `h1=${e}`));
  await ctx.close();
}

// --- 3. ham URL yazarken geometri + nokta ------------------------------
{
  const { ctx, page } = await open("");
  await page.click(".cm-content");
  const steps = ["https://a", ".", "com"];
  let ok = true; let detail = [];
  let baseTop = null;
  for (const chunk of steps) {
    await page.keyboard.type(chunk);
    const m = await page.evaluate(() => {
      const v = window.__view(); const h = v.state.selection.main.head;
      const c = v.coordsAtPos(h);
      const line = v.dom.querySelector(".cm-line").getBoundingClientRect();
      // son metin düğümünün sağ kenarı
      const walker = document.createTreeWalker(v.contentDOM, NodeFilter.SHOW_TEXT);
      let last = null; while (walker.nextNode()) last = walker.currentNode;
      const r = document.createRange(); r.setStart(last, last.length); r.setEnd(last, last.length);
      const rr = last.length ? (() => { const q = document.createRange(); q.setStart(last, last.length - 1); q.setEnd(last, last.length); return q.getBoundingClientRect(); })() : null;
      const slot = v.dom.querySelector("[class*=dotSlot]");
      return { caretLeft: c.left, glyphRight: rr?.right, lineH: line.height, top: c.top, slotW: slot ? slot.getBoundingClientRect().width : null, text: v.state.doc.toString() };
    });
    baseTop ??= m.top;
    const good = Math.abs(m.caretLeft - m.glyphRight) <= 1.5 && Math.abs(m.top - baseTop) <= 0.5 && (m.slotW === null || m.slotW === 0);
    ok &&= good; detail.push(`${m.text}: caret=${m.caretLeft.toFixed(1)} glyph=${m.glyphRight?.toFixed(1)} slotW=${m.slotW} lineH=${m.lineH}`);
  }
  report("3a https://a → . → com: imleç glif sonunda, satır sabit, nokta genişliği 0", ok, detail.join(" | "));
  // hover: kaynak değişmez, satır yüksekliği değişmez
  const before = await lines(page); const srcBefore = await page.evaluate(() => window.__view().state.doc.toString());
  await page.hover("a[href^='https://a.com']"); await page.waitForTimeout(100);
  const after = await lines(page); const srcAfter = await page.evaluate(() => window.__view().state.doc.toString());
  report("3b hover metrik ve kaynağı değiştirmez", JSON.stringify(before) === JSON.stringify(after) && srcBefore === srcAfter);
  const dotVisible = await page.evaluate(() => { const d = document.querySelector("[class*=dot_]:not([class*=dotSlot])") ?? document.querySelector("button[aria-label='Bağlantıya ad ver']"); return d ? getComputedStyle(d).opacity : null; });
  report("3c hover'da nokta görünür", dotVisible === "1", `opacity=${dotVisible}`);
  await page.click("button[aria-label='Bağlantıya ad ver']");
  const s2 = await page.evaluate(() => ({ t: window.__view().state.doc.toString(), h: window.__view().state.selection.main.head }));
  report("3d tıklama [](URL) yapar, imleç [|]", s2.t === "[](https://a.com)" && s2.h === 1, JSON.stringify(s2));
  await page.keyboard.type("P");
  const s3 = await page.evaluate(() => window.__view().state.doc.toString());
  report("3e ilk alias karakteri", s3 === "[P](https://a.com)", s3);
  await ctx.close();
}

// --- 4. placeholder / imleç taban çizgisi ------------------------------
for (const [dsf, scheme, zoom] of [[1, "light", 1], [2, "dark", 1], [1, "light", 2], [1, "dark", 2]]) {
  const { ctx, page } = await open("", { dsf, scheme, zoom });
  await page.click(".cm-content");
  const m = await page.evaluate(() => {
    const v = window.__view(); const c = v.coordsAtPos(0);
    const ph = v.dom.querySelector(".cm-placeholder"); const r = ph.getBoundingClientRect();
    // yazının alt çizgisi: placeholder içindeki metin düğümü
    const tn = [...ph.childNodes].find((n) => n.nodeType === 3) ?? ph; const rg = document.createRange(); rg.selectNodeContents(tn); const tr = rg.getBoundingClientRect();
    return { caretTop: c.top, caretBottom: c.bottom, phTop: tr.top, phBottom: tr.bottom, phH: tr.height, caretH: c.bottom - c.top };
  });
  const dTop = Math.abs(m.caretTop - m.phTop), dBot = Math.abs(m.caretBottom - m.phBottom);
  report(`4 placeholder/imleç hizası dsf=${dsf} ${scheme} zoom=${zoom}`, dTop <= 2.5 && dBot <= 2.5, `Δtop=${dTop.toFixed(2)} Δbottom=${dBot.toFixed(2)}`);
  await ctx.close();
}

// --- 5. toolbar: odak ve seçim korunur ---------------------------------
{
  const { ctx, page } = await open("merhaba dünya");
  await setSel(page, 0, 8); await page.focus(".cm-content");
  await page.click("button[aria-label='Kalın']");
  const a = await page.evaluate(() => { const v = window.__view(); return { t: v.state.doc.toString(), s: [v.state.selection.main.from, v.state.selection.main.to], f: v.hasFocus }; });
  report("5a B seçimi kalın yapar, odak/seçim korunur", a.t === "**merhaba** dünya" && a.s[0] === 2 && a.f, JSON.stringify(a));
  const pressed = await page.getAttribute("button[aria-label='Kalın']", "aria-pressed");
  report("5b B aria-pressed=true", pressed === "true");
  await page.click("button[aria-label='Kalın']");
  report("5c B tekrar → kaldırır", (await page.evaluate(() => window.__view().state.doc.toString())) === "merhaba dünya");
  // seçimsiz: yazım modu
  await setSel(page, 13); await page.focus(".cm-content");
  await page.click("button[aria-label='Kalın']"); await page.keyboard.type("x");
  const t1 = await page.evaluate(() => window.__view().state.doc.toString());
  await page.click("button[aria-label='Kalın']"); await page.keyboard.type("y");
  const t2 = await page.evaluate(() => window.__view().state.doc.toString());
  report("5d seçimsiz B: yaz, tekrar B ile normale dön", t1 === "merhaba dünya**x**" && t2 === "merhaba dünya**x**y", `${t1} → ${t2}`);
  await ctx.close();
}

// --- 6. klavye: çift yazım, Enter listesi, güvenli bağlantı ------------
{
  const { ctx, page } = await open("");
  await page.click(".cm-content");
  await page.keyboard.type("**kalin**");
  let t = await page.evaluate(() => window.__view().state.doc.toString());
  report("6a **kalin** elle yazım: ikinci çift üretilmez", t === "**kalin**", t);
  await page.keyboard.press("Enter"); await page.keyboard.type("- bir"); await page.keyboard.press("Enter"); await page.keyboard.type("iki"); await page.keyboard.press("Enter"); await page.keyboard.press("Enter");
  t = await page.evaluate(() => window.__view().state.doc.toString());
  report("6b liste: devam + boş Enter ile çıkış, fazladan boş satır yok", t === "**kalin**\n- bir\n- iki\n", JSON.stringify(t));
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} geçti`);
process.exit(failed.length ? 1 : 0);
