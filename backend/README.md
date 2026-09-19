# backend — Rust portu (faz 0.2)

Hedef sema: `spec/21-sema-v2.md`. Python uygulamasi (`app.py`, `shared/`,
`sites/`) port bitene kadar yaninda calismaya devam eder.

## Bagimliliklar

```bash
cd backend
cargo add axum tokio --features tokio/full
cargo add sqlx --features runtime-tokio,tls-rustls,postgres,uuid,chrono,json,macros
cargo add tower-http --features fs,compression-br,trace
cargo add axum-extra --features cookie-signed
cargo add minijinja --features loader
cargo add serde --features derive
cargo add serde_json uuid chrono reqwest tracing tracing-subscriber image
```

| crate | ne icin |
|---|---|
| `axum` + `tokio` | HTTP |
| `sqlx` | ham SQL, derleme zamani sorgu denetimi. ORM yok (KNOW-178) |
| `axum-extra` `cookie-signed` | imzali oturum cerezi. Sunucu tarafi oturum tablosu YOK (KNOW-97) |
| `minijinja` | sablonlar |
| `reqwest` | Google OIDC — elle, `oauth2` crate'i uc HTTP cagrisi icin agir |
| `image` | kucuk resim (`media.rs`) |

**Sablon motoru: `minijinja`.** Calisma zamani, Jinja2 sozdizimi — mevcut 45
sablon (2272 satir, 23'u `include`, 6'si `extends`) neredeyse oldugu gibi
tasiniyor. `askama` derleme zamani denetimi verirdi ama her sablon icin bir
struct ve dialekt cevrimi isterdi. Bedeli: derleme zamani denetim kaybi —
telafisi tek test, sablon dizinini gezip hepsini ornek baglamla cizer.

## Yapi

```
src/
  main.rs config.rs state.rs error.rs media.rs push.rs
  routes/    yol + Host yonlendirme (mod.rs)
  handlers/  istek govdesi, yetki, YAZMA yollari
  models/    satir tipleri
  db/        pool · tree · scope · search
```

Her dosya bos degil: icinde ne durmasi gerektigini ve hangi karara bagli
oldugunu soyleyen bir sozlesme yorumu var.

Iki yer bolunmemeli:

- **`routes/shared.rs` + `handlers/shared.rs`** — eylem seridi, akis ve kart
  bloklari iki sitenin de kullandigi TEK uc (KNOW-265). Bolunurse mobil ikinci
  kopya yazmaya baslar.
- **`handlers/` icindeki yazma yollari** — bir yazma yolu tek yerde. Python`da
  `service.py` 1034 satira cikmisti (KNOW-219); bolunme ozellige gore, siteye
  gore degil.

## Henuz yok

- `migrations/001_schema.sql` — `spec/21-sema-v2.md` sonundaki alti acik nokta
  kapanmadan yazilmamali; yazilirsa yanlisi donar.
- `templates/` — mevcut 45 sablon buraya tasinacak, dosya adlari Ingilizce'ye
  cevrilerek (CLAUDE.md "dosya adi" kurali; Python gecisinde atlanmisti).
- Testler — Python'daki HTTP seviyesindeki testler sozlesme olarak korunur,
  Rust binary'sine karsi kosturulur.
