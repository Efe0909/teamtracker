# Domain katmanı refaktörü — ortak kurallar

Üç ajan **paralel** çalışır (agent1, agent2, agent3 aynı anda), her biri kendi dalında.
Her ajan önce bu dosyayı (özellikle § Paralel çalışma), sonra kendi `agentN.md`'sini, sonra
`00-envanter.md`'de kendi dosyalarının bölümünü okur.

## Paralel çalışma (önce bunu oku)

Ajanlar birbirinin işini beklemez. Çakışmamak için:

1. **Kendi dalın, kendi worktree'n.** `refactor/domain-layer`'dan dallan:

   | ajan | dal | worktree |
   |---|---|---|
   | agent1 | `refactor/domain-agent1` | `/home/Efe/Projects/teamtracker-agent1` |
   | agent2 | `refactor/domain-agent2` | `/home/Efe/Projects/teamtracker-agent2` |
   | agent3 | `refactor/domain-agent3` | `/home/Efe/Projects/teamtracker-agent3` |

   Worktree koordinatör tarafından açıldıysa doğrudan orada çalış (`git worktree list` ile
   doğrula, dalın tabanı `refactor/domain-layer` olmalı). Açılmadıysa:
   `git -C /home/Efe/Projects/teamtracker worktree add <worktree> -b <dal> refactor/domain-layer`.
   Ana `/home/Efe/Projects/teamtracker` dizinine **yazma**. Commit'leri kendi dalına at,
   sonda `git push -u origin <dal>`. `main`'e ya da `refactor/domain-layer`'a merge etme.
2. **Yalnız kendi dosyalarına yaz:** kendi modüllerinin `src/api/<m>.rs` ve
   `src/domain/<m>.rs` dosyaları. Başka ajanın dosyasına, `api/mod.rs`'e, `main.rs`'e ve
   `refactor/` altına dokunma. Ajan dosyalarındaki "şu çağıranı da güncelle" maddeleri
   paralel düzende **geçersiz**: o işi aşağıdaki yönlendirme + son temizlik yapar.
3. **Başka ajanın çağırdığı şeyi taşıyınca yönlendirme bırak.** `00-envanter.md`'de
   `ÇAĞIRAN:` satırında başka ajanın dosyası geçen bir fonksiyonu/tipi taşıdığında, kendi
   `api/<m>.rs`'inde şunu bırak (kural 8'in paralel istisnası):
   ```rust
   // Gecici yonlendirme (paralel refaktor): son temizlik kaldirir.
   pub(crate) use crate::domain::<m>::{fn_a, TypeB};
   ```
   Böylece diğer ajanın dalındaki `crate::api::<m>::fn_a` / `super::<m>::fn_a` çağrıları
   birleştirmeden sonra da derlenir. Kendi dosyaların arasındaki çağıranları ise kural 8 ile
   doğrudan `crate::domain::…`'e çevir. Yönlendirme bir handler'la aynı adı taşıyorsa
   bırakma, rapora yaz.
4. **Başka ajanın modülüne** domain'den her zaman `crate::api::<m>::…` ile eriş (kural 9),
   ortak yardımcılar dahil: `crate::api::common::{text, has_scope, tree, …}`. O ajan taşımış
   olsun olmasın bu yol çalışır (yönlendirme sayesinde). `crate::domain::<başkasının m>`
   yazma — senin dalında o dosya boş.
5. **Görünürlük hazır:** koordinatör `api/mod.rs`'teki modülleri ve `pub(super)` yardımcıları
   (`home::manage_teams`, `finance::{is_viewer, need_viewer, need, today}`) `pub(crate)`
   yaptı. Başka bir şey erişilemez çıkarsa kendi dosyanda değilse dokunma, rapora yaz.
6. **`tools/local_test.sh` sabit port (18099-18102) ve sabit veritabanı kullanır.** Aynı anda
   yalnız biri koşabilir, kilitle çalıştır:
   `flock /tmp/ekiptakip-local-test.lock tools/local_test.sh`.
   `cargo` kendi worktree'nde ayrı `target/` kullanır, çakışmaz.
