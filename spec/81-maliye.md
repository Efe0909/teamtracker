# 81 — Maliye

**Durum: tasarım** (Efe ile 2026-10-14: istek listesi, interview, üç tur eskiz ve eskiz
yorumları). Eskiz: "Maliye Eskizleri" artifact'ı (özel; Genel, Satın alım duvarı, Fatura
onayı, SEB iadeleri, Kulüp kasası, Malzemeler, Tedarikçiler, Mail şablonları, Fatura ekle).
Bu belge eskizdeki ekranların veri modelini, akışını ve yetkisini bağlar.

Bağlı belgeler: `73-etkinlik.md` §5 (satın alımlar widget'ı, `materials`), `74-referans-veri.md`
(operational kökler), `75-yetki.md`, `82-profil.md` (hesap numaraları), `83-belge-ekleri.md`
(fatura ekleri), `84-birlestirme.md` (tedarikçi mükerrerleri), `79-llm-yuku.md` (LLM'e veri).

---

## 1. İş

Hiyerarşide **Mali İşler** hücresinin makineleri bu sayfanın ekranlarıdır:

| Makine / görev (ağaçta) | Ekran |
|---|---|
| Dönemlik Bütçe Hazırlığı (Etkinlik Havuzu, Bütçe Derleme) | Genel › dönem bütçesi; Bütçe (§8) |
| Etkinlik Malzeme Onayı (Malzeme listesi, İhtiyaç Talebi) | Malzemeler, Satın alım duvarı, etkinlik widget'ı |
| SEB Geri Ödemeler (Fatura Fiş Toplama, Harcama Bildirimi, Kişisel Geri Ödemeler) | Fatura ekle, Fatura onayı, SEB iadeleri |
| Kulüp Kasası | Kulüp kasası (defter) |

**Kim:** maliye ekibi (her gün, birkaç kez); fatura gönderen her üye (ayda birkaç kez);
yönetim (dönem başı/sonu).

**Soru:** "Ne satın alındı, ne alınacak, kime ne borçluyuz, SEB'den ne alacağız, kasada ne var,
bütçenin neresindeyiz?"

### 1.1 İki para (Efe'nin anlatımı)

> Okulun yönetmeliği: kulüpler bütçe ister, okul onaylar, kulüpler satın alımı yapar, SEB iade
> eder. Esneklik çok az olduğu için okul dışı etkinliklerle kulüp adına gelir elde etmek serbest;
> dolayısıyla SEB'den bağımsız reel bir kasamız var. Birisi fungible real money, birisi
> transactional money.

| | SEB parası (transactional) | Kulüp kasası (fungible) |
|---|---|---|
| Birim | kalem → fatura → iade dosyası | defter satırı |
| Bakiye | **yok**; alacak izlenir (harcandı, iadesi gelmedi) | **var**; satırlardan hesaplanır |
| Kaynak | `materials`, `invoices`, `reimbursement_claims` | `ledger_entries` (bankadan elle) |

**Köprü:** SEB iadesi banka hesabına girer → defterde bir **gelir satırı** olur ve iade
dosyasına bağlanır. İki taraf birleşik görünümde çift sayılmadan toplanır:

```
net durum = kasa bakiyesi + SEB'den alacak − üyelere borç
```

## 2. Kararlar (2026-10-14, Efe)

| # | Karar | Kaynak |
|---|---|---|
| D-1 | Yalnız **normal görünüm**. Basit/gelişmiş anahtarı yok; "UI kalabalıklaşmaya başlayınca düşünelim". | eskiz yorumu |
| D-2 | Kanban en fazla **3 sütun**: "fazlası kafa ve göz sıkıyor". | eskiz yorumu |
| D-3 | **Form başına bir fatura**; fatura **birden çok etkinliğe** dokunabilir ama DB'de fatura **yalnız kaleme** bağlanır (`invoice_items`). Formda etkinlik eklenir, o etkinliğin kalemi seçilir; etkinlik ilişkisi kalemden türetilir. | eskiz yorumu: "relation commutative olarak sağlanır zaten" |
| D-4 | **Bölünmüş fatura**: aynı belge birden çok kaleme kalem başına tutarla bağlanır; tutarların toplamı faturanın toplamına eşit. | "split fatura özelliği yapabiliriz" |
| D-5 | Fatura formunu **herkes** gönderir; **yönetici onaylar** (`review_purchases`). | "bunları onaylamak yöneticiye bağlı" |
| D-6 | Listede olmayan kalem için form **etkinlik sayfasına** götürür; satın alımlar widget'ı **tıklanana kadar** vurgulu. | "ekle tuşu direkt etkinliğin sayfasına yönlendirip malzeme widget'ına highlight animasyonu versin" |
| D-7 | SEB iadesi **aylık**, zaman zaman **etkinlik bazlı** dosyayla izlenir. | interview |
| D-8 | Kasa **bankadan elle** tutulur; tek hesap. | interview: "genel olarak bankadan manuel takip" |
| D-9 | Bütçe **dönem → kategori → etkinlik**. | interview |
| D-10 | Kişisel geri ödeme borcu ayrı tablo değil; onaylı faturadan **türetilir** (§6.4). | eskiz turu |
| D-11 | Döviz: işlem **tarihindeki kur sabitlenir** (SEB işlem günkü kuru istiyor). | "dolarla yapılan işlemlerin yanına anlık kur pinlemek gereksin" |
| D-12 | Belge **silinmez** (HDD, 500 GB); fatura yalnız iptal edilir. | "hdd var 500 gb sakla" |
| D-13 | Kasa düzeltmesi **karşıt (ters) kayıtla**; satır düzenlenmez, silinmez. | "karşıt" |
| D-14 | Dönem **değişken, akademik takvim**: tarih aralığı elle tanımlanır. | "variable akademik takvimsel" |
| D-15 | Kategoriler Veri Yönetimi'nde, Maliye kökünün altında **liste**; her kategorinin türü **SEB** ya da **Genel**, türler kontrollü. | "veri yönetiminden liste türünde operational node altında olsun bütün kategoriler" |
| D-16 | Mail şablonu: HTML/Markdown taslak yüklenir, seçilince **önizleme** açılır, önizleme taslaktaki **değişkenleri** bulup alan üretir. Türler: metin, para (tutar, [biçim], [birim]), tarih, matris {ad, para}. | "taslak yükleme alanı html/markdown…" |
| D-17 | **Etkinlikten bağımsız satın alımlar** için kanban duvarı: büyük hacim için, bağlam olmadığından **AI önerisi yok**, alınan/alınacak için ileri-geri **tarih aralığı**, varsayılanlar Veri Yönetimi'nde. | eskiz yorumu |
| D-18 | Profil ve hesap numaraları **global profil sayfasında** (spec/82), Maliye'de değil. | eskiz yorumu |
| D-19 | Tedarikçi mükerrerleri **yumuşak, geri alınabilir** birleştirmeyle (spec/84); eskizdeki "Eşleştir" uyarısı kalır. | interview + "bu harika olmuş" |

## 3. Veri modeli (göç 028)

Para her yerde `numeric(12,2)`; float yok (spec/73 §5). Kur `numeric(12,6)`.

### 3.1 Maliye kökü ve kategoriler (spec/74 kalıbı)

```
Maliye                       [kök, key=finance, list]          ← attrs: duvar aralıkları (§7.2)
└─ Bütçe Kategorileri        [bölüm, key=budget_categories, list → category]
   ├─ Sponsorluk destekleri  [category, attrs.ledger = "seb"]
   ├─ Demirbaş               [category, attrs.ledger = "seb"]
   ├─ Promosyonel giderler   [category, attrs.ledger = "seb"]
   ├─ Etkinlik giderleri     [category, attrs.ledger = "general"]
   └─ Ofis ve sarf           [category, attrs.ledger = "general"]
```

- Yeni `node_type`: `category` (leaf). `attrs` **zorunlu** ve kontrollü:
  `{"ledger": "seb" | "general"}` (`refdata::validate_attrs`; başka anahtar `400`).
- Bölümü `manage_budgets` düzenler (`Editor::Scope`). Kök: yalnız admin; kökün `attrs`'ını
  (§7.2) `manage_budgets` yazar.
- Kategori emekliye ayırma = pasifleştirme; kullanılan kategori silinemez (`node_in_use`).
- Tohum: yukarıdaki 5 kategori (ağaçtaki "Bütçe Derleme" açıklamasındaki üç SEB gider türü +
  iki genel).

### 3.2 Dönemler

```sql
create table finance_periods (
  id      uuid primary key default gen_random_uuid(),
  name    text not null unique check (char_length(btrim(name)) between 1 and 60),
  span    daterange not null check (not isempty(span) and lower_inc(span)),
  exclude using gist (span with &&)          -- dönemler çakışmaz
);
```

Akademik takvim değişken (D-14): dönemi yönetim elle tanımlar ("2026 Güz", 1 Eyl – 31 Oca).
Bir tarih en fazla bir döneme düşer; boşluk serbest (yaz arası).

### 3.3 Malzemeler (genişletme)

```sql
alter table materials
  add column category_id uuid references nodes(id) on delete restrict,
  add column needed_by   date;
```

- **Etkinliğe bağlı olmayan** kalemde (`event_materials` satırı yok) `category_id` **zorunlu**
  (API, `category_required`): duvar ve bütçe kategorisiz kalem gösteremez.
- Etkinlik kaleminde kategori isteğe bağlı; yoksa **fonlama** SEB sayılır (yönetmelik:
  etkinlik bütçesi SEB'den istenir). Fonlama tek fonksiyonda: `finance::funding(material)`
  = kategorinin `ledger`'ı, kategori yoksa `seb`.
- `needed_by`: bağımsız kalemde "ne zamana lazım"; etkinlik kaleminde boş kalır, etkinlik
  günü kullanılır.

### 3.4 Tedarikçiler

```sql
create table vendors (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 200),
  name_key    text not null,                       -- spec/84 §3 normalize anahtarı
  contact     text check (char_length(contact) <= 200),
  phone       text check (char_length(phone) <= 30),
  email       text check (char_length(email) <= 200),
  url         text check (char_length(url) <= 500),
  issues_invoice boolean,                          -- "kulüp adına fatura kesiyor mu"
  note        text check (char_length(note) <= 2000),
  merged_into uuid references vendors(id) on delete restrict,   -- spec/84
  created_by  uuid references users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create unique index vendors_live_key on vendors (name_key) where merged_into is null;
alter table material_providers add column vendor_id uuid references vendors(id) on delete set null;
```

- Teklif (`material_providers`) tedarikçiye **isteğe bağlı** bağlanır; serbest metin `name`
  kalır (telefon teklifinde kişi adı). Bağ, teklif eklerken otomatik tamamlamadan seçilince
  kurulur; eski serbest metinler spec/84 §6'daki dolguyla eşlenir.
- Tedarikçi sayfası geçmişi **tekliflerden ve faturalardan** türetir; ayrı "alım" tablosu yok.

### 3.5 Faturalar

```sql
create table invoices (
  id               uuid primary key default gen_random_uuid(),
  submitted_by     uuid not null references users(id) on delete restrict,
  purchased_on     date not null,
  currency         char(3) not null default 'TRY' check (currency ~ '^[A-Z]{3}$'),
  total            numeric(12,2) not null check (total > 0),          -- faturanın kendi biriminde
  fx_rate          numeric(12,6) check (fx_rate > 0),                  -- 1 birim = ? TRY
  fx_on            date,                                               -- kurun tarihi
  fx_source        text check (fx_source in ('tcmb','manual')),
  total_try        numeric(12,2) not null generated always as
                     (round(total * coalesce(fx_rate, 1), 2)) stored,
  paid_by          text not null check (paid_by in ('member','club')),
  payee_account_id uuid references bank_accounts(id) on delete restrict,
  vendor_id        uuid references vendors(id) on delete set null,
  note             text check (char_length(note) <= 2000),
  status           text not null default 'pending'
                     check (status in ('pending','changes_requested','approved','rejected','withdrawn','cancelled')),
  claim_id         uuid references reimbursement_claims(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check ((currency = 'TRY') = (fx_rate is null)),
  check ((fx_rate is null) = (fx_on is null) and (fx_rate is null) = (fx_source is null)),
  check ((paid_by = 'member') = (payee_account_id is not null)),
  check (claim_id is null or status = 'approved')
);

-- Her durum geçişi bir satır: kim, ne zaman, hangi notla. Faturanın "son kararı" buradan.
create table invoice_reviews (
  id         uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  action     text not null check (action in
               ('submit','resubmit','approve','changes','reject','withdraw','cancel')),
  note       text check (char_length(note) <= 2000),
  by_user    uuid references users(id) on delete set null,
  at         timestamptz not null default now(),
  check (action not in ('changes','reject','cancel') or char_length(btrim(note)) > 0)
);
create index on invoice_reviews (invoice_id, at);

create table invoice_items (
  invoice_id  uuid not null references invoices(id) on delete cascade,
  material_id uuid not null references materials(id) on delete restrict,
  amount      numeric(12,2) not null check (amount > 0),     -- faturanın biriminde
  -- Onay anında yazılır, sonra donar: kategori sonradan değişse de iade dosyası bozulmaz.
  funding     text check (funding in ('seb','general')),
  primary key (invoice_id, material_id)
);
create index on invoice_items (material_id);

create table invoice_attachments (
  invoice_id    uuid not null references invoices(id) on delete cascade,
  attachment_id uuid not null unique references attachments(id) on delete restrict,
  primary key (invoice_id, attachment_id)
);
```

- **Toplam eşitliği** DB'de: ertelenmiş kısıt tetikleyicisi (`deferrable initially deferred`)
  işlem sonunda `sum(invoice_items.amount) = invoices.total` ve en az bir kalem şartını denetler.
  Uygulama aynı kuralı `400 invoice_split_mismatch` ile önce söyler; tetikleyici son savunma.
- Etkinlik ilişkisi **saklanmaz** (D-3): `invoice_items → event_materials` birleşimiyle
  türetilir. Kalemin sayfasında (etkinlik widget'ı, malzeme detayı) bağlı faturalar görünür;
  ilişki iki yönde de aynı satırdan okunur.
- Bir kalem birden çok faturada olabilir (kapora + kalan).
- Kalem yalnız **onaylı ve elde olmayan** olabilir (`state = 3 and not owned`;
  `material_not_approved`): 018'deki `not purchased or (state = 3 and not owned)` kısıtıyla
  aynı kural, çünkü onay kalemi `purchased` yapar (§6.2).
- `invoices` ↔ `reimbursement_claims` ↔ `ledger_entries` yabancı anahtarları döngüsel; göç
  tabloları önce anahtarsız yaratır, döngüyü kapatan kısıtları sonda `alter table … add`
  ile ekler.

### 3.6 İade dosyaları

```sql
create table reimbursement_claims (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('monthly','event')),
  month           date check (month = date_trunc('month', month)),
  event_id        uuid references events(id) on delete restrict,
  status          text not null default 'draft'
                    check (status in ('draft','sent','office_approved','paid')),
  sent_at         timestamptz,
  approved_at     timestamptz,
  paid_at         timestamptz,
  received_amount numeric(12,2) check (received_amount >= 0),       -- SEB'in gerçekte yatırdığı
  ledger_entry_id uuid unique references ledger_entries(id) on delete restrict,
  created_by      uuid references users(id) on delete set null,
  created_at      timestamptz not null default now(),
  check ((kind = 'monthly') = (month is not null)),
  check ((kind = 'event') = (event_id is not null)),
  check ((status = 'paid') = (paid_at is not null and received_amount is not null and ledger_entry_id is not null))
);
create unique index on reimbursement_claims (month) where kind = 'monthly';
create unique index on reimbursement_claims (event_id) where kind = 'event';
```

- Dosyaya **onaylı** fatura girer; dosyanın iade tutarı = içindeki faturaların **SEB fonlu**
  kalemlerinin TRY toplamı (`invoice_items.funding = 'seb'`).
- Durum sırayla ilerler; geri alma yalnız bir adım ve yalnız `paid` değilse.
  `sent` sonrası dosyaya fatura eklenmez/çıkarılmaz (`claim_locked`).
- `paid`: kullanıcı yatan tutarı girer → aynı işlemde defterde `seb_refund` gelir satırı
  açılır (§3.7) ve dosyaya bağlanır. Fark (talep − yatan) dosyada görünür.

### 3.7 Kasa defteri

```sql
create table ledger_entries (
  id             uuid primary key default gen_random_uuid(),
  occurred_on    date not null,
  amount         numeric(12,2) not null check (amount <> 0),       -- + giriş, − çıkış, TRY
  kind           text not null check (kind in
                   ('income','expense','purchase','seb_refund','member_payout','reversal','opening')),
  description    text not null check (char_length(btrim(description)) between 1 and 300),
  category_id    uuid references nodes(id) on delete restrict,     -- genel kategori
  event_id       uuid references events(id) on delete set null,
  invoice_id     uuid references invoices(id) on delete restrict,  -- kind = purchase
  payee_user_id  uuid references users(id) on delete restrict,     -- kind = member_payout
  reverses_id    uuid unique references ledger_entries(id) on delete restrict,
  created_by     uuid references users(id) on delete set null,
  created_at     timestamptz not null default now(),
  check ((kind = 'reversal') = (reverses_id is not null)),
  check ((kind = 'member_payout') = (payee_user_id is not null)),
  check (kind <> 'purchase' or invoice_id is not null)
);
create table ledger_attachments (
  entry_id      uuid not null references ledger_entries(id) on delete restrict,
  attachment_id uuid not null unique references attachments(id) on delete restrict,
  primary key (entry_id, attachment_id)
);
create table ledger_checks (                       -- banka mutabakatı
  id           uuid primary key default gen_random_uuid(),
  checked_on   date not null,
  bank_balance numeric(12,2) not null,
  created_by   uuid references users(id) on delete set null,
  created_at   timestamptz not null default now()
);
```

- **Değişmez defter** (D-13): `ledger_entries` üzerinde `update` ve `delete`'i reddeden
  tetikleyici. Düzeltme: `reversal` satırı, `amount = −asıl`, `reverses_id = asıl`; ters
  kaydın ters kaydı yok (asıl satır `reversal` olamaz — tetikleyici). Ekranda ters kaydı
  yapılmış satır üstü çizili, ters kayıt "Düzeltme" etiketiyle görünür.
- Bakiye = `sum(amount)`; tarih sırası `occurred_on, created_at`.
- `opening`: defterin açılış bakiyesi, bir kez.
- **Mutabakat**: kullanıcı bankadaki bakiyeyi girer (`ledger_checks`); fark = o tarihe kadar
  defter bakiyesi − banka. Fark sıfır değilse Genel'de uyarı.

### 3.8 Tekrarlayan giderler ve kur önbelleği

```sql
create table recurring_expenses (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 200),
  amount      numeric(12,2) not null check (amount > 0),
  currency    char(3) not null default 'TRY',
  every       text not null check (every in ('month','year')),
  next_on     date not null,
  category_id uuid references nodes(id) on delete restrict,
  is_active   boolean not null default true
);
create table fx_rates (
  day      date not null,
  currency char(3) not null,
  rate     numeric(12,6) not null check (rate > 0),     -- TCMB döviz satış
  primary key (day, currency)
);
```

### 3.9 Mail şablonları

```sql
create table mail_templates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (char_length(btrim(name)) between 1 and 120),
  format     text not null check (format in ('html','md')),
  body       text not null check (octet_length(body) between 1 and 262144),
  created_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);
```

Değişkenler **saklanmaz**, gövdeden okunur (§9).

## 4. Yetki (scope'lar)

| Scope | Yeni mi | Ne |
|---|---|---|
| (yok) | — | fatura **gönder**, kendi faturalarını gör/düzelt/geri çek |
| `review_purchases` | var (018) | faturayı onayla/düzeltme iste/reddet/iptal et; kalemi satın alındı işaretle; iade dosyaları |
| `manage_budgets` | var (019) | dönemler, bütçe satırları, kategoriler, duvar varsayılanları |
| `manage_ledger` | **yeni** | kasa defteri yaz (satır, ters kayıt, mutabakat), tekrarlayan giderler, iade dosyasını "ödendi" yap |
| `manage_purchases` | var | tedarikçi ekle/düzenle/birleştir, bağımsız kalem ekle (duvar) |

**Görme (öneri, Efe onayı bekler):** Maliye sayfası yalnız yukarıdaki dört scope'tan birine
sahip olana ya da admin'e açık. Diğer herkes yalnız **Fatura ekle** ve **Faturalarım**
(kendi faturalarının durumu) görür. Gerekçe: kasa ve kişi borçları kulüp içinde bile herkese
açık olması gerekmeyen veriler; tam IBAN zaten yalnız ayrıntıda (spec/82 §4.3).

## 5. Fatura ekle (form)

Rota: dashboard `/finance/invoices/new`, mobil `/invoice/new` (mobilde kamera ilk eylem:
fişin fotoğrafı). Herkes açabilir.

1. **Alan kişi** — oturumdan, salt okunur.
2. **Fatura / fiş** — en az bir ek, `purpose=invoice` (spec/83: görsel, PDF, xlsx, csv; 10 MB).
3. **Alışveriş tarihi ve tutar** — `purchased_on`, `total`, `currency` (₺ varsayılan; $, €).
   Birim TRY değilse **kur kutusu** açılır: `purchased_on` günü için TCMB döviz satış kuru
   sunucudan gelir (`GET /api/finance/fx?currency=USD&on=2026-10-10`), sabitlenir
   (`fx_source = tcmb`), TRY karşılığı yazılır. "Elle düzelt" `fx_source = manual` yapar.
4. **Bu fatura hangi kalemler için?** — **Etkinlik ekle** seçicisiyle etkinlik eklenir (ayrıca
   "Etkinliğe bağlı olmayan kalemler" grubu). Her grupta o etkinliğin onaylı kalemleri; kalem
   işaretlenince tutar alanı açılır. Altta canlı **"Dağıtılan X / Y"** ve farkı; altında
   türetilmiş "İlişkili etkinlikler (kalemlerden): …" satırı.
5. **Listede yok, etkinliğe kalem ekle** — form taslağı `sessionStorage`'a yazılır, kullanıcı
   `/events/{id}?focus=supplies&return=/finance/invoices/new` adresine gider (§10.1).
6. **Ödemeyi kim yaptı?** — "Ben ödedim, bana iade edilsin" / "Kulüp kasasından ödendi".
   İlki seçiliyse **iade edilecek hesap** (`bank_accounts`, varsayılan seçili). Kişinin hesabı
   yoksa form gönderilmez; `/profile?tab=accounts&return=/finance/invoices/new`'a yönlendirir
   (spec/82 P4).
7. **Onaya gönder** → `pending`.

Doğrulama (sunucu): ≥1 ek, ≥1 kalem, toplam eşitliği, kalemler onaylı, kur kuralı, hesap
kişinin kendi silinmemiş hesabı, `purchased_on` ≤ bugün ve ≥ bugün − 1 yıl.

## 6. Fatura yaşam döngüsü

```
            ┌──────────── düzelt + yeniden gönder ────────────┐
            ▼                                                  │
 gönder → pending ──onayla──► approved ──iptal (dosya gönderilmemişse)──► cancelled
            │  ├──düzeltme iste──► changes_requested ──────────┘
            │  └──reddet──► rejected
            └──geri çek (gönderen)──► withdrawn
```

### 6.1 Kim ne yapar
- Gönderen: `pending` ve `changes_requested` faturasını düzenler/geri çeker.
- `review_purchases`: onay, düzeltme isteği (not zorunlu), ret (not zorunlu), iptal.
- `approved` fatura **düzenlenmez**; yanlışsa iptal + yeni fatura.

### 6.2 Onayın etkileri (tek işlem)
1. Her `invoice_items` satırına `funding` yazılır (`finance::funding`).
2. Bağlı kalemler `purchased = true` (`purchased_at`, `purchased_by` = onaylayan) — zaten
   satın alınmışsa dokunulmaz.
3. `paid_by = club` → defterde `purchase` gider satırı (`amount = −total_try`, `invoice_id`).
4. SEB fonlu kalemi varsa fatura `purchased_on` ayının **aylık dosyasına** (yoksa `draft`
   olarak açılır) eklenir. Onaylayan, faturayı aylık yerine bir **etkinlik dosyasına**
   taşıyabilir (D-7) — dosya `sent` olmadıkça.
5. Gönderene bildirim (spec/82 §3.3).

### 6.3 İptal
Yalnız faturanın dosyası yoksa ya da dosya `draft` ise. Etkiler tersine: dosyadan çıkar,
`purchase` gider satırının ters kaydı yazılır, kalemin `purchased`'ı **başka onaylı fatura
yoksa** kalkar.

### 6.4 Üyelere borç (türetilir, D-10)

```
kişinin alacağı = Σ onaylı, paid_by=member faturalarının total_try'si
                − Σ o kişiye member_payout satırları (|amount|)
```

Ekranda iki parça: **ödenebilir** (faturanın SEB fonlu kısmının dosyası `paid`, ya da kısım
genel fonlu) ve **SEB bekleniyor**. Ödeme: "Öde" → `member_payout` satırı (kişi, tutar,
açıklama "Ayşe K.'ya iade · Eylül dosyası").

## 7. Satın alımlar

### 7.1 Malzemeler (liste)
Bütün kalemler, etkinlikli ya da değil (`materials`). Eskizdeki yapı:

- Özet şeridi: onaylı kalemlerin toplamı, bütçe ve aşım, satın alınan, fatura bekleyen.
- **Kuyruk sekmeleri:** İncelenecek (`state=3`, `!owned`, `!purchased`) · Teslim bekleyen
  (`purchased`, `!delivered`) · Fatura bekleyen (`purchased`, onaylı faturası yok) · Tedarik
  sürüyor (`state<3`) · Tümü.
- Süzgeçler: arama (kalem + tedarikçi), etkinlik, tür, kategori; "etkinliğe göre grupla".
- Satır: öncelik, ad, adet·tür, aşama + kaynak (seçili teklif / sponsor / zaten var), fiyat +
  bütçe + aşım kademesi (`$/$$/$$$`, spec/73 §5), teslim tarihi + "Geç", fatura.
- Ayrıntı bölmesi: teklif karşılaştırması (en düşük, seçili, sponsor), yaşam çizgisi
  (onaylandı → satın alındı → teslim → fatura), eylemler.
- **Toplu:** seçilenleri satın alındı işaretle (`review_purchases`), **tek faturaya bağla**
  (fatura formunu bu kalemlerle açar).

### 7.2 Satın alım duvarı (etkinlikten bağımsız, D-17)
- Kalemler: `event_materials` satırı **olmayan** `materials`.
- **3 sütun** (D-2): **Hazırlanıyor** (`state 0-2`; kart etiketi Talep / Tedarik sürüyor) ·
  **Alınacak** (`state=3`, `!purchased`) · **Alındı** (`purchased`; teslim edilmiş ve onaylı
  faturası olan "Kapandı" etiketiyle aynı sütunda).
- **Tarih aralığı sütun başına:** Alınacak **ileri** bakar (`needed_by`; geciken her zaman
  görünür, kırmızı); Alındı **geri** bakar (`purchased_at`). Seçenekler 7 / 14 / 30 / 90 gün /
  dönem başından / tümü. Aralık dışı sayısı sütunda yazar ("+23 eski kalem gizli").
- Varsayılan aralıklar **Maliye kökünün attrs'ında**:
  `{"wall_ahead_days": 30, "wall_back_days": 30}` (`manage_budgets`, Veri Yönetimi'nde kök
  ayrıntısı). Sütundaki seçim yalnız kullanıcının görünümü (URL'de, KNOW-234).
- Büyük hacim: sütun başına **sunucu sayfalaması** (50'şer, imleç), sayılar ayrı uçtan; kart
  yoğun (ad, tutar, kategori SEB/Genel rozeti, tarih, talep eden).
- Kategori çipleri (sayılı) + SEB/Genel anahtarı + arama.
- **AI önerisi yok**: malzeme önerisi (spec/79 §9) etkinlik bağlamı ister; bu duvarda çizilmez.
- Kart sürüklenir (`state` yazar, `manage_purchases`), Alındı'ya bırakmak `review_purchases`
  ister (satın alındı işareti).

### 7.3 Etkinlik widget'ı (spec/73 §5) için eklemeler
1. Kalem detayında **kategori** (isteğe bağlı) ve kartta **fatura bağlı mı** göstergesi.
2. Kalem detayında bağlı faturalar listesi (D-3'ün ters yönü).
3. `?focus=supplies` vurgusu (§10.1).

## 8. Bütçe

- `budget_lines(period_id, category_id, event_id null, amount)`; `unique (period_id, category_id, event_id)`
  (`nulls not distinct`). Etkinlik satırı o etkinliğe ayrılan pay; etkinliksiz satır
  kategorinin genel payı.
- **Plan vs gerçek** (dönem içinde, TRY):
  - harcanan = onaylı faturaların kalem tutarları (kalemin kategorisine, etkinliğine) +
    defterdeki genel kategorili giderler;
  - taahhüt = onaylı ama satın alınmamış kalemlerin kart fiyatı (spec/73 `priceOf`).
- Genel ekranında iki grup: **SEB bütçesi** (SEB kategorileri) ve **Kulüp kasası (genel)**;
  her kategori bir çubuk (harcanan dolu, taahhüt açık ton, aşım kırmızı).
- Dönemlik bütçe hazırlığı (SEB'e beyan) için **Excel çıktısı**: dönem × kategori × etkinlik.

```sql
create table budget_lines (
  id          uuid primary key default gen_random_uuid(),
  period_id   uuid not null references finance_periods(id) on delete cascade,
  category_id uuid not null references nodes(id) on delete restrict,
  event_id    uuid references events(id) on delete cascade,
  amount      numeric(12,2) not null check (amount >= 0),
  note        text check (char_length(note) <= 500),
  unique nulls not distinct (period_id, category_id, event_id)
);
```

## 9. Mail şablonları (D-16)

- Liste (dar ray) + **Yükle** (`.html` / `.md`; dosya istemcide okunur, gövde `mail_templates`'e,
  ek değil — spec/83 §2) + seçili şablonun **önizlemesi** ve **değişken alanları** yan yana,
  taslak kaynağı açılır bölümde.
- **Sözdizimi:** `{{ad:tür}}`. `ad` = harf, rakam, `_`. Tür yoksa `metin`.

| Tür | Yazılış | Alan | Biçim |
|---|---|---|---|
| metin | `{{kulup_adi}}`, `{{kulup_adi:metin}}` | tek satır | olduğu gibi (HTML'de kaçışlı) |
| para | `{{toplam:para}}`, `{{toplam:para(biçim=tam, birim=USD)}}` | tutar + birim (varsayılan ₺) | `tr-TR`, `biçim=tam` 2 ondalık (varsayılan), `biçim=yuvarlak` ondalıksız |
| tarih | `{{donem:tarih}}`, `{{gun:tarih(biçim=gün)}}` | tarih ya da ay seçici | `biçim=ay` "Eylül 2026" (varsayılan), `gün` "14 Ekim 2026" |
| matris | `{{kalemler:matris(ad, tutar:para)}}` | satır ekle/sil tablosu | HTML'de `<table>`, MD'de boru tablosu; sütun türü metin/para/tarih |

- Aynı değişken birden çok yerde geçebilir; türleri çelişirse önizleme uyarı verir, ilk
  geçiş kazanır.
- İsteğe bağlı ilk satır `Konu: …` mailin konusu olur (değişken içerebilir).
- **Bağlamdan doldurma:** şablon bir iade dosyasından açılırsa bilinen adlar doldurulur:
  `kulup_adi`, `donem`/`ay`, `toplam`, `kalemler` (ad + tutar), `etkinlik`, `kisi`. Kullanıcı
  değiştirebilir.
- **Çizim istemcide**, betiksiz `iframe sandbox` + `srcdoc`; değişken değerleri kaçışlanır;
  HTML gövde izinli etiket listesine indirgenir (p, br, b/strong, i/em, u, a[http/https/mailto],
  ul/ol/li, table/thead/tbody/tr/th/td, h1-h4, span, div; `style` ve olay öznitelikleri
  atılır). Markdown, ön yüzün mevcut Markdown çizicisiyle.
- Eylemler: **Mail olarak kopyala** (HTML + düz metin panoya), **Excel ekini hazırla** (iade
  dosyasının Excel'i). Uygulama mail **göndermez** (`mail.rs` göndericisiz kuyruk; ileride).

## 10. Ekranlar ve rotalar (dashboard)

| Rota | Ekran | Görür |
|---|---|---|
| `/finance` | Genel: net durum bandı, yaklaşan ödemeler (30 gün), bekleyen işler, dönem bütçesi | maliye |
| `/finance/wall` | Satın alım duvarı (§7.2) | maliye |
| `/finance/materials` | Malzemeler (§7.1) | maliye |
| `/finance/invoices` | Fatura onayı: kuyruk + ayrıntı (önizleme, bağlı kalemler ve bütçeleri, ödeme, eylemler) | `review_purchases` |
| `/finance/invoices/new` | Fatura ekle (§5) | herkes |
| `/finance/invoices/{id}` | Fatura ayrıntısı | gönderen + maliye |
| `/finance/mine` | Faturalarım | herkes |
| `/finance/claims` | SEB iadeleri: dosyalar + ayrıntı (durum zinciri, kime ne kadar, Excel, mail taslağı) | maliye |
| `/finance/ledger` | Kulüp kasası: bakiye, bu ay giren/çıkan, defter, satır ekle, ters kayıt, mutabakat | maliye |
| `/finance/vendors` | Tedarikçiler: liste + ayrıntı (iletişim, geçmiş alımlar) + eşleştirme uyarısı (spec/84) | maliye |
| `/finance/templates` | Mail şablonları (§9) | maliye |
| `/finance/analysis` | Analiz (§12) | maliye |

Kenar gezinme grupları (eskiz): **Takip** (Genel, Satın alım duvarı, Fatura onayı, SEB
iadeleri, Kulüp kasası) · **Kayıtlar** (Malzemeler, Tedarikçiler, Mail şablonları) ·
**Gönder** (Fatura ekle). Dönem seçici başlıkta.

Mobil (`app.`): `/invoice/new` (kamera önce), `/invoices` (Faturalarım). Maliye'nin geri kalanı
masaüstünde.

### 10.1 Etkinlik sayfasında vurgu (D-6)
`/events/{id}?focus=supplies&return=<yol>`:
- Satın alımlar widget'ı görünüme kaydırılır, çevresinde **nabız halkası** (vurgu rengi);
  widget'a ilk tıklamada kalkar. `prefers-reduced-motion`: animasyonsuz sabit halka.
- Üstte şerit: "Fatura formundan geldin. Eksik kalemi ekle; faturaya dönünce listede
  görünür." + **Faturaya dön** (`return`; yalnız göreli uygulama yolu).
- Form taslağı `sessionStorage`'dan geri yüklenir; yüklenmiş ekler (1 gün süpürülmez) korunur.

### 10.2 Genel ekranı
- **Net durum bandı:** Kulüp kasası (son mutabakat notuyla) · SEB'den alacak (iade
  bekleyen dosya sayısıyla) · Üyelere borç (kişi sayısıyla) · Net durum.
- **Yaklaşan ödemeler** (önümüzdeki 30 gün, tarih sırası): (a) onaylı ama alınmamış kalemler
  (`needed_by`, yoksa etkinlik günü) · (b) üyelere ödenebilir iadeler · (c) tekrarlayan
  giderler (`next_on`). Efe: "şimdilik başka önerim yok".
- **Bekleyen işler:** onay bekleyen fatura sayısı (en eskisinin yaşı), hazırlanan dosyanın
  eksikleri, mutabakat farkı.
- **Dönem bütçesi** (§8).

## 11. Uçlar

| Uç | Yetki | Ne |
|---|---|---|
| `GET /api/finance/summary?period` | maliye | Genel'in bütün sayıları tek cevapta |
| `GET /api/finance/upcoming?days=30` | maliye | yaklaşan ödemeler |
| `GET /api/finance/fx?currency&on` | oturum | TCMB kuru (önbellek `fx_rates`); servis kapalıysa `503 fx_service_off` |
| `POST /api/finance/invoices` | oturum | gönder |
| `GET /api/finance/invoices?status&mine&cursor` | maliye / `mine` herkes | liste |
| `GET /api/finance/invoices/{id}` | gönderen + maliye | ayrıntı (maliyeye tam IBAN + `iban_viewed` olayı) |
| `PATCH /api/finance/invoices/{id}` | gönderen (`pending`/`changes_requested`) | düzelt, yeniden gönder |
| `POST /api/finance/invoices/{id}/decision` `{action: approve|changes|reject|cancel|withdraw, note?, claim_id?}` | §6.1 | durum geçişi |
| `GET /api/finance/claims` · `POST` · `GET/PATCH /api/finance/claims/{id}` | maliye | dosyalar; `PATCH {status, received_amount?}` |
| `GET /api/finance/claims/{id}.xlsx` | maliye | harcama bildirimi dökümü |
| `GET /api/finance/ledger?from&to&cursor` · `POST` · `POST /api/finance/ledger/{id}/reverse` | maliye / yazma `manage_ledger` | defter |
| `POST /api/finance/ledger/checks` | `manage_ledger` | mutabakat |
| `GET /api/finance/materials?queue&event&type&category&q&cursor` | maliye | §7.1 |
| `GET /api/finance/wall?column&range&type&category&q&cursor` · `GET /api/finance/wall/counts` | maliye | §7.2 |
| `POST /api/finance/materials` | `manage_purchases` | bağımsız kalem (kategori zorunlu) |
| `GET/POST /api/finance/vendors` · `GET/PATCH /api/finance/vendors/{id}` | maliye / yazma `manage_purchases` | tedarikçiler |
| `GET/POST /api/finance/periods` · `PATCH/DELETE …/{id}` | maliye / yazma `manage_budgets` | dönemler |
| `GET/PUT /api/finance/budget?period` | maliye / yazma `manage_budgets` | bütçe satırları |
| `GET/POST /api/finance/recurring` · `PATCH/DELETE …/{id}` | maliye / yazma `manage_ledger` | tekrarlayan giderler |
| `GET/POST /api/finance/templates` · `GET/PUT/DELETE …/{id}` | maliye | şablonlar |
| `GET /api/finance/analysis?group=month|period|event|category&from&to` | maliye | §12 |

"maliye" = `review_purchases ∨ manage_budgets ∨ manage_ledger ∨ manage_purchases ∨ admin` (§4).
Yeni hata kodları (`api/errors.ts`): `invoice_split_mismatch`, `material_not_approved`,
`category_required`, `claim_locked`, `invoice_locked`, `fx_service_off`, `fx_rate_required`,
`account_required`, `ledger_immutable`, `already_reversed`, `period_overlap`.

## 12. Analiz (ay / dönem / etkinlik)

- Gruplama: ay, dönem, etkinlik, kategori; her satırda **SEB** ve **kasa** ayrı sütun +
  toplam (eskizdeki "ayrı ayrı ve birlikte takip").
- Ölçüler: harcanan, taahhüt, bütçe, SEB'den talep edilen, SEB'den yatan, kasa girişi
  (etkinlik geliri, sponsor), net.
- Grafik: seçili gruplamada yığılmış çubuk (SEB / kasa), `--chart-*` token'ları.
- Excel çıktısı aynı tablo.

## 13. Kur (D-11)

- Kaynak: TCMB günlük kurlar XML'i, `purchased_on` günü, **döviz satış**. Hafta sonu/tatilde
  dosya yok → geriye doğru en fazla 7 gün, ilk bulunan iş günü (`fx_on` o gün olur).
- Önbellek `fx_rates`; aynı gün ikinci istek dışarı çıkmaz.
- Dış servis kill switch'i: `external_off`'a `fx` (spec/76 kalıbı). Kapalı ya da ulaşılamıyorsa
  form kur alanını elle ister (`fx_source = manual`).
- Ağ çağrısı `st.http` ile ama tek modülden (`finance::fx`); LLM hattı değil.

## 14. Uygulama sırası

1. Göç 028 (bu belgenin bütün tabloları) + kök/kategori tohumu + tetikleyiciler; Rust
   `finance` modülü: `funding`, borç türetme, kur.
2. Fatura gönderme + onay akışı (uçlar + Fatura ekle + Fatura onayı + Faturalarım).
3. Kasa defteri + iade dosyaları + Genel.
4. Malzemeler + duvar + tedarikçiler.
5. Bütçe + analiz + Excel çıktıları.
6. Mail şablonları.

Her adım: `cargo clippy --all-targets`, `npm run build`, `npm test`, `backend/tools/local_test.sh`.

## 14.1 Uygulama notları (geri bildirim turu, Ekim 2026)

- **Tedarikçi bul-ya-da-aç**: `purchasing::ensure_vendor`; teklif yazılırken (`events.rs`,
  `create_material`) ve açılışta (`backfill_vendors`) çalışır. Telefon/e-posta tedarikçi olmaz.
- **Malzemeler**: durum (kuyruk) sade filtre çipi; hazır ayarlar yalnız görünen çipleri doldurur
  (gizli sorgu yok). Tarih aralığı `from`/`to` (etkinlik günü, yoksa gerektiği gün). Aynı
  normalize adlı kalemler tek satırda (`group_key`), "n etkinlik" yazar. Ayrıntı:
  `GET /api/finance/materials/{id}`; etkinliksiz kalem de `/api/materials/..` uçlarıyla düzenlenir
  (cevap: etkinlikli kalemde etkinlik ayrıntısı, etkinliksizde kalemin kendisi).
- **Duvar**: kart başına ileri/geri düğmesi yok (sürükle-bırak); karta tıklayınca ayrıntı.
- **Fatura ekle**: etkinlik seç + ekle yerine tek aranabilir kalem listesi (etkinliğe göre gruplu,
  "Etkinliksiz"); tutar kartın fiyatından önerilir, kalan canlı gösterilir.
- **SEB iadeleri**: `GET /api/finance/claim-slots` — SEB fonlu faturası olan her ay ve etkinlik,
  dosya açılmamışsa "Dosya açılmadı"; tıklayınca dosya açılır. Etkinlik dosyası açılırken etkinliğin
  SEB fonlu onaylı faturaları (dosyasız ya da taslak aylık dosyadakiler) dosyaya taşınır.
- **Eylem atananları** (göç 029): `action_assignees`; `actions.owner_id` kalktı. API: `owner_ids`.
  Her atanan kayda katılımcı olur (K1 değişmedi).
- **Bütçe/analiz/Excel**: `api/budget.rs` (`/api/finance/periods|budget|analysis` + `.xlsx`),
  şablonsuz tek sayfa Excel: `xlsx.rs`. Tekrarlayan giderler `api/recurring.rs`, mail şablonları
  `api/templates.rs` (çizim istemcide, `FinanceTemplates.tsx`). Mobil: `/invoice/new`, `/invoices`.
- Henüz yok: şablonun iade dosyasından bağlam doldurması (`kulup_adi`, `toplam`, …), iade dosyası
  Excel'i (`claims/{id}.xlsx`), Genel'de dönem bütçesi şeridi.

## 15. Alınmayanlar

- **Banka entegrasyonu / ekstre içe aktarma**: interview'de "bankadan manuel takip".
- **Çoklu kasa hesabı** (nakit + banka): tek hesap yeterli (D-8).
- **Basit/gelişmiş görünüm**: D-1.
- **Uygulamadan mail gönderme**: kopyala-yapıştır yeterli; gönderici bağlanınca ayrı karar.
- **Faturada etkinlik alanı**: D-3, türetilir.
- **Satır düzenleme/silme (defter)**: D-13.

## 16. Açık sorular

1. **Görme yetkisi** (§4): Maliye herkese mi açık, yalnız maliye scope'larına mı? Önerim ikincisi.
2. **Kur kaynağı**: TCMB döviz satış varsayıldı; SEB'in istediği kur türü (alış/satış/efektif)
   teyit edilmeli.
3. **Eski etkinlik kalemlerinin fonlaması**: kategori yoksa SEB sayılıyor (§3.3); kasadan
   yapılmış eski alımlar varsa elle kategori verilmeli.
4. **Fatura onayında tutar düzeltme**: onaylayan tutarı kendisi düzeltebilsin mi, yoksa her
   zaman "düzeltme iste" mi? Önerim düzeltme iste (gönderenin beyanı korunur).
