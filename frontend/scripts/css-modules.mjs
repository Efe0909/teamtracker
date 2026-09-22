// CSS Modules icin iki denetim — `npm run build` / `typecheck` oncesi kosar:
//
// 1. Her `*.module.css` icin tipli bildirim (`*.module.d.css.ts`): siniflar
//    ADIYLA yazilir, indeks imzasi yok. Yanlis yazilan sinif adi derleme
//    hatasi olur (tsconfig `noPropertyAccessFromIndexSignature` ile uyumlu).
// 2. Ham renk yasagi: modul CSS'te hex renk YOK, yalniz token
//    (src/tokens.css tek kaynak — spec/16 §3.3).
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

let bad = 0;
for (const file of walk("src").filter((f) => f.endsWith(".module.css"))) {
  const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
    console.error(`${file}: ham renk ${m[0]} — src/tokens.css'teki bir token kullan`);
    bad++;
  }
  const names = [...new Set([...css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]))].sort();
  const body = names.map((n) => `  readonly ${JSON.stringify(n)}: string;`).join("\n");
  const out = `// URETILDI (scripts/css-modules.mjs) — elle degistirme.\ndeclare const styles: {\n${body}\n};\nexport default styles;\n`;
  const target = file.replace(/\.css$/, ".d.css.ts");
  let prev = "";
  try { prev = readFileSync(target, "utf8"); } catch {}
  if (prev !== out) writeFileSync(target, out);
}
if (bad > 0) process.exit(1);
