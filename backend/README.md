# backend — Rust JSON API (alpha-0.2)

Yalniz `/api/*`, yalniz JSON (`spec/15-sinirlar.md`). HTML yok; on yuz
`frontend/`. Hedef sema: `spec/21-sema-v2.md`. Python uygulamasi (`app.py`,
`shared/`, `sites/`) yalniz BASVURU — davranisin kaynagi, calisan yigin degil.

## Yapi

```
src/
  main.rs      acilis: config, goc, agac, ara katman sirasi
  config.rs    ortam degiskenleri TEK yerde; yayinda eksik sir acilisi durdurur
  auth.rs      oturum cerezi (uid.csrf) + CurrentUser — "kim" sorusunun tek cevabi
  csrf.rs      degistiren isteklerde X-CSRF-Token kapisi
  ratelimit.rs giris uclari, IP basina dakikada 10
  api/         rotalar: mod.rs (/api/me), auth.rs (Google OAuth + PKCE, cikis, dev-login)
  db/ models/  alan katmani (agac, kapsam, filtre, akis) — JSON uclari geldikce
```

| crate | ne icin |
|---|---|
| `axum` + `tokio` | HTTP |
| `sqlx` | ham SQL, ORM yok (KNOW-178); gocler ikiliye gomulu |
| `axum-extra` `cookie-signed` | imzali oturum cerezi. Sunucu tarafi oturum tablosu yok (KNOW-97) |
| `reqwest` | Google OAuth — elle, uc HTTP cagrisi |
| `sha2` + `base64` | PKCE S256 |

## Sikilik

Kodu cogunlukla derleyici gozden geciriyor. `Cargo.toml` `[lints]`:
`todo!`, `unimplemented!`, `unwrap`, `expect`, `panic!` ve `unsafe` DERLEMEYI
DUSURUR (testlerde `unwrap` serbest, `clippy.toml`). Kontrol: `cargo clippy --all-targets`.

## Calistirma

```bash
docker start ekiptakip-db                       # ya da: make db-ac
docker exec ekiptakip-db createdb -U ekiptakip ekiptakip_alpha02
DATABASE_URL=postgresql://ekiptakip:ekiptakip@127.0.0.1:5432/ekiptakip_alpha02 \
  EKIPTAKIP_AUTH=sahte cargo run                # 127.0.0.1:8000, goc acilista
docker exec -i ekiptakip-db psql -U ekiptakip -d ekiptakip_alpha02 < seed.sql   # VERIYI SILER
```

## Sinama

- `cargo test` — birim (agac, filtre, hiz siniri).
- `tools/vm_test.sh` — Mac'te cross-derler, VM'de atilip-yikilan dizin + veritabani,
  iki surec (sahte kimlik + Google kipi), `tools/check_api.sh` JSON sozlesmesi.
- `tools/release.sh` — yayin tarball'i (ikili + on yuz), GitHub release, `deploy/release.nix`.
