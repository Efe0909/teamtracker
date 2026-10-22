# Agent 2 — etkinlik, LLM bağlamı, OTF, satın alma

Önce `refactor/README.md`'yi oku; kurallar orada. Bu dosya yalnız kapsamı ve özel durumları
söyler. Envanter: `refactor/00-envanter.md` (aşağıdaki dosyaların `===api/…===` bölümleri).

**Senden önce agent1 bitti:** `common`, `records`, `cards`, `attachments`, `notify`, `chats`,
`nodes`, `home`, `teams`, `bank_accounts`, `profile` domain'de. Başlamadan `git log` ile
commit'lerini ve agent1'in raporunu gör. Domain kodun bunları `crate::domain::…` ile çağırır
(`crate::domain::common::{text, has_scope, tree, …}`, `crate::domain::records::{load, log, …}`).

**Senden sonra agent3** maliye ve yönetimi taşıyacak: `api/finance.rs` ve `api/llm.rs` hâlâ
`api/`'de olacak; onlara README kural 9 ile `crate::api::…` yolundan eriş.

## Kapsam (~3.200 satır)

| # | api dosyası | → domain | satır | not |
|---|---|---|---|---|
| 1 | `events.rs` | `events.rs` | 1618 | en büyük; `material_cols!` makrosu, alt modül |
| 2 | `events/context.rs` | `events/context.rs` | 440 | LLM bağlamı (spec/79) |
| 3 | `events/context/materials.rs` | `events/context/materials.rs` | 653 | malzeme önerisi |
| 4 | `purchasing.rs` | `purchasing.rs` | 737 | `events` ile karşılıklı |
| 5 | `otf.rs` | `otf.rs` | 590 | docx dosya yanıtı |

`events` ↔ `purchasing` birbirini çağırıyor (`purchasing::ensure_vendor`, `offer_label` ←
events; `events::material_one` ← purchasing) — **ikisini aynı commit'te** taşı. `events`'in
iki alt modülü de aynı commit'te (re-export zinciri). Sonra `otf`.

## Özel durumlar

- **Alt modül zinciri.** `api/events.rs` içinde `mod context;` ve
  `pub(crate) use context::{known_names, llm_context, llm_restore, material_brief,
  material_sample, material_suggestions, reject_suggestion, try_suggest};`,
  `context.rs` içinde `mod materials;` + re-export var; alt modüller `use super::*;` ile
  üstün importlarını alıyor. Domain'de aynı yapıyı kur: `domain/events.rs`'e `mod context;`,
  `domain/events/context.rs`'e `mod materials;` (dosyalar boş hazır). Handler olan
  re-export'lar (`llm_context`, `llm_restore`, `material_brief`, `material_suggestions`,
  `reject_suggestion`) `api/events.rs`'te ince handler olarak kalır.
- **`material_cols!` makrosu** `events.rs`'te tanımlı, alt modüller kullanıyor:
  `macro_rules!` tanımı `mod context;` satırından ÖNCE kalmalı (sıra önemli).
- **`events.rs` testleri** (`mod material_tests` ve `#[cfg(test)]`) kodla domain'e gider.
- **`purchases_xlsx`** (`-> Result<Response>`): domain bayt + dosya adı döner, başlıkları
  handler kurar.
- **`purchasing.rs`** — `use super::finance::{need, need_viewer, today};` var. `need*`
  `pub(super)`: domain'den erişmek için `api/finance.rs`'te bu üçünü `pub(crate)` yap
  (agent3'ün dosyasında izin verilen tek değişiklik) ve `crate::api::finance::{need,
  need_viewer, today}` ile çağır. agent3 taşıyınca yolu düzeltecek.
- **`purchasing::backfill_vendors`** `main.rs:61`'den çağrılıyor (`api::purchasing::…`):
  `main.rs`'teki yolu `domain::purchasing::backfill_vendors` yap (izin verilen istisna).
  `api/mod.rs`'teki `pub mod purchasing;` görünürlüğü bundan sonra gerekmeyebilir —
  `api/mod.rs`'e DOKUNMA, uyarı çıkarsa rapora yaz.
- **LLM bağlamı** `crate::api::llm::load` çağırıyor (agent3'ün) — kural 9: olduğu gibi
  bırak. `crate::llm::…` (kök modül: `run`, `settings`, `contract`) kapsam dışı, aynen kalır.
- **`llm.rs` (agent3'ün)** `events::known_names`, `events::material_sample`,
  `events::try_suggest` kullanıyor: taşıyınca `api/llm.rs`'teki import yolunu
  `crate::domain::events::…`'e çevir (kural 8).
- **`otf.rs`** — `events::editable`, `events::require_visible` (bu agent) ve
  `crate::api::records::check_user` (agent1 taşıdı; yolu zaten güncellenmiş olmalı, değilse
  düzelt). `docx` dosya yanıtı: domain bayt + ad döner.

## Bitti sayılır

- 5 dosyanın her biri için `grep -n sqlx src/api/<dosya>.rs` boş.
- `cargo clippy --all-targets`, `cargo test`, `tools/local_test.sh` yeşil.
- Commit'ler: events (+context, materials) + purchasing, otf.
- README'deki rapor; özellikle bıraktığın `crate::api::finance::…` ve
  `crate::api::llm::…` yollarını listele (agent3 bunları düzeltecek).
