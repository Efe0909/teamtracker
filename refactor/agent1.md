# Agent 1 — çekirdek: kayıtlar, kartlar, ekler, sohbet, yapı, kişi

Önce `refactor/README.md`'yi oku; kurallar orada. Bu dosya yalnız kapsamı ve özel durumları
söyler. Envanter: `refactor/00-envanter.md` (aşağıdaki dosyaların `===api/…===` bölümleri).

**Sen ilk ajansın.** Senden önce taşınmış bir şey yok; senden sonrakiler (agent2: etkinlik
ve satın alma, agent3: maliye ve yönetim) senin taşıdıklarını `crate::domain::…` yolundan
çağıracak.

## Kapsam (~3.600 satır, sırayla)

| # | api dosyası | → domain | satır | not |
|---|---|---|---|---|
| 1 | `common.rs` | `common.rs` | 95 | bölünür, aşağıda |
| 2 | `records.rs` | `records.rs` | 1091 | merkez; agent2 de çağırıyor |
| 3 | `cards.rs` | `cards.rs` | 606 | `records` ile karşılıklı |
| 4 | `attachments.rs` | `attachments.rs` | 436 | dosya yanıtı + ham gövde |
| 5 | `notify.rs` | `notify.rs` | 306 | `fanout` |
| 6 | `chats.rs` | `chats.rs` | 289 | `authorize_read` realtime'a açık |
| 7 | `nodes.rs` | `nodes.rs` | 587 | ağaç kilidi |
| 8 | `home.rs` | `home.rs` | 213 | `manage_teams` → teams |
| 9 | `teams.rs` | `teams.rs` | 392 | |
| 10 | `bank_accounts.rs` | `bank_accounts.rs` | 199 | `list_of` → profile |
| 11 | `profile.rs` | `profile.rs` | 198 | dışa aktarma dosya yanıtı |

Sıra bağımlılığa göre: `records` ↔ `cards` birbirini çağırıyor — **ikisini aynı commit'te**
taşı. Diğerleri tek tek.

## 1. `common.rs`'i böl (ilk iş, ayrı commit)

- `domain/common.rs`'e taşı: `tree`, `has_scope`, `present`, `NAME_MIN`, `DESC_MIN`,
  `min_chars`, `text` ve `#[cfg(test)] mod tests`.
- `api/common.rs`'te kalsın: `Body<T>` (axum çıkarıcısı) ve `id` (yol ayrıştırma).
- **README kural 8'in tek istisnası:** `api/common.rs`'e şunu ekle ki taşınmamış dosyalar
  derlenmeye devam etsin:
  ```rust
  // Gecici: domain'e taşınmamış uclar icin. agent3 sonda kaldirir.
  pub(crate) use crate::domain::common::{has_scope, min_chars, present, text, tree, DESC_MIN, NAME_MIN};
  ```
- Domain koduna taşıdığın her şey `crate::domain::common` kullanır, `crate::api::common`
  DEĞİL.
- `#[serde(deserialize_with = "common::present")]` öznitelikleri metin içinde yol taşır:
  struct domain'e geçince `"crate::domain::common::present"` (ya da domain dosyasında
  `use … common;` varsa `"common::present"`) olmalı. Derleyici yakalar.

## Özel durumlar

- **`records.rs`** — `load`, `detail_of`, `require_edit`, `may_respond`, `is_restricted`,
  `touch`, `log`, `log_override`, `change`, `check_*`, `may_set_owner` başka dosyalardan
  çağrılıyor (`cards`, `chats`, `attachments`, `events`, `otf`). Taşıyınca `events.rs` ve
  `otf.rs`'teki çağrıları da `crate::domain::records::…`'e çevir (agent2'nin dosyaları ama
  yalnız yol değişikliği — kural 8).
- **`cards.rs`** — `records::Detail` dönüyor; `cards::insert`, `cards::of_record`,
  `CardView` records'tan çağrılıyor.
- **`attachments.rs`**
  - `upload` ham gövde alıyor (`std::result::Result<Bytes, BytesRejection>`) + `Query`.
    Handler reddi (`BytesRejection`) koda çevirir ve domain'e `Bytes`/`&[u8]` geçer; `bytes`
    crate tipi axum tipi sayılmaz.
  - `get`/`thumb` → `serve(..) -> Result<Response>`: domain dosya verisini (yol/bayt, mime,
    önbellek için gereken bilgi) düz struct olarak döner; `header::*` ve CSP başlıklarını
    handler kurar.
  - `att::views`, `att::can_tag`, `att::claimable`, `att::claimable_for`, `AttachView`
    `cards`, `chats` ve **`finance.rs`** (agent3'ün) tarafından kullanılıyor — finance'teki
    import yolunu da güncelle.
- **`notify.rs`** — `fanout` `chats.rs`'ten `tokio::spawn` ile çağrılıyor; spawn çağrısı
  domain'e (chats) taşınır, `fanout` da domain'e.
- **`chats.rs`** — `authorize_read`'i realtime kullanıyor: `api/mod.rs:43`'teki
  `pub(crate) use chats::authorize_read as authorize_chat_read;` satırını
  `pub(crate) use crate::domain::chats::authorize_read as authorize_chat_read;` yap.
  (`api/mod.rs`'te izin verilen TEK değişiklik.)
- **`nodes.rs`** — `type Tx<'a>` takma adı ve `log` yardımcısı dosyaya özel; domain'e taşı.
  `st.structure` (tokio Mutex) kilidi ve `st.tree` yenilemesi gövdeyle birlikte gider.
- **`home.rs`** — `manage_teams` (`pub(super)`) `teams.rs`'ten çağrılıyor → `pub(crate)`.
  `home::teams`/`home::team` `GET` rotaları da burada.
- **`teams.rs`** — kendi `type Tx<'a>`'sı var; domain'e taşı.
- **`bank_accounts.rs`** — `list_of` `profile.rs`'ten çağrılıyor.
- **`profile.rs`** — `export -> Result<Response>`: domain JSON değerini/baytı ve dosya adını
  döner, `CONTENT_DISPOSITION`'ı handler kurar.

## Bitti sayılır

- 11 dosyanın her biri için `grep -n sqlx src/api/<dosya>.rs` boş (yalnız `common.rs` ve
  `Body` çıkarıcısı hariç tutulabilir — orada zaten `sqlx` yok).
- `cargo clippy --all-targets`, `cargo test`, `tools/local_test.sh` yeşil.
- Commit'ler: common, records+cards, attachments, notify, chats, nodes, home, teams,
  bank_accounts, profile.
- README'deki rapor.
