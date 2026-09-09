# 71 — Yönetim Paneli (`admin`)

Kaynak sistemde bu ekranın karşılığı yok — bu bölüm görüntüden değil, TODO.md
madde 3 ve 2026-09-09 tasarım oturumundan çıkıyor. `spec/README.md`'nin 6.
maddesi ("kaynaktaki kötü yanları da yaz") burada boş kalıyor, çünkü kaynak yok.

## 1. İş

Bugün kullanıcı eklemenin tek yolu sunucuda kabuk açıp
`tools/kullanici.py ekle` çalıştırmak (`tools/kullanici.py:1`). Bu ekran o
eşiği kaldırıyor: kulübe birini almak, birini kapatmak, yetki vermek artık
sunucuya girmeden yapılabilir. Kullanan: admin yetkisi olan 1-3 kişi, haftada
birkaç kez (yeni üye dönemlerinde daha sık).

Dar kapsam (TODO.md madde 3, "önce sadece üye/admin ekleme"): **kullanıcılar +
scope/role yönetimi**. Takım üyeliği `ekipler` ekranına ait (`MODULES` kaydı
zaten öyle diyor — `sites/dashboard/routes.py:40`). `change_requests` kuyruğu
(onayla/reddet) ve kapsam düğüm ataması `kazanim-agaci` ekranına ait — TODO.md
"Sonraya bırakılanlar" bölümünde bu ikisinin çakıştığı, sınır kararı verilmeden
ikisinin birden yazılmayacağı not düşülmüş.

## 2. Akış

- Girişten sonra ana sayfa → `Yönetim Paneli` kartı → `/admin`. Kart bugün
  `ready: False`, tıklayınca `module.html` "Yakında" iskelet sayfasını açıyor
  (`sites/dashboard/routes.py:472`).
- `/admin` yalnızca `manage_users` scope'una sahip kullanıcıya (veya admin'e)
  açık; yoksa 403 — panelin kendisi bir gizleme değil, her yazan uç ayrıca
  kontrol eder (bkz. §4).
- Ekrandan çıkış yok; `rail.html` üzerinden diğer modüllere geçilir
  (`fragments/rail.html`, `aktif="admin"`).
- Bir üst adım yok: bu, sunucuya girmenin yerini alan ekran.

## 3. Ekrandaki bölgeler

