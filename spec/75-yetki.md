# 75 — Yetki: kim neyi yapabilir

**Durum: uygulandı** (2026-10-03). §6'daki K1–K5 ve §7'deki A1–A5 kullanıcı
kararıyla (2026-10-03) karara bağlandı ve koda geçti; sözleşme testleri
`backend/tools/check_api.sh`'te. "Ne var" kısmının kaynağı kod: `backend/src/api/*.rs`
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
   tanımlamak, pillar silmek, başka bir admin'i kapatmak, `manage_users`'ı
   (doğrudan ya da rol içinde) vermek ya da almak, kendinde olmayan bir scope'u,
   rolü ya da dalı vermek, kendi satırında yetki değiştirmek (A1).
3. **Scope.** Kişinin etkin scope'ları, doğrudan verilenlerle (`user_scopes`)
   rollerinden gelenlerin (`role_scopes`) birleşimidir ve okuma anında
   hesaplanır (`scope.rs:20`). Uçlar bunu `common::has_scope` ile sorar.
   Listenin tamamı §3'te.
4. **Dal/düğüm erişimi.** `NodeAccess` (`scope.rs:98`) kökün şemasına göre iki
   kural uygular (`refdata::editor`, `refdata.rs:44`):
   - `units` kökü: `edit_nodes` scope'u **ve** düğümün izinli bir dalın
     (`user_node_scopes`) altında olması gerekir. Alt ağaç izni miras alır.
     Bu belgede "dal editörü" budur.
   - `event_types` / `event_locations` kökleri: dal izni aranmaz. Yalnız
     `manage_event_types` ya da `manage_event_locations` gerekir.
   - Sert silme iki kademelidir. Bağımlısı olmayan düğümü Edit yetkisi silebilir.
     Bağımlısı olanı `units`'te `hard_delete_nodes` siler, refdata köklerinde
     yine aynı scope siler (kullanımdaki düğümü FK korur). Kök ve slot
     düğümlerinde yalnız ad ve açıklama değişir.
5. **Kayıt ilişkisi.** Burada şu kontroller var:
   - `can_edit_record` (`scope.rs:79`) kayıt düzenleme yetkisidir. Beş yoldan
     biri yeter: admin, sorumlu (`owner_id`), açan (`created_by`), katılımcı
     (`record_participants`), kaydın takımının üyesi ya da kaydın birimini
     kapsayan izinli bir dal. Son yolda `edit_nodes` **aranmaz**: dal izni tek
     başına kayıt yetkisi verir. Ön yüzde "üye" denen şey budur. Bir eylemin
     sorumlusu olan kişi kayda katılımcı olarak eklenir (K1), yani eylem
     sahipliği ayrı bir yol değil, katılımcılık yoluna bağlanır.
   - `decider` (`records.rs:137`) erişim kipini değiştirir ve katılma
     isteklerini karara bağlar: admin, sorumlu ya da açan.
   - Sorumluyu değiştirmek (`may_set_owner`, `records.rs:231`): `can_edit`'in
     üstüne mevcut sorumlu, admin ya da kaydın biriminde dal editörü;
     sorumlusuz kaydı düzenleyen herkes kendine alabilir. Etkinlikte ayrıca
     `manage_events` (A2).
   - Gizli kayıt (`is_restricted`, `records.rs:849`): `access_mode = private`
     olan bir kayıtta üye olmayan kişi yalnız kayıt satırını görür. Eylemler,
     kartlar, katılımcılar, sohbet, sohbet ve kart ekleri (A5) ve ikiz
     etkinliğin ayrıntısı, OTF'si (A4) ona kapalıdır.
   - Kart cevabı ve oy (`may_respond`, `records.rs:858`): `public` kayıtta
     herkes, `request` ve `private` kayıtta yalnız üye (K5).
   - Etkinlik için iki ayrı kural var. `editable` (`events.rs:250`):
     `manage_events` **ya da** ikiz kayıtta `can_edit_record`. Onaylayıcı
     (`is_approver`, `events.rs:632`): `events.owner_id` **ya da**
     `manage_events`.
