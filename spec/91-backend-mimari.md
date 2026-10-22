# 91 — Backend mimarisi: crate'ler, modüller, akışlar

Durum: **rehber** (2026-10-21). Kapsam: `backend/` (Rust, yalnız `/api/*`, JSON).
Her diyagram kaynak koddan çıkarıldı; bir şey değişirse önce kodu oku, sonra bu
dosyayı güncelle. Dosya yolları `backend/src/` altındadır, aksi yazılmadıkça.

Önce okunacaklar: `spec/15-sinirlar.md` (Rust ile ön yüzün sınırı),
`spec/70-guvenlik.md` (kimlik, CSRF, yetki), `spec/77-gercek-zamanli.md` (soket),
`spec/75-yetki.md` (yetki katmanları), `backend/README.md` (modül haritası).

---

## 1. Bir bakışta: crate ve dış dünya

Tek bir Rust crate'i (`ekiptakip`, sürüm `0.10.4`) var. İçinde workspace yok.
Süreç tek ve bilerek tek: agaç indeksi ve gerçek zamanlı hub süreç belleğinde
(KNOW-85). Tarayıcı, nginx üzerinden aynı kökenden konuşur; Rust yalnız
`127.0.0.1` dinler.

```mermaid
flowchart LR
    Browser["Tarayıcı<br/>(React, frontend/)"]
    Nginx["nginx<br/>statik dosya + /api/ vekili"]

    subgraph Rust["ekiptakip (tek süreç, axum)"]
        Api["api/<br/>rotalar ve handler'lar"]
        Mid["Ara katmanlar<br/>audit · csrf · realtime"]
        Domain["Alan katmanı<br/>db/ · decision · finance · media · otf · refdata · push · mail"]
        State["AppState<br/>havuz · ağaç · hub · kilitler"]
    end

    PG[("PostgreSQL<br/>sqlx, ham SQL")]
    FS[("Dosya sistemi<br/>media_root (ekler)")]
    Google["Google OAuth"]
    OR["OpenRouter<br/>LLM"]
    Resend["Resend<br/>e-posta"]
    Push["Web Push<br/>(tarayıcı push servisi)"]

    Browser -->|"HTTPS"| Nginx
    Nginx -->|"/api/"| Mid
    Mid --> Api
    Api --> Domain
    Api --> State
    Domain --> PG
    Domain --> FS
    Api -->|"reqwest"| Google
    Domain -->|"llm::run"| OR
    Domain -->|"mail_outbox → run_outbox"| Resend
    Domain -->|"webpush.rs"| Push
```

Bağımlılıklar (`backend/Cargo.toml` ve `backend/README.md`):

| crate | işi | nerede kullanılır |
|---|---|---|
| `axum`, `tokio` | HTTP, asenkron çalışma zamanı | `main.rs`, `api/`, `realtime.rs` |
| `sqlx` | Ham SQL, ORM yok (KNOW-178); göçler ikiliye gömülü | `db/`, `api/`, `migrations/` |
| `axum-extra` (`cookie-signed`) | İmzalı oturum çerezi | `auth.rs` |
| `reqwest` | Google OAuth, OpenRouter, Resend | `api/auth.rs`, `openrouter.rs`, `mail.rs` |
| `serde`, `serde_json` | JSON, `manifest.json` | her yerde |
| `image` | Ek yeniden kodlama (EXIF düşer) | `media.rs` |
| `zip` (yalnız deflate) | OTF `.docx` doldurma, Excel çıktısı | `otf.rs`, `xlsx.rs`, `purchases_xlsx.rs` |
| `p256`, `hkdf`, `aes-gcm` | Web Push şifreleme (RFC 8291/8292), elle | `webpush.rs` |
| `chrono`, `uuid`, `base64`, `sha2`, `time` | Zaman, kimlik, kodlama, özet | her yerde |
| `tower-http` (`trace`) | İstek günlüğü | `main.rs` |
| `tracing` | Günlük | her yerde |

