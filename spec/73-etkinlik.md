# 73 — Etkinlik planlama modülü

**Durum: uygulandı.** Göç `backend/migrations/010_events.sql`, uçlar
`backend/src/api/events.rs`, ön yüz `frontend/src/surfaces/dashboard/Events.tsx`,
`EventPage.tsx`, `Purchases.tsx`. Kod ile bu belge çelişirse önce hangisinin
yanlış olduğuna bakılır, ikisi birlikte düzeltilir.

Yalnız `dashboard.` yüzü. Mobil karşılığı şimdilik yok.

---

## 1. İş

Ekip yılda onlarca etkinlik yapıyor: toplantı, eğitim, saha ziyareti, sosyal
etkinlik, fuar/konferans. Bugün bunların hazırlığı (mekan, malzeme, satın alım,
kim ne yapıyor) kayıtlara ve sohbete dağılıyor. Modülün cevapladığı sorular:

- Önümüzdeki haftalarda ne var, hangisinin hazırlığı geride?
- Bu etkinlik için ne alınacak, hangisi onaylandı, en ucuz/en yakın tedarikçi kim?
- Kim hangi rolde, hangi takım dahil, hangi kayıtlar (görev/hata) bu etkinliğe bağlı?

---

## 2. Ekranlar

| Rota | Ne |
|---|---|
| `/events` | liste: Geçmiş · Planlanan · Havuz sekmeleri, Tür/Önem/Sorumlu çipleri, sıralama, arama (filtreler URL'de, KNOW-234); altta en çok bağlanan kayıtlar; sağda daraltılır ray — ay takvimi + aylara göre ajanda |
| `/events/{id}` | etkinlik sayfası — **kayıt sayfasıyla aynı iskelet ve sınıflar** (`RecordPage`): sol iş, sağ sütun |

- **Havuz** = tarihi olmayan etkinlik (`date is null`). Geçmiş/Planlanan tarihe göre
  ayrılır, durum sütununa değil.
- Tabloda saat **yok** (başlık sıkışıyordu); saat yalnız etkinlik sayfasında.
- Etkinlik sayfası, sol: breadcrumb (Etkinlikler › Tür › Ad), başlık, durum +
  katılımcı yığını + "X açtı", açıklama, katlanır özellikler, **widget'lar**.
  Sağ: **zaman çizelgesi** (checkpoint'ler), **kişiler** (rol + yazış),
  **takımlar** (takım başına "+ Kayıt").
- Kart detayı gibi etkinlik de **sayfa**, modal değil (KNOW-112).

---

## 3. Şema

Ana fikir: kayıt kartları sunum verisini `cards.data` jsonb'de tutar (KNOW-267,
KNOW-281). Etkinlik widget'ları **tutmaz** — her widget türünün verisi kendi
ilişkisel tablosunda, indekslenebilir ve toplanabilir. Gerekçe: satın alımlar
ileride bir Maliye sayfasında (fatura, Excel dökümü, sponsor/üniversite bütçesi)
etkinlikler arası toplanacak; jsonb içinden para toplamak tam da kaçındığımız
şey.

```sql
create table events (
  id          uuid primary key default gen_random_uuid(),
  -- etkinliğin kendi kaydı: sohbet + arşiv (§3a). Ters yön kayıtta TUTULMAZ.
  record_id   uuid not null unique references records(id) on delete restrict,
  title       text not null check (length(title) between 1 and 200),
  kind        text not null check (kind in ('meeting','training','social','visit','conference')),
  status      text not null default 'idea'
              check (status in ('idea','planning','confirmed','done','cancelled')),
  priority    text not null default 'medium'
              check (priority in ('critical','high','medium','low')),
  owner_id    uuid references users(id) on delete set null,
  date        date,                 -- null = havuz
  start_time  time,
  place       text,
  attendees   integer check (attendees >= 0),
  description text,
  created_by  uuid references users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- kesinleşmiş ya da yapılmış etkinliğin tarihi olur
  check (status not in ('confirmed','done') or date is not null),
  check (start_time is null or date is not null)
);
create index on events(date);

create table event_participants (
  event_id uuid not null references events(id) on delete cascade,
  user_id  uuid not null references users(id) on delete cascade,
  role     text,                    -- serbest: "Sosyal medya", "Lojistik"
  primary key (event_id, user_id)
);

create table event_teams (
  event_id uuid not null references events(id) on delete cascade,
  team_id  uuid not null references teams(id) on delete cascade,
  primary key (event_id, team_id)
);

create table event_checkpoints (
  id        uuid primary key default gen_random_uuid(),
  event_id  uuid not null references events(id) on delete cascade,
  label     text not null,
  offset_days smallint,             -- şablondan: etkinlik tarihine göre (§6)
  due_date  date,                   -- elle eklenen: mutlak; ikisi birden dolu olamaz
  done_at   timestamptz,            -- elle işaretlenir; tarih geçti diye kendiliğinden dolmaz
  position  smallint not null
);
create index on event_checkpoints(event_id, position);

-- Widget = sayfadaki YUVA (sıra + görünürlük). Veri yuvada değil, türün tablosunda.
-- İstisna `record`: yuvanın kendisi bağlantıdır (tek kayıt). Ayrı bir
-- event_records tablosu YOK — etkinliğe bağlı kayıtlar = kayıt widget'ları.
create table event_widgets (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  widget_type text not null check (widget_type in
              ('supplies','record','otf')),
  record_id   uuid references records(id) on delete cascade,
  position    smallint not null,
  check ((widget_type = 'record') = (record_id is not null))
);
-- kayıt dışındaki türlerden etkinlikte en çok bir tane; aynı kayıt iki kez bağlanmaz
create unique index on event_widgets(event_id, widget_type) where widget_type <> 'record';
create unique index on event_widgets(event_id, record_id) where record_id is not null;
create index on event_widgets(record_id) where record_id is not null;
```

### 3a. Etkinliğin kendi kaydı — sohbet ve arşiv

Etkinliğin sohbeti yok; konuşma ve geçmiş için kayda gitmek gerekiyordu (bağlı
kayıt aç → oraya git). Hem deneyim hem arşiv için kötü: etkinliğin konuşması
herhangi bir bağlı kaydın içinde kayboluyordu.

- **Her etkinliğin tam bir kaydı var** (`events.record_id`, `not null unique`) —
  etkinliğin **ikizi**. Sohbet, katılımcı akışı, kartlar, eylemler o kayıttan gelir.
- **İkiz yalnız etkinlik oluşturulurken doğar.** Kayıt **aynı işlemde** açılır
  (başlık etkinlikle aynı, `kind = 'task'`); etkinlik oluşturma ucu `record_id`
  **almaz**. Var olan bir kayıt ikiz yapılamaz, ikiz sonradan başka kayda
  çevrilemez. Veritabanı da zorlar:

  ```sql
  create function events_record_id_frozen() returns trigger language plpgsql as $$
  begin
    raise exception 'events.record_id değiştirilemez' using errcode = 'check_violation';
  end $$;
  create trigger events_record_id_frozen before update of record_id on events
    for each row when (old.record_id is distinct from new.record_id)
    execute function events_record_id_frozen();
  ```

  "Var olan kayıt bağlanamaz" kuralı uçtadır (kaydı oluşturan uç tek yol); ikiz
  bir kez bağlandıktan sonra tetikleyici dondurur.
- **Görünüm anahtarı**: başlık satırının **en sağında** iki ikonlu anahtar
  (takvim | sohbet), dolu parça bulunulan yüz. Anahtarın **tamamı tek bağlantı**:
  neresine basılırsa basılsın öbür yüze geçer. Kayıt sayfasında da **aynı yerde**
  çıkar — kayıt bir etkinliğin ikiziyse — gidip gelirken yeri kaymaz.
- **İki yüz göz kırpar gibi geçer**: başlık, anahtar, katlanır özellik özeti ve
  "Top kimde" satırı iki sayfada aynı yerde. Özet sırası ortak — öncelik, sorumlu,
  tarih önce, **durum en sonda**; katlanma tercihi tek anahtarda. Etkinliğin
  "Top kimde" satırı ikiz kaydın eylemlerinden gelir (eylemler orada durur).
- **Başlık eşit kalır**: etkinliğin başlığı değişince ikizin başlığı **aynı işlemde**
  değişir. İkizin başlığı kayıt tarafından değiştirilirse de etkinliğe yazılır —
  tek ad, iki yüz.
- **Görevler listesinde** ikiz kayıt sıradan bir görev gibi düşer, yanında
  **"Etkinlik" etiketi** (takvim ikonu, etkinlik sayfasına bağlantı). Liste cevabı
  her satıra `event_id` (null olabilir) join'le ekler. Gizlenmez; `records.kind`'a
  üçüncü değer eklenmez (`21-sema-v2.md` §1: `kind` bir etiket).
- **Ters yön sorgudan gelir, saklanmaz.** Kayıt sayfası "bu kayıt bir etkinliğin
  mi?" sorusunu `select id from events where record_id = $1` ile sorar (unique
  indeks → tek arama); `GET /api/records/{id}` cevabına `event_id` (null olabilir)
  join'le eklenir. `records.event_id` gibi ikinci bir FK **yok**: aynı bağ iki
  yerde yazılırsa biri güncellenip diğeri unutulduğunda ayrışır (normal form).