6. **Sahiplik ve self.** Bazı yazmalar yalnız `me.id`'ye bağlı satırlara
   dokunur: profil, pin, kart sırası, bildirim tercihi, push aboneliği, favori
   düğüm, kişinin kendi katılım cevabı ve oyu, kendi katılma isteği. Bir eki
   yükleyen ya da admin silebilir (`attachments.rs:280`). Mesaja ya da karta
   yalnız kendi yüklediğin ve henüz bir yere bağlanmamış ek bağlanır
   (`claimable`, `attachments.rs:356`).

## 3. Scope sözlüğü

Ekranda görünen metinler `frontend/src/lib/labels.ts` `SCOPE`'ta. Admin hepsine
sahip sayılır.

| Scope | Ne verir | Uçlar |
|---|---|---|
| `edit_nodes` | `units` içinde düğüm ekleme, düzenleme, taşıma, pasifleştirme ve bağımsız düğümü silme. Yalnız izinli dalda geçerli. Dal izniyle birlikte kaydın sorumlusunu değiştirme (A2). | `POST /api/nodes`, `PATCH`/`DELETE /api/nodes/{id}`, `PATCH /api/records/{id}` (`owner_id`) |
| `hard_delete_nodes` | `units` içinde bağımlısı olan düğümü silme (`edit_nodes` ve dal izniyle birlikte) | `DELETE /api/nodes/{id}` |
| `manage_event_types` | `event_types` alt ağacının tamamı: ekleme, düzenleme, silme. Dal izni gerekmez. | `/api/nodes*` |
| `manage_event_locations` | `event_locations` alt ağacının tamamı, aynı kuralla | `/api/nodes*` |
| `manage_event_outcomes` | `event_outcomes` (Etkinlik Kazanımları) alt ağacının tamamı, aynı kuralla. `event_management` kökünün kendisini (ad/açıklama) yalnız admin düzenler. | `/api/nodes*` |
| `manage_users` | Panel ve kullanım verisi; kişi davet etme, açma ve kapatma (admin olmayanları); kendinde olan scope, rol ve dalı verip alma; avatar. Kendi satırına dokunamaz, `manage_users`'ı veremez (A1). | `GET /api/admin`, `GET /api/admin/activity`, `POST /api/admin/users`, `PATCH /api/admin/users/{id}` (op=`admin` hariç) |
| `manage_teams` | Takım ve pillar kurma ve düzenleme, takım silme, takıma düğüm bağlama, üye ekleme ve çıkarma | `POST /api/teams`, `PATCH`/`DELETE /api/teams/{id}`, `/api/teams/{id}/nodes/{node}`, `POST /api/pillars`, `PATCH /api/pillars/{id}`, `/api/teams/{id}/members*`. Kişi kendini bir takıma ekleyince o takımın kayıtlarında `can_edit` kazanır. |
| `edit_deadline` | Kaydın ve eylemin son tarihi. Kayıt yetkisinin **üstüne** eklenir (ikisi birlikte gerekir). Etkinlik adımlarının (checkpoint) tarihi bu scope'ta değil, `manage_events`'te (K4). | `PATCH /api/records/{id}` (`due_date`), `POST /api/records/{id}/actions` (`due_date` gelirse), `PATCH /api/actions/{id}` (`due_date`) |
| `tag_media` | Var olan etiketi bir eke ekleme ya da çıkarma. Katılım şartı da var: kayıtta `can_edit`, takım duvarında üyelik. | `POST /api/attachments/{id}/tags`, `DELETE /api/attachments/{id}/tags/{tag}` |
| `create_tags` | Yeni etiket adı tanımlama (`tag_media` kapısından sonra sorulur) | `POST /api/attachments/{id}/tags` (slug yoksa) |
| `manage_events` | Her etkinliği düzenleme (`editable`), checkpoint ekleme ve tarihini değiştirme, onaylayıcı olma, etkinliğin sorumlusunu değiştirme (A2) | `/api/events/*`, `/api/event-checkpoints/*`, `/api/checkpoint-requests/*`, OTF yazma |
| `manage_event_widgets` | Şablon widget'ı ekleme ve silme (`record` türü hariç) | `POST /api/events/{id}/widgets`, `DELETE /api/event-widgets/{id}` |
| `manage_purchases` | Malzeme ve tedarikçi yazma. Etkinliği düzenleme yetkisi ayrıca aranmaz. Satın alınmış (`purchased`) kalemin tedariki donar: yalnız not, öncelik ve teslim işareti yazılır (`purchased_locked`). | `POST /api/events/{id}/materials`, `/api/materials/{id}`, `/api/materials/{id}/providers`, `/api/material-providers/*` |
| `manage_budgets` | Kalem bütçesini yazma ya da silme (`budget`). Satın alım yetkisine ek: `PATCH /api/materials/{id}` içinde `budget` alanı bu yetkiyi ister, tedarik yetkisi tek başına yetmez. | `PATCH /api/materials/{id}` (`budget`) |
| `review_purchases` | Kalemi "satın alındı" işaretleme ve geri alma (maliye incelemesi). Widget'taki onay (`state` 3) satın alındı demek değildir; yalnız onaylı, elde olmayan kalem işaretlenir (`not_approved`). | `PATCH /api/materials/{id}/purchased` |

