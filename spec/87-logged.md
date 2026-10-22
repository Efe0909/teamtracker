# 87 — `Logged<T>`: alan olaylarını taşıyan Writer monad

**Durum: tasarım** (Efe ile 2026-10-13 / 2026-10-22). Kod yok; bugün gerekmiyor, sonradan
kademeli eklenir. Üst mimari Stele KNOW-397'de (logger → halka tampon → izleyiciler / KPI,
MCP pencereyi salt okur). Bu belge yalnız **tipi** tanımlar.

## 1. İş

Backend eylemleri tipli **alan olayı** (`DomainEvent`) üretsin; olaylar bellekteki kayan
pencereye düşsün. Tüketenler:

- **İzleyiciler (watcher)** — oturumda canlı sayaç, özet satır kalıcı (KNOW-397 §2).
- **MCP** — pencereyi ek bilgi kaynağı olarak ayrık Rust sözleşmeleriyle okur (salt okunur,
  KNOW-396).

Logger "MCP ne yaptı" kaydı **değildir**. Olaylar diske yazılmaz.

`Logged<T>` bu olayları üreten fonksiyonların dönüş tipi: değer + o değeri üretirken olan
olaylar. Biriktirici değil — her fonksiyon kendi anlamlı işinin olaylarını döner, `bind`
anlamlı işleri birleştirir.

## 2. Değişmezler

Kod incelemesi bu listeye karşı yapılır. Biri bozuluyorsa değişiklik spec'i de değiştirir.

1. **Alan fonksiyonu yayınlamaz.** Olay üretir, döner. Veriyolunu (`EventBus`) yalnız kenar
   (handler) görür.
2. **Veritabanı değişikliğinin olayı `commit` başarılı olduktan SONRA yayınlanır.** Geri
   alınan yazma sayılmaz.
3. **Bellek içi değişikliğin olayı değişiklik olduğu anda yayınlanabilir** (zaten kesin).
   Aynı handler'da DB yazması da varsa bellek değişikliği commit'ten sonra yapılır; yoksa
   commit düşünce bellek değişmiş ama olay düşmüş olur.
4. **Olay sırası yürütme sırasıdır.** `bind` sırayı korur.
5. **`into_inner` olay düşürür ve yasaklıdır** (§6). Her istisna `#[allow]` + gerekçe taşır.
6. **Olay alan düzeyindedir, HTTP düzeyinde değil.** `(Provider, Added)`,
   `(Material, Changed { field: "state" })`; "POST /api/…" değil. Sayfa yükleme, yeniden çekme, okuma olay üretmez.
7. **Olay kişisel veri taşımaz.** Kimlikler (`Uuid`) ve izleyici koşullarının ihtiyaç duyduğu
   alan değerleri (`material.type`, `pillar_id`…) evet; telefon, e-posta, serbest metin gövdesi
   hayır. Metin gerekiyorsa okuyan taraf kimlikten çeker — okuma anındaki yetkiyle.
8. **`DomainEvent` dışarı çıkmaz.** MCP ve ön yüz olayı değil, tipli projeksiyonu görür
   (KNOW-397 §3).
9. **Olay metin değil, komuttur.** İşlem kodu `(Entity, Verb)`, işlenenler `id` + `refs` +
   `change`. Cümleyi her tüketici kenarda kendisi kurar (§4.3).

## 3. Tip

