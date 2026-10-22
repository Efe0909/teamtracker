# Agent 3 — maliye, yönetim, LLM ayarları + son temizlik

Önce `refactor/README.md`'yi oku; kurallar orada. Bu dosya yalnız kapsamı ve özel durumları
söyler. Envanter: `refactor/00-envanter.md` (aşağıdaki dosyaların `===api/…===` bölümleri).

**Senden önce agent1 ve agent2 bitti:** kayıtlar, kartlar, ekler, sohbet, yapı, kişi,
etkinlik, LLM bağlamı, OTF, satın alma domain'de. Başlamadan `git log` ile commit'lerini ve
iki raporu gör — agent2'nin raporu senin düzelteceğin geçici `crate::api::finance::…` ve
`crate::api::llm::…` yollarını listeliyor.

**Sen son ajansın:** taşımadan sonra refaktörü kapatan temizlik de sende (§ Son temizlik).

## Kapsam (~4.200 satır)

| # | api dosyası | → domain | satır | not |
|---|---|---|---|---|
| 1 | `finance.rs` | `finance.rs` | 1451 | `need`, `need_viewer`, `today` 4 dosyaya açık |
| 2 | `budget.rs` | `budget.rs` | 537 | iki xlsx |
| 3 | `recurring.rs` | `recurring.rs` | 149 | |
| 4 | `templates.rs` | `templates.rs` | 106 | |
| 5 | `admin.rs` | `admin.rs` | 630 | `HeaderMap` (IP) |
| 6 | `llm.rs` | `llm.rs` | 711 | `HeaderMap` ×11 (IP) |
| 7 | `llm_usage.rs` | `llm_usage.rs` | 491 | yalnız okuma |
| 8 | `quality.rs` | `quality.rs` | 109 | `HeaderMap` (IP) |

Sıra: `finance` önce (diğer maliye dosyaları ona bağlı), sonra `budget`, `recurring`,
`templates`; `llm` `llm_usage`'dan önce (`llm::require`).

## Özel durumlar

- **`finance.rs`**
  - `need`, `need_viewer`, `today` (`pub(super)`; agent2 `pub(crate)` yapmış olabilir)
    `budget`, `recurring`, `templates` ve **`domain/purchasing.rs`** tarafından
    kullanılıyor (`use super::finance::{…}` / `crate::api::finance::{…}`). Taşıyınca hepsini
    `crate::domain::finance::{…}`'e çevir.
  - **Ad çakışması:** kökte de `crate::finance` modülü var (`cents`, `micros`; kapsam
    dışı). `domain/finance.rs` içinde bugünkü `use crate::finance::{self, cents, micros};`
    aynen çalışır; `finance::` önekinin kök modülü gösterdiğinden emin ol, kendi modülünü
    değil.
  - `att::views`, `att::claimable…` artık `crate::domain::attachments` (agent1 yolu
    güncellemiş olmalı).
  - `claim_xlsx` (`-> Result<axum::response::Response>`): domain bayt + dosya adı döner.
- **`budget.rs`** — `xlsx_response(bytes, name) -> Response` yardımcısı axum tipi kurduğu
  için **api'de kalır**; `budget_xlsx` ve `analysis_xlsx` domain'den bayt + ad alır ve onu
  çağırır.
- **`HeaderMap` (admin, llm, quality).** Yalnız IP için (`audit::client_ip` →
  `audit::log_event`). Handler `crate::audit::client_ip(&headers)` ile IP'yi çıkarır, domain
  fonksiyonu `ip: Option<std::net::IpAddr>` alır. `api/llm.rs`'teki
  `async fn log(st, headers: &HeaderMap, me, event, detail)` yardımcısı domain'de
  `log(st, ip, me, event, detail)` olur. `audit.rs` kapsam dışı, yalnız çağrılır.
- **`llm.rs`**
  - `load` `domain/events/context.rs` ve `domain/events/context/materials.rs`'ten
    `crate::api::llm::load` ile çağrılıyor → `crate::domain::llm::load`.
  - `require` `llm_usage.rs`'ten çağrılıyor (`api::{common, llm::require}`).
  - `events::known_names`, `material_sample`, `try_suggest` agent2 tarafından
    `crate::domain::events::…`'e çevrilmiş olmalı; değilse çevir.
  - Kök `crate::llm` (`run`, `settings`, `disabled_services`…) kapsam dışı, aynen kalır.
    `api/meta.rs` kök modülü çağırıyor, etkilenmez.
- **`quality.rs`** — `st.quality` (`RwLock<QualityConfig>`) yazımı gövdeyle birlikte gider.

## Son temizlik (taşımalar bittikten sonra, ayrı commit)

1. `grep -rn "crate::api::" src/domain` → **boş** olmalı. Kalan her yolu `crate::domain::…`'e
   çevir.
2. `api/common.rs`'teki geçici satırı kaldır:
   `pub(crate) use crate::domain::common::{has_scope, min_chars, present, text, tree, DESC_MIN, NAME_MIN};`
   Derleme kırılırsa kırılan handler hâlâ iş mantığı taşıyor demektir → onu incelt, satırı
   geri koyma.
3. `grep -ln sqlx src/api/*.rs src/api/events/*.rs src/api/events/context/*.rs` → yalnız
   kapsam dışı `auth.rs`, `mod.rs` (`me` ucu) kalabilir. Başka dosya çıkarsa rapora yaz.
4. `api/` içinde artık kullanılmayan `use` satırlarını temizle (clippy gösterir).
5. `cargo clippy --all-targets`, `cargo test`, `tools/local_test.sh` yeşil.

Commit: `refactor(domain): son temizlik — geçici yollar ve yönlendirmeler kaldırıldı`.

## Bitti sayılır

- 8 dosyanın her biri için `grep -n sqlx src/api/<dosya>.rs` boş.
- Son temizliğin beş adımı tamam.
- Commit'ler: finance, budget, recurring, templates, admin, llm, llm_usage, quality, temizlik.
- README'deki rapor + refaktörün tamamı için kısa özet: `api/` ve `domain/` satır sayıları
  (`wc -l`), kalan istisnalar.
