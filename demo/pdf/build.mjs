// Scribe tarzi rehber PDF'i: demo/capture ciktisindaki (`steps.json` + `shots/`) adimlardan
// 16:9 sayfalar uretir; vurgu halkasi, numara, imlec ve karartma burada cizilir (goruntuler yalin).
//
//   node demo/pdf/build.mjs [--dir demo/guide] [--name EkipTakip-Rehber] [--no-pdf]
//
// Cikti: <dir>/<name>.pdf ve <dir>/GUIDE.md (ayni icerik, GitHub'da okunur).
// Birim agaci, etkinlik turleri/yerleri ve kisi tablosu temiz tohum veritabanindan (`_snap`) okunur.

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlaywright } from "../capture/lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const dir = resolve(arg("dir", join(here, "..", "guide")));
const name = arg("name", "EkipTakip-Rehber");
const { steps, chapters } = JSON.parse(readFileSync(join(dir, "steps.json"), "utf8"));

// --- temiz tohum verisi (veritabani anlik goruntusu) ------------------------------------------
const SNAP = process.env.SNAP_PSQL ?? "PGPASSWORD=ekiptakip psql -h 127.0.0.1 -U ekiptakip -d ekiptakip_demo_snap";
const SEP = "\u001f";
function rows(q) {
  // Sorgu stdin'den gider: `-c` icinde satir sonlari psql'e kacis dizisi olarak ulasirdi.
  const out = execSync(`${SNAP} -X -q -t -A -F '${SEP}'`, { input: q }).toString().trim();
  return out === "" ? [] : out.split("\n").map((l) => l.split(SEP));
}
const TYPE = { cell: "Cell", machine: "Makine", task: "Görev", step: "Adım", generic: "Genel" };

const units = rows(`
  with recursive t as (
    select n.id, n.name, n.node_type, n.description, 0 as depth, array[n.sort_order] as path
      from nodes n where n.parent_id = (select id from nodes where key = 'units') and n.is_active
    union all
    select c.id, c.name, c.node_type, c.description, t.depth + 1, t.path || c.sort_order
      from nodes c join t on c.parent_id = t.id where c.is_active)
  select depth, name, node_type, coalesce(description, '') from t order by path`)
  .map(([depth, nm, type, desc]) => ({ depth: Number(depth), name: nm, type: TYPE[type] ?? type, desc }));

const [teamCount, pillarCount] = rows(`select (select count(*) from teams t where not exists (select 1 from pillars p where p.team_id = t.id)),
  (select count(*) from pillars where is_active)`)[0].map(Number);

const eventTypes = rows(`
  select o.name, coalesce(o.description, ''),
    coalesce((select string_agg(c.name || ' (' || (c.attrs->>'offset_days') || ' gün)', ' · ' order by (c.attrs->>'offset_days')::int)
              from nodes s join nodes c on c.parent_id = s.id
              where s.parent_id = o.id and s.attrs->>'slot' = 'steps' and c.is_active), ''),
    coalesce((select string_agg(case c.attrs->>'widget' when 'otf' then 'OTF formu' when 'supplies' then 'Satın alımlar' else c.attrs->>'widget' end, ', ')
              from nodes s join nodes c on c.parent_id = s.id
              where s.parent_id = o.id and s.attrs->>'slot' = 'widgets' and c.is_active), '')
  from nodes o where o.parent_id = (select id from nodes where key = 'event_types') and o.is_active order by o.sort_order, o.name`)
  .map(([nm, desc, st, wd]) => ({ name: nm, desc, steps: st, widgets: wd }));

const locations = rows(`select name, coalesce(description, '') from nodes
  where parent_id = (select id from nodes where key = 'event_locations') and is_active order by sort_order, name`)
  .map(([nm, desc]) => ({ name: nm, desc }));

const people = rows(`
  select u.name, coalesce(u.nickname, ''), coalesce(u.color, '#6e56cf'), u.is_admin,
    coalesce((select string_agg(r.name, ', ' order by r.name) from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = u.id), ''),
    coalesce((select string_agg(t.name, ', ' order by t.name) from team_members tm join teams t on t.id = tm.team_id
              where tm.user_id = u.id and not exists (select 1 from pillars p where p.team_id = t.id)), '')
  from users u where u.is_active order by u.created_at`)
  .map(([nm, nick, color, admin, roles, teams]) => ({ name: nm, nick, color, admin: admin === "t", roles, teams }));