```rust
/// Değer + onu üretirken olan alan olayları.
#[must_use = "olaylar yayınlanmadan düşer: bind, into_parts ya da gerekçeli into_inner"]
pub struct Logged<T> {
    value: T,
    events: Vec<DomainEvent>,
}

impl<T> Logged<T> {
    /// Olaysız değer (monad `pure`).
    pub fn pure(value: T) -> Self;
    /// Değer + tek olay — alan fonksiyonlarının olağan dönüşü.
    pub fn new(value: T, event: DomainEvent) -> Self;
    /// Olay ekle (zincirleme).
    pub fn with(self, event: DomainEvent) -> Self;

    /// Değeri dönüştür, olaylar aynen.
    pub fn map<U>(self, f: impl FnOnce(T) -> U) -> Logged<U>;
    /// Monad bind: f'in olayları bizimkilerin ARDINA eklenir.
    pub fn bind<U>(self, f: impl FnOnce(T) -> Logged<U>) -> Logged<U>;
    /// Async ve hata dönebilen bind. f hata dönerse bütün olaylar düşer
    /// (DB tarafında transaction da geri alınıyor — §2.2).
    pub async fn bind_async<U, E>(
        self, f: impl AsyncFnOnce(T) -> Result<Logged<U>, E>,
    ) -> Result<Logged<U>, E>;

    /// Kenar: değer ve yayınlanacak olaylar.
    pub fn into_parts(self) -> (T, Vec<DomainEvent>);
    /// Olayları DÜŞÜRÜR. clippy ile yasak (§6).
    pub fn into_inner(self) -> T;
}
```

- `AsyncFnOnce` Rust 1.85'ten beri kararlı; kapanış `&mut tx` ödünç alabiliyor.
- Hata yolu monad içinde değil, dışında: `Result<Logged<T>, AppError>`. `?` hatanın bind'ı.
  `Logged<Result<…>>` kullanılmaz.
- Okuma fonksiyonları `Logged` dönmez.

### Monad yasaları

`pure(a).bind(f) == f(a)`, `m.bind(pure) == m`,
`m.bind(f).bind(g) == m.bind(|x| f(x).bind(g))` — değer ve **olay sırası** dahil. Birim
testi bu üçünü olay sırasıyla birlikte doğrular (§7).

## 4. `DomainEvent`

Olay bir **komut satırı** gibidir: işlem kodu `(Entity, Verb)`, işlenenler kimlikler.
Olay başına tip ya da sabit tanımlanmaz; iki küçük enum'un çarpımı olay kataloğudur.

```rust
/// Tablo başına bir kol (~15). Serde adı SABİT: izleyiciler DB'de bu adla saklanır,
/// Rust tipi yeniden adlandırılınca bozulmaz.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Entity { Record, Action, Card, Node, Team, Member, Participant, TeamNode,
                  Event, Material, Provider, Role, User, … }

/// Az ve genel (~6–8). Yeni fiil yalnız `Changed { field }` gerçekten okunmaz
/// olduğunda eklenir; derleyici ele alınmayan her yeri gösterir.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Verb { Added, Changed, Deleted, Disabled, Moved, Closed, Merged }

/// Bir işlenenin olaydaki rolü — konumla tahmin edilmez.
pub enum Role { Of, From, To, With }

pub struct DomainEvent {
    pub entity: Entity,
    pub verb: Verb,
    pub id: Uuid,                        // varlığın kendi kimliği
    pub refs: Vec<(Role, Entity, Uuid)>, // diğer işlenenler
    pub change: Option<Change>,          // yalnız Changed
}

/// Alan geçişi. Değer yalnız küçük/enum (§2.7): durum, bayrak, kimlik.
pub struct Change { pub field: &'static str, pub from: Attr, pub to: Attr }
```

Bu sözlük yeni değil: `activity.verb` bugün `node_created`, `team_renamed`,
`member_added`, `action_changed`, `field_changed`, `role_deleted`, `poll_closed` yazıyor —
hepsi varlık_fiil. Enum'lar onu biçimlendirir.

### 4.1 Birden çok nesneli fiil

1. **Eyleyen olayda yok** — zarfta (`Envelope.actor`). "Deniz Ali'yi kayda ekledi" →
   olay yalnız "Ali → kayıt".
2. **İlişki kendisi varlıktır.** İki nesneli her fiilin DB'de bir bağlantı tablosu var
   (`record_participants`, `team_members`, `team_nodes`, `card_attachments`,
   `event_teams`…); o satır varlıktır:
   `(Participant, Added, refs: [(Of, Record, x), (With, User, ali)])`.
