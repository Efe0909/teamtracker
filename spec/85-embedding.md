# 85 — Embedding: model türü, vektör deposu, anlamsal arama

**Durum: tasarım** (Efe ile 2026-10-14). Efe: *"model tiplerine bir embedding modeli eklemek
istiyorum; hem vector search hem de semantic graph gibi fikirlerim."* Karar: **OpenAI uyumlu,
OpenRouter üzerinden** bir embedding modeli; vektörler Postgres'te **pgvector**.

Bağlı: `79-llm-yuku.md` §2 (değişmezler) ve §11 (profil/görev/limit/çağrı kaydı),
`84-birlestirme.md` §4 (aday), `86-baglantilar-graf.md` (anlamsal kenar).

---

## 1. Kararlar

| # | Karar | Gerekçe |
|---|---|---|
| E1 | `llm_profiles.endpoint`'e üçüncü tür: **`embeddings`** (`/api/v1/embeddings`, OpenAI biçimi). | spec/79 §11.1: "yeni bir tür, önce kodda yeni bir uç sözleşmesi ister". Profil + görev + limit + çağrı kaydı aynen. |
| E2 | Her embedding çağrısı **`llm::run`**'dan geçer (limit, `llm_calls` satırı, kill switch). Doğrudan `st.http` yok. | Tek çağrı yolu (spec/79 §11.1). |
| E3 | İki görev: **`embed_index`** (içerik dizinleme) ve **`embed_query`** (arama sorgusu). İkisi **aynı profili** kullanmak zorunda (`llm_profile_mismatch` genişler): farklı modelin vektörleri karşılaştırılamaz. | Kosinüs yalnız aynı uzayda anlamlı. |
| E4 | Vektör, **modeli ve boyutuyla** saklanır; arama yalnız etkin profilin modeline eşit satırları karşılaştırır. Model değişince eski vektörler yok sayılır, arka planda yeniden dizinlenir. | Model değişimi sessizce yanlış sonuç vermesin. |
| E5 | **pgvector yoksa özellik kapalı, açılış durmaz.** Eklenti ve tablo **göçle değil, açılışta** (`semantic::ensure`) kurulur; başarısızsa `meta.semantic = false`. | Göç dosyası bir kez koşar ve donar (CLAUDE.md); eklentisiz kurulumda koşup "uygulandı" sayılırsa eklenti sonradan gelse tablo hiç doğmaz. |
| E6 | **spec/79 değişmezleri embedding için de geçerli.** Giden her metin temizleyiciden geçer; serbest metin (başlık, açıklama) yalnız **`embed_free_text`** anahtarı açıkken gider, **varsayılan kapalı**. Tedarikçi, sponsor ve kişi adları **hiçbir koşulda** gitmez. | Değişmez 2, 4, 5. Embedding "yalnız sayıya çevirmek" değil: metin sağlayıcıya gider. |
| E7 | Boyut **512** (`dimensions` parametresi, model destekliyorsa). Arama ilk sürümde **tam tarama**; HNSW indeksi satır sayısı 20 000'i geçince. | Pi bellek bütçesi: 10 000 × 512 × 4 B ≈ 20 MB. |