Sıkılık: `Cargo.toml` `[lints]` bölümü `todo!`, `unimplemented!`, `unwrap`,
`expect`, `panic!` ve `unsafe` kullanımını derlemeyi düşürecek şekilde yasaklar
(testlerde serbest). Kontrol: `cargo clippy --all-targets`.

---

## 2. Modül haritası: hangi dosya ne yapar

Dosyalar üç katmana ayrılır. Üst katman alt katmanı çağırır, tersi olmaz:

```mermaid
flowchart TB
    subgraph Giris["Giriş ve yapılandırma"]
        main["main.rs<br/>açılış sırası, ara katman sırası"]
        config["config.rs<br/>ortam + manifest (tek yer)"]
        manifest["manifest.json<br/>sır olmayan ayarlar"]
        bootstrap["bootstrap.rs<br/>ilk yönetici listesi"]
    end

    subgraph HTTP["HTTP katmanı: api/"]
        apimod["api/mod.rs<br/>router, /api/me"]
        records["records · cards · chats"]
        events["events · events/context"]
        finance["finance · budget · purchasing<br/>recurring · templates · bank_accounts"]
        nodes["nodes · teams · otf"]
        llmapi["llm · llm_usage · quality"]
        admin["admin · notify · profile · home<br/>meta · attachments · auth"]
    end

    subgraph Ara["Ara katmanlar (her istekte)"]
        audit["audit.rs<br/>403 denetimi"]
        csrf["csrf.rs<br/>X-CSRF-Token kapısı"]
        realtime["realtime.rs<br/>başarılı yazma → olay"]
        auth["auth.rs<br/>CurrentUser: 'kim?'"]
        rate["ratelimit.rs<br/>giriş: IP başına 10/dk"]
    end

    subgraph Alan["Alan katmanı"]
        dbmod["db/<br/>tree · scope · filters · feed · search · nodes · pool"]
        decision["decision.rs<br/>bilgi yoğunluğu kapısı"]
        llm["llm.rs<br/>üretken AI'nin TEK yolu"]
        openrouter["openrouter.rs<br/>HTTP alt düzeyi"]
        media["media.rs<br/>magic byte, yeniden kodlama"]
        fin["finance.rs · otf.rs · refdata.rs<br/>xlsx.rs · purchases_xlsx.rs"]
        push["push.rs · channel.rs · webpush.rs<br/>notify kararı ve teslimat"]
        mail["mail.rs<br/>kuyruk + Resend"]
        mentions["mentions.rs · redact.rs<br/>normalize.rs"]
    end

    subgraph Durum["Süreç durumu"]
        state["state.rs<br/>AppState"]
        models["models/<br/>satır ve enum türleri"]
    end

    main --> config
    main --> bootstrap
    main --> apimod
    apimod --> admin
    apimod --> records
    apimod --> events
    apimod --> finance
    apimod --> nodes
    apimod --> llmapi
    records --> auth
    records --> dbmod
    records --> decision
    events --> dbmod
    finance --> fin
    llmapi --> llm
    llm --> openrouter
    decision --> llm
    admin --> mail
    notifyPath["api/notify.rs"] --> push
    push --> channel["channel.rs"]
    channel --> webpush
    channel --> mail
    state --> dbmod
    dbmod --> models
```

Dosya tablosu (kısa): her satır, bir işi aradığında açılacak ilk dosya.

| Ne arıyorsun | Açılacak dosya |
|---|---|
| Yeni bir uç (route) ekleme | `api/mod.rs` (router) + ilgili `api/*.rs` |
| "Bu kullanıcı şunu yapabilir mi?" | `auth.rs` (kim) + `db/scope.rs` (ne yapabilir, nerede) |
| Kayıt / eylem / kart kuralları | `api/records.rs`, `api/cards.rs` |
| Etkinlik kuralları | `api/events.rs`, `api/events/context.rs` |
| Ağaç (birim, takım, etkinlik türü) | `db/tree.rs`, `api/nodes.rs`, `refdata.rs` |
| Gerçek zamanlı olay | `realtime.rs` |
| AI çağrısı, limit, kayıt | `llm.rs` (yol), `openrouter.rs` (HTTP), `api/llm.rs` (yönetim) |
| Bildirim (kim, ne zaman, hangi kanal) | `push.rs` (karar), `channel.rs` (protokol), `api/notify.rs` |
| Ek yükleme | `media.rs`, `api/attachments.rs` |
| Maliye hesapları | `finance.rs` (saf kurallar), `api/finance.rs` (uçlar) |
| Yeni veritabanı tablosu | `migrations/NNN_*.sql` (sıradaki numara) |

