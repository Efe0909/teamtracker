# Markdown editörü — gerçek tarayıcı denetimleri

jsdom geometri ölçemez; bu betikler gerçek Chromium'da editörün **geometri ve imleç**
davranışını sınar. `npm test` / `npm run build` parçası DEĞİL: Playwright repo
bağımlılığı olarak kurulu değil, elle koşulur. (Kabul matrisi: `spec/78-markdown-editor.md`.)

```bash
cd frontend
npm install --no-save playwright      # yalnız bu denetimler için, package.json'a yazılmaz
npx vite --port 5199 --strictPort &   # harness: /tools/md-browser/index.html
node tools/md-browser/browser.mjs     # dikey kayma, imleç tuzağı, kural genişliği, başlık boyutu, URL yazımı, toolbar
node tools/md-browser/browser2.mjs    # elle yazım, fare/sürükleme, Shift+ok, link/liste/kod toolbar'ı, salt okunur tutarlılık
node tools/md-browser/fuzz.mjs        # rastgele belgelerde ArrowRight/Left taraması
node tools/md-browser/dialog.mjs      # gerçek Radix Dialog içinde placeholder/imleç hizası, çeşitli yakınlaştırma
```

Ortam: `MD_HARNESS` harness adresini değiştirir. Boyutlar tarayıcı yakınlaştırmasını
DPR artışı + CSS görünüm alanı daralması olarak taklit eder (CSS `zoom` değil).
Harness (`main.tsx`) sahte `meta` ile gerçek `MarkdownField`/`Dialog`/tokens'ı çizer.
