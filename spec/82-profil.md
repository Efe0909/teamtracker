# 82 — Profil ve ayarlar sayfası

**Durum: tasarım** (Efe ile 2026-10-14, Maliye eskiz turu; eskizde "Profil ve ayarlar"
ekranı). Bugün profil bir pencere (`features/profile/ProfileDialog.tsx`), bildirim
ayarları ayrı bir pencere (`NotifySettings.tsx`); ikisi de kişi menüsünden açılıyor.

Efe'nin sözleri: *"profilleri artık popup değil adam akıllı sayfaya da çevirelim, veri
gizliliği notice'i falan da koy"* ve *"bunu global kullanıcı profilinde düşünmüştüm,
kullanıcıların adam akıllı birer profil ve ayarlar yeri olsun."*

---

## 1. İş

- **Kim:** her kullanıcı, kendi hesabı için. Ayda birkaç kez; ilk girişte zorunlu (telefon).
- **Soru:** "Benim hakkımda ne biliniyor, kim görüyor, bana nasıl ulaşılıyor, bana nasıl
  ödeme yapılacak?"
- Maliye'ye ait **değil**: hesap numarası Maliye'nin ihtiyacı ama sahibi kişi; sayfa her
  yüzde aynı yerden açılır.

## 2. Kararlar

| # | Karar | Gerekçe |
|---|---|---|
| P1 | Profil **tam sayfa**: dashboard'da `/profile`, mobilde `/profile`. Pencere (`ProfileDialog`) kalkar. | KNOW-112: ayrıntı sayfa olur, URL paylaşılır, mobil geri tuşu çalışır. |
| P2 | Bölümler sekme değil **yan gezinme** + URL: `/profile?tab=info|accounts|notifications|appearance|privacy`. | Bölüm bağlantısı başka ekrandan verilebilir (fatura formu → hesaplar). |
| P3 | `NotifySettings` penceresi sayfanın **Bildirimler** bölümü olur; sohbet başına zil menüsü (`ChatBell`) yerinde kalır. | Ayarların tek yeri. |
| P4 | **Hesap numaralarım** (IBAN) profilde; Maliye fatura formu onu okur. İlk faturada hesabı olmayan buraya yönlendirilir, ekledikten sonra forma döner. | Efe: "profilde hesap numaralarım diye bir kısım olsun, ilk kez fatura yükleyenler ya da IBAN'ı olmayanları bu sayfaya yönlendir." |
| P5 | Tema **cihazda** kalır (`lib/theme.ts`, localStorage). Sayfa yalnız seçiciyi taşır. | Bugünkü bilinçli karar ("kişisel kolaylık, sunucuya gitmez"); ilk boyamada yanıp sönme olmasın. Senkron istenirse ayrı karar. |
| P6 | Telefon zorunluluğu (`profile_complete`) aynen: profil eksikse uygulama `/profile?tab=info`'ya düşer, gezinme kapalı, üstte açıklama. | Bugünkü pencere kapatılamıyordu; sayfa karşılığı yönlendirme. |
| P7 | Gizlilik bölümü **aydınlatma metni** + kişinin kendi verisi üzerindeki eylemler (indir, hesap numarası sil, hesap kapatma isteği). | "veri gizliliği notice'i falan da koy". |

## 3. Ekrandaki bölgeler

Sol: yan gezinme (5 bölüm). Sağ: seçili bölüm. Başlıkta avatar, ad, e-posta.

### 3.1 `info` — Profilim
- **Görünen ad** (`users.name`): yalnız `edit_user_names` kapsamıyla düzenlenir (bugünkü
  kural, `PATCH /api/users/{id}/name`); kapsam yoksa salt okunur.
