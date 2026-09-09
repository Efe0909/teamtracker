# EkipTakip — ajanlar için proje notları

## Şu anki dağıtım: GEÇİCİ, Efe'nin Mac'inde

Kalıcı ev Raspberry Pi. Bugün oraya kurulmadı; alpha-0.1 **geçici olarak macOS'ta**
ayakta. Bunu bilerek yaz/oku — `deploy/` altındaki Linux şablonları bu makinede
çalışmaz.

```
telefon ──https──> Cloudflare ──tünel "temp"──> cloudflared (root, --token)
         ──> nginx :8080 ──> uvicorn 127.0.0.1:8000
```

| Parça | Bu makinede | Şablonun varsaydığı |
|---|---|---|
| nginx | Homebrew, `Efe` kullanıcısı, config `/opt/homebrew/etc/nginx/servers/ekiptakip.conf` → repoya **symlink** | `/etc/nginx/sites-available`, `sudo` |
| Servis yöneticisi | **Yok.** uvicorn elle, arka planda bir kabuktan | systemd (`deploy/ekiptakip.service`) |
| Tünel | **Uzaktan yönetimli** — `~/.cloudflared/` içinde yalnızca `cert.pem`, `config.yml` yok; ingress panelde | yerel `config.yml` (`deploy/cloudflared-ornek.yml`) |
| Kullanılan conf | `deploy/nginx-ekiptakip.macos.conf` + `-ortak.macos.conf` | `deploy/nginx-ekiptakip.conf` |

Alan adları (zon `polonyum.com`, push demosuyla ortak):

- `app.polonyum.com` → mobil, kökte (`/`, `/search`, `/actions`); `/tasks` **404**, kasten
- `dashboard.polonyum.com` → masaüstü
- bilinmeyen Host → `444` (`default_server` bloğu)

Bu üç değişken yayında tanımlıdır. Tanımsızken ayrım Host'un ilk etiketine
bakar: `app.localhost` mobil, `localhost` masaüstü — yol öneki hiçbir
durumda yoktur:

```bash
EKIPTAKIP_HOST_APP=app.polonyum.com \
EKIPTAKIP_HOST_DASHBOARD=dashboard.polonyum.com \
EKIPTAKIP_COOKIE_DOMAIN=.polonyum.com \
  .venv/bin/uvicorn app:app --host 127.0.0.1 --port 8000 --workers 1
```

### Bu geçiciliğin sonuçları

- **Uvicorn kalıcı değil.** Oturum kapanınca/makine uyuyunca gider. launchd plist yok
  (systemd biriminin darwin karşılığı yazılmadı).
- **8080 push demosuyla paylaşılıyor** (`~/projects/push`, `push.polonyum.com` → 5001).
  O bloğa dokunma. `listen 8080` wildcard kalmalı — `listen 127.0.0.1:8080` yazılırsa
  nginx aynı portta ikinci socket'e açılmaz.
- `servers/` alfabetik yükleniyor (`ekiptakip.conf` < `push.polonyum.conf`), bu yüzden
  varsayılan sunucu **açıkça** tanımlı; kaldırma.
- Pi'ye taşınırken: `deploy/kur.sh` + Linux şablonları zaten hazır, `.macos.conf` ikilisi
  orada kullanılmaz.

### Ayakta mı, nasıl bakılır

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: app.polonyum.com'       http://127.0.0.1:8080/
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: dashboard.polonyum.com' http://127.0.0.1:8080/
nginx -t && ps aux | grep [u]vicorn
```

## Kapı — kapatılmadan yayına açma

Uygulamanın kendi kimlik doğrulaması **yok**: `uid` çerezi imzasız, CSRF yok
(README "Bilgi güvenliği"). Dışarı açılan hostname'in önünde Cloudflare Access
politikası olmalı; public hostname ile Access'i peş peşe kur, arada bırakma.
`auth_basic` satırları `-ortak.macos.conf` içinde yorumda duruyor — Access
kullanılmayacaksa onlar açılır.

## Faz durumu

alpha-0.1 = Faz 1 (hiyerarşi, kayıtlar, kart içi sohbet, alan değişiklikleri) + mobil yüz.
Faz 2 (Google OAuth) gelene kadar kimlik sahte; `auth.current_user` tek değişecek yer.

## Kod dili: İngilizce. İstisna yok.

Kaynak koddaki **her tanımlayıcı İngilizce**: değişken, fonksiyon, sınıf, modül
ve dosya adı, tablo ve sütun adı, kapsam/izin anahtarı, sözlük anahtarı, test adı,
**URL yolu ve query parametre adı**. Rota kayıtlarındaki (`@router.get(...)`),
form alanı `name=` özniteliklerindeki ve `hx-get`/`hx-post`/`hx-patch` hedeflerindeki
yol dizgeleri de bu kurala girer — `/gorevler` değil `/tasks`, `?takim=` değil
`?team=`.

Türkçe kalan tek şey **kullanıcının gördüğü metin**: şablonlardaki yazılar, hata
mesajları, etiketler, `SCOPES` sözlüğünün *değerleri*, tohum verisindeki (`shared/seed.py`)
takım/düğüm adları ve açıklamaları. Yorumlar, docstring'ler, `spec/` ve commit
mesajları da Türkçe kalır — onlar kod değil, anlatı.

```python
SCOPES = {
    "edit_nodes": "Yapıyı düzenle — düğüm ekle, adlandır, taşı, sil",
#    ^ anahtar İngilizce      ^ ekranda görünen metin Türkçe
}
```

**Neden:** iki ay sonra `kapsam` / `gocler` / `var_mi` açıldığında ne olduğu
okunmuyor. Terimi çevirme — `scope` scope'tur, `kapsam` değil.

### Depo bu kurala uyuyor (2026-09-09'da tamamlandı)

Kod tabanı baştan sona İngilizceye çevrildi: `shared/kapsam.py` → `shared/scope.py`,
`shared/kimlik.py` → `shared/identity.py`, `shared/sertlestirme.py` → `shared/hardening.py`,
`db.havuz()` → `db.pool()`, `db.gocler()` → `db.migrate()`, `service.dugum_ekle` →
`service.add_node`, Türkçe test adları da dahil tüm rotalar, form alanları, DB
tablo/sütun adları ve durum/öncelik/rol gibi sabit değerler (`acik`→`open`,
`kritik`→`critical`, `lider`→`lead`…) çevrildi. `spec/` belgeleri ve commit
geçmişi hâlâ eski (Türkçe) adları anabilir — kod referans alınmalı.

**Göç dosyası adları artık donuk.** `db.migrate()` uygulanan göçü *dosya
adıyla* `schema_migrations`'a yazıyor (`shared/db.py`); `shared/migrations/`
içindeki `001_schema.sql`…`007_scopes.sql` bir daha yeniden adlandırılmamalı —
kurulu bir veritabanında yeniden adlandırılırsa uygulanmamış sayılır ve
**yeniden koşar**. Rename bu geçişte serbestti çünkü henüz canlıya hiç
kurulmamıştı (veritabanı boştu); artık ilk gerçek kurulumdan sonra donarlar.