## 4. Uç matrisi

Kısaltmalar:

- **oturum**: yalnız giriş yapmış olmak yeterli.
- **self**: istek yalnız kişinin kendi satırını yazar ya da okur.
- **can_edit**: kaydın `can_edit_record` kontrolü.
- **editable**: etkinliğin `editable` kontrolü.
- **approver**: etkinliğin onaylayıcı kontrolü.
- **gizli değilse**: kayıt (ya da ikiz) `private` ise yalnız üye; değilse oturum.

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
| `POST /api/records` | oturum | Her birimde açılabilir (karar 2026-09-23, `90` G1). `:353` |
| `GET /api/records/{id}` | oturum | Kayıt gizliyse ve kişi üye değilse kısıtlı görünüm döner. `:218` |
| `PATCH /api/records/{id}` | can_edit | `due_date` için ayrıca `edit_deadline`, `access_mode` için ayrıca decider, `owner_id` için ayrıca `may_set_owner` (A2; red 403 `owner_change_denied`). `:407` |
| `PUT /api/records/{id}/participants/{user}` | can_edit | `:681` |
| `DELETE /api/records/{id}/participants/{user}` | can_edit | `:703` |
| `POST /api/records/{id}/join` | oturum | Zaten `can_edit` varsa bir şey yapmaz. `public` kayıtta kişi doğrudan katılımcı olur; diğer kiplerde istek açılır. `:766` |
| `DELETE /api/records/{id}/join` | self | Kişi kendi isteğini geri çeker. `:800` |
| `POST /api/records/{id}/join-requests/{user}` | decider | `:815` |
| `PUT /api/records/{id}/pin` | self | `:723` |
| `DELETE /api/records/{id}/pin` | self | `:732` |
| `PUT /api/records/{id}/card-order` | self | Yalnız kişinin kendi görünümü. `:747` |
| `POST /api/records/{id}/actions` | can_edit | `due_date` gelirse ayrıca `edit_deadline`. `owner_id` verilirse kişi kayda katılımcı olur (K1). `:545` |
| `GET /api/actions/mine` | self | `:667` |
| `PATCH /api/actions/{id}` | kaydın can_edit kontrolü | `due_date` için ayrıca `edit_deadline`. `owner_id` atanan kişi kayda katılımcı olur, böylece kendi eylemini kapatabilir (K1). `:591` |

### Kartlar (`cards.rs`)

| Uç | Gerçek kontrol | Not |
|---|---|---|
| `POST /api/records/{id}/cards` | can_edit | `:363` |
| `PATCH /api/cards/{id}` | can_edit | `:387` |
| `DELETE /api/cards/{id}` | can_edit | `:411` |
| `PUT /api/cards/{id}/signup` | `may_respond`: `public` kayıtta oturum, `request`/`private` kayıtta üye | Kişi yalnız kendi adına cevap verir (K5). `:431` |
| `PUT /api/cards/{id}/vote` | `may_respond` | Kişi yalnız kendi oyunu verir (K5). `:484` |
| `POST /api/cards/{id}/attachments` | can_edit + `claimable` | `:536` |