3. **Konum yetmediğinde rol:** `(Node, Moved, id: a, refs: [(From, Node, b), (To, Node, c)])`,
   `(Card, Merged, id: a, refs: [(To, Card, b)])`.
4. **Toplu eylem = nesne başına bir olay.** 5 kişi birden eklendi → 5 olay; sayaçlar doğru sayar.

Alan eylemleri CRUD değilse `Changed` ile:

| Alan dili | Olay |
|---|---|
| tedarikçi seçildi | `(Material, Changed { field: "chosen_provider_id", to })` |
| satın alındı | `(Material, Changed { field: "purchased", to: true })` |
| durum 1 → 2 | `(Material, Changed { field: "state", from: 1, to: 2 })` |

İzleyici editörü bunları okunur adla etiketler; DB'deki izleyici `("material", "changed",
field = "purchased", to = true)` olarak saklanır.

### 4.2 Kod tarafında tüketim

```rust
match (e.entity, e.verb) {
    (Entity::Provider, Verb::Added) => …,
    (Entity::Material, Verb::Changed) if e.field() == Some("purchased") => …,
    _ => {}
}
```

Yazım hatası derleme hatası. Katalog (izleyici editörü, benzersizlik testi) `Entity × Verb`'ten
çıkar; ayrı kayıt gerekmez.

### 4.3 Kenar: cümleyi kurmak

Olay metin taşımaz; her tüketici kendi cümlesini kurar:

| Tüketici | Çıktı |
|---|---|
| kaydedici / UI | "Deniz, Ali'yi kayda ekledi" (Türkçe, `Display` tek yerde) |
| push | kısa başlık + `url` |
| izleyici | metin yok — işlem kodu + işlenen süzgeci |
| MCP | tipli projeksiyon |

Dil, ton ve kanal başına uzunluk kenarda; işlenenler kimlik olduğu için **yetki de kurulum
anında** okuyanın güncel `can_read`'iyle uygulanır (`realtime.rs`'teki "olay veri taşımaz"
kuralının aynısı).

**Ad çözümü:** cümle kurulurken ad kimlikten çekilir — sonradan yeniden adlandırılan varlık
yeni adıyla, silinen "(silinmiş)" görünür. `activity` etiketleri bu yüzden kopyalıyor (001).
Kayan bellek penceresinde süre kısa, kabul. Olaylar bir gün kalıcı yazılırsa işlenenlere
etiket anlık görüntüsü eklenir.

### 4.4 Zarf

**Kim, hangi kanaldan, ne zaman** olayda DEĞİL, kenarda zarflanır — alan fonksiyonu
bunları bilmek zorunda kalmasın:

```rust
pub struct Envelope {
    pub actor: Uuid,                  // CurrentUser
    pub via: Via,                     // Web | Mobile | System (MCP salt okunur: üretmez)
    pub at: DateTime<Utc>,
    pub events: Vec<DomainEvent>,
}
```

## 5. Kenar: yayın

```rust
// handler
let mut tx = st.pool.begin().await?;
let out = add_provider(&mut tx, material, &input).await?          // Logged<ProviderId>
    .bind_async(async |p| choose_provider(&mut tx, material, p).await).await?;
tx.commit().await?;                                               // §2.2: önce commit
let (id, events) = out.into_parts();
st.bus.publish(Envelope { actor: me.id, via, at: Utc::now(), events });
```

- `publish` yalnız handler'da çağrılır. Mevcut `Tx<'a>` takma adı
  (`api/nodes.rs`, `api/teams.rs`) olduğu gibi kalır; `Logged` transaction'ı sarmaz.
- Bellek içi değişiklik (izleyici başladı, kaydedici açıldı, `TreeIndex` yenilendi):
  aynı `Logged` dönüşü, transaction yok, değişiklik bitince `publish`.
- Veriyolu ve halka tampon bu belgenin dışında (KNOW-397 §1: `VecDeque` + `RwLock`,
  sayı + süre sınırı, `broadcast` değil).

