# EkipTakip — Faz 1 Handoff

**Hedef:** tek bir dikey dilimi uçtan uca çalıştırmak. Veritabanından ekrana, tarayıcıdan
veritabanına geri. Bu dilim çalıştığı an geri kalan her şey aynı kalıbın tekrarı olur.

**Ana ekran = TABLO.** Binlerce kayıt var; insanlar ID veya sütun filtresiyle arayıp
buluyor, sonra sohbete giriyor. "Bana ait" bir kayıtlı görünüm, ana ekran değil.

**Faz 1 kapsamı:** hiyerarşi + kayıt tablosu (sunucu tarafı filtre/sıralama/sayfalama) +
kart içi sohbet + alan değişiklikleri + atama (tekil ve toplu).
**Faz 1'de YOK:** giriş/OAuth, push, pivot, panel, talep akışı, IWS terfisi, dosya ekleme.

---

## Dosyalar

| Dosya | Ne |
|---|---|
| `00-BASLA.md` | bu dosya — Faz 1 planı |
| `01-sema.md` | veri şeması (tam, gelecek fazlar dahil) |
| `layout-a.html` | **referans arayüz** — şablonlar buradan türetilecek |
| `push-rapor.txt` | web push denemesi bulguları (Faz 3'te lazım) |

---

## Karar 1 — Yığın

**Python 3.12 + FastAPI + Jinja2 + HTMX + SQLite**

Gerekçeler:
- Python: push denemesi zaten Python'la yürüdü ve sorunsuz kuruldu (`uv`, 3.12). Aynı
  makinede ikinci bir dil kurmanın getirisi yok.
- HTMX: sunucu HTML parçası döndürür, tarayıcı onu yerine koyar. **JavaScript yazılmaz.**
- SQLite: Faz 1'de kurulum sıfır, tek dosya, yedeklemesi kopyalama. Ekip 5-10 kişiyken
  yeterli. Postgres'e geçiş Faz 2'de, ve aşağıdaki taşınabilirlik kurallarına uyulursa acısız.

### SQLite → Postgres taşınabilirlik kuralları (Faz 1'de uy)

- `id` sütunları **TEXT**, değeri Python'da `uuid4().hex`. Otomatik artan sayı kullanma.
- Zaman sütunları **TEXT**, ISO-8601 UTC (`2026-08-20T14:03:11Z`). `CURRENT_TIMESTAMP` kullanma,
  değeri Python'da üret.
- Boolean yerine `INTEGER 0/1`, tek yerde çeviren yardımcı yaz.
- Ham SQL yaz, ORM kurma. Sorgular iki veritabanında da çalışacak kadar sade kalsın.
- `ltree`, `jsonb`, pencere fonksiyonu kullanma. JSON tutman gerekirse TEXT'e `json.dumps`.

---

## Karar 2 — Ağaç bellekte, veritabanı sadece kalıcılık

Ağaç SQLite'ta **adjacency list** olarak durur (`nodes.parent_id`). Ama okuma için her
istekte SQL'e gitme. Açılışta tek sorguyla tüm düğümleri çek, bellekte bir indeks kur:

```python
class TreeIndex:
    parent: dict[str, str|None]     # id -> üst id
    children: dict[str, list[str]]  # id -> çocuk id'leri (sıralı)
    tin: dict[str, int]             # DFS giriş numarası
    tout: dict[str, int]            # DFS çıkış numarası
    depth: dict[str, int]
```

`tin`/`tout` Euler tour'dan gelir ve iki şeyi bedavaya çevirir:

```python
def is_descendant(self, node, ancestor) -> bool:      # YETKİ KONTROLÜ
    return self.tin[ancestor] <= self.tin[node] and self.tout[node] <= self.tout[ancestor]
```

Bu **O(1)**. Yetki kontrolü her istekte çalışacağı için önemli.

**Kural:** ağaç yapısı her değiştiğinde (ekle/adlandır/taşı/sil) indeks komple yeniden
kurulur. Kısmi güncelleme yapma — birkaç bin düğümde tam kurulum mikrosaniyeler sürer,
kısmi güncelleme ise hata kaynağı olur.

Tek süreç varsayımı geçerli. `uvicorn --workers 1` ile çalıştır. Çok worker gerektiğinde
(Faz 3+) bu indeksin tek yazıcıya taşınması gerekir — o zaman not düşülür.

---

## Karar 3 — Parçalar layout'tan bağımsız (skin kuralı)

Bu Faz 1'in en önemli kuralı. İleride arayüzü değiştirmek istediğimizde yeniden yazmamak
için parçalar **nerede gösterildiklerini bilmemeli.**

`layout-a.html` içindeki her `<section data-fragment="X">` bir Jinja partial'a karşılık gelir:

```
templates/
  base.html                 tam sayfa iskeleti (ray + panel + içerik)
  fragments/
    rail.html               sol ray
    panel_inbox.html        "Bana ait" listesi
    panel_tree.html         hiyerarşi ağacı
    breadcrumb.html         kart üstü yol + açılır ağaç
    card_head.html          başlık + açıklama
    card_fields.html        alan şeridi (durum, öncelik, sorumlu, DMS, pillar)
    card_feed.html          mesaj + sistem olayları akışı
    card_message.html       TEK mesaj (akışa eklenir)
    composer.html           mesaj yazma kutusu
```

Kurallar:
1. Bir parça **kendi kökünü** döndürsün, dış sarmalayıcı `<div class="panel">` içermesin.
2. Parça içinde `position:absolute` ve sabit genişlik olmasın — kabı boyutlandırsın.
3. Parça, kendisini nereye koyduğunu varsaymasın. `card_fields` hem şerit hem yan panel
   olarak çalışabilmeli.
4. CSS tek dosyada, **token'larla** (`--acc`, `--line`, `--sh`). Bileşenler ham renk yazmasın.

Bu üç kurala uyulursa Plan A'dan Plan B'ye geçmek `base.html`'i değiştirmek demek olur.

---

## Karar 4 — Tablo sorguları: her şey SQL'de, hiçbir şey bellekte

**Mevcut sistemdeki hata tam olarak şu:** tüm kayıtları çekip runtime'da süzüp sıralamak.
5–15 saniyelik yanıt süresinin sebebi bu. Bizde bu yaklaşım **yasak.**

Kural: filtre, sıralama ve sayfalama **tek SQL sorgusunda** olur. Python'a dönen satır
sayısı ekranda gösterilecek satır sayısıdır (50). Asla `SELECT * FROM items` yazma.

### Sorgunun şekli

```python
where, params = ["1=1"], []
if f.status:   where.append(f"i.status IN ({qs(f.status)})"); params += f.status
if f.priority: where.append(f"i.priority IN ({qs(f.priority)})"); params += f.priority
if f.assignee == "__none": where.append("i.assignee_id IS NULL")
elif f.assignee:           where.append("i.assignee_id = ?"); params.append(f.assignee)
if f.dms:      where.append("i.dms = ?"); params.append(f.dms)
if f.pillar:   where.append("i.pillar = ?"); params.append(f.pillar)
if f.overdue:  where.append("i.due_date < ? AND i.status <> 'kapandi'"); params.append(today)
if f.node:     # ALT AĞAÇ — aşağıdaki numaraya bak
    where.append("n.tin BETWEEN ? AND ?"); params += [tree.tin[f.node], tree.tout[f.node]]
if f.code:     where.append("i.code LIKE ?"); params.append(f.code.upper() + "%")
if f.q:        where.append("i.rowid IN (SELECT rowid FROM items_fts WHERE items_fts MATCH ?)"); params.append(f.q)

sort_col = SAFE_SORT[f.sort]          # sabit sözlük — kullanıcı girdisi değil
direction = "DESC" if f.desc else "ASC"
sql = (
    "SELECT i.*, n.name AS node_name, u.name AS assignee_name "
    "FROM items i "
    "JOIN nodes n ON n.id = i.node_id "
    "LEFT JOIN users u ON u.id = i.assignee_id "
    "WHERE " + " AND ".join(where) + " "
    f"ORDER BY {sort_col} {direction}, i.id DESC "
    "LIMIT ? OFFSET ?"
)
```

`SAFE_SORT` bir **sabit sözlük** olsun (`{"son_hareket": "i.last_activity_at", ...}`).
Sıralama sütununu kullanıcıdan gelen metinle asla birleştirme — SQL enjeksiyonu oradan girer.

### Alt ağaç filtresi = aralık taraması (DSA kararının SQL karşılığı)

`nodes` tablosuna **`tin` ve `tout`** sütunlarını yaz (Euler tour numaraları — `TreeIndex`
zaten hesaplıyor). O zaman "bu dal ve altındaki her şey" sorgusu recursive CTE değil,
indeksli bir aralık taraması olur:

```sql
WHERE n.tin BETWEEN :tin AND :tout        -- indeks kullanır, hızlı
```

Ağaç yapısı her değiştiğinde `TreeIndex` yeniden kurulur **ve** `nodes.tin/tout` tek
`UPDATE`'le veritabanına yazılır. Yapı değişikliği nadir, sorgu sürekli — takas doğru tarafta.

### İndeksler (bunlar olmadan tablo yavaşlar)

```sql
CREATE UNIQUE INDEX ix_items_code   ON items(code);
CREATE INDEX ix_items_activity      ON items(last_activity_at DESC);
CREATE INDEX ix_items_node          ON items(node_id);
CREATE INDEX ix_items_assignee_open ON items(assignee_id) WHERE status <> 'kapandi';
CREATE INDEX ix_items_unassigned    ON items(last_activity_at DESC) WHERE assignee_id IS NULL;
CREATE INDEX ix_items_status_prio   ON items(status, priority);
CREATE INDEX ix_items_due_open      ON items(due_date) WHERE status <> 'kapandi';
CREATE INDEX ix_nodes_tin           ON nodes(tin);
```

`last_activity_at` sütunu `items` üzerinde **denormalize** tutulur: her mesaj ve her alan
değişikliği onu günceller. Varsayılan sıralama bu sütundan gider; `events` tablosuna
`MAX(created_at)` için join atmak sıralamayı yavaşlatır.

### Metin araması

- SQLite: **FTS5** sanal tablosu (`items_fts(title, description)`), trigger'la senkron tutulur.
- Postgres'e geçince: `tsvector` sütunu + GIN indeks. Sorgunun şekli aynı kalır.
- `LIKE '%kelime%'` **kullanma** — indeks kullanmaz, tam tarama yapar. Tam da kaçtığımız şey.

### ID ile arama — en sık kullanılan yol

Her kaydın kısa, okunabilir ve **değişmeyen** bir kodu olur: `BUT-1042`.
Önek ilk oluşturulduğu düğümden türetilir, sayı global artar. Kayıt başka düğüme taşınsa
bile kod değişmez — insanlar onu konuşmada ve e-postada kullanıyor.

Arama kutusundaki metin bir koda benziyorsa (`^[A-Z]{2,4}-\d+$`) **doğrudan o kartı aç**,
tabloyu süzme. Bu, en sık yapılan işi tek adıma indirir.

### Sayfalama

Faz 1'de `LIMIT 50 OFFSET n` yeterli. Ama 40. sayfaya inildiğinde OFFSET yavaşlar.
Sıralama `last_activity_at` üzerinden gittiği için **keyset**'e geçmek kolay olacak:

```sql
WHERE (i.last_activity_at, i.id) < (:son_activity, :son_id)
ORDER BY i.last_activity_at DESC, i.id DESC LIMIT 50
```

Faz 1'de OFFSET yaz, ama sıralama **her zaman `(last_activity_at, id)` ikilisiyle bitsin** —
hem deterministik olur hem keyset'e geçiş engellenmemiş olur.

### Sayaçlar

Kayıtlı görünüm rozetleri (Atanmamış 37, Kritik 23…) yedi ayrı `COUNT(*)` demek.
Her sayfa yüklemesinde yedi sorgu koşmasın: tek sorguda topla
(SQLite'ta `SUM(CASE WHEN … THEN 1 ELSE 0 END)`), sonucu 30 saniye önbellekle.

### Performans bütçesi

Tablo yanıtı **200 ms altında** olmalı. Kabul testine şu ekleniyor: 50.000 sahte kayıt üret,
en kötü filtre kombinasyonunu ölç, süreyi rapora yaz. 200 ms'yi geçen sorgunun
`EXPLAIN QUERY PLAN` çıktısını da yaz — hangi indeksin kullanılmadığı görülsün.

---

## Karar 5 — Atanmamış havuzu herkese açık

Atanmamış bir kayıt, **kapsamı ne olursa olsun** herkes tarafından görülür ve atanabilir.
Gerekçe: sahipsiz iş kimsenin sorumluluğunda değildir; onu yetkiyle gizlemek kaybolmasına yol açar.

```python
def can_assign(user, item, tree) -> bool:
    if item.assignee_id is None:
        return True                              # sahipsiz iş herkese açık
    return can_edit_item(user, item, tree)       # sahibi varsa normal yetki
```

Arayüz tarafı:
- "Atanmamış" **ilk** kayıtlı görünüm, sayısı kırmızı rozetle duruyor (görmezden gelinmesin)
- Tabloda sorumlu sütununda `+ Ata` düğmesi — satırı açmadan atama
- Onay kutularıyla çoklu seçim → toplu atama şeridi

`POST /items/assign` gövdesi `{ids: [...], assignee_id: ...}` alır, her kayıt için
`can_assign` kontrolü yapar. Yetkisi olmayanları **sessizce atlamaz**: kaç tanesinin
atandığını ve kaçının reddedildiğini döndürür.

---

## Uçlar (Faz 1)

Sunucu iki tür yanıt verir: **tam sayfa** (ilk yükleme, adres çubuğundan gelen) ve
**parça** (HTMX isteği). Ayrımı `HX-Request` başlığıyla yap.

| Metot | Yol | Döndürdüğü | İş |
|---|---|---|---|
| GET | `/` | tam sayfa | **tablo** + araç çubuğu (varsayılan görünüm: Açık kayıtlar) |
| GET | `/items` | `table_rows`+`table_footer` | filtre/sırala/sayfala — her filtre değişiminde |
| GET | `/items/counts` | `table_toolbar` | kayıtlı görünüm rozetleri (30 sn önbellekli) |
| GET | `/search?q=` | tablo ya da 302 | kod eşleşirse doğrudan karta yönlendirir |
| GET | `/tree` | `panel_tree` | hiyerarşi (ray modu ve breadcrumb açılırı aynı parçayı kullanır) |
| GET | `/item/{id}` | `card_*` | kartı sağdan çekmecede aç |
| POST | `/items/assign` | `table_rows` | tekil veya toplu atama |
| POST | `/item/{id}/message` | `card_message` | mesaj gönder → akışa ekle |
| PATCH | `/item/{id}/field` | `card_fields` | tek alan değiştir + sistem olayı yaz |
| POST | `/item` | `card_*` | yeni kayıt (düğüm alanı **zorunlu**) |
| GET | `/whoami` | — | sahte kullanıcı (aşağıya bak) |
| POST | `/switch/{user_id}` | tam sayfa | sahte kullanıcı değiştir |

**Alan değişikliği kuralı:** her alan değişikliği `events` tablosuna bir `sistem` olayı
yazar ve `card_fields` ile birlikte `card_feed`'i de tazeler (HTMX `hx-swap-oob` ile).
Prototipteki en sevilen davranış buydu: kartın tarihçesi ile konuşması aynı akışta.

---

## Kimlik (Faz 1'de sahte)

Google girişi Faz 2. Faz 1'de üstteki avatar bir açılır liste olsun, tıklayınca
kullanıcı değiştirsin — prototipteki gibi. Oturum tek çerezde `user_id` tutar.

**Ama yetki mantığı gerçek olsun.** `current_user` fonksiyonu baştan doğru yerde dursun ki
Faz 2'de sadece onun içi değişsin:

```python
def current_user(request) -> User:      # Faz 2'de burası OAuth'a bağlanır
    return get_user(request.cookies.get("uid"))

def can_edit_item(user, item, tree) -> bool:
    if user.is_admin: return True
    if user.id == item.assignee_id or user.id == item.created_by: return True
    if user.id in item.participant_ids: return True          # karta dahil edilenler
    return user.scope_node_id and tree.is_descendant(item.node_id, user.scope_node_id)
```

Yetkiyi şablonda değil, **sunucuda** uygula. Şablon sadece `can_edit` bayrağına göre
düğmeyi soluklaştırsın; asıl kontrol POST/PATCH ucunda olsun.

---

## Kabul kriterleri

Faz 1 şu altı adım çalıştığında biter:

1. `uvicorn app:app` ile açılıyor, `/` **tabloyu** gösteriyor
2. Bir satıra tıklayınca sağdan sohbet çekmecesi açılıyor (sayfa yenilenmeden)
3. Mesaj yazıp gönderince mesaj akışa ekleniyor, kutu temizleniyor, sayfa yenilenmiyor
4. Durum değiştirince hem şerit güncelleniyor hem akışa sistem olayı düşüyor
5. Raydan 🌳'a basınca ağaç geliyor, düğüme tıklayınca tablo o dala süzülüyor
6. Kapsamı dışındaki bir kartta alanlar kilitli — ve `curl` ile PATCH denenince de
   **403 dönüyor** (arayüzde gizlemek yetmez)
7. Sütun filtreleri SQL'e gidiyor: filtre değişince yeni sorgu koşuyor, Python'a **50 satır**
   dönüyor. Log'a dönen satır sayısını yaz ve doğrula.
8. **50.000 sahte kayıtla tablo 200 ms altında** açılıyor — en kötü filtre kombinasyonunda da
9. Atanmamış bir kayda, kapsamı dışındaki bir kullanıcı `+ Ata` ile atama yapabiliyor
10. Arama kutusuna `BUT-1042` yazınca doğrudan o kart açılıyor

Son madde önemli: yetkiyi sadece görsel olarak uygulamak yetki uygulamamaktır.

---

## Sıra

1. Şema → SQLite (`schema.sql`) + indeksler + FTS5. **50.000 sahte kayıt** üreten bir
   `seed.py` yaz — performansı baştan gerçek hacimle ölç, sonda sürpriz olmasın
2. `TreeIndex` + testi (alt ağaç, atalar, is_descendant)
3. `base.html` + `rail` + **tablo** (filtre + sıralama + sayfalama, hepsi SQL'de)
4. `/item/{id}` + kart parçaları — HTMX ile sağdan çekmece
5. Mesaj gönderme (ilk yazma işlemi)
6. Alan değişikliği + sistem olayı + çift parça tazeleme
7. Ağaç paneli + düğüme göre süzme (`tin/tout` aralığı)
8. Atama: satır içi `+ Ata` ve toplu atama
9. Yetki kontrolü + 403 testi + performans ölçümü

Her adımdan sonra çalıştır ve gör. 8 adımı tek seferde yazıp sonunda test etme.

---

## Yapma

- **ORM kurma.** SQLAlchemy Faz 1'i yavaşlatır, ham SQL 20 sorgu için yeterli.
- **JS framework ekleme.** HTMX + gerekirse 20 satır vanilla. React/Vue yok.
- **Ağacı her istekte SQL'den okuma.** Bellekteki indeks var.
- **Kısmi indeks güncellemesi yapma.** Yapı değişti mi, komple yeniden kur.
- **Faz 2 işine girme.** OAuth, push, pivot Faz 1'i bitirmeden başlanmaz.
- **Tüm kayıtları belleğe çekip Python'da süzme/sıralama.** Mevcut sistemin 5–15 saniyelik
  yavaşlığının sebebi tam olarak bu. Ağaç bellekte, **kayıtlar değil**.
- **`LIKE '%…%'` ile arama yapma.** FTS5 var.
- **Sıralama sütununu kullanıcı girdisiyle birleştirme.** Sabit sözlük.
- **Şablonlara iş mantığı koyma.** Yetki, sıralama, gruplama Python'da.

---

## Rapor

Bittiğinde şunları yaz:
- Altı kabul kriterinden hangileri geçti
- SQLite'ta taşınabilirlik kurallarından sapmak zorunda kaldığın yer oldu mu
- `TreeIndex` yeniden kurulumu kaç ms sürüyor (tohum veriyle)
- **50.000 kayıtla tablo yanıt süresi** (en iyi ve en kötü filtre kombinasyonu)
- 200 ms'yi geçen sorgu varsa `EXPLAIN QUERY PLAN` çıktısı
- HTMX'te takıldığın nokta oldu mu — özellikle `hx-swap-oob` ile çift parça tazeleme
- Şablon parçalarından hangileri "nerede gösterildiğini bilmek" zorunda kaldı (skin kuralı ihlali)
