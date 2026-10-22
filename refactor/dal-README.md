# Veri erişim katmanı — ortak kurallar (TASK-420)

Dört ajan **paralel** çalışır (A, B, C, D), her biri kendi dalında ve kendi dosyalarında.
Önce bu dosyayı, sonra kendi işinin brifini oku.

## Amaç

`backend/src/domain/` bugün 484 satır içi `sqlx::query*` çağrısı taşıyor. Hedef üç katman:
**api (kenar) → domain (iş kuralı, yetki, doğrulama, transaction sınırı) → db (yalnız SQL)**.
Bu görevde yalnız **taşıma** var: davranış, SQL metni, sorgu sırası, hata kodu değişmez.
ORM yok (KNOW-178); filtreleme SQL'de (KNOW-181); parametreli sorgu, sütun adı beyaz liste.

## Başlangıç durumu

`backend/src/db/` altında senin alanlarının boş dosyaları ve `db/mod.rs` bildirimleri hazır
(`db/<alan>.rs`, tek satır `//!` yorumu). `cargo check` yeşil. Başka dosyaya bildirim ekleme:
`db/mod.rs`'e, `main.rs`'e, `api/`'ye ve başka ajanın dosyalarına **dokunma**.
`db/nodes.rs` zaten var (C ajanı genişletir).

## Biçim

```rust
// domain/teams.rs — SONRA
let ok = db::attachments::banner_ok(&mut **tx, a, max).await?;
if !ok { return Err(AppError::BadRequest("invalid_banner")); }
db::teams::set_banner(&mut **tx, team, banner).await?;

// db/teams.rs
pub(crate) async fn set_banner(ex: impl sqlx::PgExecutor<'_>, team: Uuid, banner: Option<Uuid>)
    -> Result<(), sqlx::Error> {
    sqlx::query("update teams set banner_id = $2 where id = $1")
        .bind(team).bind(banner).execute(ex).await?;
    Ok(())
}
```

## Kurallar

1. **Domain'de `sqlx::query`, `query_as`, `query_scalar`, `QueryBuilder` kalmaz** (kendi
   dosyalarında). Kontrol (boş olmalı):
   `grep -nE 'sqlx::(query|query_as|query_scalar)|QueryBuilder' src/domain/<dosya>.rs`
2. **db fonksiyonu yalnız SQL çalıştırır.** Yetki, doğrulama, iş hatası (`AppError::BadRequest`
   vb.), `st.hub`, `tokio::spawn`, activity yazma kararı domain'de kalır. db satır, `Option`,
   `bool`, sayı ya da `rows_affected` döner. Hata tipi `sqlx::Error`; `?` domain'de `AppError`'a
   çevrilir (mevcut kodla aynı yol).
3. **İmza:** tek ifadelik işlevler `ex: impl sqlx::PgExecutor<'_>` alır; çağıran `&st.pool` ya da
   `&mut **tx` geçirir. Aynı bağlantıda birden çok ifade çalıştıran işlev
   `c: &mut sqlx::PgConnection` alır. Transaction'ı **domain** açar ve kapatır; db `begin`/`commit`
   çağırmaz.
4. **Ad:** fiil + nesne (`insert_team`, `set_banner`, `list_for_user`, `find_by_id`). Aynı alanın
   fonksiyonu `db/<alan>.rs`'te, `domain/<alan>.rs`'in bire bir karşılığıdır. Görünürlük `pub(crate)`.
5. **Dönüş tipi:** çok sütunlu sonuçta `#[derive(sqlx::FromRow)]` struct'ı `db/<alan>.rs`'te
   tanımla; mevcut kod demet (tuple) kullanıyorsa ve ≤3 sütunsa demet kalabilir. Yeni struct
   alanları İngilizce. `Serialize` ekleme: JSON şekli domain'de kurulur.
6. **SQL AYNEN.** Metin, sütun sırası, `order by`, kilitler (`for update`), `returning` aynı.
   Dinamik SQL kuran bir fonksiyon (filtre, sütun beyaz listesi) bütünüyle db'ye taşınır;
   beyaz liste db'de kalır. İyileştirme, birleştirme, yeniden adlandırma YOK.
   Hata gibi görünen bir şey görürsen **düzeltme**, rapora yaz.
7. **Tek tablo, çok alan:** başka ajanın alanında olan bir tabloya (`activity`, `attachments`,
   `users`, `nodes`, `chats`…) ihtiyacın varsa **kendi `db/<alan>.rs`'ine** yaz, kopya sorun
   değil: ikinci aşamada bir entegrasyon işi tekilleştirir. Başka ajanın `db/` dosyasına yazma.
8. **Yeni soyutlama YOK:** trait, generic depo, struct-servis, makro yok. Düz `async fn`.
9. **Testler** (`#[cfg(test)]`) test ettikleri kodla gider; db'ye taşınan SQL'in testi varsa orada.
10. **Dosya düzenleme Edit/Write aracıyla.** Büyük taşımada db dosyasını Write ile kur,
    domain dosyasını Edit ile incelt. `sed`/`python` ile toplu yeniden yazma yok.
11. **Kod dili İngilizce, anlatı Türkçe:** yeni tanımlayıcılar İngilizce; yorum ve commit
    mesajı Türkçe (CLAUDE.md).
12. **Kapsam dışı:** `api/`, `crate::llm`, `crate::mail`, `crate::media`, `realtime.rs`,
    `decision.rs`, `domain/mod.rs`, `main.rs`, `refactor/`. Domain'in public imzası değişmez
    (başka dosyalar çağırıyor).

## Denetim

Başlamadan ÖNCE taban çizgisi (yeşil olmalı; değilse dur ve bildir):

```bash
cd backend && cargo clippy --all-targets && cargo test
```

`tools/local_test.sh` Docker (`ekiptakip-db`) ve sabit port ister. Sandbox Docker'a
erişemezse çalıştırma, raporda "local_test koşmadı" yaz; koordinatör kendisi koşar.
Aynı anda yalnız biri koşabilir: `flock /tmp/ekiptakip-local-test.lock tools/local_test.sh`.

Her domain dosyasından sonra `cargo clippy --all-targets` (uyarı = hata) + `cargo test`.
Sonda: rakamların tutması için kural 1'in `grep`'i her dosya için.

## Commit

Domain dosyası başına bir commit, Türkçe:

```
refactor(db): teams SQL'i db/teams.rs'e taşındı

Domain yalnız iş kuralı; sorgular db katmanında. Davranış değişikliği yok.
```

## Rapor (son mesaj)

- Taşınan dosyalar, commit'ler, db fonksiyon sayısı.
- Domain'de SQL'i **kalan** yerler (varsa) ve nedeni.
- Başka ajanın alanındaki tablolar için yazdığın kopyalar (tablo, db fonksiyonu) — ikinci aşama bundan yürür.
- Gördüğün olası hatalar (dosya:satır), düzeltilmeden.
- Çalıştıramadığın denetimler.