### Etkinlikler ve OTF (`events.rs`, `otf.rs`)

| Uç | Gerçek kontrol | Not |
|---|---|---|
| `GET /api/events` | oturum | `events.rs:90` |
| `POST /api/events` | oturum | Açan kişi sorumlu, katılımcı ve dolayısıyla onaylayıcı olur (K2). `:318` |
| `GET /api/events/{id}` | gizli değilse | İkiz `private` ise ve kişi üye değilse 403, ikizin sohbeti gibi (A4, `require_visible` `:240`). `:230` |
| `PATCH /api/events/{id}` | editable | `owner_id` için ayrıca `may_set_owner` ya da `manage_events` (A2; red 403 `owner_change_denied`). `:398` |
| `PUT /api/events/{id}/participants/{user}` | editable | Kişiyi ikizin katılımcısı da yapar, yani ona yetki verir. `:532` |
| `DELETE /api/events/{id}/participants/{user}` | editable | `:554` |
| `PUT /api/events/{id}/teams/{team}` | editable | `:569` |
| `DELETE /api/events/{id}/teams/{team}` | editable | `:581` |
| `POST /api/events/{id}/checkpoints` | `manage_events` | `:600` |
| `POST /api/events/{id}/widgets` | `record` türünde editable, diğerlerinde `manage_event_widgets` | Bağlanan kayıt için yetki aranmaz; yalnız var olması gerekir. `:790` |
| `POST /api/events/{id}/materials` | `manage_purchases` | `:845` |
| `GET /api/events/{id}/otf` | gizli değilse | A4. `otf.rs:235` |
| `PUT /api/events/{id}/otf` | editable | `otf.rs:305` |
| `POST /api/events/{id}/otf/autofill` | editable | `otf.rs:266` |
| `GET /api/events/{id}/otf.docx` | gizli değilse | A4. Gözden geçirilmemiş form 409 döner. `otf.rs:384` |
| `PATCH /api/event-checkpoints/{id}` | editable | `done` için ayrıca approver, `date` için ayrıca `manage_events` (K4). `:643` |
| `DELETE /api/event-checkpoints/{id}` | approver | `editable` ayrıca aranmaz (K3). `:671` |
| `POST /api/event-checkpoints/{id}/requests` | editable | `:707` |
| `POST /api/checkpoint-requests/{id}` | approver | K3. `:741` |
| `DELETE /api/event-widgets/{id}` | `record` türünde editable, diğerlerinde `manage_event_widgets` | `:822` |
| `PATCH /api/materials/{id}` | `manage_purchases` | `:883` |
| `DELETE /api/materials/{id}` | `manage_purchases` | `:916` |
| `POST /api/materials/{id}/providers` | `manage_purchases` | `:935` |
| `DELETE /api/material-providers/{id}` | `manage_purchases` | `:958` |
| `PATCH /api/material-providers/{id}` | `manage_purchases` | Teklif düzenleme. |
| `PATCH /api/materials/{id}/purchased` | `review_purchases` | Maliye; kalem etkinliğe bağlı olmak zorunda değil. |

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
| `GET /api/notifications` | self | A3 (K1 ile kapandı). `:82` |
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
| `POST /api/attachments` | oturum | Ek bir yere bağlanmadan oluşur. `:157` |
| `GET /api/attachments/{id}` | gizli değilse | Ek gizli bir kaydın sohbetinde ya da kartındaysa yalnız üye (A5). Bağsız, takım duvarı, profil fotoğrafı ve takım kapağı ekleri herkese. `:268` |
| `GET /api/attachments/{id}/thumb` | gizli değilse | A5, aynı kural. `:272` |
| `DELETE /api/attachments/{id}` | yükleyen ya da admin | `:280` |
| `POST /api/attachments/{id}/tags` | `can_tag` (admin ya da `tag_media` + katılım) | Yeni etiket adı için ayrıca `create_tags`. `:311` |
| `DELETE /api/attachments/{id}/tags/{tag}` | `can_tag` | `:341` |
| `GET /api/tags` | oturum | `:298` |

