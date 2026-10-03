# 75 — Yetki: kim neyi yapabilir

**Durum: taslak** (2026-10-03). "Ne var" kısmının kaynağı kod: `backend/src/api/*.rs`
(rotalar `api/mod.rs`), `backend/src/db/scope.rs`, `backend/src/refdata.rs`,
`backend/src/csrf.rs`, `backend/src/auth.rs`. "Ne olmalı" görüşleri iki ayrı
kaynaktan geldi: Jev (`backend/tools/scope_audit.json`/`.md`; karar modeli her uç
için olasılık verdi) ve Haiku matrisi. İkisi de yalnız görüş; tablolar koddan
okundu.

`70-guvenlik.md` §3'teki yetki tablosunun yerini bu belge alır. O tablo eskidi:
scope'lar ve gizli kayıt yok, "Yönetim = `is_admin`" diyor. §3 kural 4 ("gizli kayıt
kavramı yok") da artık geçerli değil (`access_mode = private`).

---

## 1. Amaç

Her `/api` ucu için tek bir doğru cevap vermek: bu isteği kim yapabilir, hangi
kontrol nerede. Yeni bir uç eklendiğinde §4'e satır eklenir. Kontrol her zaman
ucun ilk satırlarında, sunucuda yapılır (`70` §3 kural 5); ön yüz yalnızca gösterir.

## 2. Katmanlar

Kontroller aşağıdaki sırayla daralır. Bir uç bunlardan birini ya da birkaçını
birlikte (VE) ister.

1. **Oturum.** `CurrentUser` (`auth.rs:85-110`) imzalı çerezi çözer ve her
   istekte `users.is_active`'e bakar; geçemeyen istek 401 alır. `/api/me` ile
   `auth/*` dışındaki bütün uçlar oturum ister. Durum değiştiren her istek
   (GET/HEAD/OPTIONS dışında kalan her şey) ayrıca CSRF kapısından geçer
   (`csrf.rs:32`); oturumsuz bir yazma isteği orada 403 `csrf` ile döner.
2. **Admin baypası.** `users.is_admin`. `scope::active` admin için **bütün**
   scope'ları döner (`scope.rs:21`), `NodeAccess` ve `by_relation` da admin'i
   doğrudan geçirir (`scope.rs:52`, `:137`). Bu yüzden admin her kontrolden
   geçer. Yalnız admin'in yapabildikleri: `is_admin` vermek ya da almak, rol
   tanımlamak, pillar silmek, başka bir admin'i kapatmak.
3. **Scope.** Kişinin etkin scope'ları, doğrudan verilenlerle (`user_scopes`)
   rollerinden gelenlerin (`role_scopes`) birleşimidir ve okuma anında
   hesaplanır (`scope.rs:20`). Uçlar bunu `common::has_scope` ile sorar.
   Listenin tamamı §3'te.
4. **Dal/düğüm erişimi.** `NodeAccess` (`scope.rs:98`) kökün şemasına göre iki
   kural uygular (`refdata::editor`, `refdata.rs:44`):
   - `units` kökü: `edit_nodes` scope'u **ve** düğümün izinli bir dalın
     (`user_node_scopes`) altında olması gerekir. Alt ağaç izni miras alır.
   - `event_types` / `event_locations` kökleri: dal izni aranmaz. Yalnız
     `manage_event_types` ya da `manage_event_locations` gerekir.
   - Sert silme iki kademelidir. Bağımlısı olmayan düğümü Edit yetkisi silebilir.
     Bağımlısı olanı `units`'te `hard_delete_nodes` siler, refdata köklerinde
     yine aynı scope siler (kullanımdaki düğümü FK korur). Kök ve slot
     düğümlerinde yalnız ad ve açıklama değişir.
