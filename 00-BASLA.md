# EkipTakip — Faz 1 Handoff

**Hedef:** tek bir dikey dilimi uçtan uca çalıştırmak. Veritabanından ekrana, tarayıcıdan
veritabanına geri. Bu dilim çalıştığı an geri kalan her şey aynı kalıbın tekrarı olur.

**Faz 1 kapsamı:** hiyerarşi + kayıtlar + kart içi sohbet + alan değişiklikleri.
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

## Uçlar (Faz 1)

Sunucu iki tür yanıt verir: **tam sayfa** (ilk yükleme, adres çubuğundan gelen) ve
**parça** (HTMX isteği). Ayrımı `HX-Request` başlığıyla yap.

| Metot | Yol | Döndürdüğü | İş |
|---|---|---|---|
| GET | `/` | tam sayfa | varsayılan: Bana ait + son açılan kart |
| GET | `/panel/inbox` | `panel_inbox` | bana ait kayıtlar, **son harekete göre sıralı** |
| GET | `/panel/tree` | `panel_tree` | hiyerarşi |
| GET | `/node/{id}/items` | `panel_inbox` | o dalın (alt ağaç dahil) kayıtları |
| GET | `/item/{id}` | `card_head`+`card_fields`+`card_feed` | kart aç |
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

1. `uvicorn app:app` ile açılıyor, `/` bana ait kayıtları gösteriyor
2. Soldaki listeden bir karta tıklayınca sağda kart + akış geliyor (sayfa yenilenmeden)
3. Mesaj yazıp gönderince mesaj akışa ekleniyor, kutu temizleniyor, sayfa yenilenmiyor
4. Durum değiştirince hem şerit güncelleniyor hem akışa sistem olayı düşüyor
5. Raydan 🌳'a basınca panel ağaca dönüşüyor, düğüme tıklayınca o dalın kayıtları geliyor
6. Kapsamı dışındaki bir kartta alanlar kilitli — ve `curl` ile PATCH denenince de
   **403 dönüyor** (arayüzde gizlemek yetmez)

Son madde önemli: yetkiyi sadece görsel olarak uygulamak yetki uygulamamaktır.

---

## Sıra

1. Şema → SQLite (`schema.sql`), 3 kullanıcı + `layout-a.html`'deki örnek ağaç ve kayıtlarla tohumla
2. `TreeIndex` + testi (alt ağaç, atalar, is_descendant)
3. `base.html` + `rail` + `panel_inbox` — sadece okuma, tam sayfa
4. `/item/{id}` + kart parçaları — HTMX ile bölme değişimi
5. Mesaj gönderme (ilk yazma işlemi)
6. Alan değişikliği + sistem olayı + çift parça tazeleme
7. Ağaç paneli + düğüme göre süzme
8. Yetki kontrolü + 403 testi

Her adımdan sonra çalıştır ve gör. 8 adımı tek seferde yazıp sonunda test etme.

---

## Yapma

- **ORM kurma.** SQLAlchemy Faz 1'i yavaşlatır, ham SQL 20 sorgu için yeterli.
- **JS framework ekleme.** HTMX + gerekirse 20 satır vanilla. React/Vue yok.
- **Ağacı her istekte SQL'den okuma.** Bellekteki indeks var.
- **Kısmi indeks güncellemesi yapma.** Yapı değişti mi, komple yeniden kur.
- **Faz 2 işine girme.** OAuth, push, pivot Faz 1'i bitirmeden başlanmaz.
- **Şablonlara iş mantığı koyma.** Yetki, sıralama, gruplama Python'da.

---

## Rapor

Bittiğinde şunları yaz:
- Altı kabul kriterinden hangileri geçti
- SQLite'ta taşınabilirlik kurallarından sapmak zorunda kaldığın yer oldu mu
- `TreeIndex` yeniden kurulumu kaç ms sürüyor (tohum veriyle)
- HTMX'te takıldığın nokta oldu mu — özellikle `hx-swap-oob` ile çift parça tazeleme
- Şablon parçalarından hangileri "nerede gösterildiğini bilmek" zorunda kaldı (skin kuralı ihlali)