> **E6 Efe onayı bekler.** Anahtar kapalıyken dizinlenebilecek metin çok az (düğüm adı,
> kategori adı, malzeme adı, kazanım adı/açıklaması — bugün de "her zaman giden kısa
> etiketler"). Kayıt ve etkinlik araması için anahtarın açılması gerekir; bu, kulüp içeriğinin
> sağlayıcıya gitmesi demek (temizlenmiş olarak).

## 2. Sözleşme (`openrouter.rs`, `llm.rs`)

İstek:
```json
{ "model": "openai/text-embedding-3-small", "input": ["…", "…"], "dimensions": 512, "encoding_format": "float" }
```
Cevap: `data[i].embedding` (float dizisi, `index` sırasıyla), `usage.prompt_tokens`,
(varsa) `usage.cost`.

- `Endpoint::Embeddings`, anahtar `"embeddings"`, etiket "Embedding".
- `Params` (bu tür için): `dimensions` (64..3072, isteğe bağlı), `provider` (spec/79'daki
  sağlayıcı seçimi, aynı doğrulama). `temperature`, `max_tokens` vb. **reddedilir**
  (`llm_params_invalid`).
- Parti: tek çağrıda en fazla 64 girdi, girdi başına 2 000 karakter (fazlası kırpılır).
- `llm_calls`: `prompt_tokens`, `cost_usd`; `completion_tokens` boş; `asked` = girdi sayısı,
  `kept` = dönen vektör sayısı.
- **Dene:** sözleşmenin örnek girdisi ("Kahve zinciri etkinliği için bardak") gönderilir;
  cevapta boyut, ilk 8 değer, süre, maliyet. Model listesinde (spec/79 §11.4) embedding
  modelleri `architecture.output_modalities` / adla süzülür; emin olunamıyorsa liste değil,
  Dene kanıtlar.
- Manifest tohumu: `embed_model` (ör. `openai/text-embedding-3-small`); yoksa profil
  oluşturulmaz ve görevler kapalı başlar.
- `llm_profiles.endpoint` kontrolü göç 031'de `('chat','decisions','embeddings')` olur
  (bu yalnız kontrol değişikliği; eklentiden bağımsız, göçte kalabilir).

## 3. Depo (`semantic::ensure`, açılışta)

```sql
create extension if not exists vector;
create table if not exists embeddings (
  subject_kind text not null check (subject_kind in ('record','event','node','material')),
  subject_id   uuid not null,
  model        text not null,
  dims         int  not null,
  content_hash text not null,           -- gönderilen (temizlenmiş) metnin sha256'sı
  embedding    vector not null,
  created_at   timestamptz not null default now(),
  primary key (subject_kind, subject_id, model)
);
```

- **Çok biçimli konu** (`subject_kind` + `subject_id`, FK yok): tablo türetilmiş önbellektir,
  kaybı veri kaybı değil. Yetim satırlar günlük süpürmede silinir (konusu yoksa). KNOW-276'daki
  "polimorfik düştü" kararı kaynak veri içindi; burada bilinçli istisna.
- `vector` boyutsuz; boyut `dims` sütununda. HNSW indeksi (E7) gelince ifade indeksi:
  `((embedding::vector(512)))` `where model = '…' and dims = 512`.
- Yerel geliştirme: `docker-compose.yml` imajı `pgvector/pgvector:pg16`. Yayın: `~/nix`
  `services.postgresql.extensions = ps: [ ps.pgvector ];`. İkisi yapılmadan kod çalışır,
  özellik kapalı görünür.

## 4. Dizinleme

**Ne dizinlenir** (her biri temizleyiciden geçen metin; E6):

| Konu | Anahtar kapalı | Anahtar açık |
|---|---|---|
| `node` (Birimler, kategoriler, kazanımlar) | ad + açıklama (kısa etiket sayılır) | aynı |
| `material` | ad + tür | + not |
| `record` | — | başlık + açıklama |
| `event` | tür adı | + başlık + açıklama |

Tedarikçi **dizinlenmez** (değişmez 2). Sohbet mesajları dizinlenmez (kişisel yazışma).

**Ne zaman:** yazmada kuyruğa değil, **eskime denetimi**: arka plan döngüsü (her 60 sn;
`media::sweep`'in döngü kalıbı) konuları tarar, `content_hash` farklı ya da yok olanları
64'lük partilerle `embed_index` görevine verir. Görev kapalı, servis kapalı ya da limit dolu
ise sessizce bekler (log satırı, kayıt yok). Böylece:
- yazma isteği gecikmez,
- model değişince (E4) aynı döngü her şeyi yeniden dizinler,
- başarısız parti sonraki turda tekrar dener (aynı partiyi tekrar tekrar göndermemek için
  `last_failed_at` belleği: 10 dk geri çekilme).

Gizli kayıt (`is_restricted`) dizinlenir ama arama sonucu **görme izniyle süzülür** (§5).

## 5. Arama

`GET /api/search/semantic?q=&kinds=record,event,node&limit=20`:
1. `q` temizlenir; `embed_query` ile vektör (sorgu metni ve vektörü saklanmaz; `llm_calls`
   satırı yazılır).
2. `select … order by embedding <=> $q limit 100` (aynı model), sonra **görme izni süzgeci**
   (kayıt: spec/75; etkinlik: ikiz kaydın izni).
3. **Karma sıralama:** mevcut tam metin (`search_vector`, tsvector) sonuçlarıyla Reciprocal
   Rank Fusion (`1/(60+r1) + 1/(60+r2)`). Anlamsal servis kapalıysa yalnız tam metin döner
   (`semantic: false` bayrağıyla).

Ön yüz: komut paleti (`Palette.tsx`) ve mobil `/search` aynı uca geçer; servis açıksa sonuçlarda
"anlamca yakın" rozeti.

## 6. Diğer kullanımlar

- **Birleştirme adayı** (spec/84 §4): yalnız dizinlenen konularda (tedarikçi değil → bugün
  tedarikçi adayları trigram'dan). Malzeme adı gruplaması için analizde kullanılabilir.
- **Anlamsal kenar** (spec/86 §5): her konu için en yakın k = 5 komşu, kosinüs ≥ 0.80; graf
  isteğinde hesaplanır, saklanmaz.

## 7. Yönetim

Yönetim › Veri işleme ve LLM:
- Profil türü seçicisine "Embedding".
- Görevler listesinde `embed_index`, `embed_query` (aynı profil zorunluluğu görev sayfasında
  açıklanır).
- **Dizin durumu kartı**: konu türü başına dizinli / eskimiş / toplam, etkin model ve boyut,
  pgvector var mı, son hata.
- `embed_free_text` anahtarı temizleme kurallarının yanında (`llm_config`), admin; değişiklik
  `security_events` (`llm_config_changed`).

## 8. Sınama
- Rust: `Params` doğrulaması (embedding'de `temperature` reddi), cevap çözücü (sıra `index`'e
  göre), aynı profil kuralı.
- `tools/openrouter_stub.py`'ye `/api/v1/embeddings` (deterministik: metnin sha256'sından
  vektör) → `local_test.sh` dizinleme + arama + izin süzgeci uçtan uca, gerçek anahtarsız.
- pgvector yokken açılış: `meta.semantic = false`, arama tam metne düşer.

## 9. Açık sorular
1. **E6**: `embed_free_text` açılacak mı? Açılmazsa anlamsal arama kayıtları kapsamaz.
2. Model: `openai/text-embedding-3-small` (512 boyut) önerisi; çok dilli (Türkçe) kalite için
   `intfloat/multilingual-e5-large` gibi bir alternatif OpenRouter'da varsa Dene ile karşılaştır.
