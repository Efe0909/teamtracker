# 10 — Mimari kararlar

Kalıcı kararlar ve gerekçeleri. Faz 1 handoff'undan damıtıldı; iş listesi ve kabul
kriterleri düştü, çünkü o iş bitti. Buradaki kurallar hâlâ bağlayıcı.

## Yığın

**Python 3.12 + FastAPI + Jinja2 + HTMX + PostgreSQL, ham SQL.**

> SQLite ile başlandı; taşınabilirlik kuralları bu geçiş için yazılmıştı ve
> `spec/80-veritabani.md` ile ödendi. Aşağıdaki kurallar geçerliliğini koruyor.

- HTMX: sunucu HTML parçası döndürür, tarayıcı yerine koyar. **JavaScript framework yok.**
  Vanilla JS toplamı iki base şablonda ~10'ar satır.
- PostgreSQL: gerçek FK garantisi, `jsonb`, tam metin arama, doğrudan bağlanıp
  sorgu yazabilme. Dosya/izin/ilişki yükü buraya oturur.
- **ORM kurma.** Yirmi sorgu için SQLAlchemy fazla.

### Taşınabilirlik kuralları (geçişten sonra da geçerli)

- `id` sütunları **TEXT**, değer Python'da `uuid4().hex`. Otomatik artan sayı yok.
- Zaman sütunları **TEXT**, ISO-8601 UTC (`2026-08-20T14:03:11Z`). `CURRENT_TIMESTAMP` yok.
- Boolean yerine `INTEGER 0/1`; çeviren yardımcı tek yerde (`shared/db.as_bool`).
- `ltree`, `jsonb`, pencere fonksiyonu yok. JSON gerekirse TEXT'e `json.dumps`.

## Ağaç bellekte, veritabanı sadece kalıcılık

Ağaç veritabanında adjacency list (`nodes.parent_id`). Okuma için her istekte SQL'e gidilmez:
açılışta tek sorguyla `TreeIndex` kurulur (`shared/tree.py`). Euler tour `tin`/`tout`
sayesinde yetki kontrolü **O(1)**:

```python
def is_descendant(self, node, ancestor) -> bool:
    return self.tin[ancestor] <= self.tin[node] and self.tout[node] <= self.tout[ancestor]
```

**Kural:** yapı her değiştiğinde indeks komple yeniden kurulur (`service.rebuild_tree`).
Kısmi güncelleme yapma — birkaç bin düğümde tam kurulum mikrosaniyeler sürer, kısmi
güncelleme hata kaynağıdır.

`uvicorn --workers 1` **şart**: indeks süreç belleğinde. Çok worker gerekirse indeksin
tek yazıcıya taşınması gerekir.

## Parçalar layout'tan bağımsız (skin kuralı)

Her `data-fragment="X"` bir şablon parçasına karşılık gelir. Kurallar:

1. Parça **kendi kökünü** döndürür, dış sarmalayıcı içermez.
2. Parça içinde `position:absolute` ve sabit genişlik olmaz — kabı boyutlandırır.
3. Parça kendisini nereye koyduğunu varsaymaz.
4. CSS token'larla (`--acc`, `--line`, `--sh`); bileşen **ham renk yazmaz**.

Bu kurallara uyulduğu için mesaj balonu (`shared/templates/ortak/mesaj.html`) iki sitede
birden değişiklik olmadan çalışıyor.

## Sorgular: filtre, sıralama, sayfalama SQL'de

**Yasak:** tüm kayıtları çekip Python'da süzmek/sıralamak. Mevcut sistemin 5–15 saniyelik
yavaşlığının sebebi buydu. Python'a dönen satır sayısı ekranda gösterilecek satır sayısıdır.

- Sıralama sütunu **sabit sözlükten** gelir; kullanıcı girdisiyle birleştirilmez (enjeksiyon).
- Sıralama her zaman `(son hareket, id)` ikilisiyle biter: deterministik olur, keyset'e
  geçiş engellenmez.