// --- yardimcilar --------------------------------------------------------------------------------
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const md = (s) => esc(s)
  .replace(/`([^`]+)`/g, "<code>$1</code>")
  .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
  .replace(/(^|[\s(“"'])\*([^*\s][^*]*?)\*/g, "$1<i>$2</i>");
const plain = (s) => String(s).replace(/\*\*([^*]+)\*\*/g, "$1").replace(/(^|[\s(“"'])\*([^*\s][^*]*?)\*/g, "$1$2").replace(/`([^`]+)`/g, "$1");
const initial = (n) => n.slice(0, 1).toLocaleUpperCase("tr");
const pc = (v, t) => `${((v / t) * 100).toFixed(3)}%`;
const personOf = (n) => people.find((p) => p.name === n);
const avatar = (n, size = 40) => {
  const p = personOf(n);
  return `<span class="av" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.46)}px;background:${p?.color ?? "#6e56cf"}">${esc(initial(n))}</span>`;
};

// --- goruntuleri kucult (Chromium tuvali; ek arac gerekmez) --------------------------------------
// Ayrica her goruntunun sol ust kosesinin ortalama parlakligi `s.corner` olarak olculur: uygulamanin
// kendi modal arka plani (koyu) varsa kose griye doner; o zaman ustune ikinci bir karartma bindirilmez.
async function shrink(browser) {
  const out = join(dir, "pdf-shots");
  mkdirSync(out, { recursive: true });
  const metaPath = join(out, "meta.json");
  const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, "utf8")) : {};
  const page = await browser.newPage();
  let done = 0;
  for (const s of steps) {
    const src = join(dir, "shots", s.file), dst = join(out, s.file);
    if (existsSync(dst) && statSync(dst).mtimeMs >= statSync(src).mtimeMs && meta[s.file] !== undefined) {
      s.corner = meta[s.file];
      continue;
    }
    const mime = s.file.endsWith(".png") ? "image/png" : "image/jpeg";
    const { b64, corner } = await page.evaluate(async ({ data, mime, maxW }) => {
      const img = new Image();
      img.src = `data:${mime};base64,${data}`;
      await img.decode();
      const k = Math.min(1, maxW / img.naturalWidth);
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * k);
      c.height = Math.round(img.naturalHeight * k);
      const g = c.getContext("2d");
      g.imageSmoothingQuality = "high";
      g.drawImage(img, 0, 0, c.width, c.height);
      const px = g.getImageData(2, 2, 24, 24).data;
      let sum = 0;
      for (let i = 0; i < px.length; i += 4) sum += (px[i] + px[i + 1] + px[i + 2]) / 3;
      return { b64: c.toDataURL("image/jpeg", 0.8).split(",")[1], corner: sum / (px.length / 4) };
    }, { data: readFileSync(src).toString("base64"), mime, maxW: s.mobile ? 660 : 1560 });
    writeFileSync(dst, Buffer.from(b64, "base64"));
    s.corner = meta[s.file] = corner;
    done += 1;
  }
  writeFileSync(metaPath, JSON.stringify(meta));
  await page.close();
  console.log(`goruntuler: ${steps.length} (${done} yeniden boyutlandi)`);
}

