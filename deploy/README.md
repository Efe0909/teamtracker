# deploy/ — yayına alma

Makine yapılandırması bu depoda **değil**: `~/nix` (github:Efe0909/nix), NixOS,
reproducible. Orada nginx, systemd birimi, sırlar (agenix) ve tünel var. Bu depo
yalnız uygulamanın sözleşmesini taşır: `module.nix` (NixOS modülü), `release.nix`
(release pini), `cloudflare-dashboard.md`.

| Ortam | Nerede | Ne çalıştırır |
|---|---|---|
| **Yerel geliştirme** | bu depo | `make dev` — Docker'da Postgres + `cargo run` + `npm run dev`, sahte kimlik |
| **Üretim** | `~/nix` → `.#evsunucu` | Raspberry Pi, aynı yapılandırma |

**Hedef makine derlemez.** Pi `cargo`/`npm` çalıştırmaz; ikili ve ön yüz Mac'te
derlenir, GitHub release'e yüklenir, makine hazır tarball'i indirir.

---

## 1. Ayar nerede durur?

| Ne | Nerede | Değişince ne gerekir |
|---|---|---|
| **Sırlar** (Google anahtarları, `EKIPTAKIP_SECRET_KEY`, `OPENROUTER_API_KEY`, `RESEND_API_KEY`, VAPID, alan adları) | `~/nix/secrets/ekiptakip-env.age` (agenix) | şifreli dosyayı düzenle → `~/nix` commit → rebuild |
| **Gizli olmayan ayarlar** (sürüm, iletişim e-postası, kapalı dış servisler, karar modeli) | [`backend/manifest.json`](../backend/manifest.json) | dosyayı düzenle → yeni release (§2) |
| Aynı ayarlar, **release çıkarmadan** | `~/nix`'te bir `manifest.json` + `services.ekiptakip.manifest = ./manifest.json;` | `~/nix` commit → rebuild |

`manifest.json` alanları:

| Alan | Anlam |
|---|---|
| `version` | `/api/meta.version`, profil penceresinin altında görünür. `backend/Cargo.toml` ve `frontend/package.json` ile **aynı olmak zorunda** — `cargo test` denetler |
| `contact_email` | geliştirici e-postası (`/api/meta.contact_email`; `VAPID_SUB` yoksa web push `sub` varsayılanı) |
| `external_off` | kapatılan dış servisler: `"decision"`, `"resend"`, `"push"` ya da `["all"]`. Bilinmeyen ad **açılışı durdurur** |
| `decision_model` | OpenRouter model adı |

Sürümü yükseltmek: üç yeri (`manifest.json`, `Cargo.toml`, `package.json`) aynı değere
çek; `cargo update -p ekiptakip --offline` ve `npm install --package-lock-only` kilit
dosyalarını eşler. Testler tutarsızlığı yakalar.

### Sırrı düzenlemek

```bash
cd ~/nix/secrets
nix run github:ryantm/agenix -- -e ekiptakip-env.age -i ~/.ssh/id_ed25519
```

Alıcılar `secrets.nix`'te (admin, ssh, vmtest, evsunucu). Sırrı çıktıya, komut
satırı argümanına, commit'e **yazma**; depo public.

### Dış servisler

| Servis | Anahtar (sır) | Anahtar yoksa / `external_off`'taysa |
|---|---|---|
| `decision` — kalite denetimi (OpenRouter) | `OPENROUTER_API_KEY` | yalnız uzunluk kuralı (başlık ≥ 5, açıklama ≥ 30 karakter) çalışır |
| `resend` — davet postası | `RESEND_API_KEY` | posta `mail_outbox`'ta bekler |
| `push` — web push | `VAPID_PRIVATE` | bildirim listesi çalışır, push gitmez |