- **Silme**: `on delete restrict` — etkinliğin kaydı tek başına silinemez. Etkinlik
  silinince kaydı aynı işlemde silinir (Rust'ta; FK yönü tersten cascade vermez).
  Uyarı: `records.unit_id` birim silinince cascade eder — etkinlik kaydının birimi
  silinmek istenirse `restrict` işlemi durdurur; birim silme akışı bunu açık hata
  olarak göstermeli.
- **Bağlı kayıt widget'ları kalır** (aşağıda): özellikle hataları etkinliğe
  bağlamanın yolu. Etkinliğin kendi kaydı widget olarak bağlanamaz, "Var olanı
  ekle" listesinde çıkmaz.
- Kayıt `unit_id` ister: yeni etkinlik formu **birim** sorar (kayıt orada durur).

### `widget_type` testi (`21-sema-v2.md` kuralı)

Tür sütununu sil — satır hâlâ ne olduğunu söylüyor mu? Evet: "bu etkinliğin
sayfasında şu sırada bir blok". `widget_type` `cards.card_type` gibi **şablon
seçer**, yaşam döngüsü ayırmaz; tek tablo doğru. Veri ise türün tablosunda
(`materials` …) ve `event_id`'ye bağlı — widget'a değil.

- **Widget kaldırmak veriyi silmez.** Yuva gider, `materials` satırları etkinlikte
  kalır; widget geri eklenince aynı liste görünür. Veriyi silmek ayrı, açık bir eylem.
- Kayıt dışındaki türlerden etkinlikte en çok bir widget (kısmi `unique`).
- **Yalnız alanları tanımlı türler var**: bugün `supplies` (satın alımlar, §5), `otf` (§5b) ve
  `record`. Yarım (iskelet) widget yayına girmez. Yeni tür = kendi tablosu +
  bileşeni + `widget_type` check'ine bir değer, **aynı göçte**. Aday türler
  (mekan, gündem, ulaşım, bütçe, duyuru) alanları tasarlanınca bu belgeye eklenir.

### Kayıt widget'ı — tek kayıt, çok widget

- Bir widget = **bir kayıt**; başlığında kaydın adı, türü, durumu; gövdesinde kaydın
  **eylemleri** (açıklar önce, en çok 5, fazlası kayda bağlantı). Bir etkinlikte
  istendiği kadar kayıt widget'ı olur — ızgarada her kayıt bir hücre.
- Yeni eklenen kayıt widget'ı önce sorar: **Yeni kayıt** (kayıt formu açılır, oluşan
  kayıt bağlanır) ya da **Var olanı ekle** (aranabilir liste, zaten bağlı olanlar hariç).
  Seçilmemiş widget **sunucuya yazılmaz** — `record_id` boş satır kısıtla yasak;
  istemcide bekler.