7. **Son temizlik (agent3.md § Son temizlik) birleştirmeden SONRA** yapılır: üç dal
   `refactor/domain-layer`'a agent1 → agent2 → agent3 sırasıyla birleştirilince, ayrı bir
   istekle. Yönlendirmeleri kaldırmak, `crate::api::` yollarını çevirmek, `api/mod.rs`
   görünürlüğünü geri almak ve `main.rs:61` yolunu düzeltmek o adımdadır.

Rapora ek: **bıraktığın yönlendirmelerin ve `crate::api::` yollarının tam listesi** — son
temizlik bundan yürür.

## Neden

Bugün `backend/src/api/` handler'ları her şeyi kendisi yapıyor: yetki, doğrulama, SQL,
transaction, activity satırı, yanıt (494 `sqlx::query`'nin hepsi `api/`'de). Hedef:
**handler yalnız kenar, iş mantığı `backend/src/domain/`'de.** Sebep: ileride aynı iş
mantığını HTTP dışından (MCP, salt okunur) çağırmak ve `Logged<T>` (spec/87) eklemek.
Bu refaktörde **logger EKLENMEZ** — yalnız taşıma.

## Başlangıç durumu (hazır)

- `backend/src/domain/` ve `api/` ile bire bir boş dosyalar açıldı; `domain/mod.rs` hepsini
  `pub(crate) mod` ile bildiriyor, `main.rs`'te `mod domain;` var. Boş hâliyle derleniyor.
- `domain/events/context.rs` ve `domain/events/context/materials.rs` boş ama henüz
  bildirilmemiş: agent2 `domain/events.rs` içine `mod context;` ekler.
- `api/mod.rs`'teki modüller ve beş `pub(super)` yardımcı geçici olarak `pub(crate)`
  (paralel çalışma için, § Paralel çalışma madde 5).
- Kapsam dışı (dokunma): `api/auth.rs`, `api/meta.rs`, `api/mod.rs` (rota tablosu),
  `realtime.rs`, `audit.rs`, ara katmanlar, `db/`, `models/`, kökteki modüller
  (`crate::finance`, `crate::llm`, `crate::otf`, `crate::mail`…). İzin verilen istisnalar
  ajan dosyalarında tek tek yazılı.

## Hedef biçim

```rust
// api/records.rs — SONRA
pub async fn add_action(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
    Body(b): Body<NewAction>,
) -> Result<Json<Detail>> {
    Ok(Json(domain::records::add_action(&st, &me, common::id(&raw)?, b).await?))
}

// domain/records.rs
pub(crate) async fn add_action(st: &AppState, me: &User, record: Uuid, b: NewAction) -> Result<Detail> {
    // eski handler gövdesi, AYNEN
}
```

## Kurallar

1. **Sözleşme değişmez.** Rota, handler adı ve imzası, JSON giriş/çıkış, hata kodları,
   HTTP durumları aynı kalır. `api/mod.rs`'e dokunulmaz.
2. **Handler gövdesi yalnız:** yol kimliğini `common::id` ile ayrıştır → TEK domain
   fonksiyonu çağır → `Json(..)` sar ya da dosya yanıtını kur. Handler'da `sqlx`, yetki,
   doğrulama, transaction KALMAZ. Kontrol: taşınan dosyada `grep -n sqlx src/api/<dosya>.rs` boş.
3. **Domain fonksiyonu axum tipi almaz/dönmez:** `State`, `Json`, `Path`, `Query`,
   `HeaderMap`, `Response`, `IntoResponse`, `header::*`, `SignedCookieJar` YOK.
   - `HeaderMap` yalnız IP için kullanılıyorsa handler `crate::audit::client_ip(&headers)`
     çağırır, domain'e `ip: Option<std::net::IpAddr>` geçer.
   - Dosya indirme (xlsx, docx, ek, dışa aktarma): domain veriyi döner (bayt + ad + mime
     gibi düz bir struct), başlıkları handler kurar.
   - `Query<T>`'nin `T`'si düz struct'tır, domain'e taşınabilir.
