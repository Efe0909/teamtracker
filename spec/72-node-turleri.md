# 72 — Node türleri: omurga + tür projeksiyonları

**Durum: tasarım.** Kod yazılmadı. Bir açık karar var (§8).

Bu belge `spec/60-kaynak-uyarlama.md` §2.6'daki "node_type serbest metin kalır,
tip kataloğu alınmaz" kararını **geçersiz kılar**. O karar yanlış değildi —
*betimleyici* bir katalog için doğruydu ("iki ekran ve bir yönetim yükü, 25
kişide getirisi yok"). Değişen şey: tür artık betimleyici değil, **davranış
taşıyor**.

---

## 1. Neden

Amaç: **dashboard'ları tek kişiden bağımsızlaştırmak.**

Bugün eklenen bir pillar yarın anlamsızlaşabilir; bir gün "Maliye'yi neden SN
pillar'ına çevirmiyoruz" denebilir. Bunların hiçbiri kod değişikliği
gerektirmemeli. Ama "pillar dropdown'ı pillar'ları göstersin" gibi bir davranış
da koda bağlı — kod, adını bilmediği bir şeye davranış bağlayamaz.

Çözüm iki seviye:

| seviye | nerede | kim değiştirir |
|---|---|---|
| **Tür** (`node_type`) | kodda enum | geliştirici (kod + göç) |
| **Örnek** (node'lar) | veritabanı, veri yönetimi ekranı | kullanıcı, kod değişmeden |

Aynı kalıp `shared/scope.py`'deki `SCOPES` ile birebir: **isim kodda, örnek
veritabanında** (`KNOW-239`).

## 2. Taşıyıcı fikir: heterojen ağaç, homojen dilimler

Ağaç karışıktır — cell, pillar, takım, görev hepsi aynı yapıda durur. Bu bir
kusur değil, tasarımın kendisi: **homojenliği kod üretir.** Her özellik kendi
türüne göre bir dilim alır:

```
              nodes (tek omurga, heterojen)
                        │
        ┌───────────────┼───────────────┐
   type=team        type=pillar      type=cell
        │               │               │
  Ekipler sayfası   pivot sayfası   operasyonel kapsam
```

Somut sonuç: **"şu türdeki tüm node'lar" temel bir sorgu primitifi olur.**
`TreeIndex` ve rotalar tür-farkında olmalı; bu baştan planlanmalı, sonradan
eklenmesi her çağrı yerine dokunur.

**Node ince kalır.** Ortak olan (kimlik, konum, ad, tür, aktiflik) `nodes`'ta;
türe özel olan (üyeler, renk, duvar) projeksiyon tablosunda (§5).

## 3. Türler (ilk liste — tartışmaya açık)

`shared/nodes.py`:

```python
NODE_TYPES = {
    "cell":     "Cell",       # IWS hücresi / operasyonel birim
    "pillar":   "Pillar",     # IWS pillar'ı — pivot sayfası üretir
    "team":     "Takım",      # Ekipler sayfasında kart üretir
    "task":     "Görev",
    "step":     "Adım",
    "group":    "Grup",       # davranışı YOK: ağaçta yer tutar
}
```

Anahtar İngilizce, etiket Türkçe (`CLAUDE.md` "Kod dili"). Yeni tür eklemek =
kod değişikliği + DML göçü, tıpkı scope gibi.

`group`, bugünkü `Operational` etiketinin karşılığı: hiçbir şeye bağlı değil,
bilerek. Ağaçta yer tutan, ileride anlam kazanabilecek node'lar için. Anlamı
olmayan bir türün **açıkça** "anlamı yok" demesi, yanlışlıkla davranış
beklenmesinden iyidir.

Bugünkü VM ağacındaki karşılıklar: `Departman`→`cell`, `Görev`→`task`,
`Operational`→`group`, `Pillar`→`pillar`, `Takım`→`team`. Tohum verisindeki
üretim terimleri (`Hat`, `Ünite`, `Makine/Kol`, `Kazanım`, `Etkinlik`) kaynak
sistemden kalma — kulüp aracında karşılığı yok, göçte eşlenmeli ya da
tohum güncellenmeli.

## 4. Tür sözleşmeleri

Her tür, kodun ona ne yapacağının sözleşmesidir:

| tür | sözleşme |
|---|---|
| `team` | Ekipler sayfasında bir kart. Üyeler, roller, takım duvarı buna asılır. |
| `pillar` | Otomatik pivot sayfası (hatalar/deviation'lar). Kayıt formundaki pillar seçicisini besler. |
| `cell` | Kendisi ve **alt ağacı** operasyonel kapsam sayılır. |
| `task`, `step` | Yapısal; kayıt bağlanır, ayrı ekran üretmez. |
| `group` | Hiçbir şey. Bilerek. |

## 5. Projeksiyon tabloları

Türe özel veri node'da değil, kendi tablosunda; **birincil anahtar node_id**:

```sql
-- teams ZATEN node_id tasiyor (goc 002) ama nullable ve on delete set null:
--   node_id uuid references nodes(id) on delete set null
-- Projeksiyona cevirmek icin baglanti SIKILASTIRILIR:
alter table teams alter column node_id set not null;
alter table teams add constraint teams_node_uniq unique (node_id);
alter table teams drop constraint teams_node_id_fkey,
  add constraint teams_node_fk foreign key (node_id)
      references nodes(id) on delete cascade;   -- node giderse kart da gider
```

`teams.name` artık **türetilir** (node'un adı). İki yerde ad tutmak, ikisinin
ayrışması demek — `teams.name` düşürülür ya da salt-okunur kabul edilir.

Aynı kalıp ileride başka türler için de: `pillar` bugün ek veri istemiyor
(pivot tamamen türetilebiliyor), isterse `pillars (node_id primary key, ...)`
eklenir. Omurga değişmez.

## 6. Yaşam döngüsü

**Node tek sahiptir.** Çift yönlü silme (karttan silince node düşsün, node'dan
silince kart disabled olsun + uzlaştırma kutusu) bilerek **alınmadı**: iki
silme yolu iki yaşam döngüsü demek, orphan üretir ve bir durum makinesi ister.

Aynı kullanıcı deneyimi tek mekanizmayla alınır: Ekipler sayfasındaki "Sil"
düğmesi de **node'u** siler, onay kutusunda neyin gideceğini sayar ("bu takımın
3 üyesi ve duvarı da gidecek"). Kullanıcı yine Ekipler sayfasından siliyor; tek
yön, uzlaştırma yok.

**Silmek yerine pasifleştirmek.** `nodes.is_active` eklenir:

- Pasif node dropdown'larda, yeni kayıt formlarında, Ekipler kartlarında çıkmaz.
- **Geçmiş kayıtlar sağlam kalır** — anlamsızlaşan bir pillar'a bağlı eski
  kayıtlar silinmez, sadece yeni seçimlerde görünmez.

Bu, §1'deki "bugünün pillar'ı yarın anlamsızlaşabilir" derdinin asıl cevabı:
silme değil, pasifleştirme.

**Tür değiştirme:** projeksiyonunda veri varken **yasak**. `team` node'unun
üyeleri varken `pillar` yapılamaz — önce boşaltılır. Yoksa sessiz veri kaybı.

## 7. Yerleşim kuralları

Bazı türler yalnız belirli yerlerde durabilir:

```python
ROOT_ONLY = frozenset({"cell"})      # cell yalnizca kokte
```

Kural kodda, kontrol `service.add_node` / `move_node` içinde (yapı değişikliği
zaten tek yerden geçiyor). Yanlış yere pillar koymak baştan engellenir.

## 8. ⚠️ Açık karar: pillar ↔ kayıt bağı

Pillar'a otomatik pivot açılacaksa, pivot **hangi kayıtları** toplar?

**(a) Türetilmiş.** Kayıt hangi cell'in altındaysa, o cell'in pillar'ı.
Kayıtta pillar alanı yok. Basit, tutarsızlık imkânsız — ama bir cell tek
pillar'a bağlanır, **matris kaybolur**.

**(b) Ayrı boyut (ÖNERİLEN, bu belge bunu varsayıyor).** Kayıt cell'in altında
durur, ayrıca bir pillar node'una etiketlenir:

```sql
alter table items drop column pillar;                    -- serbest metin, hic kullanilmadi
alter table items add column pillar_node_id uuid references nodes(id) on delete set null;
```

IWS'te pillar × cell matristir (bir cell birçok pillar'a iş üretir, bir pillar
birçok cell'e yayılır); (b) bunu korur. VM'deki `Pillars` dalı da zaten bir
**kayıt defteri** gibi duruyor — altında gerçek kayıt yok, pillar tanımları var.

Karar (a) olursa bu belgede yalnız bu bölüm ve §4'teki `pillar` satırı değişir.

## 9. Üyelik ≠ yetki

Takım node olunca şu ikisi aynı şeye benzer ama **değildir**:

| | ne demek |
|---|---|
| `team_members` | "bu takımdayım" — üyelik |
| `user_node_scopes` | "bu dalda düzenleyebilirim" — yetki |

Aynı node üzerinde ikisi de bulunabilir. Karıştırılırsa "takıma ekledim"
sessizce "düzenleme yetkisi verdim"e döner. `can_edit_item`'daki takım yolu
(`KNOW-64`) **bilinçli bir karar** olarak durur, node'laşma yüzünden otomatik
genişlemez.

## 10. Etkilenen yerler

| yer | ne olur |
|---|---|
| `shared/nodes.py` (yeni) | `NODE_TYPES`, `ROOT_ONLY`, tür sorguları |
| `shared/service.py` | `add_node`/`update_node`/`move_node` tür + yerleşim kontrolü |
| `shared/tree.py` | `TreeIndex` tür-farkında dilim (`nodes_of_type`) |
| `shared/filters.py` | `_pillar_options()` artık pillar node'larından — `TASK-220` kapanır |
| `sites/dashboard/routes.py` | veri yönetimi formunda tür `<select>`; Ekipler node projeksiyonundan |
| göç (yeni) | `nodes.is_active`, `node_type` enum'a eşleme, `teams.node_id` sıkılaştırma, `items.pillar` → `pillar_node_id` |

`TASK-220` (pillar filtresi ölü metin kutusu) bu işin doğal sonucu olarak
kapanır: seçenekler artık `select distinct pillar from items` yerine pillar
türündeki node'lardan gelir, yani boş veritabanında bile `<select>` doğru çizilir.

## 11. Alınmayanlar

- **Tür-ilişki matrisi** (hangi tür hangi türün altına girebilir — kaynak
  sistemde vardı). `ROOT_ONLY` dışında kural konmuyor; ağacın esnekliği
  bilerek korunuyor. İhtiyaç çıkarsa aynı dosyaya bir tablo eklenir.
- **Türü veritabanından yönetmek.** Tür davranış taşıyor; kodun bilmediği bir
  türe davranış bağlanamaz. `SCOPES` ile aynı gerekçe.
- **Çift yönlü silme / uzlaştırma ekranı** (§6).
