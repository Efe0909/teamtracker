import { chromium } from "playwright";
const BASE = process.env.MD_HARNESS ?? "http://localhost:5199/tools/md-browser/index.html";
const results = []; const report = (n, ok, d = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); };
const b = await chromium.launch({ args: ["--no-sandbox"] });
const open = async (value = "") => { const ctx = await b.newContext({ viewport: { width: 700, height: 900 } }); const page = await ctx.newPage(); page.on("pageerror", (e) => console.log("PAGEERROR", e.message)); await page.goto(`${BASE}?value=${encodeURIComponent(value)}`); await page.waitForSelector(".cm-content"); return { ctx, page }; };
const doc = (p) => p.evaluate(() => window.__view().state.doc.toString());
const text = (p) => p.evaluate(() => window.__view().contentDOM.textContent);
const sel = (p) => p.evaluate(() => { const s = window.__view().state.selection.main; return [s.anchor, s.head]; });
const wait = (p) => p.waitForTimeout(40);

// A. elle yazım akışı
{
  const { ctx, page } = await open(); await page.click(".cm-content");
  await page.keyboard.type("# Başlık"); await page.keyboard.press("Enter");
  await page.keyboard.type("Metin **kalın** devam"); await wait(page);
  report("A1 başlık+kalın elle yazım: kaynak", (await doc(page)) === "# Başlık\nMetin **kalın** devam", JSON.stringify(await doc(page)));
  report("A2 imleç uzaktayken işaretler gizli", (await text(page)) === "BaşlıkMetin kalın devam", JSON.stringify(await text(page)));
  await page.keyboard.press("Enter"); await page.keyboard.type("> alıntı"); await page.keyboard.press("Enter");
  report("A3 alıntıda Enter satır devam ettirir", (await doc(page)).endsWith("> alıntı\n> "), JSON.stringify((await doc(page)).slice(-14)));
  await page.keyboard.press("Enter"); await page.keyboard.type("---"); await page.keyboard.press("Enter"); await page.keyboard.type("son");
  const t = await doc(page);
  report("A4 --- kural yazımı", t.endsWith("\n---\nson"), JSON.stringify(t.slice(-20)));
  await ctx.close();
}
// B. [ad](url) elle yazım
{
  const { ctx, page } = await open(); await page.click(".cm-content");
  await page.keyboard.type("[Ad](https://x.com) sonra"); await wait(page);
  report("B1 elle link: kaynak korunur, ad görünür, işaretler gizli", (await doc(page)) === "[Ad](https://x.com) sonra" && (await text(page)) === "Ad sonra", JSON.stringify(await text(page)));
  await ctx.close();
}
// C. fare: tıklama ve sürükleme
{
  const { ctx, page } = await open("önce **kalın metin** sonra ve [bağ](https://x.com) son");
  const box = await page.locator(".cm-line").first().boundingBox();
  const before = await text(page);
  const at = await page.evaluate(() => { const c = window.__view().coordsAtPos(10); return { x: c.left, y: (c.top + c.bottom) / 2 }; }); // kalın metin: "**kalın |metin**" içinde
  await page.mouse.click(at.x, at.y); await wait(page);
  const s1 = await sel(page);
  report("C1 kalın içine tıklama imleci doğru kaynak konumuna koyar, işaretler gizli kalır", s1[0] === s1[1] && Math.abs(s1[0] - 10) <= 1 && (await text(page)) === before, JSON.stringify(s1));
  await page.mouse.move(box.x + 20, box.y + 8); await page.mouse.down(); await page.mouse.move(box.x + 200, box.y + 8, { steps: 8 }); await page.mouse.up(); await wait(page);
  const s2 = await sel(page);
  report("C2 sürükleme seçimi yapar, takılma/hata yok", s2[0] !== s2[1], JSON.stringify(s2));
  await page.keyboard.press("ArrowRight"); const s3 = await sel(page);
  report("C3 seçimden sonra ok tuşu çalışır", s3[0] === s3[1], JSON.stringify(s3));
  await ctx.close();
}
// D. Shift+ok seçim: her adım 1 kaynak karakter
{
  const { ctx, page } = await open("a **b** c [d](https://x.com) e");
  await page.click(".cm-content"); await page.keyboard.press("Control+Home");
  let ok = true, prev = 0, det = "";
  for (let i = 0; i < 12; i++) { await page.keyboard.press("Shift+ArrowRight"); const s = await sel(page); if (s[1] !== prev + 1) { ok = false; det = `${prev}→${s[1]}`; break; } prev = s[1]; }
  report("D1 Shift+→ her adım 1 karakter", ok, det);
  await page.keyboard.press("End"); const e = await sel(page); report("D2 End satır sonuna gider", e[1] === (await doc(page)).length, JSON.stringify(e));
  await ctx.close();
}
// E. Backspace davranışları
{
  const { ctx, page } = await open("**a**"); await page.click(".cm-content"); await page.keyboard.press("End"); await page.keyboard.press("Backspace"); await wait(page);
  report("E1 kapanış işaretinin yanında Backspace tek karakter siler (kaynak bozulmaz kaybı)", (await doc(page)) === "**a*", JSON.stringify(await doc(page)));
  await ctx.close();
}
// F. toolbar: link, liste, kod bloğu, başlık
{
  const { ctx, page } = await open("metin"); await page.click(".cm-content");
  await page.keyboard.press("Control+Home"); await page.keyboard.press("Shift+End");
  await page.click("button[aria-label='Bağlantı']");
  await page.fill("input[aria-label='Bağlantı adresi']", "https://example.com"); await page.click("text=Uygula"); await wait(page);
  report("F1 toolbar bağlantı: seçimden [ad](url)", (await doc(page)) === "[metin](https://example.com)", JSON.stringify(await doc(page)));
  await page.click(".cm-content"); await page.keyboard.press("Control+a");
  await page.click("button[aria-label='Madde işaretli liste']");
  report("F2 liste butonu", (await doc(page)).startsWith("- [metin]"), JSON.stringify(await doc(page)));
  await page.click("button[aria-label='Madde işaretli liste']");
  report("F3 liste butonu tekrar → listeden çıkar (toolbar ile çıkış)", (await doc(page)) === "[metin](https://example.com)", JSON.stringify(await doc(page)));
  await page.click("button[aria-label='Başlık 2']"); await page.click("button[aria-label='Başlık 2']"); await page.click("button[aria-label='Başlık 3']");
  report("F4 başlık düğmeleri yığılmaz, değiştirir", (await doc(page)) === "### [metin](https://example.com)", JSON.stringify(await doc(page)));
  await ctx.close();
}
// G. salt okunur ile editör tutarlılık
{
  const { ctx, page } = await open("# A\n\n- x\n\n---\n\n**k** [l](https://x.com)");
  await page.waitForSelector("#ro");
  const ro = await page.evaluate(() => document.querySelector("#ro").innerText.replace(/\s+/g, " ").trim());
  const ed = await page.evaluate(() => window.__view().contentDOM.innerText.replace(/\s+/g, " ").trim());
  report("G1 salt okunur ve editör aynı görünür metni üretir (bullet hariç)", ro.replace("• ", "") === ed.replace("• ", "") , `${JSON.stringify(ro)} vs ${JSON.stringify(ed)}`);
  const ruleW = await page.evaluate(() => { const r = document.querySelector("#ro [class*=rule]"); return r ? [r.getBoundingClientRect().width, document.querySelector("#ro").getBoundingClientRect().width] : null; });
  report("G2 salt okunur yatay çizgi bileşen genişliğinde", ruleW && Math.abs(ruleW[0] - ruleW[1]) <= 1, JSON.stringify(ruleW));
  await ctx.close();
}
await b.close();
const bad = results.filter((x) => !x).length; console.log(`\n${results.length - bad}/${results.length} geçti`); process.exit(bad ? 1 : 0);
