# Karar modeli kalite ölçümü

Örnek: 120 satır (60 kapanış, 60 kayıt); 720 çağrı sonucu.

## Noul dağılımı

| Soru | Etiket | n | Min | Medyan | Maks |
|---|---|---:|---:|---:|---:|
| closing/closing_justified | good | 60 | 0.935 | 0.948 | 0.950 |
| closing/closing_justified | borderline | 60 | 0.604 | 0.932 | 0.949 |
| closing/closing_justified | bad | 60 | 0.145 | 0.367 | 0.798 |
| entry/specific | good | 60 | 0.827 | 0.906 | 0.939 |
| entry/context | good | 60 | 0.117 | 0.636 | 0.911 |
| entry/specific | borderline | 60 | 0.160 | 0.739 | 0.879 |
| entry/context | borderline | 60 | 0.067 | 0.151 | 0.416 |
| entry/specific | bad | 60 | 0.069 | 0.127 | 0.820 |
| entry/context | bad | 60 | 0.049 | 0.066 | 0.090 |

## Yanlış karar ve eşik taraması

Birden çok sorulu kayıtta herhangi bir sorunun noul değeri eşikten küçükse RED. Yanlış red=good örneğin reddi; borderline red ayrıca raporlanır. Yanlış geçiş=bad örneğin geçmesi.

| Eşik | Soru | Good yanlış red | Borderline red | Bad yanlış geçiş |
|---:|---|---:|---:|---:|
| 0.20 | closing/closing_justified | 0.0% | 0.0% | 80.0% |
| 0.20 | entry/specific | 0.0% | 10.0% | 10.0% |
| 0.20 | entry/context | 10.0% | 60.0% | 0.0% |
| 0.20 | entry/combined | 10.0% | 60.0% | 0.0% |
| 0.25 | closing/closing_justified | 0.0% | 0.0% | 80.0% |
| 0.25 | entry/specific | 0.0% | 10.0% | 10.0% |
| 0.25 | entry/context | 20.0% | 80.0% | 0.0% |
| 0.25 | entry/combined | 20.0% | 80.0% | 0.0% |
| 0.30 | closing/closing_justified | 0.0% | 0.0% | 65.0% |
| 0.30 | entry/specific | 0.0% | 10.0% | 10.0% |
| 0.30 | entry/context | 40.0% | 85.0% | 0.0% |
| 0.30 | entry/combined | 40.0% | 85.0% | 0.0% |
| 0.35 | closing/closing_justified | 0.0% | 0.0% | 55.0% |
| 0.35 | entry/specific | 0.0% | 10.0% | 10.0% |
| 0.35 | entry/context | 40.0% | 90.0% | 0.0% |
| 0.35 | entry/combined | 40.0% | 90.0% | 0.0% |
| 0.40 | closing/closing_justified | 0.0% | 0.0% | 45.0% |
| 0.40 | entry/specific | 0.0% | 15.0% | 10.0% |
| 0.40 | entry/context | 45.0% | 90.0% | 0.0% |
| 0.40 | entry/combined | 45.0% | 90.0% | 0.0% |
| 0.45 | closing/closing_justified | 0.0% | 0.0% | 45.0% |
| 0.45 | entry/specific | 0.0% | 15.0% | 10.0% |
| 0.45 | entry/context | 45.0% | 100.0% | 0.0% |
| 0.45 | entry/combined | 45.0% | 100.0% | 0.0% |
| 0.50 | closing/closing_justified | 0.0% | 0.0% | 35.0% |
| 0.50 | entry/specific | 0.0% | 20.0% | 10.0% |
| 0.50 | entry/context | 50.0% | 100.0% | 0.0% |
| 0.50 | entry/combined | 50.0% | 100.0% | 0.0% |
| 0.55 | closing/closing_justified | 0.0% | 0.0% | 35.0% |
| 0.55 | entry/specific | 0.0% | 30.0% | 10.0% |
| 0.55 | entry/context | 50.0% | 100.0% | 0.0% |
| 0.55 | entry/combined | 50.0% | 100.0% | 0.0% |
| 0.60 | closing/closing_justified | 0.0% | 0.0% | 30.0% |
| 0.60 | entry/specific | 0.0% | 35.0% | 10.0% |
| 0.60 | entry/context | 50.0% | 100.0% | 0.0% |
| 0.60 | entry/combined | 50.0% | 100.0% | 0.0% |
| 0.65 | closing/closing_justified | 0.0% | 5.0% | 30.0% |
| 0.65 | entry/specific | 0.0% | 35.0% | 10.0% |
| 0.65 | entry/context | 50.0% | 100.0% | 0.0% |
| 0.65 | entry/combined | 50.0% | 100.0% | 0.0% |
| 0.70 | closing/closing_justified | 0.0% | 10.0% | 30.0% |
| 0.70 | entry/specific | 0.0% | 35.0% | 10.0% |
| 0.70 | entry/context | 50.0% | 100.0% | 0.0% |
| 0.70 | entry/combined | 50.0% | 100.0% | 0.0% |