### Yönetim (`admin.rs`)

| Uç | Gerçek kontrol | Not |
|---|---|---|
| `GET /api/admin` | `manage_users` ya da admin | `:173` |
| `GET /api/admin/activity` | `manage_users` ya da admin | `:535` |
| `POST /api/admin/users` | `manage_users` ya da admin | `:188` |
| `PATCH /api/admin/users/{id}` | `manage_users` ya da admin; admin olmayanda `within_grant` (`:361`) | op=`admin` yalnız admin. Hedef admin'se op=`active` da yalnız admin. Son admin korunur. A1: kendi satırı 403 `self_permissions`; kendinde olmayan scope, rol ya da dal 403 `grant_not_held`; `manage_users` (rol içinde de) 403 `grant_manage_users`. Geri almak da aynı sınırda. `:230` |
| `POST /api/admin/roles` | admin | `:464` |
| `PATCH /api/admin/roles/{id}` | admin | `:477` |
| `DELETE /api/admin/roles/{id}` | admin | `:492` |

## 5. Veri kapsamı ve erişim

Aşağıdaki okumalar isteği reddetmez (403 dönmez). Bunun yerine **satırları ya da
alanları süzer**. Okuma modeli "giriş yapan herkes görür"
(`70` §3 kural 4) ve buna tek bir istisna var: gizli kaydın içi (sohbeti,
kartları, ekleri, ikiz etkinliği). Bu yüzden bunlar yetki açığı sayılmadı ve tek
tek işaretlenmedi:

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
- `GET /api/events`: gizli ikizi olan etkinlik de listede görünür (kayıt
  listesi gibi); ayrıntısı A4 ile kapalı.

## 6. Kararlar (önceden "karar bekleyen")

Bu bölüme Jev'in ya da Haiku'nun kodu yanlış bulduğu **ve** kodu okuduktan
sonra en azından tartışmalı kalan noktalar girdi. Hepsi 2026-10-03'te kullanıcı
kararıyla kapandı.

**K1 — Eylem sahibi kendi eylemini kapatamıyordu.** `PATCH /api/actions/{id}`
kaydın `can_edit` kontrolünü istiyor. Eylemin `owner_id`'si `can_edit_record`'un
beş yolundan biri değil, bu yüzden kayda katılımcı olarak eklenmemiş bir kişiye
atanan eylemi o kişi "tamamlandı" yapamıyordu.
Jev: `owner_or_editor` (0.94). Haiku: `owner_or_admin`.
**Karar (2026-10-03):** Eyleme sorumlu atamak (açılışta `owner_id` ya da sonradan
`PATCH` ile) kişiyi kayda katılımcı yapar; katılımcı eklemeyle aynı satır
(`record_participants`), tekrar atamada bir şey değişmez. Ayrı bir "eylem
sahibi" yetki yolu açılmadı. Uygulama: `add_action_owner` (`records.rs:244`),
`add_action` ve `patch_action`. Var olan satırlar `012_action_owner_participants.sql`
ile eşitlendi. A3'ü de kapatır.

**K2 — Etkinliği herkes açabiliyor.** `POST /api/events` yalnız oturum istiyor.
Açan kişi sorumlu olur, bu yüzden kendi etkinliğinin onaylayıcısıdır.
Haiku: `manage_events` olmalı. Jev: `anyone_logged_in`, ama düşük güvenle (0.34).
**Karar (2026-10-03):** Açık kalır; kayıt açma kararıyla tutarlı (2026-09-23).
Asıl risk olan "onay akışını baypas etme" A2 ile kapandı. Kod değişmedi.

