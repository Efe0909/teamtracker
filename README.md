# EkipTakip — alpha-0.1 (Faz 1)

Ana sayfa (`/`) ekran seçimidir: Görev Yöneticisi çalışır, diğer modüller (kazanım ağacı,
pivot, takvim, görev tanımları, arşiv, dosyalar/NAS, yönetim paneli) iskele sayfa gösterir.
Faz 1'in çalışan dikey dilimi: hiyerarşi + kayıtlar + kart içi sohbet + alan değişiklikleri.
Yığın: Python 3.12 + FastAPI + Jinja2 + HTMX + SQLite, ham SQL, ORM yok, JS framework yok.

## Çalıştır

Tek komut (sanal ortam + bağımlılıklar + tohum + sunucu):

```bash
make up          # http://127.0.0.1:8000
```

Sonraki günler `make dev` yeter. `make` yazınca komut listesi çıkar:

| Komut | Ne yapar |
|---|---|
| `make up` | sıfırdan kaldırır: kurulum + tohum (veritabanı yoksa) + sunucu |
| `make dev` | sunucu, `--reload` açık (`make dev PORT=9000` ile port değişir) |
| `make run` | sunucu, `--reload` kapalı |
| `make seed` | veritabanını tohumlar — **varolan `ekiptakip.db` silinir** |
| `make reseed` | veritabanını sıfırlar ve yeniden tohumlar |
| `make test` | `pytest tests -q` |
| `make check` | sunucu ayaktayken uçların durum kodlarını basar |
| `make clean` / `make distclean` | veritabanı+önbellek / üstüne sanal ortam |

Elle kurmak istersen:

```bash
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python fastapi "uvicorn[standard]" jinja2 python-multipart pytest httpx
.venv/bin/python seed.py                  # ekiptakip.db'yi siler ve yeniden tohumlar
.venv/bin/uvicorn app:app --workers 1 --reload
```

`--workers 1` şart: ağaç indeksi süreç belleğinde (00-BASLA.md Karar 2).
Makefile `--host 127.0.0.1` kullanır — alpha-0.1 kimlik doğrulaması olmadan dışarı açılmamalı
(aşağıdaki bilgi güvenliği bölümü).

## Test

```bash
make test        # ya da: .venv/bin/python -m pytest tests -q
```

`tests/test_tree.py` TreeIndex birim testleri, `tests/test_api.py` altı kabul kriterinin
uç karşılığı (403 dahil).

## Dosyalar

