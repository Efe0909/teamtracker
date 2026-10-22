# Agent 2 — etkinlik, LLM bağlamı, OTF, satın alma

Önce `refactor/README.md`'yi oku; kurallar orada. Bu dosya yalnız kapsamı ve özel durumları
söyler. Envanter: `refactor/00-envanter.md` (aşağıdaki dosyaların `===api/…===` bölümleri).

**Paralel çalışıyorsun** (README § Paralel çalışma): dalın `refactor/domain-agent2`,
worktree'n `/home/Efe/Projects/teamtracker-agent2`. agent1 (`common`, `records`, `cards`,
`attachments`, …) ve agent3 (`finance`, `llm`, …) aynı anda çalışıyor. Senin dalında onların
modülleri henüz `api/`'de: domain kodun onları **her zaman** `crate::api::…` ile çağırır
(`crate::api::common::{text, has_scope, tree, …}`, `crate::api::records::{load, log, …}`,
`crate::api::finance::{need, need_viewer, today}`, `crate::api::llm::load`). Birleştirmeden
sonra bu yollar onların yönlendirmeleri üzerinden çalışır; son temizlik çevirir. Onların
dosyalarına dokunma. Aşağıdaki "başka ajanın dosyasını güncelle" maddeleri yerine
yönlendirme geçerli.

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
- **`purchasing.rs`** — `use super::finance::{need, need_viewer, today};` var. Koordinatör
  üçünü `pub(crate)` yaptı; domain'den `crate::api::finance::{need, need_viewer, today}` ile
  çağır. `api/finance.rs`'e dokunma.
- **`purchasing::backfill_vendors`** `main.rs:61`'den çağrılıyor (`api::purchasing::…`):
  `main.rs`'e dokunma, `api/purchasing.rs`'te `backfill_vendors` için yönlendirme bırak.
  Son temizlik `main.rs` yolunu çevirir.
- **LLM bağlamı** `crate::api::llm::load` çağırıyor (agent3'ün) — kural 9: olduğu gibi
  bırak. `crate::llm::…` (kök modül: `run`, `settings`, `contract`) kapsam dışı, aynen kalır.
- **`llm.rs` (agent3'ün)** `events::known_names`, `events::material_sample`,
  `events::try_suggest` kullanıyor: `api/llm.rs`'e dokunma; `api/events.rs`'teki mevcut
  `pub(crate) use context::{…}` satırı bunları zaten dışa veriyor — taşıyınca
  `pub(crate) use crate::domain::events::{known_names, material_sample, try_suggest};`
  yönlendirmesi olarak koru.
- **`otf.rs`** — `events::editable`, `events::require_visible` (bu agent) ve
  `crate::api::records::check_user` (agent1'in; `crate::api::records::check_user` olarak
  bırak). `docx` dosya yanıtı: domain bayt + ad döner.

## Bitti sayılır

- 5 dosyanın her biri için `grep -n sqlx src/api/<dosya>.rs` boş.
- `cargo clippy --all-targets`, `cargo test`,
  `flock /tmp/ekiptakip-local-test.lock tools/local_test.sh` yeşil.
- Commit'ler: events (+context, materials) + purchasing, otf — `refactor/domain-agent2`
  dalında, push edilmiş.
- README'deki rapor; özellikle bıraktığın yönlendirmeleri ve bütün `crate::api::…` yollarını
  listele (son temizlik bunları çevirecek).