// --- vurgu katmani ------------------------------------------------------------------------------
// Ust uste binen delikler "evenodd"de yeniden dolardi: kesisen kutular tek kutuda birlestirilir.
function mergeRects(rects) {
  const out = rects.map(({ x, y, w, h }) => ({ x, y, w, h }));
  for (let again = true; again;) {
    again = false;
    for (let i = 0; i < out.length && !again; i++) {
      for (let j = i + 1; j < out.length && !again; j++) {
        const a = out[i], b = out[j];
        if (a.x < b.x + b.w + 2 && b.x < a.x + a.w + 2 && a.y < b.y + b.h + 2 && b.y < a.y + a.h + 2) {
          const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
          out[i] = { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
          out.splice(j, 1);
          again = true;
        }
      }
    }
  }
  return out;
}

function overlay(s) {
  const { width: W, height: H } = s.viewport;
  if (s.boxes.length === 0) return "";
  const pad = 6;
  const R = s.boxes.map((b) => {
    const x = Math.max(0, b.x - pad), y = Math.max(0, b.y - pad);
    return { x, y, w: Math.min(W - x, b.w + 2 * pad), h: Math.min(H - y, b.h + 2 * pad), label: b.label };
  });
  const big = R.some((r) => r.w * r.h > 0.55 * W * H);
  const backdrop = (s.corner ?? 255) < 215; // uygulamanin modal arka plani zaten karartilmis
  const dim = big || backdrop ? 0 : s.click ? 0.26 : 0.14;
  // Karartma: tum sayfa - hedef delikleri, tek "evenodd" yol. SVG <mask> kullanilmaz: Chromium maskeyi PDF'e
  // adim basina ~40 KB'lik RGB + yumusak maske goruntusu olarak gomer (285 adim = ~9 MB).
  const rr = (r, k) => `M${r.x + k} ${r.y}H${r.x + r.w - k}A${k} ${k} 0 0 1 ${r.x + r.w} ${r.y + k}V${r.y + r.h - k}A${k} ${k} 0 0 1 ${r.x + r.w - k} ${r.y + r.h}H${r.x + k}A${k} ${k} 0 0 1 ${r.x} ${r.y + r.h - k}V${r.y + k}A${k} ${k} 0 0 1 ${r.x + k} ${r.y}Z`;
  const holes = mergeRects(R).map((r) => rr(r, Math.min(10, r.w / 2, r.h / 2))).join("");
  const mask = dim === 0 ? "" : `<svg class="dim" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path fill-rule="evenodd" fill="rgba(20,14,50,${dim})" d="M0 0H${W}V${H}H0Z${holes}"/></svg>`;
  const rings = R.map((r) => `<i class="ring" style="left:${pc(r.x, W)};top:${pc(r.y, H)};width:${pc(r.w, W)};height:${pc(r.h, H)}"></i>`).join("");
  const labels = R.filter((r) => r.label).map((r) => {
    // Etiket halkanin ust kenarina oturur; komsu kutuyla cakismasin diye ic tarafa tasmaz.
    const y = r.y < 20 ? r.y + 6 : r.y - 15;
    return `<b class="tag" style="left:${pc(Math.max(r.x + 14, 4), W)};top:${pc(Math.max(y, 4), H)}">${esc(r.label)}</b>`;
  }).join("");
  const first = R[0];
  // Rozet kutunun sol ust kosesine oturur; tek satirlik seritlerde (liste satiri) metni kapatmasin diye biraz yukari,
  // kucuk hedeflerde (ok, ikon) hedefi kapatmasin diye capraz disari kayar.
  const tiny = first.w < 90 && first.h < 48, strip = !tiny && first.h < 48;
  const bx = tiny ? first.x + first.w / 2 - 36 : first.x + (strip ? 2 : 0);
  const by = tiny ? first.y + first.h / 2 - 36 : first.y - (strip ? 12 : 0);
  const badge = R.some((r) => r.label) ? "" : `<b class="badge" style="left:${pc(Math.max(bx, 26), W)};top:${pc(Math.max(by, 26), H)}">${s.local}</b>`;
  const cur = s.click
    ? `<svg class="cursor" style="left:${pc(Math.min(first.x + first.w * 0.7, W - 30), W)};top:${pc(Math.min(first.y + first.h * 0.72, H - 40), H)}" viewBox="0 0 28 36"><path d="M2 2 L2 28 L9 21.5 L14 33 L19 30.8 L14 19.5 L24 19.5 Z" fill="#fff" stroke="#15131f" stroke-width="2.2" stroke-linejoin="round"/></svg>`
    : "";
  return `${mask}${rings}${labels}${badge}${cur}`;
}

// --- sayfa tanimlari ----------------------------------------------------------------------------
const byChapter = new Map(chapters.map((c) => [c.id, steps.filter((s) => s.chapter === c.id)]));
steps.forEach((s) => { s.local = byChapter.get(s.chapter).indexOf(s) + 1; });
const stepOf = (id) => steps.find((s) => s.id === id);

const personaChapters = new Map();
chapters.forEach((c, i) => {
  if (!personaChapters.has(c.persona)) personaChapters.set(c.persona, []);
  personaChapters.get(c.persona).push(i + 1);
});
const titleOf = new Map();
chapters.forEach((c) => titleOf.set(c.persona, c.role));

const plan = [];
plan.push({ type: "cover" });
plan.push({ type: "howto" });
plan.push({ type: "cast" });
plan.push({ type: "tree" });
plan.push({ type: "units" });
plan.push({ type: "lists" });
plan.push({ type: "contents" });
chapters.forEach((c, i) => {
  plan.push({ type: "chapter", c, n: i + 1 });
  for (const s of byChapter.get(c.id)) plan.push({ type: "step", c, n: i + 1, s });
});
plan.push({ type: "tips" });
plan.push({ type: "end" });
const total = plan.length;
const pageOfChapter = new Map();
plan.forEach((p, i) => { if (p.type === "chapter") pageOfChapter.set(p.c.id, i + 1); });
const pageOfType = (t) => plan.findIndex((p) => p.type === t) + 1;

const footer = (page, label) => `<footer><span>EkipTakip · Ekip kullanım rehberi</span><span>${esc(label ?? "")}</span><span>${page} / ${total}</span></footer>`;

function render(p, page) {
  switch (p.type) {
    case "cover": {
      const pick = ["gorevler-tablo", "etk-genel", "veri-agac"].map(stepOf).filter(Boolean);
      const cards = pick.map((s, i) => `<img class="fan f${i}" src="../pdf-shots/${s.file}" alt="">`).join("");
      return `<section class="slide cover"><div class="coverText">
        <div class="logo"><i></i>EkipTakip</div>
        <h1 class="sr">EkipTakip — Ekip kullanım rehberi</h1><div class="title">Ekip kullanım rehberi</div>
        <p class="lead">Haftalık işleyişin adım adım anlatımı: kayıtlar, etkinlikler, takımlar, veri yönetimi ve telefon. Her adımda neye tıklayacağın çerçeveyle gösterilir.</p>
        <ul class="facts"><li><b>${chapters.length}</b> bölüm</li><li><b>${steps.length}</b> adım</li><li><b>${people.length}</b> kişilik örnek ekip</li></ul>
        <p class="small">Bu rehber <b>demo verisiyle</b> hazırlandı: adlar, e-postalar, etkinlikler ve kayıtlar kurgudur; canlı veriye dokunulmadı.</p>
      </div><div class="coverArt">${cards}</div></section>`;
    }
    case "howto":
      return `<section class="slide plain"><h1>Rehber nasıl okunur?</h1>
      <p class="lead2">Her sayfa tek bir adımdır. Solda ne yapacağın yazar, sağda ekranın kendisi görünür.</p>
      <div class="legend">
        <div><span class="lgIcon"><span class="lgRing"></span></span><h3>Turuncu çerçeve</h3><p>Bakman ya da tıklaman gereken yeri gösterir. Çerçevenin dışı hafifçe karartılır.</p></div>
        <div><span class="lgIcon"><b class="lgBadge">3</b></span><h3>Numaralı daire</h3><p>Adımın bölüm içindeki sırasıdır. Aynı sıra sol üstteki mor daireyle yazılır.</p></div>
        <div><span class="lgIcon"><svg class="lgCur" viewBox="0 0 28 36"><path d="M2 2 L2 28 L9 21.5 L14 33 L19 30.8 L14 19.5 L24 19.5 Z" fill="#fff" stroke="#15131f" stroke-width="2.2" stroke-linejoin="round"/></svg></span><h3>İmleç</h3><p>Bu adımda <b>tıklanacak</b> yer. İmleç yoksa sadece bakıp okuman yeterli.</p></div>
        <div><span class="lgIcon"><b class="lgTag">Eylemler</b></span><h3>Etiketli çerçeveler</h3><p>Genel bakış adımlarında sayfanın bölümlerini adlarıyla tanıtır.</p></div>
        <div><span class="lgIcon"><span class="lgPhone"></span></span><h3>Telefon çerçevesi</h3><p>Mobil uygulama adımları telefon ekranı olarak gösterilir.</p></div>
        <div><span class="lgIcon">${avatar("Kaan Demir", 56)}</span><h3>Kişi</h3><p>Her bölüm bir ekip arkadaşının gözünden anlatılır; yetkiler kişiye göre değişir.</p></div>
      </div>
      <p class="note">İpucu: PDF'te içindekiler sayfasındaki satırlara ve sol paneldeki yer imlerine tıklayarak bölümler arasında gezebilirsin.</p>
      ${footer(page, "Giriş")}</section>`;
    case "cast":
      return `<section class="slide plain"><h1>Rehberde tanışacağın ekip</h1>
      <p class="lead2">Örnek kulüp: Maker Kulübü. ${people.length} kişi, ${teamCount} takım, ${pillarCount} pillar. Bölümleri her seferinde bir kişi anlatır.</p>
      <div class="cast">${people.map((u) => {
        const ch = personaChapters.get(u.name);
        return `<div class="person">${avatar(u.name, 64)}<div><h3>${esc(u.name)}${u.nick ? ` <small>“${esc(u.nick)}”</small>` : ""}</h3>
          <p class="roleLine">${u.admin ? "<em>Yönetici</em>" : ""}${esc(u.roles)}${!u.admin && !u.roles ? "Rolsüz üye" : ""}</p>
          <p class="teamLine">${esc(u.teams || "Takımsız")}</p>
          ${ch ? `<p class="chLine">Bölüm ${ch.join(", ")}</p>` : ""}</div></div>`;
      }).join("")}</div>${footer(page, "Giriş")}</section>`;
    case "tree": {
      const prefix = (d) => (d === 0 ? "" : "    |" + "   |".repeat(d - 1));
      const text = units.map((u) => `${prefix(u.depth)}${u.name}(${u.type})`).join("\n");
      return `<section class="slide plain"><h1>Birim ağacı: işin haritası</h1>
      <p class="lead2">Her kayıt, ağaçtaki bir birime bağlanır. Rehberdeki örnek kulüp yalnız <b>Etkinlik</b> dalını kullanır: bir hücre, üç makine ve altlarında görevler ile adımlar.</p>
      <div class="treeBox"><pre>${esc(text)}</pre>
        <div class="typeKey"><h3>Düğüm türleri</h3>
          <p><b>Cell</b> ana hücre: kendisi ve altındaki dal operasyonel kapsamdır.</p><p><b>Makine</b> girdisi ve çıktısı olan atomik iş birimi.</p>
          <p><b>Görev</b> kalıcı bir iş alanı: kayıtlar buraya bağlanır.</p><p><b>Adım</b> sürecin tek bir aşaması (ETF, OTF gibi); kayıtlar buraya da bağlanır.</p>
          <p class="fine">Ağaç <b>Veri yönetimi → Birimler</b> altında düzenlenir (bölüm 20).</p></div></div>
      ${footer(page, "Giriş")}</section>`;
    }
    case "units":
      return `<section class="slide plain"><h1>Birimler ve açıklamaları</h1>
      <table class="tbl units"><thead><tr><th>Birim</th><th>Tür</th><th>Ne yapılır?</th></tr></thead><tbody>
      ${units.map((u) => `<tr><td style="padding-left:${14 + u.depth * 26}px"><b>${esc(u.name)}</b></td><td><span class="chip">${esc(u.type)}</span></td><td>${esc(u.desc)}</td></tr>`).join("")}
      </tbody></table>${footer(page, "Giriş")}</section>`;
    case "lists":
      return `<section class="slide plain"><h1>Etkinlik türleri ve yerleri</h1>
      <div class="two"><div><h2>Etkinlik türleri <small>şablon: zaman çizelgesi adımları ve widget'lar</small></h2>
        <table class="tbl small"><thead><tr><th>Tür</th><th>Adımlar (etkinliğe göre)</th><th>Widget'lar</th></tr></thead><tbody>
        ${eventTypes.map((t) => `<tr><td><b>${esc(t.name)}</b><br><span class="dimS">${esc(t.desc)}</span></td><td>${esc(t.steps || "—")}</td><td>${esc(t.widgets || "—")}</td></tr>`).join("")}
        </tbody></table></div>
        <div><h2>Etkinlik yerleri <small>etkinlikte “Yer” listesi</small></h2>
        <table class="tbl small"><thead><tr><th>Yer</th><th>Açıklama</th></tr></thead><tbody>
        ${locations.map((l) => `<tr><td><b>${esc(l.name)}</b></td><td>${esc(l.desc)}</td></tr>`).join("")}
        </tbody></table></div></div>${footer(page, "Giriş")}</section>`;
    case "contents": {
      const rowsHtml = chapters.map((c, i) => `<a class="crow" href="#ch${i + 1}"><b class="cn">${i + 1}</b><span class="ct"><b>${esc(c.title)}</b><small>${esc(c.persona)} · ${byChapter.get(c.id).length} adım</small></span><span class="cp">${pageOfChapter.get(c.id)}</span></a>`);
      const half = Math.ceil(rowsHtml.length / 2);
      return `<section class="slide plain"><h1>İçindekiler</h1><div class="toc"><div>${rowsHtml.slice(0, half).join("")}</div><div>${rowsHtml.slice(half).join("")}</div></div>${footer(page, "Giriş")}</section>`;
    }
    case "chapter": {
      const { c, n } = p;
      const list = byChapter.get(c.id);
      return `<section class="slide chapter" id="ch${n}"><div class="chL">
        <div class="bigNum">${String(n).padStart(2, "0")}</div>
        <h1>${esc(c.title)}</h1>
        <p class="lead">${esc(c.intro)}</p>
        <div class="whoCard">${avatar(c.persona, 72)}<div><b>${esc(c.persona)}</b><span>${esc(c.role)}</span></div></div></div>
        <div class="chR"><h3>Bu bölümde ${list.length} adım var</h3><ol class="${list.length > 9 ? "cols" : ""}">${list.map((s) => `<li>${esc(s.title)}</li>`).join("")}</ol></div>
        ${footer(page, `Bölüm ${n}`)}</section>`;
    }
    case "step": {
      const { c, n, s } = p;
      const count = byChapter.get(c.id).length;
      const shot = `<div class="shot${s.mobile ? " phone" : ""}"><img src="../pdf-shots/${s.file}" alt="">${overlay(s)}</div>`;
      const bar = Array.from({ length: count }, (_, i) => `<i class="${i < s.local ? "on" : ""}"></i>`).join("");
      return `<section class="slide step${s.mobile ? " mob" : ""}" id="s${s.n}"><div class="txt">
        <div class="eyebrow">Bölüm ${n} · ${esc(c.title)}</div>
        <div class="head"><b class="num">${s.local}</b><h2>${esc(s.title)}</h2></div>
        <p class="cap">${md(s.text)}</p>
        ${s.tip ? `<div class="tip"><span>İpucu</span>${md(s.tip)}</div>` : ""}
        <div class="who">${avatar(c.persona, 34)}<span><b>${esc(c.persona)}</b> · ${esc(c.role)}</span></div>
        <div class="bar">${bar}</div></div>
        <div class="pic">${shot}</div>${footer(page, `Adım ${s.local}/${count}`)}</section>`;
    }
    case "tips":
      return `<section class="slide plain"><h1>Hızlı ipuçları</h1><div class="tips">
        ${[
          ["⌘K", "Komut paleti", "Her sayfada **⌘K** (Windows'ta **Ctrl+K**): kayıt, etkinlik, takım ve sayfa ara; Enter açar."],
          ["@", "Birini an", "Sohbette **@ad**, **@all** (herkes), **@here** (son 10 dakikada görülenler), **@team** (kaydın takımı). Anılan kişi kayda katılımcı olur."],
          ["↵", "Enter / Shift+Enter", "Masaüstünde **Enter** mesajı gönderir, **Shift+Enter** yeni satır açar. Telefonda Enter satır atlar."],
          ["30", "Kısa metin kabul edilmez", "Kayıt başlığı en az **5**, açıklama ve kapanış notu en az **30** karakter olmalı; sayaç altta görünür."],
          ["✓", "Açık eylem varken kapanmaz", "Kaydı kapatmadan önce eylemlerini bitir; durum listesinde “Kapandı” yanında kaç açık eylem kaldığı yazar."],
          ["3", "OTF: 3 iş günü kuralı", "Etkinlik formu SEB'e en geç etkinlikten **3 iş günü** önce gitmeli; son gün etkinlik sayfasında hesaplanır."],
          ["⏻", "Silme, pasifleştir", "Birim, tür ve yerleri silmek yerine **pasifleştir**: geçmiş kayıtlar adını göstermeye devam eder."],
          ["👥", "Takım = düzenleme yetkisi", "Takım üyesi, o takıma bağlı kaydı düzenleyebilir. Takımdaki lider/mentor/üye rolü yetki vermez."],
          ["🔗", "Filtreler adreste", "Görevler ve Etkinlikler'deki filtreler adres çubuğuna yazılır; adresi paylaşınca aynı görünüm açılır."],
          ["📱", "Telefonda", "**app.** adresini ana ekrana ekle: uygulama gibi açılır; fotoğrafı doğrudan sohbete gönderebilirsin."],
        ].map(([k, t, d]) => `<div class="tipCard"><span class="key">${esc(k)}</span><div><h3>${esc(t)}</h3><p>${md(d)}</p></div></div>`).join("")}
      </div>${footer(page, "Ek")}</section>`;
    case "end":
      return `<section class="slide plain end"><h1>Bu rehber nasıl hazırlandı?</h1>
      <p class="lead2">Canlı veriye dokunulmadı. Aşağıdaki adımlar yerel bir geliştirme ortamında demo verisi kurar, ekranları senaryolarla gezer ve bu PDF'i üretir.</p>
      <pre class="cmd">demo/stack.sh seed                     # boş demo veritabanı + örnek ekip, kayıt ve etkinlikler
node demo/capture/run.mjs              # ${chapters.length} bölümü gez, ${steps.length} ekran görüntüsü al
node demo/pdf/build.mjs                # bu PDF ve GUIDE.md</pre>
      <p class="note">Ayrıntılar <b>demo/README.md</b> dosyasında. Demo kişileri ve e-postalar (<code>@demo.example</code>) kurgudur; gerçek kişilerle ilgisi yoktur.</p>
      ${footer(page, "Ek")}</section>`;
  }
  return "";
}

// --- CSS -----------------------------------------------------------------------------------------
const FONT_DIR = resolve(here, "..", "..", "frontend", "node_modules", "@fontsource-variable");
const fontFace = (fam, file, weight) => existsSync(join(FONT_DIR, fam, "files", file))
  ? `@font-face{font-family:"${fam === "inter" ? "InterV" : "MonoV"}";src:url("file://${join(FONT_DIR, fam, "files", file)}") format("woff2");font-weight:${weight};font-style:normal}` : "";
const fonts = [
  fontFace("inter", "inter-latin-wght-normal.woff2", "100 900"),
  fontFace("inter", "inter-latin-ext-wght-normal.woff2", "100 900"),
  fontFace("jetbrains-mono", "jetbrains-mono-latin-wght-normal.woff2", "100 800"),
  fontFace("jetbrains-mono", "jetbrains-mono-latin-ext-wght-normal.woff2", "100 800"),
].join("\n");

const CSS = `
${fonts}
@page { size: 1920px 1080px; margin: 0 }
:root { --brand:#6e56cf; --brand2:#4b36b0; --ink:#16151d; --mute:#5d5b6b; --hair:#e4e2ee; --accent:#ff5a1f; --bg:#f6f5fb }
* { box-sizing: border-box; margin: 0; padding: 0 }
html, body { background: #fff; font-family: InterV, Inter, system-ui, "Helvetica Neue", Arial, sans-serif; color: var(--ink); -webkit-font-smoothing: antialiased }
.slide { position: relative; width: 1920px; height: 1080px; overflow: hidden; page-break-after: always; break-after: page; background: var(--bg) }
footer { position: absolute; left: 72px; right: 72px; bottom: 26px; display: flex; justify-content: space-between; font-size: 15px; color: #8b89a0; letter-spacing: .01em }
footer span:nth-child(2) { font-weight: 600 }
code { font-family: MonoV, "JetBrains Mono", ui-monospace, monospace; background: #ece9f8; padding: 1px 7px; border-radius: 6px; font-size: .9em; color: var(--brand2) }
.av { display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; color: #fff; font-weight: 700; flex: none }

/* Not: bulanik golge (blur) yok — Chromium bunlari PDF'e buyuk gri/RGB goruntu olarak gomer (PDF 85 MB -> ~35 MB). */
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap }
/* kapak */
.cover { background: radial-gradient(1200px 800px at 85% 10%, #8a73ff 0, transparent 60%), linear-gradient(135deg, #2c1d7a, #5a43c6 55%, #7c63e8); color: #fff }
.cover .coverText { position: absolute; left: 96px; top: 150px; width: 780px }
.logo { display: flex; align-items: center; gap: 16px; font-size: 34px; font-weight: 700; letter-spacing: -.01em; margin-bottom: 70px }
.logo i { width: 54px; height: 54px; border-radius: 15px; background: #fff; display: inline-block; position: relative }
.logo i::after { content: ""; position: absolute; inset: 14px 13px; border-top: 5px solid var(--brand); border-bottom: 5px solid var(--brand); border-radius: 2px; box-shadow: inset 0 0 0 0 transparent }
.cover .title { font-size: 104px; line-height: 1.02; letter-spacing: -.035em; font-weight: 800 }
.cover .lead { margin-top: 36px; font-size: 31px; line-height: 1.45; color: rgba(255,255,255,.88); max-width: 720px }
.facts { display: flex; gap: 20px; margin-top: 44px; list-style: none }
.facts li { background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.22); border-radius: 16px; padding: 14px 24px; font-size: 24px }
.facts b { font-size: 40px; margin-right: 8px }
.cover .small { position: absolute; top: 790px; font-size: 21px; max-width: 700px; color: rgba(255,255,255,.78); line-height: 1.5 }
.coverArt { position: absolute; right: 0; top: 0; width: 960px; height: 1080px }
.fan { position: absolute; width: 760px; border-radius: 16px; box-shadow: 14px 18px 0 rgba(10,6,40,.3); border: 1px solid rgba(255,255,255,.25) }
.f0 { left: 150px; top: 120px; transform: rotate(-4deg) }
.f1 { left: 250px; top: 390px; transform: rotate(3deg) }
.f2 { left: 130px; top: 640px; transform: rotate(-2deg) }

/* duz sayfalar */
.plain { padding: 70px 96px }
.plain h1 { font-size: 64px; letter-spacing: -.03em; font-weight: 800 }
.plain h2 { font-size: 30px; margin-bottom: 14px } .plain h2 small { font-size: 17px; color: var(--mute); font-weight: 500; margin-left: 10px }
.lead2 { margin-top: 14px; font-size: 26px; line-height: 1.5; color: var(--mute); max-width: 1500px }
.note { position: absolute; left: 96px; right: 96px; bottom: 70px; font-size: 21px; color: var(--mute) }
.legend { display: grid; grid-template-columns: repeat(3, 1fr); gap: 30px; margin-top: 50px }
.legend > div { background: #fff; border: 1px solid var(--hair); border-radius: 22px; padding: 34px 34px 30px; min-height: 260px }
.lgIcon { display: flex; align-items: center; height: 72px }
.legend h3 { font-size: 26px; margin: 18px 0 8px } .legend p { font-size: 20px; line-height: 1.5; color: var(--mute) }
.lgRing { display: block; width: 150px; height: 56px; border: 4px solid var(--accent); border-radius: 10px; box-shadow: 0 0 0 4px rgba(255,90,31,.22) }
.lgBadge, .badge { display: inline-flex; align-items: center; justify-content: center; width: 52px; height: 52px; border-radius: 50%; background: var(--accent); color: #fff; font-size: 27px; font-weight: 800; border: 4px solid #fff; box-shadow: 0 0 0 1.5px rgba(21,19,31,.35) }
.lgCur { width: 44px; height: 56px }
.lgTag, .tag { display: inline-block; background: var(--accent); color: #fff; font-size: 17px; font-weight: 700; padding: 5px 13px; border-radius: 999px; box-shadow: 0 0 0 1.5px rgba(21,19,31,.3) }
.lgPhone { display: block; width: 44px; height: 70px; border: 7px solid #17151f; border-radius: 14px; background: #fff }
.lgPerson { display: block }
.cast { display: grid; grid-template-columns: repeat(3, 1fr); gap: 26px; margin-top: 40px }
.person { display: flex; gap: 22px; background: #fff; border: 1px solid var(--hair); border-radius: 22px; padding: 26px; min-height: 200px }
.person h3 { font-size: 26px } .person h3 small { font-size: 18px; color: var(--mute); font-weight: 500 }
.person p { font-size: 19px; line-height: 1.4; margin-top: 6px } .roleLine { color: var(--brand2); font-weight: 600 } .roleLine em { font-style: normal; background: #e8e3ff; padding: 1px 9px; border-radius: 8px; margin-right: 6px }
.teamLine { color: var(--mute) } .chLine { color: #8b89a0; font-size: 17px }
.treeBox { display: flex; gap: 44px; margin-top: 36px; align-items: flex-start }
.treeBox pre { background: #1b1a26; color: #ece9ff; font-family: MonoV, "JetBrains Mono", monospace; font-size: 29px; line-height: 1.5; padding: 34px 44px; border-radius: 22px; flex: none }
.typeKey { background: #fff; border: 1px solid var(--hair); border-radius: 22px; padding: 30px 34px; flex: 1 }
.typeKey h3 { font-size: 26px; margin-bottom: 16px } .typeKey p { font-size: 21px; line-height: 1.5; margin-top: 12px } .typeKey .fine { color: var(--mute) }
.tbl { width: 100%; border-collapse: collapse; background: #fff; border-radius: 18px; overflow: hidden; box-shadow: 0 0 0 1px var(--hair); margin-top: 26px; font-size: 19px }
.tbl th { text-align: left; background: #efedf9; padding: 12px 16px; font-size: 16px; text-transform: uppercase; letter-spacing: .06em; color: var(--mute) }
.tbl td { padding: 10px 16px; border-top: 1px solid var(--hair); vertical-align: top; line-height: 1.38 }
.tbl.units td:nth-child(2) { width: 110px } .tbl.small { font-size: 16px; margin-top: 8px } .tbl.small td, .tbl.small th { padding: 8px 12px }
.dimS { color: var(--mute); font-size: 14px }
.chip { background: #ece9f8; color: var(--brand2); font-weight: 700; padding: 3px 12px; border-radius: 999px; font-size: 16px }
.two { display: grid; grid-template-columns: 1.35fr 1fr; gap: 40px; margin-top: 26px }
.toc { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 26px }
.crow { display: flex; align-items: center; gap: 18px; padding: 6px 14px; border-radius: 16px; text-decoration: none; color: inherit; border-bottom: 1px solid var(--hair) }
.cn { width: 42px; height: 42px; border-radius: 50%; background: var(--brand); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 22px; flex: none }
.ct { flex: 1; display: flex; flex-direction: column } .ct b { font-size: 23px; line-height: 1.2 } .ct small { font-size: 15px; color: var(--mute); margin-top: 1px }
.cp { font-size: 20px; color: var(--mute); font-variant-numeric: tabular-nums }
.tips { display: grid; grid-template-columns: 1fr 1fr; gap: 20px 28px; margin-top: 36px }
.tipCard { display: flex; gap: 22px; align-items: flex-start; background: #fff; border: 1px solid var(--hair); border-radius: 20px; padding: 20px 26px }
.tipCard .key { flex: none; min-width: 74px; height: 62px; padding: 0 12px; display: inline-flex; align-items: center; justify-content: center; border-radius: 15px; background: #efedf9; color: var(--brand2); font-weight: 800; font-size: 25px }
.tipCard h3 { font-size: 23px } .tipCard p { font-size: 18px; line-height: 1.45; color: var(--mute); margin-top: 4px }
.end .cmd { margin-top: 36px; background: #1b1a26; color: #ece9ff; font-family: MonoV, "JetBrains Mono", monospace; font-size: 27px; line-height: 1.8; padding: 34px 44px; border-radius: 22px }

/* bolum ayiracı */
.chapter { background: linear-gradient(120deg, #2c1d7a, #5a43c6 60%, #7c63e8); color: #fff }
.chapter .chL { position: absolute; left: 100px; top: 110px; width: 900px }
.bigNum { font-size: 240px; line-height: .9; font-weight: 800; letter-spacing: -.05em; color: rgba(255,255,255,.22) }
.chapter h1 { font-size: 78px; line-height: 1.05; letter-spacing: -.03em; margin-top: 8px; font-weight: 800 }
.chapter .lead { font-size: 31px; line-height: 1.5; margin-top: 30px; color: rgba(255,255,255,.88) }
.whoCard { margin-top: 44px; display: inline-flex; gap: 20px; align-items: center; background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.25); border-radius: 22px; padding: 16px 30px 16px 18px }
.whoCard b { display: block; font-size: 28px } .whoCard span:not(.av) { font-size: 20px; color: rgba(255,255,255,.8) }
.chR { position: absolute; right: 70px; top: 110px; width: 790px; max-height: 860px; background: rgba(255,255,255,.96); color: var(--ink); border-radius: 26px; padding: 34px 40px; box-shadow: 12px 16px 0 rgba(8,4,40,.25) }
.chR h3 { font-size: 24px; color: var(--mute); margin-bottom: 14px } .chR ol { padding-left: 26px; font-size: 21px; line-height: 1.55 } .chR li::marker { color: var(--brand); font-weight: 700 }
.chR ol.cols { columns: 2; column-gap: 44px; font-size: 19px } .chR ol.cols li { break-inside: avoid }
.chapter footer { color: rgba(255,255,255,.6) }

/* adim sayfasi */
.step { padding: 0 }
.step .txt { position: absolute; left: 72px; top: 64px; bottom: 70px; width: 500px; display: flex; flex-direction: column }
.eyebrow { font-size: 15px; letter-spacing: .09em; text-transform: uppercase; color: var(--brand); font-weight: 700; margin-bottom: 22px }
.head { display: flex; gap: 20px; align-items: flex-start }
.num { flex: none; width: 66px; height: 66px; border-radius: 50%; background: var(--brand); color: #fff; font-size: 34px; display: inline-flex; align-items: center; justify-content: center }
.step h2 { font-size: 39px; line-height: 1.14; letter-spacing: -.02em; font-weight: 800; padding-top: 4px }
.cap { margin-top: 30px; font-size: 24px; line-height: 1.52; color: #2c2a38 } .cap b { color: var(--ink); font-weight: 700 } .cap i { color: var(--mute) }
.tip { margin-top: 26px; background: #fff7df; border: 1px solid #f3dc9a; border-radius: 16px; padding: 16px 20px; font-size: 20px; line-height: 1.45 } .tip span { display: block; font-size: 13px; letter-spacing: .1em; text-transform: uppercase; color: #a67a00; font-weight: 800; margin-bottom: 4px }
.who { margin-top: auto; display: flex; align-items: center; gap: 12px; font-size: 17px; color: var(--mute) } .who b { color: var(--ink) }
.bar { display: flex; gap: 4px; margin-top: 18px } .bar i { flex: 1; height: 6px; border-radius: 3px; background: #dcd8ee } .bar i.on { background: var(--brand) }
.pic { position: absolute; left: 640px; right: 64px; top: 64px; bottom: 70px; display: flex; align-items: center; justify-content: center }
.shot { position: relative; display: inline-block; line-height: 0; border-radius: 16px; overflow: hidden; box-shadow: 0 0 0 1px rgba(30,20,80,.18) }
.shot img { display: block; max-width: 1216px; max-height: 946px; width: auto; height: auto }
.phone { border-radius: 44px; box-shadow: 0 0 0 12px #17151f } .phone img { max-height: 926px; max-width: 460px }
.dim, .ring, .tag, .badge, .cursor { position: absolute; pointer-events: none }
.dim { inset: 0; width: 100%; height: 100% }
.ring { border: 4px solid var(--accent); border-radius: 11px; box-shadow: 0 0 0 4px rgba(255,90,31,.22) }
.badge { transform: translate(-50%, -50%) } .tag { transform: translateY(0) }
.cursor { width: 44px; height: 56px }
.mob .pic { left: 700px }
`;

function html() {
  const body = plan.map((p, i) => render(p, i + 1)).join("\n");
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>EkipTakip — Ekip kullanım rehberi</title><style>${CSS}</style></head><body>${body}</body></html>`;
}

// --- GUIDE.md ---------------------------------------------------------------------------------
function guideMd() {
  const out = [];
  out.push("# EkipTakip — Ekip kullanım rehberi\n");
  out.push("Demo verisiyle hazırlanmış, adım adım ekran rehberi. Adlar, e-postalar ve kayıtlar kurgudur. PDF sürümü: `" + name + ".pdf`.\n");
  out.push("## İçindekiler\n");
  chapters.forEach((c, i) => out.push(`${i + 1}. [${c.title}](#bolum-${i + 1}) — ${c.persona}, ${byChapter.get(c.id).length} adım`));
  out.push("\n## Birim ağacı\n");
  const prefix = (d) => (d === 0 ? "" : "    |" + "   |".repeat(d - 1));
  out.push("```\n" + units.map((u) => `${prefix(u.depth)}${u.name}(${u.type})`).join("\n") + "\n```\n");
  out.push("| Birim | Tür | Ne yapılır? |\n|---|---|---|");
  units.forEach((u) => out.push(`| ${"&nbsp;&nbsp;".repeat(u.depth)}**${u.name}** | ${u.type} | ${u.desc} |`));
  out.push("\n## Etkinlik türleri\n\n| Tür | Açıklama | Adımlar | Widget'lar |\n|---|---|---|---|");
  eventTypes.forEach((t) => out.push(`| **${t.name}** | ${t.desc} | ${t.steps || "—"} | ${t.widgets || "—"} |`));
  out.push("\n## Etkinlik yerleri\n\n| Yer | Açıklama |\n|---|---|");
  locations.forEach((l) => out.push(`| **${l.name}** | ${l.desc} |`));
  chapters.forEach((c, i) => {
    out.push(`\n<a id="bolum-${i + 1}"></a>\n## ${i + 1}. ${c.title}\n`);
    out.push(`*${c.persona} — ${c.role}.* ${c.intro}\n`);
    for (const s of byChapter.get(c.id)) {
      out.push(`### ${i + 1}.${s.local} ${s.title}\n`);
      out.push(`${plain(s.text)}\n`);
      if (s.tip) out.push(`> İpucu: ${plain(s.tip)}\n`);
      out.push(`![${s.title}](shots/${s.file})\n`);
    }
  });
  return out.join("\n") + "\n";
}

// --- calistir ----------------------------------------------------------------------------------
const { chromium } = loadPlaywright();
const browser = await chromium.launch({ args: ["--lang=tr-TR"] });
await shrink(browser);
const pdfDir = join(dir, "pdf");
mkdirSync(pdfDir, { recursive: true });
writeFileSync(join(pdfDir, "index.html"), html());
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(`file://${join(pdfDir, "index.html")}`, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
const pdfPath = join(dir, `${name}.pdf`);
if (process.argv.includes("--no-pdf")) {
  // Hizli yineleme: yalniz HTML (ve GUIDE.md) uretilir; sayfalari gormek icin `index.html` acilir.
  await browser.close();
  writeFileSync(join(dir, "GUIDE.md"), guideMd());
  console.log(`${total} sayfa (PDF atlandi) -> ${join(pdfDir, "index.html")}`);
  process.exit(0);
}
await page.pdf({ path: pdfPath, width: "1920px", height: "1080px", printBackground: true, preferCSSPageSize: true, outline: true, tagged: true });
await browser.close();
writeFileSync(join(dir, "GUIDE.md"), guideMd());
const mb = (statSync(pdfPath).size / 1e6).toFixed(1);
console.log(`${total} sayfa -> ${pdfPath} (${mb} MB)\nGUIDE.md yazildi`);
