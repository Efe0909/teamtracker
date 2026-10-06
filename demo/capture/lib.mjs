// Ekran goruntusu yakalayici: kisi olarak giris, adim kaydi, vurgu kutulari.
//
// Her adim = bir goruntu (tiklanacak oge vurgulu) + kisa anlatim. Goruntu YALIN kalir
// (sayfaya bir sey enjekte edilmez); vurgu kutulari `steps.json`'a yazilir, halkayi
// ve numarayi PDF olusturucu cizer. Boylece ayni goruntuden farkli yerlesimler uretilir.

import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);

export function loadPlaywright() {
  for (const p of ["playwright", join(execSync("npm root -g").toString().trim(), "playwright")]) {
    try { return require(p); } catch { /* sonrakini dene */ }
  }
  throw new Error("playwright bulunamadi (npm i -g playwright)");
}

export const HOSTS = {
  apex: "http://localhost:5173",
  dashboard: "http://dashboard.localhost:5173",
  app: "http://app.localhost:5173",
};

const PSQL = process.env.PSQL ?? "PGPASSWORD=ekiptakip psql -h 127.0.0.1 -U ekiptakip -d ekiptakip_demo";
export const sql = (q) => execSync(`${PSQL} -X -q -t -A -c ${JSON.stringify(q)}`).toString().trim();
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
export const userId = (name) => sql(`select id from users where name = ${lit(name)}`);

/** Basliga gore kayit kimligi (bolum onceki bolumun actigi kayda dayaniyorsa net bir hata ver). */
export function recordId(title) {
  const id = sql(`select id from records where title = ${lit(title)}`);
  if (id === "") throw new Error(`"${title}" kaydi yok (once onu acan bolumu calistir)`);
  return id;
}

/** Bugunun haftadaki adi ("Salı"); hikaye metinleri hangi gun calistirilirsa onu soylesin. */
export const weekday = () => new Intl.DateTimeFormat("tr", { weekday: "long", timeZone: "UTC" }).format(new Date())
  .replace(/^./, (c) => c.toLocaleUpperCase("tr"));

/** Ilk etkinligin (Arduino atolyesi) bugunden gun farki: en erken 9 gun sonraki Cumartesi (`cal.py` A.e1). */
export function workshopOffset() {
  let n = 9;
  while (new Date(Date.now() + n * 86_400_000).getUTCDay() !== 6) n += 1;
  return n;
}

/** Bugunden `n` gun sonrasinin takvim hucre etiketi ("10 Ekim 2026"). Sunucu, tohum ve
 *  tarayici UTC oldugu icin "bugun" hepsinde ayni gundur. */
export function dayLabel(n) {
  const d = new Date(Date.now() + n * 86_400_000);
  return new Intl.DateTimeFormat("tr", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(d);
}

/** Masaustu ya da telefon boyutunda, `ad` olarak giris yapmis sayfa. */
export async function openUser(browser, name, { host = "dashboard", mobile = false, width, height, scale } = {}) {
  const viewport = mobile ? { width: 390, height: 844 } : { width: width ?? 1440, height: height ?? 900 };
  const ctx = await browser.newContext({
    viewport, deviceScaleFactor: scale ?? (mobile ? 2 : 1.5), locale: "tr-TR", timezoneId: "UTC",
    isMobile: mobile, hasTouch: mobile, acceptDownloads: true,
    permissions: ["clipboard-read", "clipboard-write"], // "Kopyala" dugmeleri bildirim gostersin
  });
  // Karsilama "Gunaydin": yalniz saat bilgisi sabitlenir (tarihler sunucuyla ayni kalir).
  await ctx.addInitScript(() => { Date.prototype.getHours = function getHours() { return 10; }; });
  // Demo sunucuda dis servis anahtarlari yok (kalite kontrolu, posta, push kapali). Rehber
  // CANLIDA gorunen metni anlatir: on yuze "hicbir servis kapali degil" denir. Yalniz
  // gosterim degisir; sunucu davranisi (ve hicbir dis servise cagri) ayni kalir.
  await ctx.route("**/api/meta", async (route) => {
    // `*.localhost` yalniz Chromium'da cozulur (Node'da degil): istegi dogrudan IP'ye yolla.
    const u = new URL(route.request().url());
    const res = await route.fetch({ url: `http://127.0.0.1:${u.port}${u.pathname}${u.search}` });
    const body = await res.json();
    await route.fulfill({ response: res, json: { ...body, external_off: [] } });
  });
  // Kalite kapisi sekmesi de "servis kapali" notunu gostermesin (yalniz okuma, GET).
  await ctx.route("**/api/admin/quality", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const u = new URL(route.request().url());
    const res = await route.fetch({ url: `http://127.0.0.1:${u.port}${u.pathname}${u.search}` });
    const body = await res.json();
    return route.fulfill({ response: res, json: { ...body, service_on: true } });
  });
  const page = await ctx.newPage();
  await page.goto(`${HOSTS[host]}/api/auth/dev-login?user_id=${userId(name)}`, { waitUntil: "networkidle" });
  await settle(page);
  return { ctx, page, viewport };
}