Kapalı servisler `/api/meta.external_off` ile ön yüze bildirilir (formlarda "kapalı"
notu görünür). Kayıt metinleri OpenRouter'a gider; kişisel veri OpenRouter
tarafındaki redact kurallarıyla maskelenir, formlardaki not ve `frontend/privacy.html`
bunu söyler. Ayrıntı: `spec/76-bilgi-yogunlugu.md`.

---

## 2. Yeni sürüm çıkarmak

Sırayla, hepsi **`main`** üzerinde. `~/nix`'teki `teamtracker-alpha02` girdisi
`github:Efe0909/teamtracker` (main'in ucu) olduğu için pin main'de değilse Pi onu görmez.

**Önkoşul:** PR merge edildi ve yerel `main` güncel (`git switch main && git pull`);
çalışma ağacı temiz; `gh auth status` Efe0909; `nix` kurulu (`zig` ve `cargo-zigbuild`
komut içinde `nix shell` ile gelir). Merge'i Efe yapar.

```bash
# 0. İsteğe bağlı ama önerilir: yerelde bir kez
(cd backend && cargo clippy --all-targets && cargo test)
(cd frontend && npm run build && npm test)

# 1. Dene: derler, tarball + hash üretir; yükleme YOK, dosya yazılmaz
DRY_RUN=1 backend/tools/release.sh

# 2. Gerçek: GitHub release'e yükler, deploy/release.nix'i yazar
backend/tools/release.sh
git add deploy/release.nix && git commit -m "release: <tag>" && git push

# 3. ~/nix: yeni pini çek
cd ~/nix && nix flake update teamtracker-alpha02
git commit -am "teamtracker-alpha02: <tag>" && git push

# 4. Pi: aşağıdaki "Pi'ye uygulamak"
```

`release.sh` ne yapar: `npm ci && npm run build`, her hedef için
(`aarch64-linux` Pi, `x86_64-linux` VDS) statik musl ikili derler, ikili + `frontend/dist`
tarball'ını `rust-<sha>` etiketli prerelease olarak yükler, **yükleme başarılıysa**
`deploy/release.nix`'e url + hash yazar. `release.nix` üretilmiş dosyadır, elle düzenleme.

### Pi'ye uygulamak

Pi'de `~/nix` klonu var ve Pi'nin kendi GitHub ed25519 anahtarı ile `git pull` yapar.
Yukarıda `~/nix`'i **push'ladıktan** sonra Pi'ye SSH ile bağlan; bağlantı kopsa da iş
sürsün diye `tmux` içinde çalıştır:

```bash
ssh evsunucu
tmux                       # yeni oturum
cd ~/nix && git pull && sudo nixos-rebuild switch --flake .#evsunucu
exit                       # bitince tmux'tan çık (oturum kapanır), sonra SSH'tan
```

Sürüm `~/nix`'in `flake.lock`'unda (`nix flake update` ile çekilip push'landı); elle sha
yazılmaz.

### Doğrulama

1. `systemctl status ekiptakip` — aktif; `journalctl -u ekiptakip -n 50`'de göç hatası yok, `dinleniyor` satırı var.
2. Tarayıcıda giriş → profil penceresinin altındaki sürüm `manifest.json`'daki ile aynı.
3. Anahtar eklendiyse: yeni kayıt açma formunda "Kalite kontrolü kapalı" notu **yok**, kişisel veri notu var.
4. Davet postası: Yönetim → Kişi ekle → ~15 sn içinde mail. Gelmezse
   `select to_email, attempts, error from mail_outbox order by created_at desc limit 5;`

### Geri dönüş

`~/nix`'te `flake.lock` değişikliğini geri al (`git revert`), commit + push, aynı
`nixos-rebuild switch`. Göçler ileri yönlüdür (yeni tablo/sütun, veri silmez); eski ikili
yeni sütunları yok sayar, veri kaybı olmaz.

### Sık takılanlar

| Belirti | Neden |
|---|---|
| `calisma agaci temiz degil` | `release.sh` HEAD'in sha'sını etiketler; önce commit'le |
| Pi eski sürümde kaldı | `release.nix` main'e push'lanmadı ya da `nix flake update` unutuldu |
| Release yüklendi ama `release.nix` değişmedi | yükleme sırasında patladı; aynı komutu tekrar çalıştır (aynı sha'ya yeni etiket gerekirse eskisini `gh release delete`) |
| Açılışta `manifest.json external_off: bilinmeyen servis` | yazım hatası (`decision`, `resend`, `push`, `all`) |
| `cargo test`: "surumu ayristi" | manifest / Cargo.toml / package.json sürümleri farklı |
| Açılışta `EKIPTAKIP_SECRET_KEY yayinda zorunlu` | env dosyasında eksik/kısa anahtar; yayında sahte kimlik de reddedilir |

---

## 3. Zincir

```
telefon ──https──> Cloudflare ──tünel──> cloudflared ──> nginx :80 ──> ekiptakip 127.0.0.1:8000
                    (TLS burada biter)                   (server_name)   (yalnız /api, JSON)
```

nginx `webRoot`'u (React derlemesi) statik verir ve `/api/`'yi Rust'a vekiller.
**`/api/ws` (WebSocket) için `Upgrade`/`Connection` başlıkları geçirilmeli** —
yapılandırma `~/nix`'te; ayrıntı ve güncellenmemişse ne olacağı: `spec/77-gercek-zamanli.md`
"Dağıtım". Host'un
ilk etiketi yüzü seçer: `app.` mobil, `dashboard.` masaüstü, apex karşılama; bilinmeyen
host `444`. Zon `polonyum.com`. Veritabanı yerel PostgreSQL, unix soketinde peer
kimlik doğrulaması — parola yok. Ağaç indeksi süreç belleğinde olduğundan tek süreç çalışır.

Medya `services.ekiptakip.mediaDir` altında (varsayılan `/var/lib/ekiptakip/media`).
İlk yönetici listesi `bootstrapAdminsFile` ile (agenix sırrı, `LoadCredential`), her
açılışta bu e-postalar aktif admin yapılır.

---

## Devamı

- [`cloudflare-dashboard.md`](cloudflare-dashboard.md) — tünel panelden yönetiliyorsa public hostname + Access politikası.
- [`release-handoff-alpha-2.1.md`](release-handoff-alpha-2.1.md) — alpha-2.1'e özel devir notu (tarihî).
- `references/python/deploy/DOCKER.md` — (0.1) konteyner yığını.
- `spec/70-guvenlik.md` — tehdit modeli, kimlik, CSRF, denetim izi.
- [`testdb.sh`](testdb.sh) — **yayın değil**, yerel deneme: atılıp yıkılan `ekiptakip_testdb` + sahte kimlikli API + dolu örnek etkinlik (`up` / `down`). Ekrana bakmak için `up`, sonra `cd frontend && npm run dev`.

## Bu kurulumun kapatmadıkları

- **Medya yedeklenmiyor.** `services.restic.backups` `/home/efe/sata`'yı hariç
  tutuyor, ekler de orada. Disk arızası her görseli götürür ve Postgres yedeği
  var olmayan dosyalara işaret eden satırları sağlam tutar.
- **Cloudflare Access AÇIK DEĞİL** (2026-09-10'da doğrulandı: public hostname'e
  giden istek doğrudan uygulamaya düşüyor — `curl` ile bakınca 401 gövdesi
  `giriş gerekli`, yani uygulamanın kendi kapısı). Access bugün **ek katman**, tek kapı
  değil: uygulamanın Google girişi, davetli listesi, imzalı oturumu, CSRF kapısı ve giriş
  hız sınırı var. Kapalı olmasının bedeli: kimliksiz trafik origin'e ulaşıyor, herkes
  `/login`'i yoklayabiliyor, ileride çıkacak bir kimlik hatası doğrudan internete açık.
  Açmaya karar verirsen: [`cloudflare-dashboard.md`](cloudflare-dashboard.md) §3.