---

## 3. Açılış sırası

Her açılışta `main.rs` şu sırayla çalışır. Sıra önemli: göçler, varsayılan LLM
satırları ve ağaç indeksi, istekler başlamadan hazır olmalı.

```mermaid
flowchart TD
    A["Config::from_env()<br/>ortam + manifest"] --> B["db::pool::connect"]
    B --> C["db::migrate<br/>migrations/ gömülü, kendiliğinden"]
    C --> D["llm::ensure_defaults<br/>profil + görev satırları"]
    D --> E["purchasing::backfill_vendors"]
    E --> F{"ilk yönetici dosyası var mı?"}
    F -- evet --> G["bootstrap::admins<br/>idempotent"]
    F -- hayır --> H
    G --> H["media::sync_volume"]
    H --> I["Günlük süpürme görevi<br/>media::sweep · llm::sweep"]
    I --> J["AppState::new<br/>ağaç kurulur (tek sorgu),<br/>vapid · mailer · kalite kapısı"]
    J --> K{"Resend anahtarı var mı?"}
    K -- evet --> L["mail::run_outbox<br/>kuyruk tüketicisi"]
    K -- hayır --> M
    L --> M["api::router + ara katmanlar"]
    M --> N["axum::serve 127.0.0.1"]
```

`--workers 1` kuralı ve neden: ağaç indeksi (`TreeIndex`) ve hub süreç
belleğindedir. İkinci süreç ayrı bir ağaç tutar ve olayları görmez.

---

## 4. AppState: istekler arasında paylaşılan şey

`state.rs` her handler'a `State<AppState>` olarak gelir. Klon ucuzdur: her
alan `Arc` veya havuz tutucusudur.

```mermaid
flowchart LR
    AS["AppState<br/>(state.rs)"]
    AS --> pool["pool: PgPool<br/>veritabanı havuzu"]
    AS --> cfg["cfg: Arc Config<br/>ortam + manifest"]
    AS --> tree["tree: Arc RwLock TreeIndex<br/>okuma sık, yazma nadir"]
    AS --> key["key: cookie Key<br/>çerez imzası"]
    AS --> http["http: reqwest::Client<br/>10 sn zaman aşımı"]
    AS --> lim["login_limit: RateLimit"]
    AS --> pres["presence: Mutex HashMap<br/>son görülme yazma anı"]
    AS --> struct_["structure: tokio Mutex<br/>yapı yazmaları sırayla"]
    AS --> pend["pending_requests<br/>dakikalık kullanım sayacı"]
    AS --> vap["vapid: Option<br/>yoksa push kapalı"]
    AS --> mail_["mailer: Option<br/>yoksa kuyruğa yazılır"]
    AS --> qual["quality: RwLock QualityConfig"]
    AS --> hub["hub: Arc Hub<br/>WebSocket konuları"]
    AS --> llmc["llm_cache: OpenRouter<br/>model ve kullanım önbelleği"]
```

Kilit kuralları (kodda yorumlu):

- `tree` için `std::sync::RwLock`: kilit `.await` üzerinden taşınamaz, bu bilerek
  derleme zamanında engellenir.
- `structure` için `tokio::sync::Mutex`: yapı yazmaları (düğüm ekle/taşı/sil)
  sırayla çalışır; iki eşzamanlı taşıma eski ağaca bakıp döngü kurmasın diye.
- Ağaç her yapısal yazmadan sonra **tamamen** yeniden kurulur (`rebuild_tree`),
  kısmi güncelleme yoktur (KNOW-179).

---