/** Ag sakinlesti, yazi tipleri yuklendi, animasyon bitti. */
export async function settle(page, ms = 350) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page.waitForTimeout(ms);
}

const pad = (n, w = 2) => String(n).padStart(w, "0");

export class Recorder {
  constructor(dir) {
    this.dir = dir;
    this.shots = join(dir, "shots");
    // Her calistirma kendi goruntu setini yazar; eski calistirmadan kalan numaralar karismasin.
    rmSync(this.shots, { recursive: true, force: true });
    mkdirSync(this.shots, { recursive: true });
    this.chapters = [];
    this.steps = [];
    this.cur = null;
    this.ext = process.env.SHOT_TYPE === "png" ? "png" : "jpg";
  }

  /** Yeni bolum: kisi ve kisa senaryo girisi (PDF ayirici sayfasi). */
  chapter({ id, title, intro, persona, role }) {
    this.cur = { id, title, intro, persona, role, steps: 0 };
    this.chapters.push(this.cur);
    console.log(`\n== ${title}`);
  }

  /**
   * Bir adim yakalar.
   *  target(s): vurgulanacak Locator / {x,y,w,h} (dizi olabilir)
   *  act: goruntuden SONRA yapilan eylem (tiklama, yazma ...)
   *  click: imlec simgesi (act varsa varsayilan acik)
   *  nav: PDF'te "anlatim" yerine geciste gosterilecek kisa ad (opsiyonel)
   *  tip: ek ipucu kutusu
   */
  async step(page, s) {
    if (this.cur === null) throw new Error("once chapter()");
    // Fare onceki tiklamanin ustunde kalirsa ipucu balonlari (title) goruntuye girer.
    await page.mouse.move(1, 1);
    // `hover`: hover'la gorunen denetimler (kalem simgesi gibi) goruntude yer alsin.
    if (s.hover !== undefined) await s.hover.first().hover();
    await settle(page, s.wait ?? 250);
    const targets = s.target === undefined ? [] : Array.isArray(s.target) ? s.target : [s.target];
    const boxes = [];
    for (const raw of targets) {
      // `{ t, label }` ile kutuya kisa bir etiket eklenir (bolumleri tanitan genel bakis adimlari).
      const labeled = raw !== null && typeof raw === "object" && "t" in raw;
      const t = labeled ? raw.t : raw;
      let b;
      if (typeof t.boundingBox === "function") {
        const first = t.first();
        await first.waitFor({ state: "visible", timeout: 8000 }).catch((e) => {
          throw new Error(`[${s.id}] hedef gorunmuyor: ${e.message.split("\n")[0]}`);
        });
        await first.scrollIntoViewIfNeeded().catch(() => {});
        await page.waitForTimeout(120);
        b = await first.boundingBox();
        if (b === null) throw new Error(`[${s.id}] hedefin kutusu yok`);
        b = { x: b.x, y: b.y, w: b.width, h: b.height };
      } else b = t;
      boxes.push(labeled ? { ...b, label: raw.label } : b);
    }
    this.cur.steps += 1;
    const n = this.steps.length + 1;
    const file = `${pad(n, 3)}-${s.id}.${this.ext}`;
    const opts = this.ext === "png" ? { type: "png" } : { type: "jpeg", quality: 86 };
    // `clipTo`: uzun (yuksek pencereli) sayfalarda goruntuyu verilen ogenin altina kadar kirp;
    // altta bos sayfa alani kalmasin. Kutular sol-ust kosesi 0,0 oldugu icin aynen gecerli.
    let clip;
    if (s.clipTo !== undefined) {
      const box = await s.clipTo.first().boundingBox();
      const full = page.viewportSize();
      if (box !== null && full !== null) {
        clip = { x: 0, y: 0, width: full.width, height: Math.min(full.height, Math.ceil(box.y + box.height + (s.clipPad ?? 28))) };
      }
    }
    await page.screenshot({ path: join(this.shots, file), ...(clip === undefined ? {} : { clip }), ...opts });
    const vp = clip === undefined ? page.viewportSize() : { width: clip.width, height: clip.height };
    this.steps.push({
      n, chapter: this.cur.id, id: s.id, title: s.title, text: s.text ?? "", tip: s.tip ?? null, file,
      viewport: vp, boxes, click: s.click ?? (s.act !== undefined), mobile: (vp?.width ?? 1440) < 600,
      zoom: s.zoom ?? null, note: s.note ?? null,
    });
    console.log(`  ${pad(n, 3)} ${s.title}`);
    if (s.act !== undefined) {
      await s.act();
      await settle(page, s.after ?? 350);
    }
  }

  write(extra = {}) {
    writeFileSync(join(this.dir, "steps.json"), JSON.stringify({
      generated: new Date().toISOString(), chapters: this.chapters, steps: this.steps, ...extra,
    }, null, 1));
  }
}