- Alt ağaç filtresi recursive CTE değil, `tin`/`tout` **aralık taraması**.
- Metin araması **tsvector** (`items.arama`, GIN). `LIKE '%kelime%'` **kullanma** — indeks kullanmaz.
- Sayaçlar tek sorguda toplanır (`SUM(CASE WHEN … )`), yedi ayrı `COUNT(*)` koşturulmaz.

## Yetki

İki katman, karıştırma:

| Katman | Ne verir | Nereden gelir |
|---|---|---|
| Kart yetkisi | durum/atama/öncelik değiştirme, mesaj | `scope_node_id` alt ağacı **veya** karta dahil edilmiş olmak |
| Yapısal yetki | düğüm ekle/adlandır/taşı/sil, talep onayı | `is_admin`, ya da `is_editor` + kapsam |

```python
def can_edit_item(user, item, tree) -> bool:      # shared/auth.py
    if user.is_admin: return True
    if user.id in (item.assignee_id, item.created_by): return True
    if user.id in item.participant_ids: return True        # karta dahil edilenler
    return user.scope_node_id and tree.is_descendant(item.node_id, user.scope_node_id)
```

**Yetkiyi şablonda değil sunucuda uygula.** Şablon sadece görsel olarak kilitler; asıl
kontrol POST/PATCH ucundadır ve kapsam dışı istek **403** döner (test edilir).

Karta dahil edilen kişi yalnızca **o kartta** yetkilidir; yetki kapsama sızmaz.

**Atanmamış havuzu herkese açık:** sahipsiz iş kimsenin sorumluluğunda değildir, onu
yetkiyle gizlemek kaybolmasına yol açar.

## Kayıt takıma, eylem kişiye

Kaynak sistem çözümlemesinden gelen bağlayıcı karar (`spec/60-kaynak-uyarlama.md`):

- **Kayıt** (hata/görev) bir **takıma** tanımlanır (`items.team_id`). "Ekibe atanan
  iş kimin sorunu" belirsizliği kayıt seviyesinde kabul edilir: sahip takımdır.
- **Eylem** bir **kişiye** atanır (`actions.assignee_id`) — ilk gören üstlenir ya da
  lider/mentor dağıtır. Sorumluluk ancak eylem seviyesinde kişiselleşir.
- Kayıt, açık eylemi varken kapanamaz. Eylem olayları kartın akışına düşer, ayrı
  akış yok. Ayrı bir "eylem yöneticisi" ekranı da yok — kart içi şerit + "Açık
  eylemim" filtresi yeter.
- Kart yetkisine üçüncü yol eklenir: kartın takımının üyesi olmak (kapsam ve
  katılımcılığa ek). `can_edit_item` bu kontrolle genişleyecek.

## Kadans hafta, gün değil

Vardiya/DDS kavramları uyarlamada yok; ekip uzaktan ve gün içi devir yapmıyor.
Dönemsel eksen **hafta**: hızlı filtreler ("Bu hafta", "Geciken"), WDS panosu
(🚧) ve özet bildirimleri hep hafta üstünden düşünülür. Günlük iş kişinin kendi
sorumluluğudur, takibi `items.pillar` etiketiyle yapılır. Şemaya ve arayüze
vardiya benzeri bir boyut ekleme.

## Kimlik (Faz 1'de sahte)

`uid` çerezi, imzasız. `auth.current_user` Faz 2'de OAuth'a bağlanacak; çağrı yerleri
değişmeyecek. Yayına alırken önüne kapı konur (Cloudflare Access / basic auth) —
bkz. `deploy/README.md`.

## Yapma

- Ağacı her istekte SQL'den okuma. Bellekteki indeks var.
- Kısmi indeks güncellemesi yapma. Yapı değişti mi, komple yeniden kur.
- Tüm kayıtları belleğe çekip Python'da süzme/sıralama.
- `LIKE '%…%'` ile arama yapma. `arama @@ to_tsquery('tr', …)` var.
- Sıralama sütununu kullanıcı girdisiyle birleştirme.
- Şablonlara iş mantığı koyma. Yetki, sıralama, gruplama Python'da.
- Şablonlarda `hx-on=` kullanma: htmx onu `new Function` ile derler, yayındaki CSP
  (`unsafe-eval` yok) engeller. Davranışı base şablonlardaki delege dinleyicilere yaz.