## 5. İstek zinciri: bir HTTP isteği içeriden nasıl geçer

`main.rs` katmanları axum'da **son eklenen en dışta** çalışacak şekilde ekler.
Gelen istek, aşağıdan yukarıya değil yukarıdan aşağıya girer:

```mermaid
flowchart TD
    REQ["Gelen istek<br/>nginx → 127.0.0.1:8000"] --> TR["TraceLayer<br/>istek günlüğü"]
    TR --> AU["audit::forbidden<br/>403 yanıtlarını security_events'e yazar"]
    AU --> CS["csrf::gate<br/>değiştiren istekte X-CSRF-Token = çerez"]
    CS --> RT["realtime::publish_writes<br/>yalnız başarılı yazmalar için olay"]
    RT --> RO["api::router<br/>yol eşleşmesi"]
    RO -->|"bilinmeyen yol"| NF["JSON 404"]
    RO --> EX["Extractor'lar<br/>CurrentUser · SignedCookieJar · Json"]
    EX -->|"oturum yok"| UN["401"]
    EX --> H["Handler<br/>api/*.rs"]
    H --> DB["db/ + sqlx<br/>ham SQL, parametreli"]
    H --> RESP["JSON yanıt"]
    RESP -. "2xx ise" .-> RT
```

Önemli sonuçlar:

- CSRF reddi (403) ve yetki reddi, handler'a hiç ulaşmaz. Olay da üretmez: olay
  katmanı CSRF'in **içinde**.
- Denetim (`audit`) CSRF'in **dışında**: kapının reddi de kayda girer.
- Yeni bir uç `AppError::Forbidden` döndürdüğünde denetime kendiliğinden girer.
- Handler panik etmez: `unwrap` ve `expect` derleyiciyle yasak.

---

## 6. Oturum ve giriş

Kimlik tek yerde çözülür: `auth.rs` içindeki `CurrentUser` extractor'ı. Her
istekte kullanıcı **veritabanından** okunur. Çerezde rol veya kapsam yoktur;
böylece bir kullanıcının kapatılması bir sonraki istekte etkili olur (KNOW-97).

### 6.1 Google ile giriş

```mermaid
sequenceDiagram
    autonumber
    participant B as Tarayıcı
    participant R as Rust (api/auth.rs)
    participant G as Google
    participant DB as PostgreSQL

    B->>R: GET /api/auth/google?next=app|dashboard
    R->>R: state üret, imzalı oturumda tut
    R-->>B: 302 → Google
    B->>G: giriş ve onay
    G-->>B: 302 → /api/auth/callback?code&state
    B->>R: GET /api/auth/callback
    R->>R: state karşılaştır (CSRF'in OAuth ayağı)
    R->>G: kod ↔ token (reqwest)
    R->>R: id_token doğrula (imza, iss, aud, exp)
    R->>DB: users: google_sub veya e-posta ile ara
    alt davetli değil veya is_active = false
        R->>DB: security_events: ret
        R-->>B: giriş reddedildi
    else davetli
        R->>DB: google_sub, email, last_login_at güncelle
        R-->>B: imzalı oturum çerezi, CSRF token'ı + 302 seçilen yüze
    end
```

Notlar:

- Davetli listesi `users` tablosudur. Listede olmayan e-posta giremez.
- Giriş uçları IP başına dakikada 10 istekle sınırlıdır (`login_limit`).
- Yerelde `EKIPTAKIP_AUTH=sahte` ile Google atlanır (`/api/auth/dev-login`);
  yayında bu yol reddedilir.

### 6.2 Her istekte "kim?"

```mermaid
flowchart LR
    C["Çerez: uid.csrf<br/>imzalı"] --> V{"İmza geçerli mi?"}
    V -- hayır --> A1["oturum yok"]
    V -- evet --> U["users satırı<br/>(her istekte DB)"]
    U --> ACT{"is_active?"}
    ACT -- hayır --> A1
    ACT -- evet --> CU["CurrentUser"]
    CU --> PRES["touch_presence<br/>istek sayacı bellekte; dakikada bir user_activity"]
```

