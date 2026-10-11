# Opus için görev istemi — Yönetim › "Veri işleme ve LLM" sayfası

> **Durum: uygulandı (2026-10-10).** Görüşmede alınan kararlar ve gerçekleşen tasarım
> `spec/79-llm-yuku.md` §11'de; bu belge yalnız tarihçe. Aşağıdaki "yalnız admin" ve "sormadan
> karar verme" maddeleri görüşmede kapandı (`manage_llm` kapsamı, gövde 7 gün, istem DB'de,
> kapı kayıtta ve modeli DB'de, model başına dolar limiti).

> Aşağıdaki bloğu olduğu gibi yeni bir Opus oturumuna ver. Depo: `teamtracker`
> (EkipTakip). Önce `CLAUDE.md`'yi ve `spec/79-llm-yuku.md`'yi okumasını söylüyor.

---

## Görev

EkipTakip'in Yönetim bölümüne **"Veri işleme ve LLM"** adlı yeni bir sekme (yalnız admin) tasarla
ve yaz. Bugün yapay zekâ ayarları dağınık: modelin adı `backend/manifest.json`'da (yeniden
dağıtım ister), temizleme kuralları `llm_config`'te (tek satır), kalite kapısı soruları
`quality_config`'te, çağrı sayısı/maliyeti hiçbir yerde saklanmıyor (yalnız log satırı). Bu sayfa
hepsinin tek yeri olacak: **model ayarları, limitler, çağrı geçmişi, toplam maliyet, temizleme
kuralları**. Hedef: model değiştirmek, limit koymak ya da maliyete bakmak için kod değişikliği
ve dağıtım gerekmesin.

**Önce spec, sonra kod** (repo kuralı): `spec/79-llm-yuku.md`'ye yeni bir bölüm yaz
(tablolar, uçlar, kararlar, açık sorular), ben onaylayınca uygula. Kararı bana ait olan
noktaları (aşağıda "Sormadan karar verme") onay almadan seçme.

## Neden bu kadar kolay: tek anahtar, tek payload biçimi

Bütün üretken çağrılar **aynı OpenRouter anahtarıyla** (`OPENROUTER_API_KEY`, ~/nix'te agenix
sırrı; asla yazdırma, loglama, istemciye gönderme) ve **aynı sohbet-tamamlama biçimiyle**
(`POST /api/v1/chat/completions`, `response_format: json_schema`) gidiyor. Yani "hangi model"
ve "hangi parametreler" yalnız **veri**; yeni bir özellik (ör. mail taslağı) aynı çağrı
yoluna yeni bir `feature` adıyla biner. Bu yüzden ayarlar DB'de tutulabilir, kodda model adı
kalmaz.

## Bugünkü durum (okuyup doğrula; satır numaralarına güvenme)