- Takımlar bölümündeki "+ Kayıt": takımı dolu kayıt formu; oluşan kayıt bir kayıt
  widget'ı olarak bağlanır.
- Bağlantıyı kaldırmak kaydı silmez. Kayıt silinirse widget'ı da gider (`on delete cascade`).
- Listedeki "en çok bağlanan kayıtlar" = kayıt widget'larının `record_id` sayımı;
  **ikiz kayıtlar sayılmaz** (etkinliğin kendisi, bağlı kayıt değil — gereksiz tekrar).

### Widget yetkisi

- **Şablon widget'ları** (kayıt dışındakiler) etkinlik açılırken türün şablonundan
  gelir. Sonradan eklemek ya da kaldırmak **`manage_event_widgets`** scope'u ister —
  yapı tutarlı kalsın, herkes kendi düzenini kurmasın.
- **Kayıt widget'ı** serbest: etkinliği düzenleyebilen herkes ekler/kaldırır.
- Widget **içindeki** veri kendi kuralına tabi (satın alımlar: `manage_purchases`, §5).

---

## 4. Tür şablonu

Yeni etkinlikte widget yuvaları ve checkpoint'ler **etkinlik türünün
şablonundan kopyalanır**; sonra elle eklenir/silinir. Şablon kodda (Rust'ta bir
sabit, ön yüzde `EVENT_TEMPLATE` onizlemesi) — kullanıcı tanımlı şablon yok.