### Soru başına eşik denemesi: kayıt specific=0.50, context=0.20

Canlıdaki birleşik kapı (iki sorudan biri düşükse red) için karma eşik; örnek başına üç tekrarın ortalaması.

| Kombine eşik | Good yanlış red | Borderline red | Bad yanlış geçiş |
|---|---:|---:|---:|
| specific <0.50 OR context <0.20 | 10.0% | 65.0% | 0.0% |

## Yazım ve isim varyantı

Eşleşmiş pair'lerde varyant − düzgün ikiz noul farkı; aynı soru, base yönergesi.

| Soru | Varyant | Eşleşen çift | Ortalama fark |
|---|---|---:|---:|
| closing/closing_justified | ascii | 15 | -0.028 |
| closing/closing_justified | no_name | 15 | -0.001 |
| entry/specific | ascii | 15 | -0.044 |
| entry/specific | no_name | 15 | +0.000 |
| entry/context | ascii | 15 | -0.018 |
| entry/context | no_name | 15 | -0.000 |

## Reddedilen gerçek örneğin sentetik ikizi

Sentetik ikiz: `Sponsor A ile görüşme yapıldı ve gerekli aksiyon alındı.` (gerçek metin/kişi adı veri setine alınmadı).
Noul tekrarları: 0.94857764, 0.94857764, 0.94857764

## Tekrar tutarlılığı

Aynı örnekteki üç base noul değerinin popülasyon standart sapması; medyan / maksimum.
0.0000 / 0.0047

## Gecikme

Tüm çağrılar: p50 0.45s; p95 12.38s; n=720 (yeniden denemeler dahil).
5 örnek pilot: 33 çağrı, 0 hata, p50 0.41s, p95 0.61s; 7272 token; bildirilen maliyet $0.000000 (33/33 yanıt). Sıfır maliyet alanı gerçek faturalamayı kanıtlamaz.

## Model / sağlayıcı yönlendirmesi

- respan/span-01-lite-20260925 / Respan — istenen model takma adından farklı model kimliği döndü.

Endpoint usage: 155400 reported tokens; reported cost $0.000000 across 720/720 responses. Zero or absent API-reported cost does not prove no external billing.

## Alternatif kapanış yönergeleri

Her soru için alt1/alt2 cevapların üç tekrarlı ortalaması ve base'e göre sınıflandırma oranları aşağıda; alternatifler ölçüm içindir, uygulama kodu değişmedi.

| Yönerge | n | Good red | Borderline red | Bad pass |
|---|---:|---:|---:|---:|
| alt1_closing_context | 60 | 0.0% | 0.0% | 90.0% |
| alt2_closing_action | 60 | 0.0% | 0.0% | 90.0% |

## Öneri (yalnız ölçüm; uygulama değişikliği yok)

- Kapanış eşiği: sınıflar tam ayrışmıyor (bad örneklerin medyanı 0.367, maks. 0.798). 0.50'de good false-reject 0%, borderline red 0%, bad-pass 35%; 0.65'te sırasıyla 0%, 5%, 30%. 0.65 yalnız 5 puan bad-pass iyileştirip 5 puan borderline red ekliyor; canlı değişiklik için güçlü kanıt değil.
- Kayıt soruları: ortak 0.50 birleşik kapı good false-reject 50%, borderline red 100%, bad-pass 0%. specific=0.50/context=0.20 denemesi good false-reject 10%, borderline red 65%, bad-pass 0%. Ayrı eşik denemesi anlamlı; yine de sentetik ölçüme dayanarak canlıya uygulamayın.
- Kapanış yönergesi: iki alternatif de bad-pass 90% (base 35%); genel gevşetmeyi reddedin. İleride dar açıklama deneyin: somut bir eylemin (ör. görüşme yapıldı) tek başına yeterli olduğunu, `gerekli aksiyon alındı` gibi eylemi adlandırmayan genel ifadenin yeterli olmadığını pozitif/negatif örnek çiftleriyle belirtin. Bu metin henüz ölçülmedi.
- Gerçek örnek: reddedilen gerçek örnek için kullanılan sentetik ikiz 3/3 kez geçti; red yeniden üretilemedi. İkiz, gerçek girdinin birebir kopyası değil; gerçek metin veya kişi adı depolanmadı. Red nedenini ayırmak için anonim başlık ve metin yapısıyla ek varyant gerekir.

## Sınırlamalar

Etiketler sentetik, küçük ve kurallara göre elle atanmış; canlı kullanıcı dağılımı değildir. Eşik kararı canlı log değil, bu dağılım ve hata takası üstünden verilmemeli. Endpoint 720 yanıtın tamamında cost=0 bildirdi; gerçek faturalama sıfır varsayılamaz.