**Backend** (Rust, axum, sqlx; İngilizce kod, Türkçe kullanıcı metni):
- `backend/src/openrouter.rs`: tek sohbet-tamamlama istemcisi. `body()` (json_schema strict,
  `reasoning.enabled=false`, `provider.require_parameters=true`, `max_tokens`), `reply()`,
  `usage()` (cevaptaki `usage.prompt_tokens/completion_tokens/cost` ve `id`), `structured()`
  (kapı `Service::Suggest`; kullanımı loga yazar, **DB'ye yazmaz**). Zaman aşımı 30 sn.
- `backend/src/api/events/context/materials.rs`: tek çağıran. `material_suggestions` ucu,
  deneysel `SYSTEM` istemi (sabit), `BATCH = 9`, `sanitize`. Model adı
  `st.cfg.suggest_model` (manifest).
- `backend/src/api/events/context.rs`: LLM yükü (`build_context`, `Scrub`, `known_names`);
  `use_generative_ai` kapsamı burada aranır.
- `backend/src/api/llm.rs` + `backend/src/redact.rs`: temizleme kuralları
  (`llm_config`: `free_text_allowed`, `rules{patterns, known_names, capitalized}`), admin
  `GET/PUT/DELETE /api/admin/llm`, `security_events`'e `llm_config_changed`.
- `backend/src/config.rs` + `backend/manifest.json`: `Service::Suggest`, `suggest_model`
  (isteğe bağlı, varsayılan `deepseek/deepseek-v4.1-flash`), `external_off`, `external_on()`.
- `backend/src/decision.rs`: **kalite kapısı** (spec/76) — **farklı uç**
  (`/api/alpha/decisions`, `decision_model`), ama aynı anahtar. Sayfa bunu da göstermeli
  (model adı, durum); çağrı kaydı için ayrı bir bağlama noktası gerekir.
- Göç numarası: son dosya `023_generative_ai_scope.sql`; yeni göç 024+. **Göç dosya adları
  donuktur**, uygulanmış göçü değiştirme.
- Kalıp örneği: `backend/src/api/quality.rs` (tek satır jsonb config, admin-only,
  `security_events`), `backend/src/api/llm.rs`.

**Frontend** (React + TS strict, CSS Modules, renk yalnız `src/tokens.css`):
- `frontend/src/surfaces/dashboard/Admin.tsx`: sekmeler (kişiler, "Kalite kapısı", Aktivite).
  Kalıp: `AdminQuality.tsx` (+ `AdminQuality.test.tsx`), `AdminActivity.tsx` (sıralanabilir
  tablo: `ui/SortTh`, `lib/sort`).
- `frontend/src/api/{hooks,types,errors}.ts`, `lib/labels.ts` (kapsam etiketleri),
  `SuggestCards.tsx`, `lib/suggestions.ts` (öneri arayüzü).

**Gerçek deneme sonucu** (`spec/79` §9): `deepseek/deepseek-v4.1-flash`, parti başına 3-6 sn,
~8 öneri; kabul edilen parametreler çalışıyor. OpenRouter her cevapta `usage.cost` (USD)
veriyor; `suggest_try.sh` ile denenir (`deploy/suggest_try.sh`).

## Yapılacaklar (öneri; spec'te netleştir)

1. **Çağrı kaydı (`llm_calls` tablosu).** `openrouter::structured` (ve ileride `decision.rs`)
   her çağrıda bir satır yazar: `id`, `created_at`, `feature` (ör. `material_suggestions`,
   `quality_gate`), `model`, `user_id`, `event_id` (varsa), `status` (ok / hata türü: http
   kodu, şema uyumsuz, kapalı), `ms`, `prompt_tokens`, `completion_tokens`, `cost_usd`,
   `or_gen_id` (OpenRouter üretim kimliği), `batch_id`, `asked`/`kept` sayıları.
   **İstem ve cevap GÖVDESİ saklanmaz** (temizlense de serbest metin taşıyabilir); isteğe
   bağlı "gövdeyi sakla" anahtarı koymak istersen KVKK/saklama süresiyle birlikte soru olarak
   bana getir. Başarısız (ücret doğan) çağrılar da yazılır. Saklama süresi (ör. 180 gün) ve
   temizlik işi.
2. **Model ve parametre ayarı (`llm_features` / `llm_config` genişletmesi).** Özellik başına:
   model adı, `max_tokens`, `temperature`, zaman aşımı, açık/kapalı, parti büyüklüğü (şimdi
   `BATCH = 9`). Kod bu ayarı DB'den okur (manifest `suggest_model` yalnız varsayılan olur).
   Geçersiz model adı çağrıyı bozmasın: kaydederken doğrula.
3. **OpenRouter'ın kendi uçlarından yararlan** (belgelerini doğrula; yalnız admin sayfasından,
   sunucu tarafında, anahtar istemciye gitmez): model listesi ve fiyatları
   (`GET /api/v1/models`: `pricing`, `supported_parameters` — `structured_outputs`,
   `reasoning` desteği olmayan model seçilemesin/uyarılsın), anahtar bilgisi/kredi
   (`GET /api/v1/key`, `/api/v1/credits`), üretim mutabakatı (`GET /api/v1/generation?id=`).
   Sonuçları kısa süre önbelleğe al (her sayfa açılışında OpenRouter'a gitme). Dış servis
   kapalıyken (`external_off`, anahtar yok) sayfa çökmesin, "kapalı" desin.
4. **Limitler.** Özellik ve kullanıcı bazında: saatlik/günlük çağrı sayısı, günlük/aylık
   **harcama tavanı** (USD, `llm_calls.cost_usd` toplamından). Aşılınca çağrı 429
   `suggest_limit` döner (hata kodu `frontend/src/api/errors.ts`'e + Türkçe metin). Şimdilik
   hiçbir limit yok; varsayılan "sınırsız" kalsın, sayfadan açılsın. Çok süreçli çalışmaya
   dikkat: mevcut `ratelimit.rs` süreç içi bellektedir (`--workers 1` varsayımı); harcama
   tavanı DB'den okunmalı.
5. **Sayfa.** Sekmeler/bölümler: *Genel* (servis durumu, anahtar/kredi, bu ayki maliyet kartı),
   *Modeller* (özellik tablosu + düzenleme + "Dene" kutusu: örnek yükle, cevabı ve maliyeti
   gör, **kaydetmez**, kalite sayfasındaki gibi), *Limitler*, *Çağrı geçmişi* (sıralanabilir,
   süzülebilir: özellik, model, kullanıcı, durum, tarih; sayfalı), *Maliyet* (günlük grafik,
   özellik/model/kullanıcı kırılımı; para biçimi `$0,0042` küçük tutarları gösterebilmeli),
   *Temizleme kuralları* (mevcut `llm_config` ekranını buraya taşı; `GET/PUT/DELETE
   /api/admin/llm` aynı kalsın). Mevcut Yönetim sekmeleri ve tasarım dili ile aynı.
6. **Mevcut istemin (`SYSTEM`) yeri.** Deneysel istem kodda sabit. İsteği DB'ye taşıyıp
   sayfadan düzenlemeyi (sürüm geçmişi + "Dene") **öner ama sormadan yapma**: istem
   değişikliği güvenlik açısından (kişisel veri kuralları, `spec/79` §2) denetim ister.

## Sormadan karar verme (önce bana sor)

- Çağrı gövdelerini saklamak (varsayılan: saklamama).
- İstemi DB'ye taşımak ve kimin düzenleyebileceği.
- Kalite kapısını (`decision.rs`, farklı uç) kayıt/limit kapsamına almak ve model adını DB'ye
  taşımak.
- Hız sınırı/tavan değerlerinin varsayılanları.
- Yeni kapsam gerekip gerekmediği (şimdilik sayfa **yalnız admin**; `use_generative_ai` yalnız
  özelliği kullanmaya yarar).

## Kurallar (bu depoya özgü, ihlal etme)

- Kod dili İngilizce (tablo/sütun, uç yolu, kapsam anahtarı, test adı dahil); kullanıcıya
  görünen metin, yorum ve commit Türkçe.
- Düzenlemeleri **Edit/Write ile** yap; `sed`/`python`/heredoc ile dosya yeniden yazma yok.
- Kapıyı derleyici ve testler tutar: `cargo clippy --all-targets` (panik/`unwrap` derlemeyi
  düşürür), `cargo test`, `backend/tools/local_test.sh` (sözleşme: yeni uçlar için
  `backend/tools/check_api.sh`'e kontrol ekle), `cd frontend && npm run build && npx vitest run`.
- Yeni hata kodu = `frontend/src/api/errors.ts` sözlüğüne Türkçe metin (yoksa kullanıcı
  "Sunucuda bir hata oldu" görür). Yeni kapsam = göç + `labels.ts` + `spec/75-yetki.md`.
- Hedef makinede derleme yok; yayın `backend/tools/release.sh` ile (sen yayınlama).
- Sırlar: `OPENROUTER_API_KEY` hiçbir çıktıya, loga, hata mesajına, test fikstürüne girmez.
  Gerçek anahtarla deneme gerekiyorsa bana söyle (anahtar agenix'te; ben çalıştırırım).
- Dal: `claude/event-llm-export` üstüne yeni bir dal aç; push/PR/birleştirme yapma.
- Bitirince: spec güncel, testler yeşil, neyi doğrulayıp neyi doğrulayamadığını açık yaz.