**Kural:** bütün hazırlık etkinlikten **en geç 7 gün önce** biter (Rust
`DEADLINE_DAYS`, testle zorlanır). Şablonda bundan geç checkpoint yok; elle
tarihsiz eklenen checkpoint de etkinlikten 7 gün önceye düşer. Farklı tarih ve
checkpoint ekleme `manage_events` ister; işaretlemek/silmek onaylayıcıya, diğer
düzenleyene onay isteği (§6).

| Tür | Widget'lar | Checkpoint'ler (etkinlikten gün farkı) |
|---|---|---|
| Toplantı | — | gündem toplandı −10, davet −7 |
| Eğitim | satın alımlar | eğitmen −21, mekan −14, malzeme hazır −7 |
| Sosyal | — | bütçe onayı −21, mekan −14, duyuru −7 |
| Saha ziyareti | — | ziyaret onayı −21, ulaşım −7 |
| Konferans | satın alımlar | başvuru −45, stand −30, tanıtım −10, malzeme −7 |

Yeni widget türü tanımlandıkça ilgili türlerin şablonuna eklenir.

- Kayıt widget'ı şablonda **yok**: kaydı olmayan kayıt widget'ı sunucuda tutulmaz.
- Kopya **oluşturma anında** alınır: şablon sonra değişirse eski etkinlikler değişmez.
- Etkinlik tarihi değişince `due_date`'ler aynı farkla kayar (henüz `done_at`'i
  olmayanlar). Tarihsiz etkinliğin checkpoint'leri tarihsiz.

---

## 5. Satın alımlar widget'ı (ilk tanımlı widget)

Şema `010_events.sql` + `018_purchases_v2.sql` (kaynak orası; burada kurallar):

- **Kalem etkinlikten bağımsızdır.** `materials` etkinlik FK'sı tutmaz; bağ
  `event_materials(material_id pk, event_id)`. Etkinlik silinince yalnız bağ gider,
  kalem sahipsiz kalabilir (ileride maliye sayfası bütün kalemleri arar ve toplar;
  etkinlik/ay bazlı dışa aktarım buradan). `created_by` kalemi kimin eklediğini tutar.
- **Süreç adımları** (sabit, 3): Gerekli mi? → Tedarikçi bulundu → Onaylandı.
  `state` tamamlanan adım sayısı (0..3); adımlar **elle** ileri/geri alınır.
  **Sponsor adım değildir**: `has_sponsor` = "sponsordan istendi". Sponsorun süreci
  arayüzde görünmez; son seçim yetkilidedir.
- **Adet** (`qty`, varsayılan 1, isteğe bağlı). Teklif fiyatı **toplam tutardır**;
  birim fiyat `price / qty` ile türetilir, saklanmaz.