5. **Kayıt ilişkisi.** Burada üç kontrol var:
   - `can_edit_record` (`scope.rs:79`) kayıt düzenleme yetkisidir. Beş yoldan
     biri yeter: admin, sorumlu (`owner_id`), açan (`created_by`), katılımcı
     (`record_participants`), kaydın takımının üyesi ya da kaydın birimini
     kapsayan izinli bir dal. Son yolda `edit_nodes` **aranmaz**: dal izni tek
     başına kayıt yetkisi verir. Ön yüzde "üye" denen şey budur.
   - `decider` (`records.rs:137`) erişim kipini değiştirir ve katılma
     isteklerini karara bağlar: admin, sorumlu ya da açan.
   - Gizli kayıt (`is_restricted`, `records.rs:813`): `access_mode = private`
     olan bir kayıtta üye olmayan kişi yalnız kayıt satırını görür. Eylemler,
     kartlar, katılımcılar ve sohbet ona kapalıdır.
   - Etkinlik için iki ayrı kural var. `editable` (`events.rs:237`):
     `manage_events` **ya da** ikiz kayıtta `can_edit_record`. Onaylayıcı
     (`is_approver`, `events.rs:613`): `events.owner_id` **ya da**
     `manage_events`.
6. **Sahiplik ve self.** Bazı yazmalar yalnız `me.id`'ye bağlı satırlara
   dokunur: profil, pin, kart sırası, bildirim tercihi, push aboneliği, favori
   düğüm, kişinin kendi katılım cevabı ve oyu, kendi katılma isteği. Bir eki
   yükleyen ya da admin silebilir (`attachments.rs:269`). Mesaja ya da karta
   yalnız kendi yüklediğin ve henüz bir yere bağlanmamış ek bağlanır
   (`claimable`, `attachments.rs:340`).

## 3. Scope sözlüğü

Ekranda görünen metinler `frontend/src/lib/labels.ts` `SCOPE`'ta. Admin hepsine
sahip sayılır.

| Scope | Ne verir | Uçlar |
|---|---|---|
| `edit_nodes` | `units` içinde düğüm ekleme, düzenleme, taşıma, pasifleştirme ve bağımsız düğümü silme. Yalnız izinli dalda geçerli. | `POST /api/nodes`, `PATCH`/`DELETE /api/nodes/{id}` |
| `hard_delete_nodes` | `units` içinde bağımlısı olan düğümü silme (`edit_nodes` ve dal izniyle birlikte) | `DELETE /api/nodes/{id}` |
| `manage_event_types` | `event_types` alt ağacının tamamı: ekleme, düzenleme, silme. Dal izni gerekmez. | `/api/nodes*` |
| `manage_event_locations` | `event_locations` alt ağacının tamamı, aynı kuralla | `/api/nodes*` |
| `manage_users` | Panel ve kullanım verisi; kişi davet etme, açma ve kapatma (admin olmayanları); scope, rol ve dal izni verip alma; avatar | `GET /api/admin`, `GET /api/admin/activity`, `POST /api/admin/users`, `PATCH /api/admin/users/{id}` (op=`admin` hariç). Bkz. A1 |
| `manage_teams` | Takım ve pillar kurma ve düzenleme, takım silme, takıma düğüm bağlama, üye ekleme ve çıkarma | `POST /api/teams`, `PATCH`/`DELETE /api/teams/{id}`, `/api/teams/{id}/nodes/{node}`, `POST /api/pillars`, `PATCH /api/pillars/{id}`, `/api/teams/{id}/members*`. Kişi kendini bir takıma ekleyince o takımın kayıtlarında `can_edit` kazanır. |
| `edit_deadline` | Kaydın ve eylemin son tarihi. Kayıt yetkisinin **üstüne** eklenir (ikisi birlikte gerekir). | `PATCH /api/records/{id}` (`due_date`), `POST /api/records/{id}/actions` (`due_date` gelirse), `PATCH /api/actions/{id}` (`due_date`) |
| `tag_media` | Var olan etiketi bir eke ekleme ya da çıkarma. Katılım şartı da var: kayıtta `can_edit`, takım duvarında üyelik. | `POST /api/attachments/{id}/tags`, `DELETE /api/attachments/{id}/tags/{tag}` |
| `create_tags` | Yeni etiket adı tanımlama (`tag_media` kapısından sonra sorulur) | `POST /api/attachments/{id}/tags` (slug yoksa) |
| `manage_events` | Her etkinliği düzenleme (`editable`), checkpoint ekleme ve tarihini değiştirme, onaylayıcı olma | `/api/events/*`, `/api/event-checkpoints/*`, `/api/checkpoint-requests/*`, OTF yazma |
| `manage_event_widgets` | Şablon widget'ı ekleme ve silme (`record` türü hariç) | `POST /api/events/{id}/widgets`, `DELETE /api/event-widgets/{id}` |
| `manage_purchases` | Malzeme ve tedarikçi yazma. Etkinliği düzenleme yetkisi ayrıca aranmaz. | `POST /api/events/{id}/materials`, `/api/materials/*`, `/api/material-providers/*` |

