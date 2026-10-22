# Agent 1 — çekirdek: kayıtlar, kartlar, ekler, sohbet, yapı, kişi

Önce `refactor/README.md`'yi oku; kurallar orada. Bu dosya yalnız kapsamı ve özel durumları
söyler. Envanter: `refactor/00-envanter.md` (aşağıdaki dosyaların `===api/…===` bölümleri).

**Paralel çalışıyorsun** (README § Paralel çalışma): dalın `refactor/domain-agent1`,
worktree'n `/home/Efe/Projects/teamtracker-agent1`. agent2 (etkinlik, satın alma) ve agent3
(maliye, yönetim) aynı anda çalışıyor ve senin modüllerine `crate::api::<m>::…` yolundan
erişiyor. Onların dosyalarına dokunma; onların çağırdığı her şeyi taşırken `api/<m>.rs`'te
yönlendirme bırak (README § Paralel çalışma madde 3). Aşağıdaki "başka ajanın dosyasını
güncelle" maddeleri yerine yönlendirme geçerli.

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
  // Gecici: domain'e taşınmamış uclar icin. Son temizlik kaldirir.
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
  çağrılıyor (`cards`, `chats`, `attachments`, `events`, `otf`). `events`/`otf` agent2'nin:
  onlar için `api/records.rs`'te yönlendirme bırak (envanterdeki `ÇAĞIRAN:` satırlarına bak),
  `events.rs`/`otf.rs`'e dokunma.
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
    `cards`, `chats` ve **`finance.rs`** (agent3'ün) tarafından kullanılıyor — finance için
    `api/attachments.rs`'te yönlendirme bırak, `finance.rs`'e dokunma.
- **`notify.rs`** — `fanout` `chats.rs`'ten `tokio::spawn` ile çağrılıyor; spawn çağrısı
  domain'e (chats) taşınır, `fanout` da domain'e.
- **`chats.rs`** — `authorize_read`'i realtime kullanıyor (`api/mod.rs`'teki
  `pub(crate) use chats::authorize_read as authorize_chat_read;`). `api/mod.rs`'e dokunma:
  `api/chats.rs`'te `pub(crate) use crate::domain::chats::authorize_read;` yönlendirmesi
  bırak; `api/mod.rs` satırı son temizlikte çevrilir.
- **`nodes.rs`** — `type Tx<'a>` takma adı ve `log` yardımcısı dosyaya özel; domain'e taşı.
  `st.structure` (tokio Mutex) kilidi ve `st.tree` yenilemesi gövdeyle birlikte gider.
- **`home.rs`** — `manage_teams` `teams.rs`'ten çağrılıyor (koordinatör `pub(crate)` yaptı).
  `home::teams`/`home::team` `GET` rotaları da burada.
- **`teams.rs`** — kendi `type Tx<'a>`'sı var; domain'e taşı.
- **`bank_accounts.rs`** — `list_of` `profile.rs`'ten çağrılıyor.
- **`profile.rs`** — `export -> Result<Response>`: domain JSON değerini/baytı ve dosya adını
  döner, `CONTENT_DISPOSITION`'ı handler kurar.

## Bitti sayılır

- 11 dosyanın her biri için `grep -n sqlx src/api/<dosya>.rs` boş (yalnız `common.rs` ve
  `Body` çıkarıcısı hariç tutulabilir — orada zaten `sqlx` yok).
- `cargo clippy --all-targets`, `cargo test`,
  `flock /tmp/ekiptakip-local-test.lock tools/local_test.sh` yeşil.
- Commit'ler: common, records+cards, attachments, notify, chats, nodes, home, teams,
  bank_accounts, profile — `refactor/domain-agent1` dalında, push edilmiş.
- README'deki rapor + bıraktığın yönlendirmelerin listesi.