## 6. Bileşim ve `into_inner` kapısı

Her yazma fonksiyonu `Logged` döner; çağıran seçer:

| Çağıran | Kullanım |
|---|---|
| Handler | `bind` / `bind_async` ile birleştirir, `into_parts` ile yayınlar |
| Üst düzey alan fonksiyonu | alttakinin olayını kendi olayıyla **değiştirir**: "satır güncellendi" yerine "tedarikçi seçildi" → alttakinde gerekçeli `into_inner` |
| Test | serbest |

`into_inner` olayı **sessizce** düşürür — "log unutuldu" hatasının ta kendisi. `#[must_use]`
yakalamaz (çağrı kullanım sayılır). Kapı clippy'de:

```toml
# backend/clippy.toml
disallowed-methods = [
  { path = "crate::log::Logged::into_inner", reason = "olay düşer; bind ya da into_parts" },
]
```

```rust
#[allow(clippy::disallowed_methods)] // üst fonksiyon (Material, Changed chosen_provider_id) yayıyor
let row = set_chosen(&mut tx, material, p).await?.into_inner();
```

`cargo clippy --all-targets` zaten derlemeyi düşürüyor (CLAUDE.md); yeni `into_inner`
kazara giremez, her istisna grep'lenebilir.

## 7. Denetim

- `log.rs` içinde birim testi: monad yasaları, olay sırası, `bind_async` hata yolunda
  olayların düştüğü.
- Ana yazma yollarında (sağlayıcı ekle/seç, malzeme durumu) handler testi: commit'ten sonra
  veriyoluna beklenen olay dizisi düşüyor; geri alınan istekte hiçbir şey düşmüyor.

## 8. Alınmayacaklar

- **Transaction'da biriktirici** (`Tx { events }` + `tx.emit`). Değerlendirildi, reddedildi:
  monad değer + olay taşır, olaylar fonksiyonun dönüşünde görünür kalır.
- **Olayların kalıcı yazılması.** Pencere bellekte, yeniden başlatma siler — kabul.
- **MCP denetim izi.** Kapsam dışı, düşürülmedi: MCP yazma araçları gelirse `via = Mcp`
  olaylarını kalıcı yazan ayrı abone (KNOW-396, KNOW-397).
- **HTTP istek düzeyi loglama.** Gürültü; kaydedici editörü çöple dolar.
- **Metin mesajlı makro** (`#[message = "did {x} to {y}"]`). İzleyici metni ayrıştırmak
  zorunda kalır, serbest metin §2.7'yi deler. Okunur cümle §4.3'te kenarda.
- **Olay başına tip/sabit** (`PROVIDER_ADDED`). `Entity × Verb` çarpımı yeter.
- **`#[logged(Verb)]` öznitelik makrosu — şimdi değil.** Taslak: iş tipi
  `impl Entity for Provider { const KIND; fn id() }` verir, makro varlığı ve kimliği dönüş
  tipinden alır, yalnız `Ok`'ta yayar, imzayı gizlemez (`Result<Logged<T>>` elle yazılır).
  Bedel: ayrı `proc-macro` crate'i + `syn`/`quote`, makro çıktısına işaret eden hatalar.
  Açık `Logged::new(v, ev)` tek satır; 20–30 yazma fonksiyonundan sonra kalıp acıtırsa eklenir.
- **Her yere birden geçiş.** `Logged` bir izleyicinin ihtiyaç duyduğu yazma yolundan
  başlayarak kademeli girer.

## 9. Açık sorular

1. İlk KPI hangisi? Örnek "#tedarikçi bulundu" — `(Provider, Added)` mı,
   `(Material, Changed chosen_provider_id)` mi, `(Material, Changed state → 3)` mü?
2. Modül adı: `crate::log` (`tracing` ile karışabilir) mı, `crate::domain_log` mu?
3. `Via`'da `Mobile` ayrı mı (Host'tan belli), yoksa `Web` yeter mi?