## 4. Uç matrisi

Kısaltmalar:

- **oturum**: yalnız giriş yapmış olmak yeterli.
- **self**: istek yalnız kişinin kendi satırını yazar ya da okur.
- **can_edit**: kaydın `can_edit_record` kontrolü.
- **editable**: etkinliğin `editable` kontrolü.
- **approver**: etkinliğin onaylayıcı kontrolü.

Satırın sonundaki `dosya:satır` handler'ın yeridir. Toplam 97 uç.

### Kimlik ve sözlük (`mod.rs`, `auth.rs`, `meta.rs`, `profile.rs`)

| Uç | Gerçek kontrol | Not |
|---|---|---|
| `GET /api/me` | yok (oturum isteğe bağlı) | `csrf` yalnız çözülen kullanıcıya verilir; `dev_users` yalnız sahte kimlikte döner. `mod.rs:147` |
| `GET /api/auth/google` | yok | Sahte kimlikte 404; hız sınırı var. `auth.rs:157` |
| `GET /api/auth/callback` | yok | `state` + PKCE, davetli listesi, `is_active` ve hız sınırı. `auth.rs:213` |
| `POST /api/auth/logout` | CSRF (oturum) | `auth.rs:339` |
| `GET /api/auth/dev-login` | yalnız sahte kimlikte | Yayında 404; Config sahte kimliği zaten reddeder. `auth.rs:357` |
| `GET /api/meta` | oturum | Bütün aktif kişileri telefon ve doğum günüyle döner. `meta.rs:101` |
| `PATCH /api/me/profile` | self | Avatar yalnız kişinin kendi eki olabilir. `profile.rs:47` |

### Ana sayfa ve takım okuma (`home.rs`)

| Uç | Gerçek kontrol | Not |
|---|---|---|
| `GET /api/home` | oturum | Sayaçlar kulübün tamamını sayar; `my_open_actions` yalnız kişinin kendi eylemleri. `:36` |
| `POST /api/pins/{slug}` | self | `:59` |
| `DELETE /api/pins/{slug}` | self | `:68` |
| `GET /api/teams` | oturum | `:117` |
| `GET /api/teams/{id}` | oturum | `:121` |
| `POST /api/teams/{id}/members` | `manage_teams` | Upsert. `:166` |
| `DELETE /api/teams/{id}/members/{user}` | `manage_teams` | `:194` |

### Kayıtlar ve eylemler (`records.rs`)

