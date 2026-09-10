# 72 — Node türleri: omurga + tür projeksiyonları

**Durum: tasarım.** Kod yazılmadı. Açık karar kalmadı; pillar ↔ kayıt bağı
bilerek ertelendi (§8).

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
  Ekipler sayfası   (sayfa: sonra)  operasyonel kapsam
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
    "pillar":   "Pillar",     # IWS pillar'ı — sayfası sonra (§4)
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
| `pillar` | **Şimdilik davranışı yok.** Tür var, node'lar tanımlanabilir. Hedeflenen: takımlarınki gibi pillar başına sayfa (ortak dökümanlar, eğitim içerikleri — "Operation Plus" tarzı). Pivot fikri **düşürüldü**, örnekti. |
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
      references nodes(id) on delete cascade;
```

`cascade` yalnız **sert silme** yolunda devreye girer (§6: admin'e ait, normal
akışta yok). Gündelik kapatma `nodes.is_active` ile olur, satır silinmez.

`teams.name` artık **türetilir** (node'un adı). İki yerde ad tutmak, ikisinin
ayrışması demek — `teams.name` düşürülür ya da salt-okunur kabul edilir.

**`teams`'in kendi `is_active`'i YOKTUR.** Durum tek yerde, node'da (§6);
iki tabloda ayrı bayrak, senkron tutulması gereken ikinci bir gerçek demekti.

Aynı kalıp ileride başka türler için de: `pillar` bugün ek veri istemiyor,
sayfası yazılırken isterse `pillars (node_id primary key, ...)` eklenir.
Omurga değişmez.

## 6. Yaşam döngüsü: iki yönde SENKRON pasifleştirme

Normal akışta **hiçbir taraf sert silmez.** Her iki yön de `is_active`'i
çevirir ve bu **senkrondur**:

| kullanıcı ne yapar | ne olur |
|---|---|
| Ekipler'de kartı kapatır | `nodes.is_active = false` — node da pasifleşir |
| Veri yönetiminde node'u kapatır | Ekipler kartı pasif görünür |

Tek durum (`nodes.is_active`), iki görünüm. Uzlaştırma kutusu yok, "node
yeniden oluşturulsun mu" sorusu yok, orphan yok — çünkü hiçbir şey yok
olmuyor, yalnız durum değişiyor.

**Geçmiş kaybı asıl mesele.** Anlamsızlaşan bir pillar'a ya da kapanan bir
takıma bağlı eski kayıtlar **silinmez**: `items.node_id`, `events`, takım
duvarı, hepsi yerinde kalır. Pasif node yalnız *ileriye dönük* kaybolur —
dropdown'larda, yeni kayıt formlarında, aktif kart listelerinde çıkmaz.

Bu, §1'deki "bugünün pillar'ı yarın anlamsızlaşabilir" derdinin asıl cevabı.

**Sert silme** (`service.delete_node`, bugün ağaçtaki ✕ düğmesi) normal
akıştan çıkar: alt ağacı ve `items.node_id` üzerinden **kayıtları da** cascade
ile götürüyor. Kalırsa yalnızca admin'e ve neyin gideceğini sayan açık bir
onayla kalır; gündelik "bu artık kullanılmıyor" işi için doğru araç
pasifleştirmedir.

**Tür değiştirme: bağımlı satır varsa KİLİTLİ.** Kural genel — node'un
`node_id`'sini kullanan herhangi bir tabloda satır varsa (bugün `teams`,
yarın pillar sayfası tabloları) tür değiştirilemez. Önce o bağımlılıklar
temizlenir. Yoksa projeksiyon değişir ve veri sessizce sahipsiz kalır.

## 7. Yerleşim kuralları

Bazı türler yalnız belirli yerlerde durabilir:

```python
ROOT_ONLY = frozenset({"cell"})      # cell yalnizca kokte
```

Kural kodda, kontrol `service.add_node` / `move_node` içinde (yapı değişikliği
zaten tek yerden geçiyor). Yanlış yere pillar koymak baştan engellenir.

## 8. Pillar ↔ kayıt bağı: ERTELENDİ

Bu soruyu ("pivot hangi kayıtları toplar?") pivot doğuruyordu; pivot düşürüldü
(§4), dolayısıyla karar da **şimdi verilmiyor**. Erken vermek, ihtiyacı henüz
belli olmayan bir sütun eklemek olurdu.

Bugün yapılan: `items.pillar` **düşürülür**. Serbest metin, hiç set edilmedi
(VM'de 0 farklı değer), `EDITABLE`'da yok yani arayüzden set edilemiyor.
Ölü sütun.

```sql
alter table items drop column pillar;
```

Buna bağlı olarak **pillar filtresi de kaldırılır** — `TASK-220`'nin kabul
ettiği iki çözümden biri bu ("ya `EDITABLE`'a eklenip set edilebilir yapıldı ya
da filtre kaldırıldı"). Kayıtla bağı olmayan bir boyutta filtre olamaz.

Pillar sayfası (§4) yazılırken soru geri gelir. O gün seçenekler:

- **(a) Türetilmiş** — kayıt hangi cell'in altındaysa o cell'in pillar'ı. Basit,
  tutarsızlık imkânsız, ama bir cell tek pillar'a bağlanır: **matris kaybolur**.
- **(b) Ayrı boyut** — `items.pillar_node_id`. IWS'te pillar × cell matris
  olduğu için doğal duran bu; VM'deki `Pillars` dalı da zaten kayıt defteri
  şeklinde (altında gerçek kayıt yok, tanım var).

## 9. Üyelik ≠ yetki

Takım node olunca şu ikisi aynı şeye benzer ama **değildir**:

| | ne demek |
|---|---|
| `team_members` | "bu takımdayım" — üyelik |
| `user_node_scopes` | "bu dalda düzenleyebilirim" — yetki |

Aynı node üzerinde ikisi de bulunabilir. Karıştırılırsa "takıma ekledim"
sessizce "düzenleme yetkisi verdim"e döner — üretim veritabanını stajyere
teslim etmek gibi.

**Kural: takım üyeliği hiçbir koşulda dal yetkisi doğurmaz.** Node'laşma bunu
değiştirmez; `user_node_scopes` tek yetki kaynağı olarak kalır.

> Ayrı ve mevcut bir konu: `shared/auth.py:126` bugün **kart** düzeyinde takım
> üyeliğini bir yetki yolu sayıyor (`item.team_id` kullanıcının takımlarındaysa
> düzenleyebiliyor — `KNOW-64`'ün beş yolundan biri). Bu dal yetkisi değil, tek
> kartlık yetki; ama "üyelik yetki doğurmaz" ilkesiyle gerginliği var. Bu
> belgenin kapsamı dışında — değişecekse ayrı bir karar, çünkü bugün o yolla
> düzenleyen insanlar yetkilerini kaybeder.

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
