# spec/ — uyarlanacak ekranların çözümlemesi

Mevcut sistemden alınan ekran görüntüleri burada **yapıya** çevrilir: ne gördüğümüz değil,
ne kuracağımız yazılır. Her ekran iki çıktı verir:

```
spec/
  README.md               bu dosya — yazım kuralları (ajan brief'i)
  00-index.md             ekran listesi + akış haritası + durum
  gorseller/              ham ekran goruntuleri — GIT'E GIRMEZ (.gitignore)
  NN-<ekran>.md           çözümleme raporu
  iskelet/<ekran>.html    statik HTML iskelet (layout-a.html kalıbında)
```

## Rapor ne içerir (`NN-<ekran>.md`)

1. **İş** — bu ekran hangi soruyu cevaplıyor, kim kullanıyor, günde kaç kez.
2. **Akış** — bir öncesi / bir sonrası hangi ekran, hangi eylemle geçiliyor.
3. **Ekrandaki bölgeler** — her biri bir `data-fragment` adıyla: ne gösteriyor, nereden
   besleniyor (hangi tablo/sütun — `01-sema.md`'ye bağla), boşken ne yazıyor.
4. **Eylemler** — düğme/alan başına: kim yapabilir (yetki), sunucuda ne değişir,
   ekranda ne tazelenir.
5. **Veri ihtiyacı** — mevcut şemayla karşılanıyor mu; karşılanmıyorsa eksik tablo/sütun
   önerisi, `01-sema.md`'deki hangi açık noktaya denk geldiği.
6. **Alınmayacaklar** — kaynaktaki neyi kasten kopyalamıyoruz ve neden.

Kaynak ekranın kötü yanlarını da yaz. Birebir kopya değil, uyarlama yapıyoruz.

## İskelet ne olur (`iskelet/<ekran>.html`)

- `layout-a.html` kalıbı: her bölge `<section data-fragment="X">`, parça **nerede
  gösterildiğini bilmez** (00-BASLA.md Karar 3 — skin kuralı).
- Renkler `static/app.css` token'larından: `--acc`, `--line`, `--panel`, `--dim`, `--sh`…
  **Ham renk yazma.** İskelet `<link rel="stylesheet" href="/static/app.css">` ile açılsın,
  ekrana özel ne varsa aynı token'ların üstüne, dosya içinde `<style>` olarak.
- Statik ve tıklanabilir olmayan bir taslak yeter: JS yok, HTMX yok, veri uydurma
  (tohum verisindeki isimlerle: Efe / Selin / Deniz, Malzeme Temini, BÜT-1042…).
- Parça içinde `position:absolute` ve sabit genişlik yok — kap boyutlandırır.

## Kurallar

- **Gerçek veri yazma.** Depo public. Ekran görüntüsündeki müşteri/çalışan adları, kayıt
  içerikleri, dosya yolları spec'e geçmez; yapıyı anlat, örnekleri tohum verisinden uydur.
- Görseller `spec/gorseller/` içinde kalır, commit edilmez.
- Rapor `01-sema.md` ve `00-BASLA.md`'ye atıf yapsın; aynı kararı ikinci kez almayalım.
- Bir ekran hazır olduğunda `00-index.md` satırı güncellenir ve `app.py`'deki `MODULES`
  kaydına bağlanır (`ready` bayrağı ancak gerçek rota yazılınca `True` olur).