---

## 7. Yetki: dört katman

Yetki sorusu üç parçaya ayrılır: **ne yapabilirsin**, **nerede**, **bu kayıt
senin mi**. `spec/75-yetki.md` ayrıntıyı verir; burada yalnız akış.

```mermaid
flowchart TD
    Q["İşlem: kayıt düzenle, düğüm ekle, ..."] --> S{"users.is_admin?"}
    S -- evet --> OK["izin ver"]
    S -- hayır --> Y["1. Yetenek<br/>user_scopes ∪ role_scopes<br/>(db/scope.rs active)"]
    Y -->|"yetenek yok"| NO["403 + security_events"]
    Y -->|"var"| D["2. Dal<br/>user_node_scopes<br/>TreeIndex.is_descendant O(1)"]
    D -->|"dal dışı"| R["3. İlişki<br/>sahip · açan · katılımcı · takım üyesi"]
    D -->|"dal içi"| OK
    R -->|"ilişki yok"| NO
    R -->|"var"| OK
```

Yetenek ile ilişki bilerek ayrıdır (KNOW-64): "kapsamın var ve o dalda
düzenlersin" ile "bu kayıt senin" farklı sorulardır. Admin, `scopes`
tablosundaki her yeteneğe sahip sayılır; bu kontrol tek yerde yapılır.

---

## 8. Yazma akışı ve gerçek zamanlı kanal

Bir değişikliğin hayatı: veritabanına yazılır, başarılı yanıt sonrası hub'a
"bu kimlik değişti" denir, tarayıcı veriyi yeniden REST'ten çeker.
**Olay veri taşımaz.**

```mermaid
sequenceDiagram
    autonumber
    participant F as Ön yüz (React)
    participant M as Ara katman (realtime)
    participant H as Handler (api/*.rs)
    participant DB as PostgreSQL
    participant Hub as Hub (realtime.rs)
    participant W as WebSocket (/api/ws)
    participant Q as Önbellek (TanStack Query)

    F->>M: PATCH /api/records/{id}  (X-CSRF-Token)
    M->>M: csrf::gate geçti
    M->>M: hedef çıkar: Record(id), record_of_card gibi
    M->>H: istek
    H->>DB: transaction, satır kilidi (for update)
    DB-->>H: commit
    H-->>M: 200 + güncel kayıt
    M->>Hub: publish Record(id) → Event Record
    M->>Hub: publish All → Event Lists
    Hub-->>W: yalnız o konuya abone bağlantılar
    W-->>F: {"t":"record","id"}
    F->>Q: invalidate, REST GET ile tazele
```

Hub'ın kuralları:

- Olay üç çeşittir: `Record { id }`, `Chat { id }`, `Lists` (kimliksiz, herkese).
- Konular: `All` (herkes otomatik), `Record(id)`, `Chat(id)`. İstemci yalnız
  `record:<uuid>` ve `chat:<uuid>` isteyebilir.
- Sohbet konusu, akış ucuyla **aynı** yetki kuralını kullanır
  (`chats::authorize_read`, gizli kayıt).
- Bağlantı başına 64 konu sınırı; istemci kuyruğu dolarsa bağlantı düşürülür.
  İstemci yeniden bağlanıp her şeyi tazeler (tekrar oynatma tamponu yok).
- Sunucu 25 sn'de bir ping atar; 75 sn çerçeve gelmezse kapatır.
- Çok süreç gerekirse hedef Postgres `LISTEN/NOTIFY`'dır. Konu ve olay biçimi
  değişmez (KNOW-85).

Ara katmanın hangi yazmayı nasıl sınıflandırdığı `realtime::target` içindedir.
Yeni bir yazma ucu `/api/records/{id}/…`, `/api/cards/{id}`,
`/api/actions/{id}`, `/api/chats/{id}/messages` altındaysa kendiliğinden
kapsanır. Başka bir yola konursa `target()` ve birim testi güncellenmelidir.

---

## 9. Bellekteki ağaç indeksi

