# 83 — Ekler: belge türleri ve uç başına boyut sınırı

**Durum: tasarım** (Efe ile 2026-10-14, Maliye eskiz turu). Bugünkü ek hattı
(`backend/src/media.rs`, `backend/src/api/attachments.rs`, R3-F08..F13) yalnız görsel
kabul ediyor. Maliye'nin fatura formu (spec/81 §5) fiş fotoğrafının yanında PDF fatura,
Excel döküm ve Word/PowerPoint belge istiyor; sohbette de aynı ihtiyaç var.

Kullanıcının sözü: *"attachment türlerine excel pdf word ppt regular text files (md, txt,
csv, py) seçeneği ekleyelim ve 10 MB'yi default limite çevirelim; different end points can
have different sizes."*

---

## 1. Kararlar

| # | Karar | Gerekçe |
|---|---|---|
| D1 | Üç **tür ailesi**: `image` (bugünkü hat), `document` (PDF + OOXML), `text` (md, txt, csv, py). | Her ailenin doğrulaması ve sunumu farklı; aile `attachments.kind` sütununda. |
| D2 | **10 MB varsayılan**, sınır **amaç** (purpose) başına. Uç kendi amacını bildirir; sınır kodda, amaç tablosunda. | "different end points can have different sizes". Sınırı veri yerine kod tutar: güvenlik değeri, yönetimden değişmesi istenmedi. |
| D3 | Tür **baytlardan** çıkarılır, dosya adı ve istemcinin `Content-Type`'ı yalnız metin alt türünü (md/txt/csv/py) seçmek için okunur. | Bugünkü kural (media.rs §1) korunur. |
| D4 | Belge ve metin **yeniden kodlanmaz, küçük resmi yok**; olduğu gibi diske yazılır (KNOW-230: HDD). | PDF/OOXML'i güvenle yeniden üretecek bir kütüphane yok; içerik doğrulaması yapıya bakarak yapılır (§3). |
| D5 | **Makrolu Office reddedilir** (`.docm`, `.xlsm`, `.pptm`, içinde `vbaProject.bin` olan her paket). Eski ikili biçimler (`.doc`, `.xls`, `.ppt`, OLE/CFB) **kabul edilmez**: "Belgeyi .docx/.xlsx/.pptx olarak kaydet" uyarısı. | Eski biçimde makro ayıklanamaz, varlığı bile güvenle anlaşılamaz. Kulübün belgeleri zaten Google Drive/Office çıktısı (OOXML). **Efe onayı bekler** (§8). |
| D6 | Görsel dışı her şey **indirme** olarak sunulur: `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`. Metin her zaman `text/plain; charset=utf-8` (asla `text/html`). | Kendi kökenimizde yüklenen bir HTML/SVG/PDF'in betik çalıştırması XSS'tir. SVG zaten kabul edilmiyor. |
| D7 | Fatura ve kasa defterine bağlı ek **silinmez** (yasal saklama), süpürülmez; bağlı kayıt iptal edilse de dosya kalır. | spec/81 D-12: "HDD var, 500 GB, sakla". |
| D8 | Sınırı aşan istek **gövde okunmadan** reddedilir: rota katmanında `DefaultBodyLimit` = o rotanın en büyük amaç sınırı + 1; amaç sınırı işlemede ikinci kez denetlenir. | Bugünkü desen (`api/mod.rs` `/api/attachments` katmanı). |

## 2. Amaçlar ve sınırlar (kod: `media::Purpose`)

Yükleme `POST /api/attachments?purpose=<amaç>&name=<ad>`. Amaç verilmezse `chat` (geriye
uyumlu: bugünkü istemci ve mobil yüz değişmeden çalışır).

| `purpose` | Kabul edilen aileler | Sınır | Nereye bağlanır |
|---|---|---|---|
| `chat` | image, document, text | 10 MB | `message_attachments`, `card_attachments` |
| `avatar` | image | 5 MB | `users.avatar_id` |
| `banner` | image | 10 MB | `teams.banner_id` |
| `invoice` | image, document (yalnız PDF + `xlsx`), text (`csv`) | 10 MB | `invoice_attachments` (spec/81) |
| `ledger` | image, document (yalnız PDF) | 10 MB | `ledger_attachments` (spec/81) |

Mail şablonu (`.html`, `.md`) **ek değildir**: dosya istemcide okunur ve metin olarak
`mail_templates.body`'ye yazılır (spec/81 §9, 256 KB). `text/html` hiçbir amaçla ek olarak
kabul edilmez; kendi kökenimizden HTML sunmanın yolu hiç açılmaz.