| Uç | Gerçek kontrol | Not |
|---|---|---|
| `GET /api/records` | oturum | Gizli kayıtlar da listede görünür (§5). `:66` |
| `POST /api/records` | oturum | Her birimde açılabilir (karar 2026-09-23, `90` G1). `:322` |
| `GET /api/records/{id}` | oturum | Kayıt gizliyse ve kişi üye değilse kısıtlı görünüm döner. `:218` |
| `PATCH /api/records/{id}` | can_edit | `due_date` için ayrıca `edit_deadline`, `access_mode` için ayrıca decider. Bkz. A2. `:376` |
| `PUT /api/records/{id}/participants/{user}` | can_edit | `:645` |
| `DELETE /api/records/{id}/participants/{user}` | can_edit | `:667` |
| `POST /api/records/{id}/join` | oturum | Zaten `can_edit` varsa bir şey yapmaz. `public` kayıtta kişi doğrudan katılımcı olur; diğer kiplerde istek açılır. `:730` |
| `DELETE /api/records/{id}/join` | self | Kişi kendi isteğini geri çeker. `:764` |
| `POST /api/records/{id}/join-requests/{user}` | decider | `:779` |
| `PUT /api/records/{id}/pin` | self | `:687` |
| `DELETE /api/records/{id}/pin` | self | `:696` |
| `PUT /api/records/{id}/card-order` | self | Yalnız kişinin kendi görünümü. `:711` |
| `POST /api/records/{id}/actions` | can_edit | `due_date` gelirse ayrıca `edit_deadline`. `:511` |
| `GET /api/actions/mine` | self | `:631` |
| `PATCH /api/actions/{id}` | kaydın can_edit kontrolü | `due_date` için ayrıca `edit_deadline`. Eylemin sahibi olmak yetki vermez (K1). `:556` |

### Kartlar (`cards.rs`)

| Uç | Gerçek kontrol | Not |
|---|---|---|
| `POST /api/records/{id}/cards` | can_edit | `:362` |
| `PATCH /api/cards/{id}` | can_edit | `:386` |
| `DELETE /api/cards/{id}` | can_edit | `:410` |
| `PUT /api/cards/{id}/signup` | oturum, kayıt kısıtlı değilse | Kişi yalnız kendi adına cevap verir (K5). `:430` |
| `PUT /api/cards/{id}/vote` | oturum, kayıt kısıtlı değilse | Kişi yalnız kendi oyunu verir (K5). `:483` |
| `POST /api/cards/{id}/attachments` | can_edit + `claimable` | `:535` |

### Etkinlikler ve OTF (`events.rs`, `otf.rs`)

| Uç | Gerçek kontrol | Not |
|---|---|---|
| `GET /api/events` | oturum | `events.rs:90` |
| `POST /api/events` | oturum | Açan kişi sorumlu, katılımcı ve dolayısıyla onaylayıcı olur (K2). `:305` |
| `GET /api/events/{id}` | oturum | İkizin `access_mode`'una bakılmaz (A4). `:230` |
| `PATCH /api/events/{id}` | editable | `owner_id` değişikliği de buradan geçer (A2). `:385` |
| `PUT /api/events/{id}/participants/{user}` | editable | Kişiyi ikizin katılımcısı da yapar, yani ona yetki verir. `:513` |
| `DELETE /api/events/{id}/participants/{user}` | editable | `:535` |
| `PUT /api/events/{id}/teams/{team}` | editable | `:550` |
| `DELETE /api/events/{id}/teams/{team}` | editable | `:562` |
| `POST /api/events/{id}/checkpoints` | `manage_events` | `:581` |
| `POST /api/events/{id}/widgets` | `record` türünde editable, diğerlerinde `manage_event_widgets` | Bağlanan kayıt için yetki aranmaz; yalnız var olması gerekir. `:771` |
| `POST /api/events/{id}/materials` | `manage_purchases` | `:826` |
| `GET /api/events/{id}/otf` | oturum | `otf.rs:235` |
| `PUT /api/events/{id}/otf` | editable | `otf.rs:303` |
| `POST /api/events/{id}/otf/autofill` | editable | `otf.rs:264` |
| `GET /api/events/{id}/otf.docx` | oturum | Gözden geçirilmemiş form 409 döner. `otf.rs:382` |
| `PATCH /api/event-checkpoints/{id}` | editable | `done` için ayrıca approver, `date` için ayrıca `manage_events` (K4). `:624` |
| `DELETE /api/event-checkpoints/{id}` | approver | `editable` ayrıca aranmaz (K3). `:652` |
| `POST /api/event-checkpoints/{id}/requests` | editable | `:688` |
| `POST /api/checkpoint-requests/{id}` | approver | K3. `:722` |
| `DELETE /api/event-widgets/{id}` | `record` türünde editable, diğerlerinde `manage_event_widgets` | `:803` |
| `PATCH /api/materials/{id}` | `manage_purchases` | `:864` |
| `DELETE /api/materials/{id}` | `manage_purchases` | `:897` |
| `POST /api/materials/{id}/providers` | `manage_purchases` | `:916` |
| `DELETE /api/material-providers/{id}` | `manage_purchases` | `:939` |

