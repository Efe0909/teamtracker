# 76 — Bilgi yoğunluğu kapısı

**Durum: uygulandı.** API, kullanıcı metninin asgari uzunluğunu denetler; kayıt ve etkinlik metinleri ayrıca karar modeliyle değerlendirilir. İstemci sayaç ve uyarıları gösterir; sunucu son kararı verir.

## Kurallar

- Başlık/ad en az **5 Unicode karakter**, açıklama en az **30 Unicode karakter** olmalı. Sayımdan önce baştaki ve sondaki boşluklar kırpılır.
- Kayıt ve etkinlik oluştururken başlık ve açıklama zorunlu. PATCH'te yalnız değiştirilen başlık/açıklama denetlenir; eski kısa veri başka alan güncellenirken geçerli kalır.
- Düğüm, takım ve pillar adları en az 5 karakter olmalı. Açıklama boş bırakılabilir; boş değilse en az 30 karakter olmalı. Yalnız oluşturma ya da değiştirilen alanlar denetlenir. Sistem slot düğümleri kapsam dışı.
- `closed` durumuna ilk geçişte kayıt ve eylem için en az 30 karakterlik kapanış notu zorunlu. `cancelled` bu kurala girmez. Not satırda saklanır, kayıt sohbetinin etkinlik akışına yazılır. Kapalıdan başka duruma geçiş notu temizler.

## Karar modeli

`POST https://openrouter.ai/api/alpha/decisions`, `OPENROUTER_API_KEY` ve manifestteki `decision_model` kullanır. Varsayılan model `respan/span-01-lite`; zaman aşımı 3 saniye. Yalnız `noul` soruları gönderilir; state düz metindir. Kayıt/etkinlikte sorular somut eylem/sonuç (`specific`) ve bağlam (`context`); kapanışta yapılan iş/sonuç/gerekçe (`closing_justified`). Herhangi bir evet olasılığı 0.5'in altındaysa API 422 `low_quality` ve başarısız soru kodları döndürür.

Ön yüz Türkçe gerekçelerle “Düzenle” ve “Yine de gönder” seçeneklerini sunar. `quality_override: true` ile tekrar gönderim kabul edilir; override kayıt sohbeti etkinlik akışında görünür. Ağ/HTTP/yanıt hatası, zaman aşımı, anahtar yokluğu veya kill switch kalite denetimini atlar ve `tracing::warn` üretir; uzunluk denetimi sürer.

## Dış servisler ve KVKK

Manifestteki (`backend/manifest.json`) `external_off` listesi `decision`, `resend`, `push` anahtarlarını ya da `"all"` değerini kabul eder; bilinmeyen ad açılışı durdurur. Anahtarı/yapılandırması olmayan servis de kapalı sayılır. Kapalı servisler `/api/meta.external_off` içinde döner. Kalite kapalıyken kayıt ve etkinlik formlarında, push kapalıyken bildirim ayarında açık bilgi gösterilir. `decision` kapatmak için manifestte `"external_off": ["decision"]` yaz.

Kalite açıkken aynı metin alanlarının altında kişisel veri uyarısı durur (telefon, e-posta, adres, kişi adı yazma; OpenRouter tarafındaki redact kuralları bunları modele ulaşmadan maskeler) ve gizlilik sayfasına bağlanır. Profil penceresi (ilk girişteki telefon/doğum günü ekranı dahil) aynı sayfaya bağlanır.

PATCH `/api/records/{id}` yanıtı, başlık/açıklama değişikliği ya da `closed`'a geçiş modeli çağırdıysa `quality` taşır: `outcome` (`pass` | `low` | `skipped`), modelin `model`/`provider` alanları, soru başına `answers.<ad>.noul` olasılığı ve `reasons`. Saklanmaz, GET'te yoktur. Servis kapalıyken `outcome: "skipped"`, uydurma güven yok.

Başlık, açıklama ve kapanış notu kalite değerlendirmesi için cihazdan OpenRouter'a gider. Bu, yurt dışına kişisel veri aktarımı doğurabilir (DOC-324); veri minimizasyonu ve hukuki dayanak ayrıca değerlendirilmelidir. KVKK riski kabul edilmiyorsa `decision` servisini kapat.

## Yapılandırma

- `OPENROUTER_API_KEY`: isteğe bağlı karar servisi anahtarı.
- `backend/manifest.json`: `decision_model` (varsayılan `respan/span-01-lite`), `external_off`, `version`, `contact_email` — gizli değil, şifreli dosyada tutulmaz.

## Test

Rust birim testleri Unicode uzunluk, kill-switch ayrıştırması, OpenRouter yanıt biçimi ve eşik eşlemesini kapsar. `backend/tools/check_api.sh`, servis kapalıyken uzunluk, PATCH geriye uyumluluğu, kapatma/iptal/yeniden açma, sohbet etkinliği ve meta sözleşmesini doğrular. Vitest, sayaç/kapatma ve düşük kalite override etkileşimini doğrular. Gerçek anahtarla tek seferlik smoke testte belirsiz ve açıklayıcı Türkçe metin için HTTP sonucu ve `noul` olasılıkları kaydedilir; anahtar asla çıktılanmaz.