| `data-fragment` | Ne gösterir | Nereden besleniyor | Boşken |
|---|---|---|---|
| `user_table` | e-posta, ad, yetki (admin/scope özeti), durum, son görülme | `users` + `effective_scopes()` özetlenmiş | "Liste boş. Aşağıdan ilk kullanıcıyı ekle." (`tools/kullanici.py`'nin bugünkü mesajıyla aynı ton) |
| `user_add_form` | e-posta + ad + (opsiyonel) rol seçimi | POST, aynı iş mantığı `shared/users.py`'de | — (form hep açık) |
| `user_row_actions` | aç/kapat, admin çevir, rol/scope düzenle | satır içi, htmx PATCH | — |
| `role_table` | rol adı, içerdiği scope'lar, üye sayısı | `roles` + `role_scopes` + `user_roles` sayımı | "Henüz rol yok. Kullanıcılara scope'ları tek tek ver, ya da bir rol tanımla." |
| `role_editor` | rol adı + `SCOPES` sözlüğünden çoklu seçim | POST/PATCH/DELETE `/role/{id}` | — |
| `user_scope_panel` | seçili kullanıcının tek tek scope'ları + (yalnız `edit_nodes` için) izinli düğümler | `user_scopes` + `user_roles ⋈ role_scopes` birleşimi (bkz. §5) | "Hiç scope yok." |

Skin kuralı geçerli: her fragment nerede gösterildiğini bilmez
(`spec/10-kararlar.md` 'skin kuralı').

## 4. Eylemler

| Eylem | Kim yapabilir | Sunucuda ne değişir | Ekranda ne tazelenir |
|---|---|---|---|
| Kullanıcı ekle | `manage_users` scope'u ya da admin | `users` satırı; `tools/kullanici.py ekle` ile **aynı** fonksiyon (`shared/users.py`, aşağı bkz.) | `user_table` |
| Aç/kapat | `manage_users` scope'u ya da admin | `is_active` çevirir + `guvenlik_olaylari` satırı (`tur='pasiflestirme'`) — bugünkünün aynısı, sadece uçtan tetiklenir | `user_table` satırı |
| `is_admin` ver/al | **yalnız admin** — kendine ait bayrağı kapatamaz, son aktif admin kapatılamaz (kilitlenme koruması, §"Kilitlenme") | `users.is_admin` | `user_table` satırı |
| Scope ver/al (tek tek) | `manage_users` scope'u ya da admin | `user_scopes` insert/delete | `user_scope_panel` |
| Rol oluştur/sil | **yalnız admin** — rol oluşturma yetkiyi çoğaltabildiği için (bkz. §"Yetki modeli" ayrıcalık yükseltme) | `roles` (+ cascade `role_scopes`, `user_roles`) | `role_table` |
| Rolü kullanıcıya ver/al | `manage_users` scope'u ya da admin | `user_roles` insert/delete — **flatten yok**, `effective_scopes()` okuma anında birleştirir (§5) | `user_scope_panel` |
| Role scope ekle/çıkar | yalnız admin | `role_scopes` — mevcut sahiplerine **otomatik yansır**, çünkü union okuma anında hesaplanıyor; ayrı bir "yansıt" adımı yok | `role_table` + o rolü tutan herkesin `user_scope_panel`'i (aynı isteğin sonucu) |

Tüm yazan uçlar `is_admin`/scope kontrolünü **sunucuda, ucun ilk satırında**
yapar (KNOW-99'daki kural burada da geçerli) — panel sadece görünen yüz.

## 5. Veri ihtiyacı

Şema kısmen kurulu (`user_scopes`, `user_node_scopes`, göç 007
— `shared/gocler/007_kapsamlar.sql`), roller yok. Yeni göç gerekiyor:

```sql
-- scope kataloğu: kod-taraflı liste (shared/scopes.py SCOPES), DML ile
-- veritabanına yazılır. Çalışma anında değişmez — yeni scope = kod değişikliği.
create table if not exists scopes (
  name       text primary key,
  created_at timestamptz not null default now()
);

create table if not exists roles (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now(),
  created_by uuid references users(id) on delete set null
);

create table if not exists role_scopes (
  role_id uuid not null references roles(id) on delete cascade,
  scope   text not null references scopes(name) on delete restrict,
  primary key (role_id, scope)
);

-- SADECE UYELIK. Yetki kontrolu bu tabloyu hic okumaz tek basina — her zaman
-- role_scopes ile join edilir (effective_scopes()). "Rolun tum scope'larina
-- sahip olmak" ile "rolu tutmak" ayri gerceklerdir.
create table if not exists user_roles (
  user_id    uuid not null references users(id) on delete cascade,
  role_id    uuid not null references roles(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references users(id) on delete set null,
  primary key (user_id, role_id)
);

alter table user_scopes
  add constraint user_scopes_scope_fk
  foreign key (scope) references scopes(name) on delete restrict;
```

Ardından DML: `insert into scopes (name) values ('edit_nodes'),
('manage_users'), ('manage_teams');` — `shared/scopes.py`'deki `SCOPES`
sözlüğüyle birebir.

**Yetki modeli — üç karar, oturumda netleşti:**

1. **Rol = scope demeti, sığ.** Flatten yok: `effective_scopes(user)` iki
   kaynağın birleşimi, tek sorguda:

   ```sql
   select scope from user_scopes where user_id = %(uid)s
   union
   select rs.scope from user_roles ur
     join role_scopes rs on rs.role_id = ur.role_id
    where ur.user_id = %(uid)s;
   ```

   Rol düzenlemesi (scope ekle/çıkar) mevcut sahiplerine otomatik yansır —
   ayrı bir "yayınla" adımı yok, çünkü hiçbir yerde materialize edilmiyor.
   Rol silinince tuttuğu scope'lar biter (`role_scopes` cascade), ama aynı
   scope birine **ayrıca tek tek** verilmişse o satır `user_scopes`'ta durur,
   silinmez — iki kaynak birbirinden bağımsız.

2. **Düğüm izni (`user_node_scopes`) kod seviyesinde korunur, FK ile değil.**
   `edit_nodes` role üzerinden de gelebildiği için `user_scopes` tablosunda
   karşılığı olmayabilir — composite FK bu durumda geçerli bir izni reddeder.
   Kontrol `shared/scopes.py`'de iki adımda kalıyor (göç 007'deki
   `dugumde_yetkili` mantığının aynısı, sadece rol union'ı eklenmiş): önce
   `edit_nodes` var mı (rolden ya da doğrudan), sonra hangi dalda.

3. **Rol oluşturma/silme yalnız admin.** `manage_users` scope'u rol
   *atayabilir*, yeni rol *tanımlayamaz* — aksi halde `manage_users`'ı
   olan biri "her şeyi yapabilen" bir rol yaratıp kendine verebilir
   (ayrıcalık yükseltme). Hiyerarşi kurulmuyor; tek çıkış admin'in tek
   tepe olması, `shared/kapsam.py`'nin (`shared/scopes.py` olacak) zaten
   dayandığı kural.

**Kilitlenme koruması** — panelin var oluş amacı sunucuya girmeyi gereksiz
kılmak; kendi kendini kilitleyebilmemeli:

- kullanıcı kendi `is_admin`'ini kapatamaz
- son aktif admin kapatılamaz / demote edilemez
- `tools/kullanici.py` **break-glass olarak kalır** — `users`'ta hiç satırı
  olmayan ilk kurulumda tek yol o (`tests/test_kullanici.py:3` bunu zaten
  test ediyor, dokunulmuyor)

**Ortak iş mantığı** — TODO.md açıkça istiyor: form, `tools/kullanici.py
ekle`'yle **aynı** fonksiyonu çağırsın, kopyalanmasın. Bugün mantık
`tools/kullanici.py:52`'de (`ekle()`). Taşıma: `shared/users.py` yeni modül,
`add_user(email, name, *, is_admin=False, scope=None)` — script bunu import
edip çağıran ince bir CLI'a düşer, panel de aynı fonksiyonu POST'tan çağırır.

**Audit** — rol/scope değişiklikleri `guvenlik_olaylari`'na düşer (bugünkü
`tur='pasiflestirme'` deseninin devamı): `tur='scope_verildi'`,
`'scope_alindi'`, `'rol_verildi'`, `'rol_alindi'`, `'rol_silindi'`. Rol
düzenlemesi N kullanıcıya birden dokunduğunda (union okuma-anında olduğu için
DB'de N satır değişmez, ama etkilenen kişi sayısı gerçek) tek satır: rol adı +
scope + etkilenen kullanıcı sayısı — kişi başına satır değil.

**İsimlendirme:** yeni her şey İngilizce (`CLAUDE.md` "Kod dili: İngilizce").
`shared/kapsam.py` → `shared/scopes.py`, `KAPSAMLAR` → `SCOPES`, anahtarlar
`edit_nodes`/`manage_users`/`manage_teams`. Veritabanında bugün Türkçe scope
adı YOK (kurulu veritabanı yok, göç 007 hiç prod'da çalışmadı) — bu yüzden
eski adı yeni ada çeviren ayrı bir göç gerekmiyor, `007_kapsamlar.sql`
doğrudan İngilizce yazılabilir.

## 6. Alınmayacaklar

- **Rol hiyerarşisi / pozisyon sıralaması** (Discord'daki "bu rol şu rolün
  üstünde" kısıtı) — 25 kişilik kulüpte getirisi yok, admin'in tek tepe
  olması yeterli. Gerekirse sonra eklenir, `roles` tablosuna `created_by`
  dışında bir şey eklemeden.
- **Negatif izin** ("bu rolün her şeyi olsun, şunu hariç") — union modeliyle
  ifade edilemiyor; ihtiyaç çıkarsa çözüm rolü kaldırıp gerekeni tek tek
  vermek, ayrı bir `deny` tablosu şimdiden kurulmaz.
- **`change_requests` kuyruğu (onayla/reddet)** — `kazanim-agaci`'na ait,
  TODO.md'nin kendi sınır çizgisi.
- **Takım üyeliği ekranı** — `ekipler`'e ait, oraya bağlantı verilir, burada
  tekrar edilmez.
- **Kapsam adı ekleme UI'dan** — `SCOPES` kod seviyesinde sabit; panel
  yalnızca var olan scope'ları listeler ve atar, yeni scope icat edemez
  (göç 007'nin "yazım hatası sessizce yetki vermesin" kararının devamı).