Ağaç (birimler, takımlar, etkinlik türleri, kazanım ağaçları) veritabanında
`nodes.parent_id` ile tutulur. Yetki kontrolü her istekte SQL'e gitmesin diye
belleğe tam kopya alınır.

```mermaid
flowchart LR
    T[("nodes<br/>parent_id, shape, key, attrs")] -->|"açılışta 1 sorgu"| L["load_tree"]
    L --> TI["TreeIndex<br/>Euler turu: is_descendant O(1)"]
    TI --> RW["Arc RwLock TreeIndex"]
    RW -->|"okuma: yetki kontrolü"| SC["db/scope.rs"]
    W["Yapı yazması<br/>(api/nodes.rs)"] --> SM["structure Mutex<br/>sıra"]
    SM --> T
    SM -->|"yazmadan sonra"| RB["rebuild_tree<br/>TAM yeniden kurulum"]
    RB --> RW
```

Ağacın kökleri (`key` dolu) `refdata.rs` içindeki şemaya göre davranır: hangi
tür nereye girer, şekil (`leaf`, `list`, `tree`) ve öznitelikler. Kod kökü
adıyla değil `key` ile bulur.

Etkinlik ve kayıtlar için ayrı bir ağaç yoktur; ağaç yalnız yapıyı taşır.

---

## 10. LLM çağrısı: tek yol

Her üretken yapay zeka çağrısı `llm::run`'dan geçer. Doğrudan HTTP çağrısı
yasaktır. Bu kural `spec/79-llm-yuku.md` §11 içindedir.

```mermaid
flowchart TD
    CALL["Çağıran<br/>decision::gate · events/context/materials.rs"] --> RUN["llm::run"]
    RUN --> SV{"service_on?<br/>yönetimde açık ve manifest'te açık"}
    SV -- hayır --> OFF["Fail::Off<br/>kayıt yok, ücret yok"]
    SV -- evet --> EN{"görev etkin mi?<br/>(deneme hariç)"}
    EN -- hayır --> DIS["Fail::Disabled"]
    EN -- evet --> LIM{"over_limit<br/>profil harcama tavanı"}
    LIM -- "aşıldı" --> LM["Fail::Limit<br/>kayıt yazılır, kapı GEÇER"]
    LIM -- "okunamadı" --> FAIL["Fail::Failed<br/>harcamaya izin yok"]
    LIM -- "altında" --> POST["openrouter::post<br/>zaman aşımı"]
    POST --> TR["trace: durum, süre,<br/>token, maliyet"]
    TR --> REC[("llm_calls<br/>her çağrı, ücret dahil")]
    TR --> BODY{"gövde saklama açık mı?"}
    BODY -- evet --> BD[("llm_call_bodies<br/>BODY_TTL_DAYS kadar")]
    TR --> PARSE["parse → Result"]
```

Sahiplik:

- `llm.rs`: sözleşme (görev adı, uç türü, şema), profil birleşimi, limit, kayıt.
- `openrouter.rs`: yalnız HTTP. Anahtar yalnız `Authorization` başlığına gider;
  istem ve yanıt gövdesi loglanmaz.
- `decision.rs`: bilgi yoğunluğu kapısı. Servis kapalıysa sessizce geçer; uzunluk
  kuralı yine API'de çalışır.
- `api/llm.rs`, `api/llm_usage.rs`: yönetim paneli uçları.

Görev → profil ilişkisi: bir görev (`llm_tasks`) bir profile (`llm_profiles`:
model, parametre, dolar limiti) bağlanır. Kod model adı bilmez.

---

## 11. Bildirim: karar, kanal, teslimat

Bildirim iki ayrı soruyu ayırır. **Kime, ne zaman, hangi kademe?** `push::decide`
tek kapıdır; **nasıl teslim?** `channel.rs` protokolüdür.

