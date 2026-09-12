# EkipTakip — ajanlar için proje notları

## Ortamlar: yerel / VM / Pi

Makine yapılandırması **bu depoda değil** — `~/nix` (github:Efe0909/nix), reproducible
NixOS. `deploy/` yalnız uygulamanın sözleşmesini anlatır (konteyner yığını, medya
dizini, tünel). Elle kurulum yok; macOS ve Debian şablonları kaldırıldı.

| Ortam | Nerede | Ne |
|---|---|---|
| Yerel geliştirme | bu depo | `make up` — Docker'da Postgres + uvicorn, sahte kimlik |
| VM testi | `~/nix` `.#vmtest` | gerçek NixOS: nginx + cloudflared + Google girişi |
| Üretim | `~/nix` `.#evsunucu` | Raspberry Pi, aynı `configuration.nix` |

### Yerel: siteyi ayağa kaldırmak (ajan oturumları)

```bash
make up          # bağımlılıklar + Postgres (Docker) + tohum + sunucu (--reload)
```

- Masaüstü: <http://localhost:8000> · Mobil: <http://app.localhost:8000>
- Ayrım **Host'un ilk etiketine** bakar. Yol öneki YOK, `/m` diye bir şey yok.
- Kimlik **sahte** (`EKIPTAKIP_AUTH=sahte`): giriş ekranı yok, ilk kullanıcı olarak
  açılır; ray'deki avatardan kullanıcı değiştirilir.

Parça parça: `make db-ac` (yalnız Postgres) · `make seed` (**varolan veriyi siler**)
· `make dev` · `make test` · `make db-kapat`. Veritabanını komple silmek:
`docker compose down -v`.

Ajan notları:

- `make test` **gerçek Postgres** ister; Docker kapalıysa testler toplanma
  aşamasında patlar. Testler `ekiptakip_test_<modul>` adlı kendi veritabanlarını
  kurar, ana `ekiptakip`'e dokunmaz — yani `make seed` testleri etkilemez.
- Gerçek Google girişini yerelde kurmaya çalışma; sahte kimlikle bütün yetki
  yolları (admin, scope, rol) sınanabiliyor. Gerçekten gerekiyorsa
  `tests/test_real_identity.py` kalıbı imzalı çerezi taklit ediyor, OAuth'a çıkmıyor.
- Yeni bağımlılık `requirements.txt`'e (tek kaynak — Makefile ve Dockerfile onu okur):
  `uv pip install --python .venv/bin/python -r requirements-dev.txt`.
- Yeni göç `shared/migrations/` altına numaralı dosya; açılışta kendiliğinden koşar.
- `--workers 1` şart: ağaç indeksi (`TreeIndex`) süreç belleğinde.

### Yayına alma

```bash
cd ~/nix
nix flake update teamtracker                      # uygulamayı main'in ucuna pinle
git commit -am "teamtracker: <sha>" && git push
nixos-rebuild switch --flake .#vmtest             # VM
nixos-rebuild switch --flake .#evsunucu --target-host efe@evsunucu --use-remote-sudo
```

Alan adları (zon `polonyum.com`): `app.` mobil kökte, `dashboard.` masaüstü,
bilinmeyen Host `444`. Ayrıntı: `deploy/README.md`.

## Kapı: Access kapalı, uygulama kendi kapısını tutuyor

Uygulamanın kendi kimliği **var**: Google girişi, davetli listesi (`users`'ta
olmayan e-posta giremez), imzalı oturum, CSRF kapısı, giriş hız sınırı
(`spec/70-guvenlik.md`). Bu bölüm eskiden "kimlik yok, Access şart" diyordu —
o dönem kapandı.

Cloudflare Access şu an **açık değil** (2026-09-10'da `curl` ile doğrulandı:
public hostname'e giden istek doğrudan uygulamaya düşüyor, 401 gövdesi
`giriş gerekli`). Access bugün ek katman; kapatmanın bedeli kimliksiz trafiğin
origin'e ulaşması. Gerekçe ve açma adımları: `deploy/README.md`,
`deploy/cloudflare-dashboard.md`.

## Faz durumu

alpha-0.1 = Faz 1 (hiyerarşi, kayıtlar, kart içi sohbet, alan değişiklikleri) + mobil yüz.
Faz 2 (Google OAuth) **geldi**: kimlik gerçek, `shared/identity.py`. Yerelde hâlâ
sahte kimlikle çalışılır (`EKIPTAKIP_AUTH=sahte`), yayında reddedilir.
Sonrası: yönetim paneli (`/admin`) ve medya ekleri de yazıldı; sıradaki iş
`TODO.md`'de (madde 2 → 1).

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
içindeki `001_schema.sql`…`011_node_types.sql` bir daha yeniden adlandırılmamalı —
kurulu bir veritabanında yeniden adlandırılırsa uygulanmamış sayılır ve
**yeniden koşar**. Rename bu geçişte serbestti çünkü henüz canlıya hiç
kurulmamıştı (veritabanı boştu); artık ilk gerçek kurulumdan sonra donarlar.
