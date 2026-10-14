# 86 — @kayıt / @etkinlik bağlantıları ve graf görünümü

**Durum: tasarım** (Efe ile 2026-10-14). İki istek tek belgede, çünkü ikincisi birincinin
verisiyle çalışıyor:

1. *"Chat ve açıklama field'larına @record ve @event ekleme gelsin, direkt sayfaya
   yönlendiren."* (Stele TASK-398)
2. *"Az önce bahsettiğim outgoing linklerle bir graph view kurabiliriz; TypeScript ile
   Obsidian style graph."* Kapsam kararı: **kayıt + etkinlik + ağaç** düğümleri; kenarlar
   anma bağlantıları + ağaç ebeveynliği; anlamsal benzerlik kenarları anahtarla.

Bağlı: KNOW-263 (kişi anması: ayrı tablo yok), KNOW-340 (etkinliğin ikiz kaydı),
KNOW-377 (açıklama Markdown kaynağı saklanır), `75-yetki.md` (görme), `85-embedding.md`.

---

## 1. Kararlar

| # | Karar | Gerekçe |
|---|---|---|
| L1 | Bağlantı metinde **kimlikle** yazılır: `@[Görünen ad](record:<uuid>)`, `@[Görünen ad](event:<uuid>)`. Köşeli parantezdeki ad yalnız yedek; ekran güncel başlığı çizer. | Başlık değişince bağ kopmaz; Markdown kaynağı (KNOW-377) okunur kalır. |
| L2 | Kişi anması (`@ayse-yilmaz`) **değişmez**. Yeni sözdizimi `@[` ile başlar; bugünkü `MENTION` deseni ve `mentions::tokens` onu yakalamaz (`[` sınıfta yok). | İki sistem çakışmaz, eski mesajlar aynı okunur. |
| L3 | Kayıt/etkinlik anması **bildirim üretmez**. | Kişi anması "kime haber", bu "nereye bağlantı" (KNOW-273'teki ayrımın üçüncü kolu). |
| L4 | Bağlantılar **`links` tablosunda türetilmiş** olarak tutulur: kaynak metin her kaydedildiğinde o kaynağın satırları silinip yeniden yazılır. Gerçeğin kaynağı metindir. | Graf ve geri bağlantılar (backlinks) metni her istekte taramadan çalışsın. Kişi anmasından (KNOW-263) farkı: o her seferinde katılımcı kümesinden hesaplanabiliyor, bu sorgu tüm metinleri gezmek ister. |
| L5 | **Etkinlik ile ikiz kaydı tek düğüm**: grafta etkinlik görünür, ikiz kayda gelen bağ etkinliğe yazılır. | KNOW-340: ikiz kayıt etkinliğin sohbet/katılımcı gövdesi; ayrı düğüm çift sayardı. |
| L6 | **Görme izni** her yerde: bağlantı çipi, geri bağlantı listesi ve graf, görülemeyen kaydın başlığını vermez ("Gizli kayıt"), grafta düğümü hiç vermez. | spec/75 A5. |
| L7 | Graf çizimi **`force-graph`** (canvas, d3-force tabanlı) ile; tek yeni bağımlılık. | Yakınlaştırma, sürükleme, isabet testi ve kuvvet benzetimi "birkaç satır" değil; canvas 5 000 düğüme kadar akıcı. WebGL (sigma.js) bu ölçekte gereksiz. |

## 2. Yazma: seçici

- Sohbet kutusu ve Markdown açıklama alanında `@` yazınca bugünkü kişi listesi açılır; altına
  iki bölüm eklenir: **Kayıtlar** ve **Etkinlikler** (yazılan metinle aranır, en fazla 5'er).
- Kaynak: `GET /api/link-targets?q=&limit=5` → `{records: [{id, title, kind}], events: [{id, title, date}]}`;
  yalnız çağıranın görebildikleri. Boş `q`: son açtıkları (ziyaret izi yoksa son güncellenenler).
- Seçilince `@[Başlık](record:<id>)` eklenir. Markdown düzenleyicide (CodeMirror) belirteç
  tek parça çip olarak görünür; sohbet kutusu düz metin ama gönderim öncesi önizlemede çip.
- `@[` elle yazılabilir; kimlik geçersizse sunucu kabul eder, ekran "bulunamadı" çipi çizer
  (metin kullanıcının, ret yok).

## 3. Okuma: çip ve geri bağlantılar

- Ön yüz belirteci **çip** olarak çizer: tür simgesi + **güncel başlık** (meta/önbellekten;
  bilinmiyorsa köşeli parantezdeki ad) + tıklayınca sayfaya git (`/tasks/{id}`, `/events/{id}`;
  mobilde `/record/{id}`). Görülemeyen kayıt: "Gizli kayıt", tıklanabilir değil.
- Başlıklar `POST /api/link-targets/resolve {ids}` ile toplu çözülür (N+1 yok).
- **Geri bağlantılar** ("Buraya bağlananlar"): kayıt ve etkinlik sayfasında küçük bölüm;
  `GET /api/links/backlinks?kind=record&id=` → kaynak (kayıt/etkinlik), nereden (açıklama,
  mesaj), ne zaman. Görme izniyle süzülür.

## 4. Veri (göç 030)

```sql
create table links (
  origin_kind text not null check (origin_kind in ('record_description','event_description','message','card')),
  origin_id   uuid not null,                 -- kaydın/etkinliğin/mesajın/kartın kimliği
  src_kind    text not null check (src_kind in ('record','event')),
  src_id      uuid not null,                 -- grafta kenarın başı (ikiz kayıt → etkinlik, L5)
  dst_kind    text not null check (dst_kind in ('record','event')),
  dst_id      uuid not null,                 -- ikiz kayıt → etkinlik (L5)
  created_at  timestamptz not null default now(),
  primary key (origin_kind, origin_id, dst_kind, dst_id)
);
create index on links (dst_kind, dst_id);
create index on links (src_kind, src_id);
```

- **Yazma kuralı (tek fonksiyon `links::sync(tx, origin, text)`):** aynı işlemde
  `delete from links where origin = …` + belirteçlerin ayrıştırılmış kümesi. Çağıranlar:
  kayıt açıklaması, etkinlik açıklaması, mesaj gönder/düzenle, kart metni. Mesaj silinince
  (yumuşak silme dahil) bağları silinir.
- `src`: açıklama için sahibi; mesaj için sohbetin sahibi (kaydın sohbeti → kayıt; ikiz kayıt →
  etkinlik; takım duvarı → **bağ yazılmaz**, graf takım düğümü taşımıyor); kart için kartın kaydı.
- Hedef var olmasa da satır yazılmaz (yalnız var olan kayıt/etkinlik); silinen hedefin
  bağları gece süpürmesinde temizlenir (FK yok: çok biçimli).
- **Dolgu:** göçte yok (bugün `@[` belirteci yok). Sözdizimi gelince yazılan her metin bağ üretir.
- Ayrıştırıcı Rust `links::parse` ve TS `lib/links.ts` aynı test fikstürüyle (`@[a](record:<uuid>)`,
  kaçışlı köşeli parantez, bozuk kimlik, kişi anmasıyla karışık metin).

## 5. Graf görünümü

### 5.1 Düğümler ve kenarlar

| Düğüm | Kaynak | Boyut |
|---|---|---|
| Kayıt (ikizi olmayan) | `records` | bağ sayısı |
| Etkinlik | `events` (ikiz kaydı içinde, L5) | bağ sayısı |
| Ağaç düğümü | `nodes`, yalnız **Birimler** alt ağacı (`root_key = units`) | çocuk + bağlı kayıt sayısı |

| Kenar | Nereden | Görünüm |
|---|---|---|
| `link` | `links` (yönlü) | düz çizgi + ok |
| `tree` | `nodes.parent_id` ve `records.unit_id` | ince, soluk |
| `semantic` | spec/85 §6: en yakın 5 komşu, kosinüs ≥ 0.80 | kesikli; **varsayılan kapalı** anahtar |

Etkinlik türü, yer, kazanım düğümleri ve kişiler/takımlar/malzemeler **yok** (Efe'nin kapsam
seçimi; "her şey" kalabalık).

### 5.2 Uç

`GET /api/graph?semantic=0|1&unit=<node>&since=<date>`:
```json
{ "nodes": [{"id": "…", "kind": "record|event|node", "label": "…", "group": "<unit id>", "weight": 3, "status": "open"}],
  "edges": [{"s": "…", "t": "…", "kind": "link|tree|semantic"}],
  "truncated": false }
```
- Görme izniyle süzülür (L6): görülemeyen kayıt düğüm olarak hiç dönmez, ona giden kenar da.
- Üst sınır 5 000 düğüm; aşılırsa en çok bağı olanlar + `truncated: true` ve ekranda
  "süzgeç daralt" uyarısı.
- `ETag` (düğüm/kenar sayıları + son `updated_at`) ile önbellek.

### 5.3 Ekran (`/graph`, dashboard)

- Tam ekran canvas; sol üstte arama (düğüme odaklanır), süzgeçler: tür (kayıt / etkinlik /
  ağaç), birim, tarih ("son 90 gün"), **Anlamsal kenarlar** anahtarı (servis kapalıysa gri,
  açıklamalı).
- Etkileşim (Obsidian kalıbı): fareyle üzerine gelince düğüm ve komşuları vurgulanır, diğerleri
  soluklaşır; tıklayınca sağda küçük panel (başlık, tür, durum, "Aç"); çift tıklama sayfaya
  gider; sürükle-bırak düğümü sabitler; tekerlekle yakınlaştırma.
- Renkler `tokens.css`'ten: canvas çizim sırasında `getComputedStyle` ile `--chart-1..6`
  (birim grubu başına), `--dim` (ağaç kenarı), `--acc` (vurgu); tema değişince yeniden okunur.
  Ham renk yok (`npm run build` denetimi).
- `prefers-reduced-motion`: benzetim ilk yerleşimden sonra durur (`cooldownTicks` düşük),
  sürekli titreşim yok.
- **Yerel graf** (Obsidian "local graph"): kayıt ve etkinlik sayfasında "Bağlantılar" bölümü,
  derinlik 1 (isteğe bağlı 2) küçük graf; geri bağlantı listesinin yanında. Aynı bileşen,
  `GET /api/graph?focus=<kind>:<id>&depth=1`.
- Mobilde graf yok (masaüstü işi); mobil kayıt sayfasında yalnız geri bağlantı listesi.

### 5.4 Bileşen yapısı (`spec/16` §3)

- `features/graph/GraphCanvas.tsx` — `force-graph` sarmalayıcı (alan bilmez değil: graf
  sözleşmesini bilir, o yüzden `features/`).
- `surfaces/dashboard/Graph.tsx` — sayfa, süzgeçler, URL durumu (KNOW-234: `replace`).
- Rota: `{ name: "graph"; query: GraphQuery }`, adres `/graph`.

## 6. Sınama

- `links::parse` / `lib/links.ts` ortak fikstür.
- `links::sync`: açıklamayı düzenleyince eski bağ gider, yeni gelir; ikiz kayda bağ → etkinlik.
- `local_test.sh`: gizli kayda bağlantı, yetkisiz kullanıcının grafında ve geri bağlantı
  listesinde görünmez; çip "Gizli kayıt".
- vitest: seçici `@` sonrası üç bölüm; çip güncel başlığı çizer.

## 7. Alınmayanlar

- **Bağlantı bildirimi** (L3).
- **Takım duvarındaki mesajın bağları**: graf takım düğümü taşımıyor.
- **Graf düzenleme** (grafta sürükleyerek bağ kurma): bağ metinden doğar.
- **Kişi, malzeme, tedarikçi düğümleri**: kapsam kararı.

## 8. Açık sorular
1. Kart (`cards`) metinleri de bağ üretsin mi? Bu belge "evet" varsayıyor; kartlar kaydın
   parçası, kaynak kayıt olur.
2. "Son açtıklarım" için ziyaret izi tutulmuyor; tutulsun mu, yoksa son güncellenenler yeter mi?