```mermaid
flowchart TD
    EV["Yeni mesaj veya olay<br/>api/notify.rs"] --> DEC["push::decide<br/>seviye: all · mentions · none<br/>sohbet tercihi · bahsedilme · sessiz saat"]
    DEC --> INAPP["in_app: uygulama içi liste<br/>sessiz saat bunu KESMEZ"]
    DEC --> PUSHQ{"push?"}
    PUSHQ -- hayır --> END1["bitti"]
    PUSHQ -- evet --> MSG["channel::Message<br/>title · body · url · tag"]
    MSG --> SEND{"kanal"}
    SEND -- Push --> WP["webpush.rs<br/>RFC 8291 + 8292<br/>VAPID"]
    SEND -- Email --> ML["mail.rs<br/>mail_outbox satırı"]
    WP --> OUT{"Outcome"}
    OUT -- "404/410" --> DEL["abonelik sil"]
    OUT -- "Sent" --> OK["bitti"]
    ML --> RUN["run_outbox<br/>sent_at boşsa gönder"]
    RUN --> RES["Resend API"]
    RES --> OUT2["sent_at ya da error + attempts"]
```

Önemli: e-posta kuyruğu bir **tablodur** (`mail_outbox`). Gönderici bağlı
değilse satırlar birikir; bağlanınca tüketilir. Davet postası da bu kuyruktan
gider (`api/admin.rs` → `mail::enqueue`).

Web Push, `vapid` anahtarı yoksa kapalıdır; uygulama içi liste yine çalışır.

---

## 12. Kayıt, eylem, etkinlik: hangi tablo ne taşır

Kayıt (`records`) bir iştir; eylemler (`actions`) ona bağlı alt işlerdir.
Etkinlik (`events`) planlama nesnesidir ve her etkinliğin bir **ikiz kaydı**
(`events.record_id`) vardır: sohbet, arşiv ve eylemler oradadır.

```mermaid
flowchart LR
    subgraph Kayit["Kayıt ve sohbet"]
        R[("records<br/>kind: issue · task<br/>status · priority")]
        RP[("record_participants")]
        RJ[("record_join_requests")]
        RPIN[("record_pins · card_order")]
        CARD[("cards<br/>kart blob'u, katılım")]
        CA[("card_attachments")]
        ACT[("actions<br/>status: open · in_progress<br/>closed · cancelled")]
        AA[("action_assignees")]
        CH[("chats")]
        MSG[("messages · message_attachments")]
        FEED["chat_feed (view)<br/>mesaj + sistem olayı"]
        R --> RP
        R --> RJ
        R --> RPIN
        R --> CARD
        CARD --> CA
        R --> ACT
        ACT --> AA
        R --> CH
        CH --> MSG
        CH --> FEED
        MSG --> FEED
    end

    subgraph Etk["Etkinlik"]
        E[("events<br/>status: idea · planning<br/>confirmed · done · cancelled")]
        EP[("event_participants")]
        ET[("event_teams")]
        EC[("event_checkpoints<br/>+ _requests")]
        EW[("event_widgets<br/>supplies · record · otf")]
        EM[("event_materials")]
        EO[("event_otf + items<br/>contacts · outcomes")]
        E --> EP
        E --> ET
        E --> EC
        E --> EW
        E --> EM
        E --> EO
    end

    E -. "ikiz kayıt (record_id)" .-> R
```

Durum kümeleri (kodda, `models/enums.rs`):

- Kayıt: `open`, `in_progress`, `pending`, `closed`, `cancelled`.
  Eylemde `pending` yoktur; iki enum bilerek ayrı tutulur.
- Eylem: `open`, `in_progress`, `closed`, `cancelled`.
- Etkinlik: `idea`, `planning`, `confirmed`, `done`, `cancelled`.

Bu diyagram yalnız değer kümelerini gösterir. Hangi durumdan hangi duruma
geçildiği `api/records.rs` ve `api/events.rs` içindedir; bu dosyalar geçişleri
kendileri doğrular, rehber bunları tekrar etmez.

---

## 13. Veri modeli: tablo grupları

Şema bugün `backend/migrations/001…029` ile kuruludur. Yeni bir göç **sıradaki
numarayla** eklenir. Mevcut dosya adları donuktur: uygulanmış bir göç yeniden
adlandırılırsa yeniden çalışır.