### Sohbet (`chats.rs`)

| Uç | Gerçek kontrol | Not |
|---|---|---|
| `GET /api/chats/{id}/feed` | oturum | Gizli bir kaydın sohbetiyse ve kişi üye değilse 403. Takım duvarını herkes okur. `:68` |
| `POST /api/chats/{id}/messages` | kayıt sohbetinde can_edit; takım duvarında üye ya da admin | Ekler `claimable` olmalı. `@anma` anılan kişiyi kayda katılımcı ekler. `:146` |

### Takım ve pillar yazma (`teams.rs`)

| Uç | Gerçek kontrol | Not |
|---|---|---|
| `POST /api/teams` | `manage_teams` | `:112` |
| `PATCH /api/teams/{id}` | `manage_teams` | Pillar takımının adı değişmez (409). `:139` |
| `DELETE /api/teams/{id}` | `manage_teams` | Pillar takımı silinmez (409). `:177` |
| `PUT /api/teams/{id}/nodes/{node}` | `manage_teams` | Yalnız `units` altındaki düğüm bağlanır. `:198` |
| `DELETE /api/teams/{id}/nodes/{node}` | `manage_teams` | `:229` |
| `POST /api/pillars` | `manage_teams` | `:253` |
| `PATCH /api/pillars/{id}` | `manage_teams` | `:290` |
| `DELETE /api/pillars/{id}` | admin | `:342` |

### Bildirim ve push (`notify.rs`)

| Uç | Gerçek kontrol | Not |
|---|---|---|
| `GET /api/notifications` | self | A3. `:82` |
| `POST /api/notifications/seen` | self | `:115` |
| `GET /api/me/notifications` | self | `:121` |
| `PATCH /api/me/notifications` | self | `:136` |
| `PUT /api/chats/{id}/prefs` | self | Sohbetin var olması yeter; erişim aranmaz. `:157` |
| `GET /api/push/vapid` | oturum | `:226` |
| `POST /api/push/subscriptions` | self | Aynı endpoint başka bir hesapla gelirse abonelik o hesaba geçer (bilinçli). `:191` |
| `DELETE /api/push/subscriptions` | self | `:212` |

### Ağaç (`nodes.rs`)

| Uç | Gerçek kontrol | Not |
|---|---|---|
| `GET /api/nodes` | oturum | `can_edit` ve `can_hard_delete` bayrakları `NodeAccess`'ten gelir. `:95` |
| `POST /api/nodes` | ebeveyn düğümde `NodeAccess` Edit | Kök oluşturulamaz. `:225` |
| `PATCH /api/nodes/{id}` | düğümde Edit; taşımada hedefte de Edit | Kökler arası taşıma yok; kök ve slotta yalnız ad ve açıklama değişir. `:333` |
| `DELETE /api/nodes/{id}` | Edit + (bağımlısı yok **ya da** HardDelete) | Kök ve slot 409. `:484` |
| `PUT /api/nodes/{id}/favorite` | self | `:520` |
| `DELETE /api/nodes/{id}/favorite` | self | `:532` |

### Ekler ve etiketler (`attachments.rs`)

| Uç | Gerçek kontrol | Not |
|---|---|---|
| `POST /api/attachments` | oturum | Ek bir yere bağlanmadan oluşur. `:156` |
| `GET /api/attachments/{id}` | oturum | A5. `:252` |
| `GET /api/attachments/{id}/thumb` | oturum | A5. `:256` |
| `DELETE /api/attachments/{id}` | yükleyen ya da admin | `:264` |
| `POST /api/attachments/{id}/tags` | `can_tag` (admin ya da `tag_media` + katılım) | Yeni etiket adı için ayrıca `create_tags`. `:295` |
| `DELETE /api/attachments/{id}/tags/{tag}` | `can_tag` | `:325` |
| `GET /api/tags` | oturum | `:282` |

