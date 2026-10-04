# backend — Rust JSON API (0.10.4)

Yalnız `/api/*`, yalnız JSON (`spec/15-sinirlar.md`). HTML yok; ön yüz
`frontend/`. Şema: `migrations/` (açılışta kendiliğinden koşar), açıklaması
`spec/21-sema-v2.md`. Python uygulaması `references/python/` altında yalnız BAŞVURU —
davranışın kaynağı, çalışan yığın değil.

## Yapı

```
manifest.json  gizli olmayan ayarlar: sürüm, iletişim e-postası, external_off, decision_model
migrations/    NNN_*.sql — dosya adları DONUK (schema_migrations adla tutar); ikiliye gömülü
src/
  main.rs      açılış: config, göç, ağaç, ara katman sırası
  config.rs    ortam değişkenleri + manifest TEK yerde; yayında eksik sır açılışı durdurur
  state.rs     AppState: havuz, ağaç indeksi, http istemcisi, dış servis kapıları
  auth.rs      oturum çerezi (uid.csrf) + CurrentUser — "kim" sorusunun tek cevabı
  csrf.rs      değiştiren isteklerde X-CSRF-Token kapısı
  ratelimit.rs giriş uçları, IP başına dakikada 10
  audit.rs     security_events (giriş, ret, 403)
  bootstrap.rs ilk yönetici listesi (EKIPTAKIP_BOOTSTRAP_ADMINS_FILE), her açılışta
  decision.rs  bilgi yoğunluğu kapısı: OpenRouter karar modeli (spec/76), `Quality` yanıtı
  mail.rs      Resend ile davet postası (mail_outbox kuyruğu, yeniden deneme)
  push.rs webpush.rs  bildirim kararı + VAPID/AES-GCM web push
  media.rs     ekler: magic byte, 10 MB tavan, yeniden kodlama (EXIF düşer)
  otf.rs       OTF .docx doldurma · refdata.rs referans veri · mentions.rs @anma · channel.rs
  api/         rotalar: records, events, nodes, teams, cards, chats, admin, notify,
               profile, home, meta (/api/meta), auth (Google OAuth + PKCE)
  db/          alan katmanı: ağaç indeksi, kapsam (scope), filtre, akış, arama
  models/      satır ve enum türleri
```

| crate | ne için |
|---|---|
| `axum` + `tokio` | HTTP |
| `sqlx` | ham SQL, ORM yok (KNOW-178); göçler ikiliye gömülü |
| `axum-extra` `cookie-signed` | imzalı oturum çerezi. Sunucu tarafı oturum tablosu yok (KNOW-97) |
| `reqwest` | Google OAuth, Resend, OpenRouter |
| `serde` / `serde_json` | JSON, `manifest.json` |
| `image`, `zip`, `p256` + `aes-gcm` + `hkdf` | ekler, OTF, web push |

## Ayar: ortam mı, manifest mi?

- **Sır** → ortam değişkeni (NixOS'ta agenix `environmentFile`): `DATABASE_URL`,
  `EKIPTAKIP_SECRET_KEY` (yayında ≥ 32), `GOOGLE_CLIENT_ID/SECRET`, `OPENROUTER_API_KEY`,
  `RESEND_API_KEY`, `VAPID_PRIVATE/PUBLIC`, host ve çerez alan adı değişkenleri.
- **Sır değil** → `manifest.json` (ikiliye gömülü). `EKIPTAKIP_MANIFEST=<dosya>` ile
  yeniden derlemeden başka dosya okunur. Alanlar ve sürüm yükseltme: `deploy/README.md` §1.

`cargo test` manifest sürümünün `Cargo.toml` ve `frontend/package.json` ile aynı olduğunu denetler.

## Sıkılık

Kodu çoğunlukla derleyici gözden geçiriyor. `Cargo.toml` `[lints]`:
`todo!`, `unimplemented!`, `unwrap`, `expect`, `panic!` ve `unsafe` DERLEMEYİ
DÜŞÜRÜR (testlerde serbest, `clippy.toml`). Kontrol: `cargo clippy --all-targets`.

## Çalıştırma

Kökten tek komut: `make dev` (Postgres + API + web). Elle:

```bash
docker compose up -d && docker exec ekiptakip-db createdb -U ekiptakip ekiptakip_alpha02
DATABASE_URL=postgresql://ekiptakip:ekiptakip@127.0.0.1:5432/ekiptakip_alpha02 \
  EKIPTAKIP_AUTH=sahte cargo run                # 127.0.0.1:8000, göç açılışta
docker exec -i ekiptakip-db psql -U ekiptakip -d ekiptakip_alpha02 < seed.sql   # VERİYİ SİLER
```

Yerelde `OPENROUTER_API_KEY` yoksa kalite denetimi kapalıdır (yalnız uzunluk kuralı);
denemek için anahtarı ortama ver.

## Sınama

- `cargo test` — birim (ağaç, filtre, hız sınırı, karar modeli yanıtı, manifest).
- `tools/local_test.sh` — atılıp-yıkılan yerel DB + iki süreç (sahte kimlik + Google kipi), `check_api.sh` JSON sözleşmesi.
- `tools/vm_test.sh` — aynısı VM'de: Mac'te cross-derler, geçici dizin + veritabanı, sonra siler.
- `tools/import_v1.sh` — TEK SEFERLİK: 0.1'in kullanıcı/ağaç/takım/rol verisini 0.2'ye
  (iş kayıtları, sohbet, ekler TAŞINMAZ). VM'de 2026-09-22'de yapıldı; Pi'de bir kez daha.
- `tools/release.sh` — yayın tarball'ı (ikili + ön yüz), GitHub release, `deploy/release.nix`. Adımlar: `deploy/README.md` §2.