- **Teklif seçimi**: `chosen_provider_id` (bileşke FK: aynı kalemin teklifi) YA DA
  `sponsor_chosen`. Sponsor teklifler arasında bir **seçenektir** (₺0; `sponsor_qty`
  ve `sponsor_date` isteğe bağlı, yalnız `has_sponsor` iken dolu). Kartta görünen
  fiyat: sponsor seçiliyse "Sponsor", seçili teklif, yoksa en düşük teklif.
- **`delivered`** (teslim edildi) sütun/adım değil, detaydaki işaret; yalnız onaylı
  (`state = 3`) ve elde olmayan kalemde. Kalem geri adıma alınınca kalkar. Panoda
  öncelik ikonu yerine kargo ikonu.
- **`purchased`** (+ `purchased_at/by`) YALNIZ maliye incelemesiyle (`review_purchases`,
  `PATCH /api/materials/{id}/purchased`). Widget'taki onay satın alındı demek DEĞİL.
  Satın alınmış kalemin tedariki donar (`purchased_locked`): yalnız not, öncelik ve
  teslim işareti yazılır.
- **Hizmet de satın alımdır** (lazer kesim gibi dışarıda yaptırılan iş): `type = 'service'`.
- **En iyi fiyat / en yakın tarih saklanmaz** — tekliflerden türetilir.
  İki kaynak ayrışamaz.
- **Para `numeric(12,2)`**, float değil: toplanacak ve dökülecek. Para birimi TL;
  çoklu para birimi yok.
- **Gecikme**: seçili teklifin (sponsor seçiliyse sponsorun, seçim yoksa en yakın
  tekliflin) varışı etkinlik gününden sonraysa kartta "Teslim geç". Teslim edilmiş
  ya da elde olan kalem sayılmaz; tarihsiz (havuz) etkinlikte uyarı yok.
- **Başlık noktası**: "Gerekli mi?" adımını geçmiş ve elde olmayan malzemelere bakar.
  Hepsi onaylı → yeşil · kritik bekleyen var → kırmızı · başka bekleyen var → turuncu ·
  hiçbiri yok → gri. Yanında toplam, onaylı tutar ve son güncelleme (`max(updated_at)`).
- **Pano** (varsayılan) ya da **liste**. Pano sütunları: Gerekli mi? (karar bekleyen ve
  tedarikçi aranan) · Tedarikçi bulundu · Onaylandı; "zaten var" kalem Onaylandı'da
  ev ikonuyla durur, toplama girmez. Kart sütunlar arasında sürüklenir (`state` yazar);
  altta **sponsor şeridi**: oraya bırakmak kalemi yerinden almaz, `has_sponsor`
  koyar (kopyası şeritte ad + öncelik olarak görünür). Karta/satıra basınca aynı
  **detay penceresi** açılır: ad, öncelik, tür, adet, sponsor/zaten var, etiketli
  adımlar, teslim, not, etkinlik gününe göre teklif zaman çizgisi ve teklif kartları
  (düzenle, seç, sil, ekle).

### Yetki

Malzeme eklemek, adım ilerletmek/geri almak, tedarikçi ve fiyat yazmak **scope
ister**: `manage_purchases`. "Satın alındı" işaretlemek ayrı scope: `review_purchases`
(maliye). Okumak etkinliği görebilen herkese açık; yetkisiz görünüm salt okunur
(kart sürüklenmez, detay alanları kapalı, ekleme formu yerine yetki notu). Ön yüz
yalnız gösterir; karar Rust'ta (`spec/70-guvenlik.md`).

Scope'lar: `manage_events`, `manage_event_widgets`, `manage_purchases`
(`010_events.sql`), `review_purchases` (`018_purchases_v2.sql`). Ekrandaki adları
`frontend/src/lib/labels.ts` `SCOPE`'ta.

---

## 5b. OTF widget'ı — üniversitenin etkinlik talep formu