| Dosya | Ne |
|---|---|
| `Makefile` | yerel kaldırma: `make up`, `make dev`, `make test` |
| `app.py` | uçlar, gruplama/sıralama, sistem olayı yazımı |
| `db.py` | ham SQL yardımcıları, `new_id()`, `now()`, `as_bool()` |
| `tree.py` | `TreeIndex` — Euler tour, `is_descendant` O(1) |
| `auth.py` | `current_user` (Faz 2'de OAuth), `can_edit_item` |
| `schema.sql` | Faz 1 tabloları (users, nodes, items, item_participants, events) |
| `seed.py` | `layout-a.html`'deki ağaç, kartlar ve akış |
| `templates/home.html` | ana sayfa — modül seçimi |
| `templates/module.html` | henüz yazılmamış modüller için iskele sayfa |
| `templates/base.html` | görev yöneticisi yerleşimi (tek yerleşim dosyası) |
| `templates/fragments/*` | layout'tan bağımsız parçalar (skin kuralı) |
| `static/app.css` | `layout-a.html`'den alınan token'lı CSS |
| `static/home.css` | ana sayfa + iskele sayfa, aynı token'lar |

## Sahte kullanıcılar (Faz 1)

| Kişi | Yetki | Kapsam |
|---|---|---|
| Efe (varsayılan) | editor | Malzeme Temini |
| Selin | admin | tüm ağaç |
| Deniz | — | Üretim Hattı A |

Rayın altındaki avatardan değiştirilir (`POST /switch/{user_id}`, çerez `uid`).

## Uçlar

`GET /` (ana sayfa) · `GET /gorevler` (görev yöneticisi) · `GET /panel/inbox` ·
`GET /panel/tree` · `GET /node/{id}/items` · `GET /item/{id}` · `POST /item/{id}/message` ·
`PATCH /item/{id}/field` · `POST /item` · `GET /whoami` · `POST /switch/{user_id}` ·
`GET /{slug}` (iskele modül sayfası — `app.MODULES` listesinden, en sonda tanımlı)

Tam sayfa / parça ayrımı `HX-Request` başlığıyla.

Modül listesi `app.py` içinde tek yerde (`MODULES`): ana sayfa kartları da iskele sayfalar da
aynı listeden okur. Bir modül yazıldığında `ready` bayrağı `True` olur ve gerçek rotası eklenir.

## Faz 1'de yok

Giriş/OAuth, push, pivot, panel, talep akışı (`change_requests`), IWS terfisi, dosya ekleme.
Ana sayfadaki bu modüller iskele sayfaya gider — ölü bağlantı yok, ne geleceği yazılı.

## Bilgi güvenliği

Bu depo **public**. alpha-0.1 bir Faz 1 prototipidir; aşağıdaki durum bilerek böyledir,
ağa açılmadan önce kapatılması gereken yerler işaretlidir.

### Depoda ne var, ne yok

- Depoda sır **yok**: parola, API anahtarı, token, VAPID anahtarı tutulmuyor.
- `.gitignore` üç şeyi dışarıda tutar: `.venv/`, `*.db` (veritabanı), `.env`.
  Bunları asla commit etme — `ekiptakip.db` içinde gerçek kart içeriği ve kullanıcı
  e-postaları birikir.
- `seed.py` ve `02-push-handoff.md` içinde bakımcının e-posta adresi geçiyor; tohum
  verisindeki diğer kişiler ve içerik uydurmadır. Depo public olduğu için tohum verisine
  **gerçek müşteri/ekip verisi koyma**.
- Web push denendiğinde VAPID anahtarları `.env`'de kalır, koda gömülmez
  (`02-push-handoff.md`).

### Faz 1'de bilerek eksik olanlar

| Konu | Durum | Ne zaman kapanır |
|---|---|---|
| Kimlik doğrulama | **Yok.** `uid` çerezi imzasız — çerezi elle yazan herkes istediği kullanıcı olur | Faz 2 (Google OAuth + imzalı oturum çerezi) |
| CSRF koruması | Yok. POST/PATCH uçlarında token kontrolü yapılmıyor | Faz 2, kimlikle birlikte |
| TLS | Yok. `uvicorn` düz HTTP | Dağıtımda önüne Caddy/nginx |
| Hız sınırlama | Yok | İhtiyaç doğunca |
| Denetim izi | Kısmi: alan değişiklikleri `events`'e `sistem` olayı olarak yazılır; okuma erişimi loglanmaz | — |

**Bu yüzden alpha-0.1 yalnızca `127.0.0.1`'e bağlanmalı.** `--host 0.0.0.0` ile açma;
tünel (`cloudflared`) ile dışarı verirsen kimlik doğrulaması olmadan herkes her kartı
düzenler.

### Faz 1'de bilerek doğru yapılanlar

- **Yetki sunucuda uygulanır.** `can_edit_item` her POST/PATCH ucunda çalışır; şablon
  sadece görsel olarak kilitler. `curl` ile kapsam dışı PATCH denemesi **403** döner
  (`tests/test_api.py::test_out_of_scope_is_403_not_just_hidden`).
- **Yetki kapsamı sızmaz.** Karta dahil edilen kişi (`item_participants`) yalnızca o kartta
  yetkilidir, diğer kartlarda hâlâ salt okunur.
- **SQL enjeksiyonu yok.** Tüm değerler parametreyle geçer. SQL'e giren tek metin
  interpolasyonu `PATCH /item/{id}/field` içindeki sütun adıdır ve `EDITABLE` beyaz
  listesinden gelir; alan değerleri ayrıca `STATUSES`/`PRIORITIES`/kullanıcı tablosuna
  karşı doğrulanır.
- **XSS'e karşı kaçış açık.** Jinja `select_autoescape` ile çalışır; mesaj ve başlık
  gövdeleri `{{ }}` ile basılır, hiçbir yerde `|safe` kullanılmaz. Kullanıcı girdisi HTML
  olarak yorumlanmaz.
- **Dosya yükleme yok**, dolayısıyla yükleme kaynaklı saldırı yüzeyi de yok.

### Açık bildirmeden önce

1. Faz 2 kimliğini bağla (OAuth + imzalı çerez), `current_user` dışında hiçbir yeri
   değiştirmen gerekmez.
2. CSRF token'ı ekle.
3. TLS sonlandıran bir ters vekil koy.
4. `ekiptakip.db` için yedek ve erişim kısıtı tanımla — tek dosya, kopyalayan her şeyi alır.

### Güvenlik açığı bildirimi

Bir açık bulursan issue açma; doğrudan bakımcıya yaz (`Efe0909` GitHub profili).
