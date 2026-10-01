# alpha-2.1 — release devir notu

Release'i yapacak ajan için. Kod tamam ve PR #45'te (`Alpha 2.1`, dal
`claude/dashboard-localhost-setup-3a0f2e-ivpc5t`). Bu belge: ne çıkıyor, ne
yapılandırılmalı, nasıl yayınlanır, nasıl doğrulanır, nasıl geri dönülür.

Genel akış `CLAUDE.md` "Yayına alma" bölümünde; burası o akışa **bu sürüme özel**
ekler.

## 0. Önkoşul

- PR #45 merge edildi mi? Merge'i Efe yapar; ajan merge etmez. `main` üzerinden release çıkar.
- CI yok (check run sıfır). Release'ten önce yerelde bir kez koş:
  `cargo clippy --all-targets`, `cargo test` (backend), `npm run build`, `npm test` (frontend).

## 1. Bu sürümde ne var (özet)

Kayıt erişim kipleri (public / request / private) ve katılma istekleri · profil
(takma ad, telefon zorunlu, doğum günü, fotoğraf) · Ekip sayfası · takım/pillar banner'ı ·
oylama kartı (medya ve sayaç opt-in) · bildirim tercihi (varsayılan + sohbet başına +
sessiz saat) + web push · Resend ile davet postası · aktivite sekmesi ve katkı matrisi ·
kayıt sabitleme, kart düzeni, katılımcı ekle/çıkar · yönetimde toplu işlem.

## 2. Veritabanı göçleri (açılışta kendiliğinden koşar)

`003_profile_banner` · `004_notification_prefs` · `005_mail_outbox` ·
`006_user_activity` · `007_pins_card_order` · `008_record_access` · `009_mail_retry`.

- Hepsi ileri yönlü: yeni tablo ve `add column`; **veri silmez**, mevcut satırlar
  varsayılanlarla kalır (`access_mode = 'public'`, bildirim `all`).
- Donuk kural: göç dosyalarının adı bir daha değişmez (`CLAUDE.md`).
- Göçler yalnız **boş yerel veritabanında** denendi. Gerçek veriyle ilk deneme VM'de olmalı
  (bkz. 5).

## 3. Yapılandırma (ortam değişkenleri)

| Değişken | Zorunlu | Not |
|---|---|---|
| `RESEND_API_KEY` | davet postası için | Yoksa mail yalnız `mail_outbox`'ta bekler, uygulama bozulmaz. Sır: agenix, koda/repoya girmez |
| `MAIL_FROM` | hayır | Varsayılan `EkipTakip <ozumaker@polonyum.com>` |
| `RESEND_API_URL` | hayır | Varsayılan `https://api.resend.com/emails` (yalnız test için değiştirilir) |
| `VAPID_PRIVATE` | hayır | Yoksa web push kapalı, bildirim listesi çalışır. Üretmek: `ekiptakip vapid-keygen` (çıktıdaki `VAPID_PRIVATE=` satırı sır, `VAPID_PUBLIC` türetilir, saklamak şart değil) |
| `VAPID_SUB` | hayır | Varsayılan `mailto:yonetici@polonyum.com` |

Sırlar `~/nix` içinde agenix ile bağlanır; mevcut sır düzenini izle, yeni düzen icat etme.
Anahtarı hiçbir çıktıya, komut satırı argümanına ya da commit'e yazma.

## 4. Resend / DNS durumu (kontrol et)

- `polonyum.com` Resend'de eklendi; Cloudflare DNS'inde `send.`, `rsend.` CNAME ve
  `resend._domainkey` TXT kayıtları **DNS only** olarak mevcut (ekran görüntüsüyle doğrulandı).
- **Doğrulanmadı:** Resend panelinde alan adının "Verified" olduğu. Doğrulanmamışsa Resend
  4xx döner ve uygulama o postaları *kalıcı red* sayıp bırakır (yeniden denemez).
