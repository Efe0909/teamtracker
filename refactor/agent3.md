# Agent 3 — maliye, yönetim, LLM ayarları + son temizlik

Önce `refactor/README.md`'yi oku; kurallar orada. Bu dosya yalnız kapsamı ve özel durumları
söyler. Envanter: `refactor/00-envanter.md` (aşağıdaki dosyaların `===api/…===` bölümleri).

**Paralel çalışıyorsun** (README § Paralel çalışma): dalın `refactor/domain-agent3`,
worktree'n `/home/Efe/Projects/teamtracker-agent3`. agent1 (`common`, `records`,
`attachments`, …) ve agent2 (`events`, `purchasing`, `otf`) aynı anda çalışıyor. Senin
dalında onların modülleri henüz `api/`'de: domain kodun onları **her zaman** `crate::api::…`
ile çağırır (`crate::api::common::{…}`, `crate::api::attachments::{views, claimable, …}`,
`crate::api::events::{known_names, material_sample, try_suggest}`). Onların dosyalarına
dokunma. `need`, `need_viewer`, `today`, `is_viewer` (agent2'nin `purchasing`'i çağırıyor) ve
`llm::load` (agent2'nin `events/context`'i çağırıyor) için kendi `api/finance.rs` /
`api/llm.rs`'inde yönlendirme bırak (README § Paralel çalışma madde 3).

**Son temizlik (§ Son temizlik) şimdi YAPILMAZ.** Üç dal birleştirildikten sonra ayrı bir
istekle gelir; bu turda yalnız 8 dosyanın taşıması.

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
  - `need`, `need_viewer`, `today` (koordinatör `pub(crate)` yaptı) `budget`, `recurring`,
    `templates` ve agent2'nin `purchasing`'i tarafından kullanılıyor. Kendi dosyalarındaki
    (`budget`, `recurring`, `templates`) çağrıları `crate::domain::finance::{…}`'e çevir;
    `purchasing` için `api/finance.rs`'te yönlendirme bırak.
  - **Ad çakışması:** kökte de `crate::finance` modülü var (`cents`, `micros`; kapsam
    dışı). `domain/finance.rs` içinde bugünkü `use crate::finance::{self, cents, micros};`
    aynen çalışır; `finance::` önekinin kök modülü gösterdiğinden emin ol, kendi modülünü
    değil.
  - `att::views`, `att::claimable…` agent1'in: domain'de `crate::api::attachments::…` ile
    çağır.
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
  - `load` agent2'nin `events/context` dosyalarından çağrılıyor → `api/llm.rs`'te
    `pub(crate) use crate::domain::llm::load;` yönlendirmesi bırak.
  - `require` `llm_usage.rs`'ten çağrılıyor (`api::{common, llm::require}`); ikisi de senin,
    doğrudan `crate::domain::llm::require`'e çevir.
  - `events::known_names`, `material_sample`, `try_suggest` agent2'nin: domain'de
    `crate::api::events::{…}` ile çağır.
  - Kök `crate::llm` (`run`, `settings`, `disabled_services`…) kapsam dışı, aynen kalır.
    `api/meta.rs` kök modülü çağırıyor, etkilenmez.
- **`quality.rs`** — `st.quality` (`RwLock<QualityConfig>`) yazımı gövdeyle birlikte gider.

## Son temizlik (üç dal birleştirildikten sonra, ayrı istekle, ayrı commit)

0. Üç raporun yönlendirme listelerini topla. Her yönlendirmeyi
   (`// Gecici yonlendirme (paralel refaktor)`) kaldır, çağıranını `crate::domain::…`'e çevir.
   `api/mod.rs`: `authorize_chat_read` satırını `crate::domain::chats::authorize_read`'e çevir,
   modülleri yeniden `mod` yap (`purchasing` dahil, `main.rs:61` yolu
   `domain::purchasing::backfill_vendors` olunca). `finance`/`home` yardımcılarının
   görünürlüğü domain'de zaten `pub(crate)`.
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

Bu tur:
- 8 dosyanın her biri için `grep -n sqlx src/api/<dosya>.rs` boş.
- `cargo clippy --all-targets`, `cargo test`,
  `flock /tmp/ekiptakip-local-test.lock tools/local_test.sh` yeşil.
- Commit'ler: finance, budget, recurring, templates, admin, llm, llm_usage, quality —
  `refactor/domain-agent3` dalında, push edilmiş.
- README'deki rapor + bıraktığın yönlendirmeler ve `crate::api::…` yolları.

Son temizlik turu (sonra):
- Son temizliğin adımları tamam, commit atılmış.
- Refaktörün tamamı için kısa özet: `api/` ve `domain/` satır sayıları (`wc -l`), kalan
  istisnalar.