**K3 — Etkinlik sorumlusu onaylayıcı mı?** Checkpoint silme ve istek yanıtlama
onaylayıcıya (sorumlu ya da `manage_events`) açık. Checkpoint eklemek ise yalnız
`manage_events`'e açık.
Jev: ikisi de `manage_events` olmalı (silme 0.74, yanıtlama 0.61). Haiku: silme
için `manage_events`, yanıtlama için onaylayıcı yeter.
**Karar (2026-10-03):** `73` §6 olduğu gibi kalır: silme isteği de onaylayıcıya
gidiyor, akış tutarlı. Kuralın koruması A2'yle geldi (düzenleyen kendini sorumlu
yapamaz). Kod değişmedi.

**K4 — Checkpoint tarihini hangi scope değiştirir?** Bugün `manage_events`.
`edit_deadline` "son tarih" yeteneği ama yalnız kayıt ve eylem için tanımlı. Jev
checkpoint tarihi için `edit_deadline` görüyor (0.66). Haiku koddaki gibi
`manage_events` diyor.
**Karar (2026-10-03):** `manage_events` kalır; checkpoint tarihi şablon yapısının
bir parçası. `edit_deadline` etiketine "(etkinlik adımları hariç)" notu eklendi
(`frontend/src/lib/labels.ts` `SCOPE`).

**K5 — Kart katılımı ve oylama.** `signup` ve `vote` yalnız "kayıt kısıtlı değil"
şartını arıyordu. Bu, `request` kipindeki bir kayıtta onayı olmayan kişinin de oy
verebilmesi demekti.
Jev: kayıt düzenleyen olmalı (0.71 / 0.70). Haiku: üye ya da açık kayıt.
**Karar (2026-10-03):** `public` kayıtta bugünkü gibi (oturumu olan herkes kendi
adına). `request` kipinde yalnız onaylı üye ve düzenleyen (`can_edit`).
`private` değişmedi. `is_restricted` genişletilmedi, çünkü `request` kayıtta okuma
açık kalmalı; ayrı bir kontrol eklendi: `may_respond` (`records.rs:858`), `cards.rs:431`,
`:484`. Red 403 `forbidden`.

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

## 7. Kapanan açıklar

Bu açıklar kodu okurken bulundu; Jev ya da Haiku'nun ne dediğinden bağımsız.
Hepsi 2026-10-03'te karara bağlandı ve kapandı. Red kodlarının Türkçe metni
`frontend/src/api/errors.ts`'te; her 403 `audit::forbidden` ara katmanından
`security_events`'e `permission_denied` olarak yazılır.

**A1 — `manage_users` kendine her yetkiyi verebiliyordu (orta).**
`PATCH /api/admin/users/{id}`'de `GrantScope`, `GrantRole` ve `GrantNode` hedefin
`me.id` olup olmadığına ya da verilen scope'a hiçbir sınır koymuyordu. `71` §5
madde 3, rol tanımlamayı "ayrıcalık yükseltme" diye yalnız admin'e bırakmıştı. Ama
doğrudan scope vermek aynı sonuca çıkıyordu.
**Karar (2026-10-03):** Admin olmayan `manage_users` sahibi:
- yalnız kendinde olanı verir: scope etkin scope'larında; rol, yalnız bütün
  scope'ları etkin scope'larındaysa; dal, yalnız kendi dallarından birine eşit
  ya da onun altındaysa (403 `grant_not_held`);
- `manage_users`'ı ne doğrudan ne bir rolün içinde verir (403 `grant_manage_users`);
- kendi satırına hiç dokunmaz: grant, revoke, rol, kapatma, avatar (403
  `self_permissions`);
- geri almada da aynı sınır: veremeyeceğini alamaz.
Admin sınırsız. Uygulama: `within_grant` (`admin.rs:361`), `patch_user`'ın başında.