- **Takma ad, telefon, doğum günü, fotoğraf**: bugünkü `PATCH /api/me/profile`.
- **E-posta**: Google'dan, salt okunur.
- **Takımlarım** (`team_members`) ve **yetkilerim** (etkin scope'lar, `SCOPE` etiketleriyle)
  salt okunur; "Yetkileri yöneticiler verir."
- **Son giriş** (`users.last_login_at`).

### 3.2 `accounts` — Hesap numaralarım
- Liste: etiket (ör. "Ziraat"), hesap sahibi adı, **maskeli IBAN** (`TR12 0006 •••• … 8413 26`),
  varsayılan işareti; düzenle / varsayılan yap / sil.
- **Hesap ekle** formu: etiket, hesap sahibi (varsayılan görünen ad), IBAN. IBAN boşluksuz
  saklanır, ekranda 4'lü gruplanır.
- Bölümün altında kısa gizlilik notu (kim görür, §5).
- `?return=<yol>` varsa (fatura formundan gelinmişse) üstte uyarı şeridi: "Fatura yüklemek
  için önce bir hesap numarası eklemelisin." ve "Faturaya dön" düğmesi. Yol yalnız uygulama
  içi göreli yol olabilir (açık yönlendirme yok: `/` ile başlar, `//` ile başlamaz).

### 3.3 `notifications` — Bildirimler
- Bugünkü `NotifySettings` içeriği: varsayılan kademe (`all | mentions | none`), sessiz saat,
  bu cihazda anlık bildirim.
- Yeni (spec/81'le gelir): **fatura sonucu** (onay / düzeltme / ret) ve **iade ödendi**
  bildirimleri. Ayrı anahtar değil, kişinin kendi kaydıyla ilgili olduğu için `mentions`
  kademesinde de gelir; `none` kapatır.

### 3.4 `appearance` — Görünüm
- Tema: Açık / Koyu / Sistem (`lib/theme.ts`).
- Başka ayar eklenmez (yoğunluk ve açılış sayfası eskizde vardı; Efe "gelişmiş"i erteledi,
  yoğunluk da onun parçası).

### 3.5 `privacy` — Gizlilik ve veri
- **Aydınlatma metni**: hangi veri tutulur (ad, e-posta, telefon, doğum günü, fotoğraf,
  takım üyeliği, yazdığı kayıt ve mesajlar, hesap numaraları, faturalar), neden, kim görür,
  ne kadar saklanır. Metnin tam hali karşılamadaki `/privacy` sayfasıyla **aynı kaynak**
  (`privacyUrl()`); profil kısa özeti ve bağlantıyı gösterir.
- **Verilerimi indir**: `GET /api/me/export` → kişinin kendi profil satırı, takımları,
  hesapları (tam IBAN, kendisi olduğu için), gönderdiği faturalar, yazdığı kayıt ve mesaj
  metinleri; JSON, ek dosyaları hariç (kimlikleriyle listelenir).
- **Hesap numaralarımı sil**: hepsini siler (§4.2 kuralıyla).
- **Hesabımın kapatılmasını iste**: yöneticinin gelen kutusuna istek (TASK-308'deki
  `access_requests` desenine bir tür daha). Doğrudan silme yok: kayıtların yazarı ve
  faturalar yasal/işleyiş gereği kalır; hesap pasifleştirilir (`users.is_active = false`).

## 4. Veri

### 4.1 Göç (027)

```sql
create table bank_accounts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  label       text not null check (char_length(btrim(label)) between 1 and 60),
  holder_name text not null check (char_length(btrim(holder_name)) between 1 and 200),
  -- Boşluksuz, büyük harf. Silinince NULL olur; son dört hane kalır (§4.2).
  iban        text check (iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
  iban_last4  text not null check (iban_last4 ~ '^[A-Z0-9]{4}$'),
  is_default  boolean not null default false,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  check ((deleted_at is null) = (iban is not null)),
  check (not (is_default and deleted_at is not null))
);
create unique index bank_accounts_one_default on bank_accounts (user_id) where is_default;
create index on bank_accounts (user_id) where deleted_at is null;
```

- IBAN doğrulaması API'de: ülke + uzunluk tablosu (TR = 26) ve **mod-97** sağlaması
  (`invalid_iban`). DB `check` yalnız biçim.
- İlk eklenen hesap otomatik varsayılan; varsayılan silinirse en yeni hesap varsayılan olur.
- Kişi başına en fazla 5 hesap (`too_many_accounts`).

### 4.2 Silme ve fatura bağı
- Fatura (spec/81) hesabı `invoices.payee_account_id` ile tutar (`on delete restrict`).
  Bu yüzden hesap satırı **silinmez**: `iban = null`, `deleted_at = now()`, `iban_last4`
  kalır. Geçmiş iade dosyasında "Ayşe K. · …8413 26 (silindi)" görünür.
- Onay bekleyen (`pending`) faturası olan hesap silinemez: `409 account_in_use`
  ("Önce bu hesaba bağlı bekleyen faturanı güncelle.").

### 4.3 Uçlar

| Uç | Kim | Ne |
|---|---|---|
| `GET /api/me/bank-accounts` | kendisi | kendi hesapları, **tam IBAN** |
| `POST /api/me/bank-accounts` | kendisi | ekle (`invalid_iban`, `too_many_accounts`) |
| `PATCH /api/me/bank-accounts/{id}` | kendisi | etiket, sahip adı, varsayılan |
| `DELETE /api/me/bank-accounts/{id}` | kendisi | §4.2 |
| `GET /api/me/export` | kendisi | §3.5 |
| `POST /api/me/closure-request` | kendisi | §3.5 |

- Başkasının hesap numarası **hiçbir liste ucunda dönmez**. Maliye yalnız fatura
  ayrıntısında, o faturanın ödeme hesabını tam görür (`review_purchases`, `manage_ledger`,
  admin; spec/81 §11). Diğer her yerde `iban_last4`.
- Fatura ayrıntısında tam IBAN gösterimi `security_events`'e `iban_viewed` olarak yazılır
  (kim, hangi fatura). Gerekçe: en hassas alan; kimin baktığı sonradan sorulabilsin.
- `/api/meta.me` yeni alan: `has_bank_account: boolean` (fatura formu yönlendirmesi için).

## 5. Gizlilik kuralları (aydınlatma metninin dayanağı)

| Veri | Görebilen | Saklama |
|---|---|---|
| Ad, takma ad, fotoğraf | oturumu olan herkes | hesap durdukça |
| Telefon | oturumu olan herkes (bugünkü kural: ekip arkadaşı ulaşsın) | hesap durdukça |
| Doğum günü | herkes (bugün yıl dahil, `/api/meta` `users[]`) | hesap durdukça |
| E-posta | herkes (giriş kimliği) | hesap durdukça |
| IBAN | kendisi; ayrıntıda `review_purchases`, `manage_ledger`, admin | silinene dek; sonra son 4 hane |
| Faturalar ve ekleri | gönderen, maliye yetkilileri, admin | yasal saklama (silinmez, iptal) |
| Mesaj ve kayıt metinleri | kayıt/sohbet izinleriyle (spec/75) | kayıt durdukça |
| LLM'e giden veri | kişisel veri **gitmez** (spec/79 §2) | `llm_call_bodies` 7 gün, kapalı varsayılan |

- Tablo **bugünkü** durumu yazar; aydınlatma metni bu tablodan üretilir, kural değişirse
  ikisi birlikte değişir.
- Metin Türkçe, sade; "KVKK" adı geçer ama hukuk metni gibi yazılmaz.

## 6. Ön yüz

- `surfaces/dashboard/routes.ts` ve `surfaces/app/routes.ts`: `{ name: "profile"; tab: ProfileTab; ret?: string }`.
- `features/profile/ProfilePage.tsx` (iki yüz ortak; `spec/16` §3: `features/` ortak),
  bölümler aynı klasörde: `ProfileInfo`, `BankAccounts`, `NotifySection` (bugünkü
  `NotifySettings` içeriği, pencere kabuğu olmadan), `Appearance`, `Privacy`.
- Kişi menüsündeki "Profilim" ve "Bildirimler" girdileri sayfaya gider; `Notifications`
  ekranındaki ayar düğmesi `/profile?tab=notifications`'a.
- `ProfileDialog` ve `NotifySettings` pencereleri silinir; içerikleri bölümlere taşınır
  (testleri de).

## 7. Sınama
- Rust: IBAN mod-97 (geçerli/geçersiz TR örnekleri; gerçek IBAN değil, sağlaması tutan
  uydurma), varsayılan tekliği, silmede son 4 hane, bekleyen faturalı hesap `409`.
- `local_test.sh`: başkasının hesabını `GET`/`PATCH` → `404`; liste uçlarında tam IBAN yok.
- vitest: `return` parametresi yalnız göreli yol; profil eksikken gezinme kapalı.

## 8. Açık sorular
1. Telefonun herkese açık olması bugünkü kural; Maliye ile birlikte "yalnız takım
   arkadaşları" daraltması istenir mi?
2. Hesap kapatma isteği onaylanınca kişinin mesajlarındaki adı kalsın mı ("Eski üye"
   yazılsın mı)? Şimdilik ad kalır, hesap pasif.
3. Doğum yılı bugün herkese gidiyor (`/api/meta`); doğum günü kutlaması için gün+ay yeter.
   Yıl yalnız kişinin kendisine dönsün mü? Önerim evet (veri en aza).