4. **Ad ve sıra:** domain fonksiyonunun adı handler'ınkiyle aynı. Parametre sırası:
   `st: &AppState, me: &User`, yol kimlikleri (`Uuid`), sonra girdi (body/query).
   `me` kullanılmıyorsa alınmaz.
5. **Gövde AYNEN taşınır.** SQL metni, sorgu sırası, hata kodu, yorum (Türkçe) aynı.
   İyileştirme, yeniden adlandırma, birleştirme YOK. Hata gibi görünen bir şey görürsen
   **düzeltme**, sonda rapora yaz.
6. **Tipler:** istek/yanıt struct ve enum'ları (`Deserialize`/`Serialize`) domain'e
   taşınır; görünürlük gerekiyorsa `pub(crate)` (alanlar dahil). Handler bunları import eder.
7. **Yardımcılar** domain'e taşınır. Başka dosyadan çağrılmıyorsa özel kalır; çağrılıyorsa
   `pub(crate)`. (`pub(super)` domain'de anlamını yitirir → `pub(crate)`.)
8. **Çağıranları güncelle.** `00-envanter.md`'de `ÇAĞIRAN:` satırı olan bir fonksiyonu
   taşıdığında, her çağıranın yolunu **aynı commit'te** `crate::domain::…`'e çevir. Yönlendirme
   (re-export) bırakma — tek istisna `api/common.rs` (agent1 §1).
9. **Henüz taşınmamış fonksiyona** domain'den `crate::api::<modül>::<fn>` ile eriş
   (gerekirse orada `pub(crate)` yap). Onu taşıyan sonraki ajan yolu düzeltir. Son kontrol
   agent3'te: `grep -rn "crate::api::" src/domain` boş olmalı.
10. **Testler** (`#[cfg(test)] mod …`) test ettikleri kodla birlikte taşınır.
11. **Yan etkiler** (`tokio::spawn(...)`, `st.hub`, `st.structure` kilidi) olduğu gibi
    domain'e gider.
12. **Yeni soyutlama YOK:** trait, generic katman, servis struct'ı, `Logged` yok. Düz
    `async fn`.
13. **Dosya düzenleme Edit/Write aracıyla.** `sed`/`python` ile dosya yeniden yazma yok.
    Büyük taşıma: domain dosyasını Write ile kur, api dosyasını Edit ile incelt.
14. **Kod dili İngilizce, anlatı Türkçe** (CLAUDE.md): yeni tanımlayıcı İngilizce, yorum
    ve commit mesajı Türkçe.

## Denetim

Başlamadan ÖNCE taban çizgisi (yeşil olmalı; değilse dur ve bildir):

```bash
cd backend && cargo clippy --all-targets && cargo test && tools/local_test.sh
```

`local_test.sh` Docker'da `ekiptakip-db`'nin ayakta olmasını ister (`docker compose up -d`
depo kökünde). `tools/check_api.sh` JSON sözleşmesinin kendisi — refaktörün güvenlik ağı.

Her modülden sonra: `cargo clippy --all-targets` (uyarı = hata) + `cargo test`.
Ajanın sonunda: üçü birden + kural 2'nin `grep`'i her taşınan dosya için.

## Commit

Modül başına bir commit, Türkçe:

```
refactor(domain): records iş mantığı domain/'a taşındı

Handler'lar yalnız kenar; SQL, yetki ve doğrulama domain::records'ta.
Davranış değişikliği yok.
```

## Rapor (ajanın son mesajı)

- Taşınan modüller ve commit'ler.
- İncelemeyen kalan handler (varsa) ve nedeni.
- Gördüğün olası hatalar (dosya:satır), düzeltilmeden.
- Kural 9 ile bıraktığın geçici `crate::api::` yolları.