- Sınır tek yerde: `media::Purpose::max_bytes()`. `/api/meta` aynı tabloyu `upload_limits`
  olarak verir; ön yüz "en fazla 10 MB" metnini oradan yazar, sayı elle yazılmaz.
- `media::MAX_BYTES` adı `DEFAULT_MAX_BYTES` olur (10 MB), amaç tablosunun varsayılanı.
- Rota katmanı: `DefaultBodyLimit::max(Purpose::LARGEST + 1)`.

## 3. Doğrulama hattı (`media::process` → `media::accept`)

Sıra (her adım reddedebilir; hata kodu parantezde):

1. Boş gövde (`empty_file`), amacın sınırı (`file_too_big`).
2. **Sihirli bayt** ile aile:
   - `image`: bugünkü `sniff` (JPEG, PNG, GIF, WebP) → bugünkü hat (çöz, EXIF uygula,
     yeniden kodla, küçük resim). Değişmez.
   - `%PDF-` → PDF.
   - `PK\x03\x04` → ZIP; OOXML mu diye §3.1.
   - `D0 CF 11 E0 A1 B1 1A E1` (OLE/CFB) → `legacy_office_not_allowed`.
   - Hiçbiri değilse ve amaç `text` kabul ediyorsa → §3.2; yoksa `bad_file_type`.
3. Amaç bu aileyi/alt türü kabul ediyor mu (`bad_file_type`).

### 3.1 OOXML (docx, xlsx, pptx)

`zip` sandığı zaten bağımlılıkta (OTF `.docx` üretimi). Paket **açılmadan** merkez dizini okunur:

- Girdi sayısı ≤ 2 000, açılmış toplam boyut ≤ 100 MB, tek girdi sıkıştırma oranı ≤ 100
  (zip bombası; aşan `corrupt_file`).
- `[Content_Types].xml` var olmalı; ana parça türü belirler: `word/document.xml` → docx,
  `xl/workbook.xml` → xlsx, `ppt/presentation.xml` → pptx. Hiçbiri yoksa `bad_file_type`
  (sıradan bir ZIP arşivi kabul edilmez).
- `vbaProject.bin` adlı herhangi bir girdi ya da içerik türünde `macroEnabled` →
  `macro_not_allowed`.
- Yol geçişi (`..`, mutlak yol) içeren girdi adı → `corrupt_file`. Paketi biz açmıyoruz ama
  indiren istemciyi koruyacak ucuz bir denetim.

### 3.2 Metin (md, txt, csv, py)

- Alt tür **dosya adının uzantısından** (`.md`, `.txt`, `.csv`, `.py`); uzantı yoksa ya da
  listede değilse `bad_file_type`.
- İçerik geçerli UTF-8 (BOM atılır), NUL baytı yok, satır sonu serbest. Değilse
  `bad_text_encoding`.
- Saklanan MIME: `text/markdown`, `text/plain`, `text/csv`, `text/x-python`; **sunumda
  hepsi** `text/plain; charset=utf-8`.

### 3.3 PDF

- `%PDF-` başlığı ve dosyanın son 1 KB'sinde `%%EOF` (yarım yüklemeyi yakalar; `corrupt_file`).
- İçerik ayrıştırılmaz (betik/form denetimi yok); bu yüzden sunum D6'daki gibi indirme.

## 4. Şema (göç 026)

```sql
alter table attachments
  add column kind    text not null default 'image' check (kind in ('image','document','text')),
  add column purpose text not null default 'chat'
    check (purpose in ('chat','avatar','banner','invoice','ledger'));
alter table attachments drop constraint attachments_mime_check;
alter table attachments add constraint attachments_mime_check check (mime in (
  'image/jpeg','image/png','image/webp','image/gif',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/markdown','text/plain','text/csv','text/x-python'));
-- Aile ile MIME tutarlı: görsel olmayanın küçük resmi ve boyutu yok.
alter table attachments add check ((kind = 'image') = (mime like 'image/%'));
alter table attachments add check (kind = 'image' or (thumb_key is null and width is null and height is null));
-- Profil fotoğrafı ve takım kapağı yalnız görsel.
alter table attachments add check (purpose not in ('avatar','banner') or kind = 'image');
```

### 4.1 Bağlanabilirlik ve süpürme

`attachments::claimable` ve `media::sweep` bugün yalnız mesaj/kart/profil/kapak tablolarını
biliyor. Yeni bağ tabloları (`invoice_attachments`, `ledger_attachments`)
**ikisine de** eklenir; eklenmezse fatura eki bir gün sonra süpürülür (veri kaybı). Bunun
için tek kaynak: `media::OWNER_TABLES` sabiti; iki sorgu da ondan üretilir ve birim testi
listeyi göçteki `references attachments` sayısıyla karşılaştırır.