**A2 — Herhangi bir düzenleyen kendini sorumlu yapabiliyordu (orta).**
`PATCH /api/records/{id}` ve `PATCH /api/events/{id}` `owner_id` alanı yalnız
`can_edit` / `editable` kontrolünü istiyordu. Sorumlu olan kişi decider olur;
etkinlikte de onaylayıcı. Böylece `public` bir kayda katılan herkes iki adımda
kaydı `private` yapabiliyordu; etkinlikte de checkpoint onay akışı (`73` §6)
anlamını yitiriyordu.
**Karar (2026-10-03):** Sorumluyu mevcut sorumlu, admin ya da kaydın biriminde
dal editörü (`edit_nodes` + dal, `NodeAccess`) değiştirir; etkinlikte ayrıca
`manage_events`. İstisna: sorumlusuz kaydı ya da etkinliği düzenleyebilen herkes
kendine alabilir (`70` §3 kural 3); başkasına veremez. Diğerleri 403
`owner_change_denied`. Uygulama: `may_set_owner` (`records.rs:231`),
`records.rs:434`, `events.rs:439`. Kaydı açan kişi decider olmaya devam eder
(erişim kipi), ama sorumluyu değiştiremez.

**A3 — Bildirimler gizli kaydın sohbetini sızdırıyordu (düşük).**
`GET /api/notifications` kaydın sohbet satırlarını "benim kayıtlarım" kümesiyle
süzüyor (`notify.rs:88-95`); bu küme eylem sahibini de içeriyor. Eylem sahibi
`can_edit_record` yollarından biri olmadığı için kısıtlı görünümdeki eylem sahibi
bildirimlerde mesaj gövdesini okuyabiliyordu.
**Karar (2026-10-03):** K1 ile kapandı: eylem sahibi artık katılımcı, yani
`can_edit` ve sohbet ona zaten açık. `notify.rs` süzgeci değişmedi. Kalan küçük
durum: eylem sahibi elle katılımcılıktan çıkarılırsa `mine` kümesinde kalır;
bu, kişiyi bilerek çıkaran düzenleyenin işi sayıldı.

**A4 — Etkinlik ayrıntısı ikizin gizliliğine bakmıyordu (düşük).**
`GET /api/events/{id}`, `/otf` ve `/otf.docx` ikiz kayıt `private` yapılsa da her
şeyi döndürüyordu; aynı ikizin sohbeti ise 403 veriyordu.
**Karar (2026-10-03):** Üçü de ikizin kısıtına uyar: ikiz `private` ve kişi üye
değilse 403, sohbetle aynı. İkizin `access_mode`'u değiştirilebilir kalır.
Uygulama: `require_visible` (`events.rs:240`), `events.rs:234`, `otf.rs:239`, `:388`.

**A5 — Eki kimliğini bilen herkes indirebiliyordu (düşük).**
`GET /api/attachments/{id}` ve `/thumb` yalnız oturum istiyordu. Gizli bir kaydın
sohbetindeki ya da kartındaki ek de bu yoldan çekilebiliyordu.
**Karar (2026-10-03):** Ek `place()` (`attachments.rs:124`) ile bir kayda bağlı
çıkarsa o kaydın `is_restricted` kontrolü uygulanır (403). Bağsız ek, takım
duvarı eki, profil fotoğrafı ve takım kapağı herkese açık kalır; profil
fotoğrafı ya da kapak olarak kullanılan ek gizli bir sohbette de dursa açıktır.
Uygulama: `serve` (`attachments.rs:235`). Yanıt `Cache-Control: private,
immutable`; tarayıcıda önbelleğe girmiş bir ek erişim kalkınca da görünebilir.

## 8. Bakım

- Yeni bir uç eklendiğinde §4'e satır, yeni bir scope eklendiğinde §3'e satır
  eklenir. Scope adı ve etiketi `labels.ts` `SCOPE`'ta durur.
- Sözleşme testi `backend/tools/check_api.sh`. Bu belgedeki kararların testleri:
  `admin_grant_limits` ve `admin_roles` (A1), `record_owner_change` ve
  `event_owner_change` (A2), `action_owner_participant` (K1, A3),
  `card_request_mode` (K5), `private_event_and_attachments` (A4, A5). Yeni bir
  yetki kararı verildiğinde reddedilen ve izin verilen yolun birer örneği eklenir.
- Jev karşılaştırması `backend/tools/scope_audit.py` ile yeniden üretilir. Çıktı
  görüştür, bu belgenin yerine geçmez.