### Yönetim (`admin.rs`)

| Uç | Gerçek kontrol | Not |
|---|---|---|
| `GET /api/admin` | `manage_users` ya da admin | `:172` |
| `GET /api/admin/activity` | `manage_users` ya da admin | `:490` |
| `POST /api/admin/users` | `manage_users` ya da admin | `:187` |
| `PATCH /api/admin/users/{id}` | `manage_users` ya da admin | op=`admin` yalnız admin. Hedef admin'se op=`active` da yalnız admin. Son admin korunur. Bkz. A1. `:229` |
| `POST /api/admin/roles` | admin | `:419` |
| `PATCH /api/admin/roles/{id}` | admin | `:432` |
| `DELETE /api/admin/roles/{id}` | admin | `:447` |

## 5. Veri kapsamı ve erişim

Aşağıdaki okumalar isteği reddetmez (403 dönmez). Bunun yerine **satırları ya da
alanları süzer**. Okuma modeli "giriş yapan herkes görür"
(`70` §3 kural 4) ve buna tek bir istisna var: gizli kaydın içi. Bu yüzden
bunlar yetki açığı sayılmadı ve tek tek işaretlenmedi:

- `GET /api/records`: `pinned=true` yalnız kişinin kendi pinlerini getirir.
  Bunun dışında gizli kayıtlar dahil hepsi listelenir, çünkü kayıt satırı
  gizli değildir.
- `GET /api/records/{id}`: kısıtlı görünümde eylemler, kartlar ve katılımcılar
  boş döner. `membership.requests` yalnız decider'a doludur.
- `GET /api/events/{id}`: `requests` onaylayıcıya hepsini, diğer kişiye yalnız
  kendi isteklerini verir.
- `GET /api/home`, `GET /api/actions/mine`, `GET /api/notifications`, `GET /api/meta`
  (`me`): kişiye ait sayaçlar ve listeler `me.id` ile süzülür.
- `GET /api/nodes`, kayıt ayrıntısı, ek görünümleri: `can_edit`, `can_delete`,
  `can_tag` gibi bayraklar yalnız bilgi verir. Asıl karar yazma ucunda verilir.

## 6. Karar bekleyen

Bu bölüme yalnız Jev'in ya da Haiku'nun kodu yanlış bulduğu **ve** kodu okuduktan
sonra en azından tartışmalı kalan noktalar girdi.

**K1 — Eylem sahibi kendi eylemini kapatamıyor.** `PATCH /api/actions/{id}` kaydın
`can_edit` kontrolünü istiyor (`records.rs:564`). Eylemin `owner_id`'si
`can_edit_record`'un beş yolundan biri değil (`scope.rs:48-75`). Bu yüzden kayda
katılımcı olarak eklenmemiş bir kişiye atanan eylemi o kişi "tamamlandı"
yapamıyor.
Jev: `owner_or_editor` (0.94). Haiku: `owner_or_admin`.
**Öneri:** Eylem sahibine yalnız `status` alanında izin verilsin; diğer alanlar
kayıt yetkisinde kalsın.

**K2 — Etkinliği herkes açabiliyor.** `POST /api/events` yalnız oturum istiyor
(`events.rs:305`). Açan kişi sorumlu olur, bu yüzden kendi etkinliğinin
onaylayıcısıdır.
Haiku: `manage_events` olmalı. Jev: `anyone_logged_in`, ama düşük güvenle (0.34).
**Öneri:** Açık kalsın; kayıt açma kararıyla tutarlı (2026-09-23). Asıl risk
olan "onay akışını baypas etme" A2 ile kapanır.

