# 76 — Bilgi yoğunluğu kapısı

**Durum: uygulandı.** API, kullanıcı metninin asgari uzunluğunu denetler; kayıt ve etkinlik metinleri ayrıca karar modeliyle değerlendirilir. İstemci sayaç ve uyarıları gösterir; sunucu son kararı verir.

## Kurallar

- Başlık/ad en az **5 Unicode karakter**, açıklama en az **30 Unicode karakter** olmalı. Sayımdan önce baştaki ve sondaki boşluklar kırpılır.
- Kayıt ve etkinlik oluştururken başlık ve açıklama zorunlu. PATCH'te yalnız değiştirilen başlık/açıklama denetlenir; eski kısa veri başka alan güncellenirken geçerli kalır.
- Düğüm, takım ve pillar adları en az 5 karakter olmalı. Açıklama boş bırakılabilir; boş değilse en az 30 karakter olmalı. Yalnız oluşturma ya da değiştirilen alanlar denetlenir. Sistem slot düğümleri kapsam dışı.
- `closed` durumuna ilk geçişte kayıt ve eylem için en az 30 karakterlik kapanış notu zorunlu. `cancelled` bu kurala girmez. Not satırda saklanır, kayıt sohbetinin etkinlik akışına yazılır. Kapalıdan başka duruma geçiş notu temizler.

## Karar modeli

`POST https://openrouter.ai/api/alpha/decisions`, `OPENROUTER_API_KEY` ve `EKIPTAKIP_DECISION_MODEL` kullanır. Varsayılan model `respan/span-01-lite`; zaman aşımı 3 saniye. Yalnız `noul` soruları gönderilir; state düz metindir. Kayıt/etkinlikte sorular somut eylem/sonuç (`specific`) ve bağlam (`context`); kapanışta yapılan iş/sonuç/gerekçe (`closing_justified`). Herhangi bir evet olasılığı 0.5'in altındaysa API 422 `low_quality` ve başarısız soru kodları döndürür.

Ön yüz Türkçe gerekçelerle “Düzenle” ve “Yine de gönder” seçeneklerini sunar. `quality_override: true` ile tekrar gönderim kabul edilir; override kayıt sohbeti etkinlik akışında görünür. Ağ/HTTP/yanıt hatası, zaman aşımı, anahtar yokluğu veya kill switch kalite denetimini atlar ve `tracing::warn` üretir; uzunluk denetimi sürer.

## Dış servisler ve KVKK

`EKIPTAKIP_EXTERNAL_OFF` virgülle ayrılmış `decision`, `resend`, `push` anahtarlarını ya da `all` değerini kabul eder. Anahtarı/yapılandırması olmayan servis de kapalı sayılır. Kapalı servisler `/api/meta.external_off` içinde döner. Kalite kapalıyken kayıt ve etkinlik formlarında, push kapalıyken bildirim ayarında açık bilgi gösterilir. `decision` kapatmak için `EKIPTAKIP_EXTERNAL_OFF=decision` kullan.

Başlık, açıklama ve kapanış notu kalite değerlendirmesi için cihazdan OpenRouter'a gider. Bu, yurt dışına kişisel veri aktarımı doğurabilir (DOC-324); veri minimizasyonu ve hukuki dayanak ayrıca değerlendirilmelidir. KVKK riski kabul edilmiyorsa `decision` servisini kapat.

## Yapılandırma

- `OPENROUTER_API_KEY`: isteğe bağlı karar servisi anahtarı.
- `EKIPTAKIP_DECISION_MODEL`: isteğe bağlı model adı, varsayılan `respan/span-01-lite`.
- `EKIPTAKIP_EXTERNAL_OFF`: isteğe bağlı kill switch listesi (`all` veya virgüllü servis adları).

## Test

Rust birim testleri Unicode uzunluk, kill-switch ayrıştırması, OpenRouter yanıt biçimi ve eşik eşlemesini kapsar. `backend/tools/check_api.sh`, servis kapalıyken uzunluk, PATCH geriye uyumluluğu, kapatma/iptal/yeniden açma, sohbet etkinliği ve meta sözleşmesini doğrular. Vitest, sayaç/kapatma ve düşük kalite override etkileşimini doğrular. Gerçek anahtarla tek seferlik smoke testte belirsiz ve açıklayıcı Türkçe metin için HTTP sonucu ve `noul` olasılıkları kaydedilir; anahtar asla çıktılanmaz.