Kampüste yapılan etkinlik için üniversite **FORM.GN.05 "Organizasyon ve Etkinlik
Talep Formu"** (OTF) ister. Gönderim kuralları (kulübe gelen duyuru, 2026):
kulüp mail adresinden, Word (.docx), etkinlikten **en geç 3 iş günü önce**,
dosya adı `KULÜPADI_25EKİM_OTF.docx`, mail konusu `KULÜP ADI ETKİNLİK TARİHİ OTF`.
Eski formatta, geç ya da kurala uymayan OTF işleme alınmaz.

- **Şablon:** üniversitenin taslağı `backend/tools/otf_template.py` ile bir kez
  işlenir. 56 içerik denetiminin her birine, önündeki yazı doğrulanarak `w:tag`
  eklenir; metin alanlarına `{{anahtar}}` konur. Çıktı `backend/assets/otf.docx`
  dosyasıdır ve binary'ye gömülür. Rust (`backend/src/otf.rs`) yalnız iki işlem
  yapar: `{{anahtar}}` → değer, işaretli kutu → ☒. Yayında Python yok.
  Üniversite yeni sürüm yayınlarsa araç yeniden koşar; etiket eşleşmezse durur.
  `otf.rs` testleri her anahtarın şablonda olduğunu doğrular.
- **Veri:** `event_otf` (amaç, bitiş saati, danışman, yaş grubu, kazanımlar,
  altı bölüm açıklaması), `event_otf_items` (işaretli kutu + isteğe bağlı adet),
  `event_otf_contacts` (en çok 3 sorumlu; telefon profilden). Etkinlikten
  gelenler (ad, tarih, başlangıç saati, yer, katılımcı sayısı) **tekrar tutulmaz**,
  dosya üretilirken okunur.
- **Adetler:** yeni taslak adetleri kutuda değil bölümün AÇIKLAMA'sında istiyor;
  gönderim kuralı "ekipmanın yanına `+` (ya da EVET) ve adet" (Aralık 2025
  duyurusu). Adet girilen kalem açıklamaya `Projeksiyon+2` olarak yazılır —
  gerçek formlardaki `SANDALYE+60` ile aynı biçim.
- **Uçlar:** `GET/PUT /api/events/{id}/otf` (form bütün olarak kaydedilir; yazmak
  etkinliği düzenleyebilene), `GET /api/events/{id}/otf.docx` (dosya adı kurala
  uygun). Cevap dosya adını, mail konusunu, son günü (3 iş günü önce; hafta sonu
  sayılmaz, resmi tatil bilinmiyor) ve geç kalındı mı bilgisini taşır.
- Kulüp adı ve dosya adındaki kısa ad yapılandırmadan gelir:
  `EKIPTAKIP_CLUB_NAME`, `EKIPTAKIP_CLUB_CODE`.
- Şablonda toplantı, eğitim ve sosyal etkinlik OTF widget'ı ve "OTF gönderildi"
  checkpoint'iyle (−7) açılır. Saha ziyareti ve konferans kampüs dışı sayılır.
- **Otomatik doldur:** etkinlikten gelmeyen bütün alanlar (alanlar, kutular +
  adetler, sorumlular) **en son kaydedilen, gözden geçirilmiş** başka formdan
  sunucuda kopyalanır (`POST /api/events/{id}/otf/autofill`; var olan formun
  üzerine yazar, onay sorulur). Kopyalanan form `needs_review` olur: Word
  indirilemez (`409 otf_unreviewed`), "Formu gözden geçirdim" kutusu Word
  indir'in yanında çıkar ve ancak kopyadan sonra **en az bir alan değişince**
  işaretlenir (`409 otf_review_needs_edit`). Kopya bekleyen form başkasına
  kaynak olmaz. Durum `event_otf.copied_from / needs_review / edited`.
- **Mail gönderilmez:** dosya kulüp adresinden elle gönderilir; uygulama dosyayı,
  adı ve konuyu hazırlar.

## 6. Uygulama kararları

- **Etkinliği kim düzenler?** (Efe, 2026-10-02) Kayıtların mekanizması: ikiz
  kaydını düzenleyebilen (sorumlu, açan, katılımcı, takım, dal izni) **ya da**
  ayrı `manage_events` scope'u olan — o her etkinliği düzenler ve checkpoint
  yapısını (ekle, sil, son tarih) yalnız o değiştirir. Etkinliğe kişi eklemek ikizin katılımcısı da yapar (sohbet bildirimi + yetki),
  çıkarmak ikisinden de çıkarır.