**K3 — Etkinlik sorumlusu onaylayıcı mı?** Checkpoint silme
(`events.rs:652`) ve istek yanıtlama (`:722`) onaylayıcıya (sorumlu ya da
`manage_events`) açık. Checkpoint eklemek ise yalnız `manage_events`'e açık.
Jev: ikisi de `manage_events` olmalı (silme 0.74, yanıtlama 0.61). Haiku: silme
için `manage_events`, yanıtlama için onaylayıcı yeter.
**Öneri:** `73` §6 olduğu gibi kalsın, çünkü silme isteği de onaylayıcıya gidiyor
ve akış tutarlı. Yalnız A2 kapanmadan bu kuralın koruması yok: herhangi bir
düzenleyen kendini sorumlu yapıp onaylayıcı olabiliyor.

**K4 — Checkpoint tarihini hangi scope değiştirir?** Bugün `manage_events`
(`events.rs:641-647`). `edit_deadline` "son tarih" yeteneği ama yalnız kayıt ve
eylem için tanımlı. Jev checkpoint tarihi için `edit_deadline` görüyor (0.66).
Haiku koddaki gibi `manage_events` diyor.
**Öneri:** `manage_events` kalsın; checkpoint tarihi şablon yapısının bir parçası.
`edit_deadline` etiketine "etkinlik adımları hariç" notu eklensin.

**K5 — Kart katılımı ve oylama.** `signup` ve `vote` (`cards.rs:430`, `:483`) yalnız
"kayıt kısıtlı değil" şartını arıyor. Bu, `request` kipindeki bir kayıtta onayı
olmayan kişinin de oy verebilmesi demek.
Jev: kayıt düzenleyen olmalı (0.71 / 0.70). Haiku: üye ya da açık kayıt.
**Öneri:** `public` kayıtta bugünkü gibi kalsın; kişi yalnız kendi adına cevap
veriyor (`cards.rs:13-15`). `request` kipinde onaysız oy istenmiyorsa,
`is_restricted` genişletilmesin, ayrı bir `mode != public && !can_edit` kontrolü
eklensin.

**Elenenler.** Şunlara bakıldı ve elendi:

- Jev'in `actual_checks` sütunu ham düzenli ifade izi. `meta`, `home`, `records`
  ve `notifications`'taki `owner_id`, `membership` ve `is_admin` işaretleri SQL
  süzgecinden geliyor (§5); yetki kontrolü değil.
- Düşük güvenli aktör tahminleri (≤0.5): `GET /api/events/{id}`, `otf.docx`,
  `POST /api/attachments`, etkinliğe takım bağlama/çözme için `manage_teams`.
- `GET /api/auth/dev-login` için admin önerisi elendi; sahte kimlik kapısı daha
  sıkı.
- `PUT card-order` ve `DELETE pin` için `owner_or_editor` önerisi elendi; ikisi
  de kişinin kendi görünümü.
- `DELETE /api/nodes/{id}` için "her zaman `hard_delete_nodes`" önerisi elendi.
  İki kademe bilinçli bir karar (`72` §6.2, `70` §3).
- Takımdan düğüm çözmek için `edit_nodes` önerisi elendi; bağ takım tarafında
  tutuluyor.
- Haiku'nun `code_checks` sütunu birkaç yerde kodu yanlış okumuş:
  `POST /api/events`'te `manage_events` görmüş, malzemelerde `record_edit`,
  `PATCH /api/actions`'ta eylem sahibi, `/admin/activity`'de `admin_only`. Bu
  satırlardaki "olmalı" görüşleri o yanlış okumaya dayandığı için elendi.
  Malzemeler için `73` §5 açık: `manage_purchases`.

## 7. Bilinen açıklar

Bu açıklar kodu okurken bulundu; Jev ya da Haiku'nun ne dediğinden bağımsız.

**A1 — `manage_users` kendine her yetkiyi verebiliyor (orta).**
`PATCH /api/admin/users/{id}`'de `GrantScope`, `GrantRole` ve `GrantNode`
(`admin.rs:286`, `:299`, `:313`) hedefin `me.id` olup olmadığına ya da verilen
scope'a hiçbir sınır koymuyor. `71` §5 madde 3, rol tanımlamayı "ayrıcalık
yükseltme" diye yalnız admin'e bırakmıştı. Ama doğrudan scope vermek aynı sonuca
çıkıyor: `manage_users` sahibi kendine bütün scope'ları ve her dalı verebilir.
Admin bayrağına ulaşamaz, ama onun dışındaki her şeye ulaşır.
Öneri: En azından admin olmayan biri kendi satırına grant yazamasın. Tam çözüm:
`manage_users`'ın verebileceği scope'ların bir listesi olsun (ya da kişi yalnız
kendisinde olanı verebilsin).