- Anahtar Efe'nin Mac'inde; `~/nix`'e yerel ajan ekliyor. Eklendi mi? VM'de
  hizmet logunda `RESEND_API_KEY yok` satırı **olmamalı**.

## 5. Yayın adımları

```bash
backend/tools/release.sh                          # Mac: derle + GitHub release + deploy/release.nix
git commit -am "release: alpha-2.1" && git push
cd ~/nix && nix flake update teamtracker-alpha02  # 0.2'yi yeni pine çek
git commit -am "teamtracker-alpha02: alpha-2.1"
sudo nixos-rebuild switch --flake .#teamtracker0.2   # ÖNCE VM
```

Önce `DRY_RUN=1 backend/tools/release.sh` ile derlemeyi dene. Üretime (`.#evsunucu`) yalnız
VM doğrulaması geçince ve **Efe onaylayınca** geç.

## 6. VM doğrulaması (geçmeden üretime çıkma)

1. Hizmet ayağa kalktı; logda göç hatası yok, `dinleniyor` satırı var.
2. Eski veri sağlam: Panolar'da sayılar ve eski kayıtlar görünüyor; kayıt sayfaları açılıyor.
3. Davet postası: Yönetim → Kişi ekle ile Efe'nin başka bir e-postasını ekle; ~15 sn içinde mail
   gelmeli. Gelmezse:
   ```sql
   select to_email, sent_at, attempts, error from mail_outbox order by created_at desc limit 5;
   ```
   `error` sütunu Resend'in cevabını gösterir (422 → alan adı doğrulanmamış / gönderen adres).
4. Erişim kipleri: bir kaydı `Gizli` yap; başka bir kullanıcıyla aç → iskelet + "katılma isteği
   gönder" bandı görünmeli, sohbet/kart/eylem görünmemeli. Sorumlu isteği onaylayınca kişi içeri girmeli.
5. Profil: telefonsuz bir kullanıcı ilk girişte profil penceresini görmeli (kapatılamaz).
6. Push (VAPID verildiyse): telefonda ana ekrana ekle → Bildirimler → "Bu cihazda bildirimi aç";
   başka biri `@adın` ile mesaj yazınca bildirim gelmeli. VAPID verilmediyse bu adımı atla.
7. Gerçek tarayıcıda göz kontrolü (bu oturumda yapılamadı): Panolar → Son hareket sağ sütun hizası,
   kayıt sayfası özellik paneli collapse, Ekip sayfası, banner.

## 7. Geri dönüş

- Göçler ileri yönlü; geri alınmaz ama zararsızdır (yeni tablo/sütun).
- Uygulamayı geri almak: `~/nix`'te `teamtracker-alpha02` pinini önceki release'e çevir, yeniden
  `nixos-rebuild switch`. Eski ikili yeni sütunları/tabloları yok sayar; veri kaybı olmaz.
- 0.1'e (Python) dönmek: `sudo nixos-rebuild switch --flake .#teamtracker0.1` — 0.2 veritabanına dokunmaz.

## 8. Bilinen sınırlar (hata değil, yapılmadı)

- Katılma isteği için push/mail bildirimi yok; sorumlu isteği kayıt sayfasında ve bildirim listesinde görür.
- Bildirim e-postası yok; yalnız davet gider. Kanal protokolü hazır (`backend/src/channel.rs`),
  kişi başına "mail kanalı" tercihi ve `push::decide`'a mail kararı eklenmedi.
- Gizli kayıtta ek dosya adresi (uuid) bilinirse açılır; kayda bağlı bir kontrol yok.
- Gerçek cihazda push ve gerçek Resend hesabıyla uçtan uca deneme yapılmadı (yalnız sahte
  sunucuyla: başarı, geçici hata → yeniden deneme, kalıcı red).
- Astryx tasarım sistemine geçiş düşünülüyor ama bu sürümün parçası değil.