- **Checkpoint tarihi göreli.** Şablondan gelen checkpoint `offset_days` tutar
  (`due_date` boş); tarih okunurken `events.date + offset_days`. Havuzdaki
  etkinliğe tarih verilince checkpoint'ler kendiliğinden dolar, tarih kayınca
  bekleyenler kayar. Tamamlanmış göreli checkpoint tarih değişmeden önce eski
  tarihine sabitlenir (`offset_days` → `due_date`). Elle eklenen checkpoint mutlak.
- **Checkpoint sırası (sunucuda, `detail_of`):** tamamlananlar üstte
  (`done_at` sırasıyla), sonra açık olanlar tarihe göre (tarihsiz sonda), sonra
  `position`. Tamamlanan adım en üste çıkar, geri alınırsa tarihindeki yerine döner.
  Ön yüz sunucu sırasını çizer; "sıradaki" halka ilk açık adımdır.
- **Onay akışı:** onaylayıcı = etkinlik sorumlusu (`events.owner_id`) **ya da**
  `manage_events`. Onaylayıcı adımı doğrudan işaretler / geri alır / kaldırır
  (`PATCH`/`DELETE /api/event-checkpoints/{id}`; başkasına 403). Etkinliği
  düzenleyen ama onaylayıcı olmayan kişi aynı düğmelere basınca **istek** açar:
  `POST /api/event-checkpoints/{id}/requests` `{action: done|undone|delete}`
  (`event_checkpoint_requests`, aynı kişi+adım+eylem tek satır). İstek ikizin
  sohbetine `checkpoint_requested` (konu = adım adı, hedef = eylem) yazar.
  Onaylayıcı `POST /api/checkpoint-requests/{id}` `{approve}` ile yanıtlar:
  onay eylemi yapar (`checkpoint_approved`), ret yapmaz (`checkpoint_denied`);
  ikisinde de istek silinir. Ayrıntı cevabı `can_approve` ve `requests` taşır
  (onaylayıcıya hepsi, diğerine yalnız kendisininki). Tarih değiştirme ve ekleme
  `manage_events`'te kalır.
- **Arşiv:** etkinlik alan değişiklikleri ikizin akışına `verb = event_changed`
  (`target_label` = alan, detay `{from,to}`) olarak yazılır; başlık değişikliği
  kayıtla ortak `field_changed`.
- **Etkinlik silme yok.** Kayıtların da silme ucu yok; vazgeçilen etkinlik
  `cancelled` olur.
- Uçlar: `GET/POST /api/events`, `GET/PATCH /api/events/{id}` (tek alan,
  `{field, value}`), `PUT/DELETE …/participants/{user}` (`{role}`),
  `PUT/DELETE …/teams/{team}`, `POST …/checkpoints|widgets|materials`,
  `PATCH/DELETE /api/event-checkpoints/{id}`, `POST /api/event-checkpoints/{id}/requests`,
  `POST /api/checkpoint-requests/{id}`, `DELETE /api/event-widgets/{id}`,
  `PATCH/DELETE /api/materials/{id}`, `POST /api/materials/{id}/providers`,
  `DELETE /api/material-providers/{id}`. Yazma uçları güncel ayrıntıyı döner.

## 6a. Açık sorular

- **Bütçe kaynağı** (sponsor / üniversite): bugün yalnız `has_sponsor`. Maliye
  sayfası gelince `funding_source` enum'una dönebilir — o sayfa yazılırken karar verilir.
- **Satın alma tarihi, fatura eki**: Maliye sayfasının işi; `materials`'a o zaman eklenir.

## 7. Bilinçli alınmayanlar

- **Kullanıcı tanımlı widget/alan.** Widget türleri kodda, her birinin tablosu göçle
  gelir. Form-builder alınmıyor (KNOW-113).
- **Mobil yüz.** Önce dashboard'da oturacak.