**A2 — Herhangi bir düzenleyen kendini sorumlu yapabiliyor (orta).**
`PATCH /api/records/{id}` `owner_id` alanı (`records.rs:401`) ve
`PATCH /api/events/{id}` `owner_id` alanı (`events.rs:423`) yalnız
`can_edit` / `editable` kontrolünü istiyor. Sorumlu olan kişi decider olur:
erişim kipini değiştirir ve katılma isteklerine karar verir (`records.rs:433`,
`:784`). Etkinlikte de onaylayıcı olur (`events.rs:613`). Böylece `public` bir
kayda katılan herkes iki adımda kaydı `private` yapabiliyor; etkinlikte de
checkpoint onay akışı (`73` §6) anlamını yitiriyor.
Öneri: Sorumluyu yalnız decider (etkinlikte onaylayıcı) değiştirebilsin. Tek
istisna: sorumlusuz kaydı herkes üstlenebilir (`70` §3 kural 3).

**A3 — Bildirimler gizli kaydın sohbetini sızdırıyor (düşük).**
`GET /api/notifications` kaydın sohbet satırlarını "benim kayıtlarım" kümesiyle
süzüyor (`notify.rs:88-95`). Bu küme eylem sahibini de içeriyor. Ama eylem
sahibi `can_edit_record` yollarından biri değil. Sonuç: gizli bir kayıtta
kısıtlı görünümdeki eylem sahibi, sohbet ucunda 403 alırken bildirimlerde mesaj
gövdesini (`body`) okuyabiliyor.
Öneri: K1 ile birlikte karar verilsin. Ya eylem sahibi kayda katılımcı olarak
eklensin ya da `mine` kümesinden kısıtlı kayıtlar çıkarılsın.

**A4 — Etkinlik ayrıntısı ikizin gizliliğine bakmıyor (düşük).**
`GET /api/events/{id}`, `/otf` ve `/otf.docx` (`events.rs:230`, `otf.rs:235`,
`:382`) ikiz kayıt `private` yapılsa da her şeyi döndürüyor: katılımcılar,
malzemeler, OTF. Aynı ikizin sohbeti ise 403 veriyor. İki yüz tutarsız.
Öneri: İkizin `access_mode` değişikliği yasaklansın (ikiz hep `public` kalsın) ya
da etkinlik ayrıntısında da `is_restricted` uygulansın.

**A5 — Eki kimliğini bilen herkes indirebiliyor (düşük).**
`GET /api/attachments/{id}` ve `/thumb` (`attachments.rs:252`, `:256`) yalnız
oturum istiyor. Gizli bir kaydın sohbetindeki ya da kartındaki ek de bu yoldan
çekilebiliyor. Kimlik UUID v4 olduğu için tahmin edilemez; risk düşük. Bu
belgeye "okuma herkese açık" modelinin bir sonucu olarak not edildi.
Öneri: `place()` (`attachments.rs:123`) zaten ekin hangi kayda bağlı olduğunu
buluyor. Aynı sorguya `is_restricted` kontrolü eklenebilir.

## 8. Bakım

- Yeni bir uç eklendiğinde §4'e satır, yeni bir scope eklendiğinde §3'e satır
  eklenir. Scope adı ve etiketi `labels.ts` `SCOPE`'ta durur.
- Sözleşme testi `backend/tools/check_api.sh`. K ve A maddeleri karara
  bağlandıkça buraya ve `check_api.sh`'e reddedilen yolun bir örneği eklenir.
- Jev karşılaştırması `backend/tools/scope_audit.py` ile yeniden üretilir. Çıktı
  görüştür, bu belgenin yerine geçmez.