Bağ, ekin **amacıyla** uyumlu olmalı: mesaj ve kart yalnız `chat` amaçlı eki alır
(`invalid_attachment`); `invoice`/`ledger` bağları yalnız kendi amacını alır. Profil fotoğrafı
ve takım kapağı amaca değil **içeriğe** bakar: görsel olmalı ve o amacın sınırını aşmamalı
(`invalid_avatar` / `invalid_banner`). Böylece eski istemci (amaçsız yükleme) çalışmaya devam
eder, 5 MB'lık profil sınırı da `chat` amacıyla yükleyip takılarak aşılamaz.

### 4.2 Silme

- Bugünkü kural (yükleyen ya da admin, yumuşak silme, dosya hemen gider) `chat`, `avatar`,
  `banner` için aynen.
- `invoice` ve `ledger`: bağlıysa `409 attachment_locked`. Bağlı olmayan (form gönderilmeden
  bırakılmış) ek bugünkü gibi süpürülür.

## 5. Sunum (`GET /api/attachments/{id}`)

| Aile | `Content-Type` | `Content-Disposition` | Ek başlık |
|---|---|---|---|
| image | DB'deki MIME | `inline` (bugünkü gibi) | `nosniff` |
| document | DB'deki MIME | `attachment; filename*=UTF-8''<ad>` | `nosniff`, `CSP: sandbox` |
| text | `text/plain; charset=utf-8` | `attachment; filename*=UTF-8''<ad>` | `nosniff`, `CSP: sandbox` |

- Dosya adı RFC 5987 (`filename*`) ile; Türkçe karakter bugün `"` temizlenip ham yazılıyor,
  bazı tarayıcıda bozuluyor.
- `/thumb` yalnız görselde; belge için `404`.
- İzin (görme) değişmez: gizli kayda bağlı ek yalnız üyeye (spec/75 A5). Fatura/kasa eki:
  faturayı görebilen (gönderen, `review_purchases`, `manage_ledger`, admin; spec/81 §11).

## 6. Ön yüz

- `upload(file, purpose)`; dosya seçicinin `accept` özniteliği amaçtan (`/api/meta`
  `upload_limits[purpose].accept`).
- Belge/metin eki sohbette ve fatura formunda **dosya çipi**: tür rozeti (`PDF`, `XLSX`,
  `MD`…), ad, boyut; tıklayınca indirir. Görsel bugünkü gibi küçük resim.
- Yükleme öncesi istemci boyutu denetler (sunucu yine denetler), aşınca "Bu alan için en
  fazla 10 MB" metni sınırı `upload_limits`'ten yazar.
- Hata kodları (`api/errors.ts`, Türkçe): `macro_not_allowed` "Makro içeren belge
  yüklenemez; makrosuz kaydedip tekrar dene.", `legacy_office_not_allowed` "Eski Office
  biçimi desteklenmiyor; .docx/.xlsx/.pptx olarak kaydet.", `bad_text_encoding` "Metin
  dosyası UTF-8 olmalı.", `corrupt_file` "Dosya bozuk görünüyor.", `attachment_locked`
  "Bu belge bir faturaya ya da kasa kaydına bağlı; silinemez."

## 7. Sınama

- `media` birim testleri: her ailenin kabul/ret örnekleri (sahte PDF başlığı, `.docm`,
  OLE başlığı, zip bombası benzeri oran, NUL içeren metin, uzantısız metin).
- `OWNER_TABLES` listesi ile göçlerdeki `references attachments` sayısı eşleşir.
- `local_test.sh`: `purpose=avatar` ile 6 MB → `400 file_too_big`; `purpose=chat` ile PDF
  kabul, indirme başlıkları `attachment` + `nosniff`; faturaya bağlı ek silme `409`.

## 8. Açık sorular

1. **Eski Office biçimleri** (D5): kulüpte `.xls` gelen bir SEB dökümü var mı? Varsa
   yalnız `invoice` amacında, indirme-yalnız ve "makro taşıyabilir" uyarısıyla açılabilir.
2. **PDF önizlemesi**: fatura onayında fişi görmek için PDF'i sekmede açmak isteniyor.
   `CSP: sandbox` bazı tarayıcıların PDF görüntüleyicisini engelliyor; cihazda denenmeden
   `inline` açılmaz. Şimdilik indirme + görselse önizleme.

## 9. Alınmayanlar

- Virüs taraması (ClamAV): Pi'de bellek ve güncelleme yükü; tür beyaz listesi + indirme
  sunumu riski yeterince daraltıyor.
- Video ve büyük dosya: KNOW-226 geçerli (kulüp Drive'ı + bağlantı).
- Arşiv (`.zip`, `.rar`) yüklemesi: içeriği denetlenemez.
