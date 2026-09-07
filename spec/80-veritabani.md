# 80 — SQLite'tan PostgreSQL'e

Karar: **PostgreSQL 16**. Tek ortak veritabanı (iki siteye ayırma yok —
`spec/50-yapi.md`'deki o tartışma kapandı: mobil, aynı verinin kişisel görünümü).

Bu geçiş `spec/10-kararlar.md`'de yazılı taşınabilirlik kurallarının borcunu ödüyor:
TEXT id, ISO-8601 metin zaman, `INTEGER 0/1` boolean, ham SQL, ORM yok — hepsi bugün
için değil bu gün için yazılmıştı.

## 1. Neden

| İhtiyaç | SQLite'ta | Postgres'te |
|---|---|---|
| Çok ilişki, FK garantisi | `pragma foreign_keys` açılmazsa **sessizce kapalı** | FK birinci sınıf, `deferrable`, `on delete` davranışları |
| İzinler | yalnızca uygulama katmanında | ileride **Row-Level Security**: uygulama unutsa da satır gelmez |
| Dosya meta verisi | tablo var ama kısıt zayıf | kısmi indeks, `exclude` kısıtı, `jsonb` |
| Yapılandırılmış alanlar | JSON'u TEXT'e gömüyorduk | **`jsonb`** (`change_requests.payload`/`prev_state` — `spec/20-sema.md`) |
| Doğrudan bağlanmak | uygulama yazarken kilide çarpar | `psql`, TablePlus, DBeaver; eşzamanlı okuma/yazma |
| Yedek | dosya kopyası | `pg_dump`, PITR |

**Dosyanın kendisi veritabanına konmaz.** NAS/diskte durur; tabloda sahibi, bağlı kayıt,
sürüm, sağlama, boyut durur. `bytea`/large object yedeklemeyi ve belleği şişirir.

## 2. Tip eşlemesi

| Bugün (SQLite) | Yarın (Postgres) | Not |
|---|---|---|
| `id text` (uuid4().hex) | `uuid` | `gen_random_uuid()` (pgcrypto) sunucuda; `db.new_id()` kalır ama tip değişir |
| zaman `text` ISO-8601 | `timestamptz` | 8 yerde `strptime/strftime` var, ikisi de sadeleşir |
| `integer 0/1` | `boolean` | `db.as_bool()` neredeyse boşalır |
| JSON → `text` | `jsonb` | yeni tablolar için |
| `?` yer tutucu | `%s` | 35 çağrı, 7 dosya — **açıkça çevrilecek**, gizli çeviri katmanı yok |

## 3. Arama — ölçüldü, karar kanıta dayanıyor

Bugün FTS5 `unicode61 remove_diacritics 2`: aksansız yazınca aksanlıyı bulur, önek eşleşir,
**kök bulma yok**.

Postgres'te iki aday denendi (16.13):

| | `turkish` (snowball) | `simple + unaccent` |
|---|---|---|
| `gündür` nasıl saklanır | **`g`** | `gundur` |
| "gun" araması `gündür`'ü bulur mu | **hayır** | evet |
| `bakım/bakımı/bakımın` | `bak` (birleşir) | ayrı ayrı, önekle yakalanır |

Türkçe snowball stemmer'ı aşırı köke iniyor ve **eşleşmeyi bozuyor** — sorgu `gun` olarak
kalırken belge `g` oluyor. Karar: **`simple` + `unaccent`**, `:*` önek eşleşmesiyle.
Bugünkü davranışın birebir karşılığı.

```sql
create extension unaccent;
create text search configuration tr (copy = simple);
alter text search configuration tr
  alter mapping for hword, hword_part, word with unaccent, simple;

alter table items add column arama tsvector
  generated always as (to_tsvector('tr', coalesce(title,'') || ' ' || coalesce(description,'')))
  stored;
create index items_arama_idx on items using gin (arama);
```

**Trigger gerekmez** — generated column kendini günceller. Bugünkü üç FTS5 trigger'ı düşer.

## 4. Göç yönetimi

Elle yazılmış `db.gocler()` yerine **numaralı SQL dosyaları** + `schema_migrations` tablosu:

```
shared/gocler/001_ilk_sema.sql
shared/gocler/002_kimlik.sql
```

Açılışta uygulanmamışlar sırayla koşar, her biri kendi işleminde. ~40 satır, ORM yok
kuralına uyar. Alembic gereksiz: şema küçük, ORM yok, kimse otomatik üretime muhtaç değil.

## 5. Testler

Karar: **Docker'da tek Postgres.** `docker compose up -d` ile ayağa kalkar; her test modülü
kendi veritabanını açar (`ekiptakip_test_<modul>`), `seed.run()` oraya koşar, sonunda düşer.
Testleri SQLite'ta bırakmak reddedildi: geçişin asıl riski lehçe farkı ve o farkı tam da
testlerin görmediği yerde bırakmak olurdu.

`make test` Docker yoksa anlaşılır bir hata verir (sessizce SQLite'a düşmez).

## 6. Dağıtım

- Pi/Mac üzerinde Postgres servisi; uygulama **unix soketi** ya da `127.0.0.1` üzerinden.
- **En az yetkili DB kullanıcısı**: uygulama `ekiptakip` rolüyle bağlanır, superuser değil;
  şema sahibi ayrı rol. Uzantı kurulumu (unaccent, pgcrypto) göç değil kurulum işi.
- Bağlantı bilgisi `.env`'de `DATABASE_URL`; parola log'a ve hata sayfasına sızmaz
  (`spec/70-guvenlik.md` §7 aynen geçerli).
- Yedek: `pg_dump -Fc` günlük cron; dosya kopyalama yedeği düşer.

## 7. Bu geçişin YAPMADIĞI şey

**`--workers 1` kısıtı kalkmaz.** O kısıt SQLite'tan değil, bellekteki `TreeIndex`'ten
geliyor (`spec/10-kararlar.md`). Postgres bunu çözmenin yolunu veriyor — ağaç değişince
`LISTEN/NOTIFY` ile diğer worker'lara "indeksini yenile" denir — ama o **ayrı bir iş**,
bu geçişin kapsamında değil.

## 8. Sıra

1. `docker-compose.yml` + `shared/db.py` psycopg'ye geçer + göç koşucusu
2. Şema Postgres'e çevrilir (tipler, `jsonb`, arama sütunu), `seed.py` uyarlanır
3. 35 SQL çağrısı `%s`'e çevrilir; zaman/boolean kullanan yerler sadeleşir
4. Testler Postgres'e bağlanır, hepsi yeşile döner
5. `deploy/` + belgeler; SQLite kalıntıları silinir

Her adım ayrı commit, aralarda temiz context'li denetim.

## 9. Kabul kriterleri

1. `make up` Docker'daki Postgres'e bağlanır, tohumlanır, iki site de açılır.
2. 85 testin tamamı Postgres'e karşı geçer; SQLite'a düşen tek yol kalmaz.
3. Arama: "butce" → "Bütçe onayı…", "unite" → "Kapak Ünitesi…", alakasız kelime bulmaz.
4. Yetki testleri (kapsam dışı 403) aynen geçer — davranış değişmedi.
5. Göç koşucusu iki kez çalıştırıldığında ikinci sefer hiçbir şey yapmaz (idempotent).
6. Uygulama superuser olmayan bir rolle çalışır; o rol `drop table` yapamaz.
7. `pg_dump` ile alınan yedek boş bir veritabanına geri yüklenir ve uygulama açılır.

---

## 10. Durum anlık görüntüleri (test aracı)

Test kurulumunu tekrarlanabilir yapmak için: ekrandaki durumu bir dosyaya al,
deneyi yap, dosyadan geri dön. Kod `shared/durum.py`, komut satırı yüzü
`tools/durum.py`.

```bash
.venv/bin/python tools/durum.py disa-aktar -o yedek   # tohumlar/yedek.sql
.venv/bin/python tools/durum.py sifirla --evet        # BÜTÜN VERİYİ SİL
.venv/bin/python tools/durum.py yukle yedek           # geri yükle
.venv/bin/python tools/durum.py yukle varsayilan      # depodaki shared/seed.py
.venv/bin/python tools/durum.py sayimlar              # tablo başına satır
```

### Neden uç değil, betik

İlk tasarım üç HTTP ucuydu (`/test/disa-aktar`, `/test/sifirla`, `/test/yukle`).
Uç olunca "veriyi tek POST'la silen bir kapı"nın yayına sızmaması için sürekli
bekçilik gerekiyordu: ortam bayrağı + anahtar, giriş kapısı ve CSRF muafiyeti
(sıfırlama kullanıcıları da sildiği için oturuma bağlı bir uç kendini kilitliyor),
üstüne yol kaçışına karşı dizin hapsi. **Betikte bu soruların hepsi düşüyor** —
çalıştıran zaten veritabanına erişen kişi; yeni bir yetki sınırı açılmıyor.
Kaybedilen tek şey "uzaktaki kurulumu HTTP ile sıfırlama"ydı; ihtiyaç değildi.

### Dosya ne taşır

Yalnızca **veri**. Şemanın kaynağı numaralı göçlerdir (§4); dump'tan şema yazmak
ikinci bir doğruluk kaynağı yaratırdı. Yüklenen dosya, göçü yapılmış (ama boş
olabilir) bir veritabanı bekler — betik açılışta `db.gocler()` koşturur.

Tablo sırası sabit listeden değil `information_schema`'daki yabancı
anahtarlardan **topolojik** çıkar. İki döngü var ve ikisi de aynı yolla çözülür —
sütun önce `NULL` yazılır, dosyanın sonunda `UPDATE` ile bağlanır:

| Döngü | Nasıl |
|---|---|
| `users.scope_node_id` ↔ `nodes.created_by` | döngüdeki NULL alabilen bir sütun ertelenir |
| `nodes.parent_id` (öz-referans) | satır sırasına güvenmemek için baştan ertelenir |

Bu, `seed.py`'nin elle yaptığı şeyin genelleştirilmiş hâli: şema büyüdüğünde
`shared/durum.py` düzenlenmez. Üretilmiş sütun (`items.arama`) `INSERT`'e girmez;
değer kaçışları psycopg'nin kendi literal uyarlayıcısından geçer, elle tırnak
kaçışı yazılmaz.

### Dikkat

- **Ağaç indeksi süreç belleğindedir** (`spec/10-kararlar.md`, `--workers 1`).
  Sunucu ayaktayken yükleme/sıfırlama yaptıysan sunucuyu **yeniden başlat**;
  yoksa sayfalar eski düğüm kimlikleriyle boş döner.
- **Dökümler `git`'e girmez** (`.gitignore: tohumlar/*.sql`): gerçek kart içeriği
  ve kullanıcı e-postaları taşırlar — veritabanı dosyasıyla aynı hassasiyet.
  Dizin `EKIPTAKIP_TOHUMLAR` ile depo dışına alınabilir.
- `sifirla` göç defterini (`schema_migrations`) korur: şema durur, veri gider.