```mermaid
flowchart TB
    subgraph Kimlik["Kimlik ve yetki"]
        users[("users")]
        scopes[("scopes")]
        roles[("roles")]
        rs[("role_scopes")]
        ur[("user_roles")]
        us[("user_scopes")]
        uns[("user_node_scopes")]
        sec[("security_events")]
        act[("activity · user_activity")]
    end

    subgraph Agac["Ağaç ve ekipler"]
        nodes[("nodes<br/>parent_id · node_type · shape · key · attrs")]
        pillars[("pillars")]
        teams[("teams · team_nodes · team_members")]
        fav[("node_favorites · user_pins")]
    end

    subgraph Bildirim["Bildirim ve posta"]
        ps[("push_subscriptions")]
        cp[("chat_prefs")]
        mo[("mail_outbox · mail_templates")]
    end

    subgraph Ekler["Ekler"]
        att[("attachments · attachment_tags")]
        sv[("storage_volumes")]
    end

    subgraph Finans["Maliye"]
        fp[("finance_periods · budget_lines")]
        inv[("invoices · invoice_items<br/>invoice_attachments · invoice_reviews")]
        le[("ledger_entries · ledger_checks<br/>ledger_attachments")]
        rc[("reimbursement_claims · recurring_expenses")]
        ven[("vendors · bank_accounts · fx_rates")]
        mat[("materials · material_providers<br/>material_suggestions")]
    end

    subgraph LLM["Yapay zeka"]
        lp[("llm_profiles · llm_tasks<br/>llm_prompts · llm_config")]
        ll[("llm_limits · llm_calls<br/>llm_call_bodies · llm_usage_daily")]
    end

    subgraph Diger["Diğer"]
        qc[("quality_config")]
        ovr[("overage_base")]
    end

    users --> ur --> roles --> rs --> scopes
    users --> us --> scopes
    users --> uns --> nodes
    nodes --> pillars
    nodes --> teams
```

Dikkat: `db/` altındaki bazı modüller henüz tam kullanılmıyor; `main.rs` bunu
`#[allow(dead_code)]` ile açıkça söyler. Yeni bir JSON ucu bu modüllere
bağlanır, yeniden yazılmaz.

---

## 14. Bir isteği baştan sona izlemek: örnek

Bir kullanıcı bir kayda yeni bir eylem ekliyor. Okuman gereken dosyalar sırasıyla:

1. `api/mod.rs`: `POST /api/records/{id}/actions` hangi handler'a gidiyor.
2. `csrf.rs` ve `auth.rs`: kim ve geçerli bir token mı.
3. `db/scope.rs`: kullanıcının dalda yetkisi var mı (`permitted_nodes`).
4. `api/records.rs`: `add_action` iş kuralları ve `activity` yazımı.
5. `realtime.rs`: `target()` bu yolu `Record(id)` olarak sınıflandırıyor mu.
6. Yanıt, ön yüzdeki önbelleği tazeler; ön yüz ayrıca `lists` olayıyla ana
   sayfa ve eylemlerim listesini yeniler.

Aynı izleme yolu, bir AI çağrısı için `llm::run` üzerinden, bir bildirim için
`push::decide` üzerinden geçer.

---

## 15. Bilinen sınırlar ve açık noktalar

- **Tek süreç.** Yatay ölçek için ağaç indeksi, hub ve `structure` kilidi
  `LISTEN/NOTIFY` ve veritabanı kilidiyle değiştirilmeli (KNOW-85).
- **Eski isimler.** Kod İngilizce; ancak `spec/` belgeleri ve commit geçmişi bazı
  eski Türkçe adları anar. Kod referans alınır.
- **Tasarım aşamasındaki belgeler.** `spec/81-maliye.md`, `spec/85-embedding.md`
  (pgvector), `spec/86-baglantilar-graf.md` durumları "tasarım"dır. Bu belgelerdeki
  bir özelliğin kodda var olup olmadığını önce `grep` ile doğrula.
- **Python arşivi.** `references/python/` yalnızca davranış başvurusudur; yeni
  özellik oraya yazılmaz.
