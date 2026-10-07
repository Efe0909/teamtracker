# EkipTakip — Ekip kullanım rehberi

Demo verisiyle hazırlanmış, adım adım ekran rehberi. Adlar, e-postalar ve kayıtlar kurgudur. PDF sürümü: `EkipTakip-Rehber.pdf`.

## İçindekiler

1. [Giriş ve Panolar](#bolum-1) — Kaan Demir, 7 adım
2. [Görevler: haftayı tara](#bolum-2) — Kaan Demir, 14 adım
3. [Yeni kayıt aç](#bolum-3) — Kaan Demir, 15 adım
4. [Kayıt sayfası: tarih, eylem, kişi](#bolum-4) — Kaan Demir, 18 adım
5. [İşi bitir ve kaydı kapat](#bolum-5) — Can Özdemir, 15 adım
6. [Sohbet: konuş, an, görsel paylaş](#bolum-6) — Kaan Demir, 15 adım
7. [Kartlar: havuz, oylama, toplantı](#bolum-7) — Kaan Demir, 12 adım
8. [Kartlara cevap ver: toplantı, oy, gönüllülük](#bolum-8) — Selin Arslan, 6 adım
9. [Etkinlikler: takvime bak](#bolum-9) — Kaan Demir, 11 adım
10. [Yeni etkinlik oluştur](#bolum-10) — Kaan Demir, 16 adım
11. [Zaman çizelgesi: adımı bitir, onay iste](#bolum-11) — Zeynep Koç, 4 adım
12. [Etkinlik sorumlusu: onayla ve planı düzenle](#bolum-12) — Kaan Demir, 8 adım
13. [Etkinliğe kişi, takım ve kayıt bağla](#bolum-13) — Kaan Demir, 14 adım
14. [Satın alımlar: malzemeyi takip et](#bolum-14) — Elif Şahin, 13 adım
15. [OTF formu: doldur, gözden geçir, gönder](#bolum-15) — Selin Arslan, 11 adım
16. [Takımlar: ekibini ve duvarını gör](#bolum-16) — Kaan Demir, 10 adım
17. [Takım kur, üye ve birim ekle](#bolum-17) — Ayşe Çelik, 14 adım
18. [Ekip, profil ve bildirimler](#bolum-18) — Kaan Demir, 8 adım
19. [Pillar'lar: kesişen sorumluluklar](#bolum-19) — Kaan Demir, 4 adım
20. [Veri yönetimi: birim ağacı](#bolum-20) — Kaan Demir, 12 adım
21. [Veri yönetimi: etkinlik türleri ve yerleri](#bolum-21) — Kaan Demir, 11 adım
22. [Yönetim: kim girer, neyi yapabilir](#bolum-22) — Defne Aksoy, 17 adım
23. [Yönetim: aktivite ve kalite kapısı](#bolum-23) — Defne Aksoy, 6 adım
24. [Mobil uygulama: sahada telefonla](#bolum-24) — Kaan Demir, 24 adım

## Birim ağacı

```
Etkinlik(Cell)
    |Takvim Planlama(Makine)
    |   |Etkinlik fikiri bulma(Görev)
    |   |Takvim Oluşturma(Görev)
    |Etkinlik Planlama(Makine)
    |   |Katılımcı Sayısı Belirleme(Adım)
    |   |Mekan ve Yer Seçimi(Adım)
    |   |Malzeme ve Kaynak Planlama(Görev)
    |   |Etkinlik Öncesi Hazırlık(Görev)
    |   |Ekip ve Görev Dağılımı(Görev)
    |SEB iletişim(Makine)
    |   |ETF(Adım)
    |   |OTF(Adım)
    |   |Ek talepler(Görev)
```

| Birim | Tür | Ne yapılır? |
|---|---|---|
| **Etkinlik** | Cell | Kulübün bütün etkinliklerinin fikirden sonuç raporuna kadar yürüdüğü ana hücre. |
| &nbsp;&nbsp;**Takvim Planlama** | Makine | Dönemin etkinlik takvimini kurar: girdisi fikir havuzu, çıktısı onaylı takvimdir. |
| &nbsp;&nbsp;&nbsp;&nbsp;**Etkinlik fikiri bulma** | Görev | Üyelerden gelen önerileri toplayıp değerlendirerek takvime girecek fikirleri seçmek. |
| &nbsp;&nbsp;&nbsp;&nbsp;**Takvim Oluşturma** | Görev | Seçilen fikirleri tarih, yer ve sorumlu ile dönem takvimine yerleştirip yayınlamak. |
| &nbsp;&nbsp;**Etkinlik Planlama** | Makine | Tek bir etkinliğin hazırlığını yürütür: girdisi onaylı fikir, çıktısı hazır etkinliktir. |
| &nbsp;&nbsp;&nbsp;&nbsp;**Katılımcı Sayısı Belirleme** | Adım | Beklenen katılımcı sayısını kayıt formu ve geçmiş etkinliklerle tahmin etme adımı. |
| &nbsp;&nbsp;&nbsp;&nbsp;**Mekan ve Yer Seçimi** | Adım | Katılımcı sayısına ve ihtiyaca uygun mekanı seçip rezervasyonunu alma adımı. |
| &nbsp;&nbsp;&nbsp;&nbsp;**Malzeme ve Kaynak Planlama** | Görev | Etkinlik için gereken malzeme, bütçe ve sponsor kaynaklarını listeleyip temin etmek. |
| &nbsp;&nbsp;&nbsp;&nbsp;**Etkinlik Öncesi Hazırlık** | Görev | Afiş, duyuru, kayıt masası ve son kontroller gibi etkinlik öncesi işleri tamamlamak. |
| &nbsp;&nbsp;&nbsp;&nbsp;**Ekip ve Görev Dağılımı** | Görev | Etkinlik gününde kimin hangi görevi ve vardiyayı üstleneceğini belirlemek. |
| &nbsp;&nbsp;**SEB iletişim** | Makine | SEB ile yazışmaları yürütür: girdisi etkinlik bilgisi, çıktısı onaylanmış formlardır. |
| &nbsp;&nbsp;&nbsp;&nbsp;**ETF** | Adım | ETF formunun hazırlanıp SEB'e iletildiği adım. |
| &nbsp;&nbsp;&nbsp;&nbsp;**OTF** | Adım | Organizasyon ve Etkinlik Talep Formu'nu (OTF) en geç 3 iş günü önce SEB'e göndermek. |
| &nbsp;&nbsp;&nbsp;&nbsp;**Ek talepler** | Görev | Projeksiyon, ses sistemi, güvenlik gibi formlara sığmayan ek ihtiyaçları SEB'den istemek. |

## Etkinlik türleri

| Tür | Açıklama | Adımlar | Widget'lar |
|---|---|---|---|
| **Toplantı** |  | Gündem toplandı (-10 gün) · OTF gönderildi (-7 gün) · Davet gönderildi (-7 gün) | OTF formu |
| **Eğitim** |  | Eğitmen kesinleşti (-21 gün) · Mekan ayarlandı (-14 gün) · OTF gönderildi (-7 gün) · Malzeme hazır (-7 gün) | OTF formu, Satın alımlar |
| **Sosyal** |  | Bütçe onayı (-21 gün) · Mekan ayarlandı (-14 gün) · OTF gönderildi (-7 gün) · Duyuru (-7 gün) | OTF formu |
| **Saha ziyareti** |  | Ziyaret onayı (-21 gün) · Ulaşım ayarlandı (-7 gün) | — |
| **Konferans** |  | Başvuru (-45 gün) · Stand kesinleşti (-30 gün) · Tanıtım (-10 gün) · Malzeme hazır (-7 gün) | Satın alımlar |
| **Atölye** | Uygulamalı, küçük gruplu eğitim: eğitmen, malzeme ve OTF gerektirir. | Eğitmen kesinleşti (-21 gün) · Mekan ayarlandı (-14 gün) · Duyuru yapıldı (-10 gün) · OTF gönderildi (-7 gün) · Malzeme hazır (-7 gün) | Satın alımlar, OTF formu |
| **Yarışma** | Takımların yarıştığı hackathon, robot ya da tasarım yarışması. | Jüri belirlendi (-30 gün) · Kural kitapçığı yayınlandı (-21 gün) · Kayıtlar açıldı (-14 gün) · OTF gönderildi (-7 gün) · Sonuçlar duyuruldu (1 gün) | OTF formu, Satın alımlar |
| **Tanıtım Standı** | Kampüste açılan stand: üye toplama, ürün gösterimi, imza günü. | Stand alanı onaylandı (-14 gün) · Malzeme hazır (-7 gün) | Satın alımlar |

## Etkinlik yerleri

| Yer | Açıklama |
|---|---|
| **Maker Atölyesi (B Blok)** | Lehim, 3B yazıcı ve elektronik tezgâhların bulunduğu atölye; en fazla 30 kişi. |
| **Konferans Salonu (A Blok)** | Sunum ve panel için 120 kişilik salon; projeksiyon ve ses sistemi hazır. |
| **Öğrenci Merkezi Toplantı Odası** | Yönetim kurulu ve haftalık koordinasyon toplantıları için 15 kişilik oda. |
| **Merkez Kampüs Meydanı** | Açık hava etkinlikleri ve stand kurulumları için kampüsün orta alanı. |
| **Kütüphane Çalışma Salonu** | Sessiz çalışma ve küçük grup eğitimleri için kütüphanenin üst kat salonu. |
| **Yemekhane Önü** | Tanıtım standı ve imza toplama etkinlikleri için yoğun geçiş alanı. |

<a id="bolum-1"></a>
## 1. Giriş ve Panolar

*Kaan Demir — Etkinlik koordinatörü.* Salı sabahı. Kaan, haftaya başlamadan önce EkipTakip'e girip önünde ne olduğuna bakıyor.

### 1.1 Giriş sayfasını aç

Ekibin adresine git. Masaüstü panelini seç ve Google ile devam et'e bas. Yalnızca ekibe davet edilmiş e-postalar girebilir.

> İpucu: Telefonda Mobil uygulama'yı seç; aynı hesapla çalışır.

![Giriş sayfasını aç](shots/001-giris-sayfasi.jpg)

### 1.2 Panolar: günün özeti

Giriş yapınca Panolar açılır. Üstteki dört sayaç sana ve ekibe ait işi özetler: açık eylemlerin, geciken kayıtlar, atanmamış işler ve toplam açık kayıt.

![Panolar: günün özeti](shots/002-panolar.jpg)

### 1.3 Kenar çubuğu: tüm modüller

Soldaki çubuktan Görevler, Etkinlikler, Takımlar, Ekip, Pillar'lar ve Veri yönetimi'ne geçersin. Takımların ve pillar'ların kısayolları altta; üye rozeti hangilerinde olduğunu gösterir.

![Kenar çubuğu: tüm modüller](shots/003-panolar-kenar.jpg)

### 1.4 Geciken kayıtlara git

Kırmızı sayaç bir şey gecikmiş demek. Geciken kayıt kutusuna tıkla; liste doğrudan o filtreyle açılır.

![Geciken kayıtlara git](shots/004-panolar-geciken.jpg)

### 1.5 Gecikenler tek listede

Son tarihi geçmiş kayıtlar (ve gecikmiş eylemi olanlar) burada. Gecikme yalnız renkle değil “1 gün gecikti” yazısıyla da belirtilir.

![Gecikenler tek listede](shots/005-geciken-liste.jpg)

### 1.6 Her yere ⌘K ile git

Herhangi bir sayfada ⌘K (Windows'ta Ctrl+K) komut paletini açar. Kayıt, etkinlik, takım ve sayfa aramak için tek kutu.

![Her yere ⌘K ile git](shots/006-palet-ac.jpg)

### 1.7 Aradığını yazarak bul

“arduino” yazınca eşleşen kayıtlar ve etkinlikler listelenir. Enter ile açılır, Esc ile kapanır.

![Aradığını yazarak bul](shots/007-palet-sonuc.jpg)


<a id="bolum-2"></a>
## 2. Görevler: haftayı tara

*Kaan Demir — Etkinlik koordinatörü.* Kaan işe önce Görevler tablosuna bakıyor: neyin sırası geldi, hangisi kimde bekliyor, hangisi gecikti?

### 2.1 Görevler'i aç

Kenar çubuğundan Görevler'e tıkla. Bütün kayıtlar tek tabloda toplanır.

![Görevler'i aç](shots/008-gorevler-ac.jpg)

### 2.2 Tabloyu oku

Her satır bir kayıt. Hata (kırmızı) bir şeyin ters gittiğini, Görev (mavi) yapılacak işi gösterir. Etkinlik etiketi kaydın bir etkinliğin kendi kaydı olduğunu, balon simgesi mesaj sayısını söyler.

![Tabloyu oku](shots/009-gorevler-tablo.jpg)

### 2.3 Sadece benim eylemlerim

Üstteki sekmeler hızlı filtredir. Açık eylemim, sana atanmış açık eylemi olan kayıtları getirir.

![Sadece benim eylemlerim](shots/010-gorevler-eylemim.jpg)

### 2.4 Önce bunlara bak

Liste kısaldı: Panolar'daki Açık eylemim sayacıyla aynı kayıtlar. Sekmeyi Hepsi'ne çevirerek tüm tabloya dön.

![Önce bunlara bak](shots/011-gorevler-eylemim-sonuc.jpg)

### 2.5 Durum filtresini aç

Filtre çipleri tek satırda durur. Boş çip kesikli çizgilidir; Durum'a tıkla.

![Durum filtresini aç](shots/012-gorevler-durum.jpg)

### 2.6 Durumu seç

Listeden Beklemede'yi seç: yalnızca bir yanıt, onay ya da malzeme bekleyen kayıtlar kalır.

![Durumu seç](shots/013-gorevler-durum-sec.jpg)

### 2.7 Filtre çipi dolu görünür

Seçili filtre koyu çipte yazar: Durum: Beklemede. Sağdaki sayaç kaç kaydın açık/kapalı olduğunu söyler. Filtreler adres çubuğuna yazılır; adresi kopyalayıp ekip arkadaşına gönderebilirsin.

![Filtre çipi dolu görünür](shots/014-gorevler-durum-sonuc.jpg)

### 2.8 Birime göre süz

Birim çipi birim ağacını açar. Kayıtlar ağaçtaki yerlerine göre süzülür.

![Birime göre süz](shots/015-gorevler-birim.jpg)

### 2.9 Ağaçta ara, favoriye ekle

Üstte Favoriler (yıldızla işaretlediklerin), altında ağaç durur. Okla dalı aç/kapa; arama kutusu eşleşen dalları kendiliğinden açar.

![Ağaçta ara, favoriye ekle](shots/016-gorevler-birim-agac.jpg)

### 2.10 Yazdıkça daralır

“mekan” yazınca yalnız eşleşen birim ve üstündeki dallar kalır. Mekan ve Yer Seçimi'ni seç.

![Yazdıkça daralır](shots/017-gorevler-birim-ara.jpg)

### 2.11 Birim filtresi uygulandı

Tablo yalnızca o birimdeki kayıtları gösterir. Çipin yanındaki × yalnız birim süzgecini kaldırır, Temizle hepsini.

![Birim filtresi uygulandı](shots/018-gorevler-birim-sonuc.jpg)

### 2.12 Başlıkta ve açıklamada ara

Arama kutusu başlık ve açıklamayı tarar; yazmayı bırakınca sonuçlar gelir. Türkçe karakterlere duyarsızdır (“afis” de “afiş”i bulur).

![Başlıkta ve açıklamada ara](shots/019-gorevler-ara.jpg)

### 2.13 Sütun başlığına tıklayıp sırala

Son tarih başlığına tıkla: artan, bir daha tıkla: azalan, üçüncüde sıralama kapanır. Sütun kenarından sürükleyerek genişliği de ayarlayabilirsin.

![Sütun başlığına tıklayıp sırala](shots/020-gorevler-sirala.jpg)

### 2.14 En yakın tarih üstte

Tarihi olmayanlar sona gider. Sıralama tablo başına cihazında hatırlanır.

![En yakın tarih üstte](shots/021-gorevler-sirala-sonuc.jpg)


<a id="bolum-3"></a>
## 3. Yeni kayıt aç

*Kaan Demir — Etkinlik koordinatörü.* Atölye günü için ek prizler gerekiyor. Kaan bunu kayda dökerek sorumlusunu ve birimini belirliyor.

### 3.1 Yeni kayıt düğmesine bas

Görevler'de ya da Panolar'da sağ üstteki Yeni kayıt'a tıkla. Her üye her birimde kayıt açabilir.

![Yeni kayıt düğmesine bas](shots/022-yeni-kayit-ac.jpg)

### 3.2 Kısa ve aranabilir bir başlık yaz

Başlık en az 5, açıklama en az 30 karakter olmalı; sayaç altta görünür. Başlık, ekibin sonradan arayıp bulacağı şey.

![Kısa ve aranabilir bir başlık yaz](shots/023-yeni-kayit-baslik.jpg)

### 3.3 Ne, neden, kim için?

Açıklamaya işin ne olduğunu, neden gerektiğini ve kimin için olduğunu yaz. Kısa tutulursa kayıt açılmaz.

![Ne, neden, kim için?](shots/024-yeni-kayit-aciklama.jpg)

### 3.4 Hata mı, görev mi?

Tür çipinden seç: Hata bir şey ters gittiyse, Görev yapılacak bir iş içindir.

![Hata mı, görev mi?](shots/025-yeni-kayit-tur.jpg)

### 3.5 Görev'i seç

Bu bir iş: Görev'i seç.

![Görev'i seç](shots/026-yeni-kayit-tur-sec.jpg)

### 3.6 Kaydın ağaçtaki yerini seç

Birim kaydın hangi işe ait olduğunu söyler. Ağaç açılır; Favoriler'den hızlıca seçebilirsin.

![Kaydın ağaçtaki yerini seç](shots/027-yeni-kayit-birim.jpg)

### 3.7 Malzeme ve Kaynak Planlama

Bu iş malzemeyle ilgili: Malzeme ve Kaynak Planlama'yı seç. Sıfırdan aramak için kutuya birimin adını yaz.

![Malzeme ve Kaynak Planlama](shots/028-yeni-kayit-birim-sec.jpg)

### 3.8 Sorumluyu seç

Varsayılan sorumlu kaydı açan sensin. Sorumlu çipinden başkasını seçebilir ya da Sorumlusuz açabilirsin.

![Sorumluyu seç](shots/029-yeni-kayit-sorumlu.jpg)

### 3.9 Can Özdemir'e ata

Prizleri sayacak kişi atölyeden sorumlu Can. Seçtiğin kişi kaydın sorumlusu olur; adı listelerde ve kayıt sayfasında görünür.

![Can Özdemir'e ata](shots/030-yeni-kayit-sorumlu-sec.jpg)

### 3.10 Takım ve öncelik

Takım çipi kaydı bir takıma bağlar: takımın üyeleri kaydı düzenleyebilir. Öncelik Kritik, Yüksek, Orta ya da Düşük olur.

![Takım ve öncelik](shots/031-yeni-kayit-takim-oncelik.jpg)

### 3.11 Kimler görsün?

Erişim: Herkese açık (herkes görür, tek tıkla katılır), İzinle katılım (sorumlu onaylar) ya da Gizli (içeriği yalnız katılımcılar görür).

![Kimler görsün?](shots/032-yeni-kayit-erisim.jpg)

### 3.12 Üç erişim kipi

Çoğu iş Herkese açık kalır. Hassas konular için Gizli'yi seç. Sonradan kayıt sayfasından değiştirilir.

![Üç erişim kipi](shots/033-yeni-kayit-erisim-sec.jpg)

### 3.13 İstersen boş kart blokları ekle

Kart blokları isteğe bağlı: Medya eki (görseller), Toplantı planı, Havuz kartı (gönüllü topla). Kayıt açıldıktan sonra da eklenir.

![İstersen boş kart blokları ekle](shots/034-yeni-kayit-kartlar.jpg)

### 3.14 Kaydı aç

Her şey tamamsa Kaydı aç'a bas. Kayıt açılır ve doğrudan kayıt sayfasına gidersin.

![Kaydı aç](shots/035-yeni-kayit-gonder.jpg)

### 3.15 Kayıt hazır

Yeni kayıt sayfası: üstte başlık, ortada özellikler ve eylemler, sağda sohbet. Bir sonraki bölümde bunları kullanacağız.

![Kayıt hazır](shots/036-yeni-kayit-sayfa.jpg)


<a id="bolum-4"></a>
## 4. Kayıt sayfası: tarih, eylem, kişi

*Kaan Demir — Etkinlik koordinatörü.* Kaan az önce açtığı kaydı ekibe dağıtıyor: son tarih koyuyor, eylemleri sahipleriyle ekliyor, Elif'i işe dahil ediyor.

### 4.1 Kaydı listeden bul ve aç

Görevler'de arama kutusuna birkaç harf yaz, satırdaki başlığa tıkla. Kayıt kendi sayfasında açılır.

![Kaydı listeden bul ve aç](shots/037-kayit-bul.jpg)

### 4.2 Kayıt sayfası beş bölümden oluşur

Üstte başlık ve açıklama, altında özellikler, sonra eylemler ve kartlar. Sağdaki sütun kaydın kendi sohbeti. Tek bir iş için gereken her şey bu sayfada.

![Kayıt sayfası beş bölümden oluşur](shots/038-kayit-genel.jpg)

### 4.3 Kayda son tarih ver

Son tarih satırındaki “Tarih ekle”ye tıkla. Tarihi olmayan işin ne zaman biteceği belli olmaz; gecikme de ancak tarih varsa görünür.

![Kayda son tarih ver](shots/039-kayit-tarih.jpg)

### 4.4 Takvimden günü seç

Takvim Pazartesi'den başlar. Hızlı seçim için Bugün, Yarın, +1 hafta düğmeleri var; ok tuşlarıyla da gezilir.

![Takvimden günü seç](shots/040-kayit-tarih-sec.jpg)

### 4.5 Kaydedildi — geri alınabilir

Değişiklik hemen kaydedilir. Alttaki bildirimde Geri al varsa yanlış seçimi birkaç saniye içinde geri çevirebilirsin.

![Kaydedildi — geri alınabilir](shots/041-kayit-tarih-sonuc.jpg)

### 4.6 İşi eylemlere böl

Kayıt büyük bir iş; eylem onun içindeki tek kişilik adımdır. “Yeni eylem ekle…” kutusuna yapılacağı yaz: kim, ne yapacak?

![İşi eylemlere böl](shots/042-eylem-baslik.jpg)

### 4.7 Eylemin sahibini seç

Sahibi seçmezsen eylem Havuzda kalır: ekipten herkes “Üstlen” diyerek alabilir.

![Eylemin sahibini seç](shots/043-eylem-sahip.jpg)

### 4.8 Can Özdemir'i seç

Sahip eylemin topunu tutan kişidir; eylem onun Panolar'daki Açık eylemim sayacına yazılır.

![Can Özdemir'i seç](shots/044-eylem-sahip-sec.jpg)

### 4.9 Eyleme de tarih koy

Her eylemin kendi son tarihi olur. Tarihi geçen eylem, kaydı da geciken listesine düşürür.

![Eyleme de tarih koy](shots/045-eylem-tarih.jpg)

### 4.10 Ekle'ye bas

Başlık, sahip ve tarih tamamsa Ekle. Enter tuşu da aynı işi yapar.

![Ekle'ye bas](shots/046-eylem-ekle.jpg)

### 4.11 Eylemler sahipleriyle listelenir

Her satırda durum, başlık, tarih ve sahip var; hepsi satırın içinden değiştirilir. Başlıktaki “2 açık” sayacı bitmemiş eylem sayısıdır.

![Eylemler sahipleriyle listelenir](shots/047-eylem-liste.jpg)

### 4.12 “Top kimde?” satırı

Özelliklerin altındaki satır işin şu an kimde beklediğini söyler: açık eylemlerin sahipleri ve son hareketin zamanı. Tıklayınca son güncellemeler açılır.

![“Top kimde?” satırı](shots/048-top-kimde.jpg)

### 4.13 Son hareketler

Yöneticiler “bu iş neden durdu?” sorusunun cevabını buradan görür: en yeni eylem ve kayıt değişiklikleri üstte.

![Son hareketler](shots/049-top-kimde-acik.jpg)

### 4.14 Başkalarını işe dahil et

Başlığın altındaki avatarlar kaydın katılımcıları. Küçük +'ya tıklayıp ekibi ekleyebilirsin; katılımcılar kaydı düzenleyebilir, sohbette bildirim alır.

![Başkalarını işe dahil et](shots/050-katilimci.jpg)

### 4.15 Kişiyi işaretle

Arama kutusuna adını yaz ve kutucuğu işaretle. Kaldırmak için işareti geri al.

![Kişiyi işaretle](shots/051-katilimci-sec.jpg)

### 4.16 Elif artık katılımcı

Avatar yığınına Elif eklendi. Sohbette birini @ad diye anarsan o kişi de otomatik katılımcı olur (sohbet bölümünde göreceğiz).

![Elif artık katılımcı](shots/052-katilimci-sonuc.jpg)

### 4.17 Sık baktığın kaydı sabitle

Başlığın yanındaki yıldız kaydı Panolar'a sabitler. Takip ettiğin birkaç iş her sabah tek bakışta orada durur.

![Sık baktığın kaydı sabitle](shots/053-sabitle.jpg)

### 4.18 Panolar'da “Sabitlenenler”

Sabitlenen kayıtlar Panolar'ın en üstünde. Yıldıza bir daha basınca (“Sabitlemeyi kaldır”) listeden çıkar.

![Panolar'da “Sabitlenenler”](shots/054-sabitle-sonuc.jpg)


<a id="bolum-5"></a>
## 5. İşi bitir ve kaydı kapat

*Can Özdemir — Atölye sorumlusu.* Can kendisine atanan iki eylemi tek tek bitiriyor, sonra işin tamamını kapatıyor. Her kapanışta kısa bir not bırakıyor.

### 5.1 Güne “Açık eylemim” ile başla

Panolar'daki Açık eylemim sayacı, sana atanmış ve bitmemiş eylemleri sayar. Kaan'ın eklediği iki eylem de bu sayıya yazıldı. Sayaca tıkla.

![Güne “Açık eylemim” ile başla](shots/055-bitir-panolar.jpg)

### 5.2 Sana ait kayıtlar listelenir

Liste yalnızca üzerinde açık eylemin olan kayıtları gösterir. Kaydı aç.

![Sana ait kayıtlar listelenir](shots/056-bitir-liste.jpg)

### 5.3 İşe başlayınca durumu güncelle

Kayıt Açık durumda. İşe başladığında Durum satırından değiştir; ekip kaydın ilerlediğini tabloda ve Panolar'da görür.

![İşe başlayınca durumu güncelle](shots/057-bitir-durum.jpg)

### 5.4 Devam'ı seç

Açık → Devam (üzerinde çalışılıyor) → Beklemede (başkasından yanıt, onay ya da malzeme bekleniyor) → Kapandı.

![Devam'ı seç](shots/058-bitir-durum-sec.jpg)

### 5.5 Eylemi bitir

Eylemin sağındaki ✓ düğmesi onu bitirir. Bitirirken bir kapanış notu istenir: ne yapıldı, sonuç ne?

![Eylemi bitir](shots/059-bitir-eylem.jpg)

### 5.6 Kapanış notunu yaz

Not en az 30 karakter olmalı; sayaç altta. Sonradan “bu iş nasıl bitmişti?” diye bakan herkes bu satırı okuyacak.

![Kapanış notunu yaz](shots/060-bitir-eylem-not.jpg)

### 5.7 Kapat'a bas

Not yeterliyse Kapat etkinleşir. Eylem biter, notu satırın yanında kalır.

![Kapat'a bas](shots/061-bitir-eylem-kapat.jpg)

### 5.8 Eylem tamamlandı

Biten eylem listenin altına iner ve soluklaşır; başlıkta “1 açık · 1 bitti” yazar. Notu eylemin yanındadır.

![Eylem tamamlandı](shots/062-bitir-eylem-sonuc.jpg)

### 5.9 Açık eylem varken kayıt kapanmaz

Durum listesinde Kapandı soluk ve yanında “1 açık eylem” yazıyor. Önce kalan eylemi bitirmen gerekir; kural reddedilince değil, daha seçmeden söylenir.

![Açık eylem varken kayıt kapanmaz](shots/063-bitir-engel.jpg)

### 5.10 Kapandı seçilemiyor

Listeyi kapat (Esc) ve ikinci eylemi bitir.

![Kapandı seçilemiyor](shots/064-bitir-engel-liste.jpg)

### 5.11 Şimdi kaydı kapatabilirsin

İki eylem de bitti, başlık “0 açık · 2 bitti” diyor. Durum'u tekrar aç.

![Şimdi kaydı kapatabilirsin](shots/065-bitir-kayit.jpg)

### 5.12 Kapandı'yı seç

Kapandı artık seçilebilir. Seçince kaydın kapanış notunu soran pencere açılır.

![Kapandı'yı seç](shots/066-bitir-kayit-sec.jpg)

### 5.13 Kaydın kapanış notunu yaz

Kayıt notu, işin sonucunu özetler: ne yapıldı, geriye ne kaldı, kim devraldı. Yine en az 30 karakter.

![Kaydın kapanış notunu yaz](shots/067-bitir-kayit-not.jpg)

### 5.14 Kaydı kapat

Kapat'a bas. Kapalı kayıt silinmez; arşivde durur, istenirse Durum'dan yeniden açılabilir.

![Kaydı kapat](shots/068-bitir-kayit-kapat.jpg)

### 5.15 Kayıt kapandı

Durum Kapandı; kapanış notu açıklamanın altında görünür. “Top kimde” satırı kalktı çünkü iş bitti. Panolar'daki ve Görevler'deki açık sayıları da bir düştü.

![Kayıt kapandı](shots/069-bitir-kayit-sonuc.jpg)


<a id="bolum-6"></a>
## 6. Sohbet: konuş, an, görsel paylaş

*Kaan Demir — Etkinlik koordinatörü.* Afiş taslakları hakkında konuşulan kayıtta Kaan baskı teklifine yanıt veriyor, Elif'i anıyor ve yerleşim planını paylaşıyor.

### 6.1 Sabitlediğin kaydı Panolar'dan aç

Panolar'daki Sabitlenenler listesi, takip ettiğin kayıtlara tek tıkla götürür.

![Sabitlediğin kaydı Panolar'dan aç](shots/070-sohbet-ac.jpg)

### 6.2 Her kaydın kendi sohbeti var

Sağdaki Sohbet sütunu bu işe özel. Mesajlar, görseller ve sistem satırları (durum, tarih, eylem değişiklikleri) tek akışta, zaman sırasıyla durur. Yeni mesajlar altta.

![Her kaydın kendi sohbeti var](shots/071-sohbet-genel.jpg)

### 6.3 Görsele tıklayıp büyüt

Sohbette paylaşılan görseller küçük görünür. Tıklayınca pencerede tam boyutu açılır.

![Görsele tıklayıp büyüt](shots/072-sohbet-gorsel-ac.jpg)

### 6.4 Tam boyutta incele

Pencerede görsel büyük görünür; Tam boyut yeni sekmede açar. Etiketleme yetkisi olanlar buradan etiket de ekler. Esc ile kapat.

![Tam boyutta incele](shots/073-sohbet-gorsel-buyuk.jpg)

### 6.5 Bir mesaja yanıt ver

Mesajın altındaki Yanıtla, cevabını o mesaja bağlar; kalabalık sohbette neye cevap verdiğin belli olur.

![Bir mesaja yanıt ver](shots/074-sohbet-yanitla.jpg)

### 6.6 @ yazınca kişi önerilir

Adın başına @ koy: öneriler çıkar. Enter ya da Tab ilkini seçer. Anılan kişi bildirim alır ve kayda katılımcı olarak eklenir. Grup anmaları da var: @all (sohbetteki herkes), @here (son 10 dakikada görülenler), @team (kaydın takımı).

![@ yazınca kişi önerilir](shots/075-sohbet-anma.jpg)

### 6.7 Mesajını tamamla ve gönder

Üstte yanıt verdiğin mesaj gri şeritte görünür (× ile vazgeçilir). Enter gönderir, Shift+Enter yeni satır açar; Gönder düğmesi de aynı işi yapar.

![Mesajını tamamla ve gönder](shots/076-sohbet-yaz.jpg)

### 6.8 Mesajın gitti

Senin mesajların mor, başkalarınınkiler gri balonda. Anma vurgulu görünür; yanıt verdiğin mesaj balonun üstünde alıntılanır, tıklayınca ona kayar.

![Mesajın gitti](shots/077-sohbet-sonuc.jpg)

### 6.9 Görsel eklemek için resim simgesi

Mesaj kutusunun solundaki resim simgesi dosya seçtirir. Bir mesaja en fazla 4 görsel eklenir; yükleme seçer seçmez başlar.

![Görsel eklemek için resim simgesi](shots/078-sohbet-gorsel-ekle.jpg)

### 6.10 Seçilen görsel mesajla gider

Dosya adı kutunun üstünde çıkar; yanlışsa × ile çıkarılır. Metin yazmak zorunlu değil: yalnız görsel de gönderilebilir.

![Seçilen görsel mesajla gider](shots/079-sohbet-gorsel-hazir.jpg)

### 6.11 Görsel sohbette

Görsel metnin üstünde görünür. Aynı görseli kayda kalıcı koymak istersen bir Medya eki kartı kullan (Kartlar bölümünde).

![Görsel sohbette](shots/080-sohbet-gorsel-sonuc.jpg)

### 6.12 Sohbetten çıkmadan eylem aç

Konuşurken bir iş çıktıysa ⚡ Hızlı eylem'e bas: “kim ne yapacak?” formu pencerede açılır. Eylem, kaydın Eylemler listesine eklenir.

![Sohbetten çıkmadan eylem aç](shots/081-sohbet-hizli.jpg)

### 6.13 Başlığı yaz, sahibini seç

Yeni eylem formuyla aynı alanlar: başlık, tarih, sahip. Ekle'ye basınca pencere kapanır, eylem listeye düşer.

![Başlığı yaz, sahibini seç](shots/082-sohbet-hizli-form.jpg)

### 6.14 Bu sohbetin bildirimlerini ayarla

Sohbetin üstündeki zil sadece bu kayıt için bildirim düzeyini seçtirir: her hareket, yalnızca anıldığımda ya da sessize al. Kalabalık bir kaydı susturmak için ideal.

![Bu sohbetin bildirimlerini ayarla](shots/083-sohbet-bildirim.jpg)

### 6.15 Düzeyi seç

Varsayılan, kişisel bildirim ayarını izler (profilinden değişir). Bir düzey seçersen yalnız bu sohbet için o geçerli olur.

![Düzeyi seç](shots/084-sohbet-bildirim-menu.jpg)


<a id="bolum-7"></a>
## 7. Kartlar: havuz, oylama, toplantı

*Kaan Demir — Etkinlik koordinatörü.* Atölye günü için vardiya çizelgesi kaydında Kaan gönüllü toplamak ve ekibe bir şey sormak istiyor. Bunun için kayda kart ekliyor.

### 7.1 Kartlar: kayda eklenen küçük araçlar

Kayıt sayfasının Kartlar bölümü, yazıdan fazlası gereken işler için. Bu kayıtta zaten bir Medya eki (yerleşim planı) ve bir Toplantı planı var. Yeni kart için Kart ekle'ye bas.

![Kartlar: kayda eklenen küçük araçlar](shots/085-kart-bolum.jpg)

### 7.2 Dört kart türü

Medya eki görselleri kayıtla birlikte tutar, Toplantı planı zaman ve yer bilgisi ile katılım sorar, Oylama ekipten tek soruda görüş toplar, Havuz kartı gönüllü arar. Kaan Havuz kartı'nı seçiyor.

![Dört kart türü](shots/086-kart-menu.jpg)

### 7.3 Kart boş doğar, sen doldurursun

Yeni kartta yalnızca türün ipucu görünür. Kartın sağ üstündeki kaleme basıp başlık ve ayrıntıları gir.

![Kart boş doğar, sen doldurursun](shots/087-kart-havuz-bos.jpg)

### 7.4 Kaç kişi lazım, ne yapılacak?

Kişi sayısı hedefi, Ne yapılacak gönüllünün işini anlatır. Atama yok: isteyen kendisi “Bu işi alıyorum” der.

![Kaç kişi lazım, ne yapılacak?](shots/088-kart-havuz-form.jpg)

### 7.5 Gönüllü kartı hazır

Kart, ne kadar kişi gerektiğini yazar; kimler üstlendikçe adları altına eklenir. Bu kartı ekibe sohbetten @all ile duyurabilirsin.

![Gönüllü kartı hazır](shots/089-kart-havuz-sonuc.jpg)

### 7.6 Ekibe bir şey sormak için Oylama

Aynı menüden Oylama'yı seç. Sorunu ve seçenekleri yazacağın bir pencere açılır.

![Ekibe bir şey sormak için Oylama](shots/090-kart-oylama-sec.jpg)

### 7.7 Soruyu ve seçenekleri yaz

Seçenek ekle ile en fazla 10 seçenek ekleyebilirsin. “Diğer” seçeneği işaretliyse kişi kendi cevabını yazar, ayrı sekmede toplanır. Altta medya, sayaç ve çoklu seçim opsiyonları var (yalnız oluştururken seçilir).

![Soruyu ve seçenekleri yaz](shots/091-kart-oylama-form.jpg)

### 7.8 Oylama açıldı

Seçenekler yan yana listelenir; her seçeneğin yanında oy sayısı ve oran çubuğu var. Kimin neye oy verdiği görünmez, yalnızca sayılar.

![Oylama açıldı](shots/092-kart-oylama-sonuc.jpg)

### 7.9 Toplantı planı kartı

Toplantı kartı ne zaman, nerede, bağlantı ve gündem bilgisini tutar; altındaki üç düğme (Katılıyorum, Belki, Katılamıyorum) herkesin cevabını toplar. Kalemle düzenle.

![Toplantı planı kartı](shots/093-kart-toplanti.jpg)

### 7.10 Tarih ve saati takvimden seç

Ne zaman alanı gün + saat ister. Yer ve Gündem serbest metin; Bağlantı'ya çevrimiçi toplantı adresini yapıştır.

![Tarih ve saati takvimden seç](shots/094-kart-toplanti-form.jpg)

### 7.11 Kartların sırasını kendine göre ayarla

Birden çok kart varsa Düzeni düzenle sırayı değiştirtir. Sıra sana özeldir: başkalarının ekranını etkilemez.

![Kartların sırasını kendine göre ayarla](shots/095-kart-duzen.jpg)

### 7.12 Yukarı / aşağı oklarını kullan

Her kartta yukarı ve aşağı okları çıkar. Bitince Düzeni bitir'e bas. Kartın başlığındaki ok kartı katlar; katlanan kartlar cihazında hatırlanır.

![Yukarı / aşağı oklarını kullan](shots/096-kart-duzen-oklar.jpg)


<a id="bolum-8"></a>
## 8. Kartlara cevap ver: toplantı, oy, gönüllülük

*Selin Arslan — SEB iletişim sorumlusu.* Selin'e üç kayıtta üç şey soruluyor: toplantıya gelecek mi, forma hangi soruların konacağını düşünüyor, kayıt masasında gönüllü olur mu?

### 8.1 Toplantıya katılacak mısın?

Toplantı planı kartında zaman, yer ve gündem yazar. Altındaki üç düğmeden biriyle yanıt ver; yanıtlar herkese görünür ve kimin gelip gelmediği tek bakışta anlaşılır.

![Toplantıya katılacak mısın?](shots/097-katil-toplanti.jpg)

### 8.2 Yanıtın kayıtlı

Seçtiğin düğme mor dolu görünür, adın Katılıyorum satırına eklenir. Yanıtı değiştirmek için başka düğmeye bas; aynı düğmeye bir daha basarsan yanıtın geri çekilir.

![Yanıtın kayıtlı](shots/098-katil-toplanti-sonuc.jpg)

### 8.3 Oylamada seçeneklere bas

Oylama kartında seçenek düğmesine basmak oy vermektir. Bu soruda birden çok seçenek işaretlenebilir: aklındaki her soruya bas.

![Oylamada seçeneklere bas](shots/099-katil-oy.jpg)

### 8.4 Oyun sayıldı

İşaretlediklerin dolu görünür; sağdaki sayı o seçeneğe verilen oy, çubuk toplamdaki oranı gösterir. Oyunu değiştirmek ya da geri çekmek için seçeneğe tekrar bas.

![Oyun sayıldı](shots/100-katil-oy-sonuc.jpg)

### 8.5 Gönüllü olmak için işi üstlen

Havuz kartı atama yapmadan gönüllü arar: “3 kişi lazım”. İsteyen Bu işi alıyorum'a basar; adı kartın altında listelenir.

![Gönüllü olmak için işi üstlen](shots/101-katil-havuz.jpg)

### 8.6 Havuz doldu

Üç gönüllü tamam: istenen kişi sayısına ulaşıldı. Fikrini değiştirirsen aynı düğmeye tekrar basıp işi bırakabilirsin.

![Havuz doldu](shots/102-katil-havuz-sonuc.jpg)


<a id="bolum-9"></a>
## 9. Etkinlikler: takvime bak

*Kaan Demir — Etkinlik koordinatörü.* Kaan önümüzdeki haftaların etkinlik takvimini tarıyor: ne zaman, nerede, kim sorumlu, hangisi tarihsiz bekliyor?

### 9.1 Etkinlikler'i aç

Kenar çubuğundan Etkinlikler'e tıkla. Toplantı, atölye, gezi, festival: kulübün tüm etkinlikleri burada planlanır.

![Etkinlikler'i aç](shots/103-etk-ac.jpg)

### 9.2 Sayfa üç parçadan oluşur

Sekmeler etkinlikleri zamana böler, tablo her etkinliğin tarihini, durumunu, önemini, sorumlusunu ve beklenen katılımcı sayısını gösterir, sağdaki takvim ayı ve yaklaşan etkinlikleri özetler.

![Sayfa üç parçadan oluşur](shots/104-etk-genel.jpg)

### 9.3 Tabloyu oku

Her satır bir etkinlik: adı, türü (gri etiket), yeri ve bağlı kayıt sayısı. Durum etiketi (Fikir, Planlanıyor, Kesin, Yapıldı, İptal) etkinliğin ne aşamada olduğunu söyler.

![Tabloyu oku](shots/105-etk-tablo.jpg)

### 9.4 Tarihi olmayanlar Havuz'da bekler

Fikir aşamasındaki, henüz tarihi konmamış etkinlikler Havuz sekmesinde durur. Tarih verilince otomatik olarak Planlanan'a geçer.

![Tarihi olmayanlar Havuz'da bekler](shots/106-etk-havuz.jpg)

### 9.5 Havuzdaki fikirler

Tarih sütunu “Tarih yok” diyor. Fikri kesinleştirmek için etkinliği aç, bir tarih seç ve durumu Planlanıyor'a çek.

![Havuzdaki fikirler](shots/107-etk-havuz-liste.jpg)

### 9.6 Geçmiş etkinlikler arşivde

Tarihi geçen etkinlikler Geçmiş'e düşer, en yenisi üstte. Yapıldı ya da iptal edilen etkinliklerin sohbeti, kayıtları ve formları da burada durur.

![Geçmiş etkinlikler arşivde](shots/108-etk-gecmis.jpg)

### 9.7 Türe göre süz

Tür, Önem ve Sorumlu çipleri tabloyu daraltır; arama kutusu etkinlik adı ve yerinde arar. Tür listesi Veri yönetimi'nden gelir.

![Türe göre süz](shots/109-etk-tur.jpg)

### 9.8 Atölye'yi seç

Listede ekibin tanımladığı etkinlik türleri var. Atölye'yi seç: yalnız atölyeler kalır.

![Atölye'yi seç](shots/110-etk-tur-sec.jpg)

### 9.9 Süzgeç çipi doldu

Çipte Tür: Atölye yazar. Temizle tüm süzgeçleri kaldırır. Süzgeçler adres çubuğuna da yazılır; adresi paylaşınca aynı görünüm açılır.

![Süzgeç çipi doldu](shots/111-etk-tur-sonuc.jpg)

### 9.10 Takvimdeki noktaya tıkla

Takvimde etkinlik olan günlerin altında renkli nokta var: renk önemi gösterir (kırmızı kritik, turuncu yüksek, mor orta). Güne ya da noktaya tıkla, etkinlik açılır. Ok düğmeleriyle aylar arasında gezilir.

![Takvimdeki noktaya tıkla](shots/112-etk-takvim.jpg)

### 9.11 Etkinlik sayfası açıldı

Takvimden doğrudan etkinliğin sayfasına geldik. Sonraki bölümlerde bu sayfanın parçalarını inceleyeceğiz.

![Etkinlik sayfası açıldı](shots/113-etk-takvim-sonuc.jpg)


<a id="bolum-10"></a>
## 10. Yeni etkinlik oluştur

*Kaan Demir — Etkinlik koordinatörü.* Ekip kasım ayında bir lehimleme atölyesi daha yapmak istiyor. Kaan etkinliği oluşturuyor; tür seçilince plan kendiliğinden geliyor.

### 10.1 Yeni etkinlik düğmesine bas

Etkinlikler sayfasında sağ üstteki Yeni etkinlik'e tıkla. Etkinlik hem takvimde hem kendi sayfasında hem de bir kayıt olarak (sohbet ve arşiv için) açılır.

![Yeni etkinlik düğmesine bas](shots/114-yeni-etk-ac.jpg)

### 10.2 Adı ve açıklamayı yaz

Ad en az 5, Açıklama en az 30 karakter olmalı. Açıklamada ne yapılacağını, neden ve kimin için olduğunu söyle; OTF ve duyurular bu metne dayanır.

![Adı ve açıklamayı yaz](shots/115-yeni-etk-ad.jpg)

### 10.3 Etkinlik türünü seç

Tür etkinliğin hangi planla yürüyeceğini belirler. Türler Veri yönetimi → Etkinlik Türleri altında tanımlıdır.

![Etkinlik türünü seç](shots/116-yeni-etk-tur.jpg)

### 10.4 Atölye'yi seç

Listede ekibin tanımladığı türler var: toplantı, atölye, eğitim, saha ziyareti, konferans, yarışma, sosyal etkinlik.

![Atölye'yi seç](shots/117-yeni-etk-tur-sec.jpg)

### 10.5 Tür seçince plan hazır gelir

Atölye şablonu otomatik yüklenir: etkinliğe bağlanacak widget'lar (OTF formu, satın alımlar) ve zaman çizelgesi adımları, etkinlik gününe göre kaç gün önce yapılacaklarıyla birlikte.

![Tür seçince plan hazır gelir](shots/118-yeni-etk-sablon.jpg)

### 10.6 Etkinliğin kaydı hangi birimde dursun?

Birim, etkinliğin kendi kaydının (sohbet + arşiv) açılacağı yeri seçer. Etkinlik işleri için genelde Etkinlik Planlama uygundur.

![Etkinliğin kaydı hangi birimde dursun?](shots/119-yeni-etk-birim.jpg)

### 10.7 Etkinlik Planlama'yı seç

Birim ağacı kayıtlardaki ağaçla aynı: favoriler üstte, aranabilir, dallar açılıp kapanır.

![Etkinlik Planlama'yı seç](shots/120-yeni-etk-birim-sec.jpg)

### 10.8 Tarihi seç (ya da boş bırak)

Tarih boş bırakılırsa etkinlik Havuz'a düşer; fikir aşamasında tarih gerekmez. Tarih verince etkinlik takvimde görünür.

![Tarihi seç (ya da boş bırak)](shots/121-yeni-etk-tarih.jpg)

### 10.9 Ayı ve günü seç

Ay okları takvimi ileri geri sürer. Cumartesi atölyeleri için kasımın uygun Cumartesi gününü seç; gün seçilince takvim kapanır.

![Ayı ve günü seç](shots/122-yeni-etk-takvim.jpg)

### 10.10 Oluştur

Alanlar tamamsa Oluştur etkinleşir. Etkinlik, kaydı ve şablondaki adımlar tek seferde açılır; doğrudan etkinliğin sayfasına geçersin.

![Oluştur](shots/123-yeni-etk-olustur.jpg)

### 10.11 Etkinlik hazır

Sayfada zaman çizelgesi (sağ üst) ve widget'lar (OTF formu, satın alımlar) şablondan geldi. Adımların tarihleri etkinlik gününe göre hesaplandı: örneğin OTF son gönderim tarihi kendiliğinden görünür.

![Etkinlik hazır](shots/124-yeni-etk-sayfa.jpg)

### 10.12 Yeri listeden seç

Etkinlik açılınca Özellikler'den eksikleri tamamlarsın. Yer listesi Veri yönetimi → Etkinlik Yerleri'nden gelir; listede yoksa Diğer… (yaz) ile serbest metin girebilirsin.

![Yeri listeden seç](shots/125-yeni-etk-yer.jpg)

### 10.13 Maker Atölyesi'ni seç

Ortak yerleri listeden seçmek yazım hatalarını önler; OTF formu ve takvim bu adı kullanır.

![Maker Atölyesi'ni seç](shots/126-yeni-etk-yer-sec.jpg)

### 10.14 Başlangıç saatini ekle

Tarih verildiği için Saat ekle çıktı (tarihsiz etkinliğin saati olmaz). Tıkla, saati yaz, Kaydet'e bas.

![Başlangıç saatini ekle](shots/127-yeni-etk-saat.jpg)

### 10.15 Beklenen kişi sayısını yaz

Katılım, OTF formundaki katılımcı sayısı ve takvimdeki kişi sütunu olarak kullanılır. Sayıyı yazıp Kaydet.

![Beklenen kişi sayısını yaz](shots/128-yeni-etk-katilim.jpg)

### 10.16 Özellikler tamam

Etkinliğin tarihi, saati, yeri ve katılımı dolu. Her değişiklik sohbet akışına ve etkinliğin kaydına yazılır; önem ve sorumluyu da aynı satırlardan değiştirebilirsin.

![Özellikler tamam](shots/129-yeni-etk-bitti.jpg)


<a id="bolum-11"></a>
## 11. Zaman çizelgesi: adımı bitir, onay iste

*Zeynep Koç — Duyuru ve sosyal medya.* Zeynep Arduino atölyesinin duyurusunu yaptı. Etkinliğin zaman çizelgesinde bu adımı tamamlandı olarak işaretlemek istiyor; ama onaylayıcı o değil.

### 11.1 Etkinliği listeden aç

Etkinlikler tablosunda satırın herhangi bir yerine (ya da başlığına) tıkla; etkinliğin sayfası açılır.

![Etkinliği listeden aç](shots/130-onay-ac.jpg)

### 11.2 Sağ üstte etkinliğin zaman çizelgesi

Etkinliğe giden yol adımlara bölünmüş. Dolu nokta yapılmış adım, halkalı nokta sıradaki, kesikli nokta sonraki adımlar. Tarihler etkinlik gününe göre türden gelir.

![Sağ üstte etkinliğin zaman çizelgesi](shots/131-onay-cizelge.jpg)

### 11.3 Adımı bitirince noktaya bas

Duyuru yayınlandı: Duyuru yapıldı noktasına tıkla. Etkinliğin sahibi ya da etkinlik yöneticisi değilsen adım hemen işaretlenmez, onay istenir.

![Adımı bitirince noktaya bas](shots/132-onay-nokta.jpg)

### 11.4 Onay istendi

Alttaki bildirim “Onay istendi” diyor, adımın yanında onay bekliyor yazıyor. Onay isteği etkinliğin sorumlusuna (ve etkinlik yöneticilerine) görünür; onaylayınca nokta dolar.

![Onay istendi](shots/133-onay-bekliyor.jpg)


<a id="bolum-12"></a>
## 12. Etkinlik sorumlusu: onayla ve planı düzenle

*Kaan Demir — Etkinlik koordinatörü.* Zeynep'in isteği Kaan'a düştü. Kaan onaylıyor, sonra planda bir adımın tarihini kaydırıp kayıt masası için yeni bir adım ekliyor.

### 12.1 Onay istekleri sayfanın en üstünde

Etkinliğin sorumlusu ve etkinlik yöneticileri, bekleyen onay isteklerini sayfanın en üstünde sarı kutuda görür: kim, hangi adımı, ne yapmak istiyor. Bu istek Zeynep'ten.

![Onay istekleri sayfanın en üstünde](shots/134-yonet-istek.jpg)

### 12.2 Onayla ya da Reddet

Duyuru gerçekten yapıldıysa Onayla'ya bas. Yapılmadıysa Reddet isteği siler, adım olduğu gibi kalır.

![Onayla ya da Reddet](shots/135-yonet-onayla.jpg)

### 12.3 Adım tamamlandı

Nokta doldu ve satırda tamam yazıyor; kutu da kayboldu. Sorumlu ve yöneticiler adıma doğrudan basıp işaretleyebilir, onay istemeden.

![Adım tamamlandı](shots/136-yonet-onaylandi.jpg)

### 12.4 Adımın tarihini değiştir

Etkinlik yöneticisi adımın altındaki tarihe tıklayıp kaydırabilir. Varsayılan etkinlikten 7 gün önce; etkinlik tarihi değişirse varsayılan tarihler onunla birlikte kayar.

![Adımın tarihini değiştir](shots/137-yonet-tarih.jpg)

### 12.5 Yeni günü seç

Takvimden yeni gün seç. Varsayılan (7 gün önce) düğmesi özel tarihi silip hesaplanana döner.

![Yeni günü seç](shots/138-yonet-tarih-sec.jpg)

### 12.6 Plana yeni bir adım ekle

Zaman çizelgesinin başlığındaki +, şablonda olmayan bir adım eklemeni sağlar.

![Plana yeni bir adım ekle](shots/139-yonet-adim.jpg)

### 12.7 Adın adını yaz, istersen tarih seç

Tarihi boş bırakırsan adım etkinlikten 7 gün önceye düşer. Ekle'ye bas.

![Adın adını yaz, istersen tarih seç](shots/140-yonet-adim-form.jpg)

### 12.8 Yeni adım çizelgede

Adım çizelgeye eklendi. Şablondan gelen adımlar gibi bu da işaretlenebilir ya da yanındaki × ile kaldırılabilir.

![Yeni adım çizelgede](shots/141-yonet-adim-sonuc.jpg)


<a id="bolum-13"></a>
## 13. Etkinliğe kişi, takım ve kayıt bağla

*Kaan Demir — Etkinlik koordinatörü.* Havya atölyesinin planı oturdu. Kaan şimdi ekibi kuruyor: eğitmeni ekliyor, takımları bağlıyor ve işleri kayıtlara bölüyor.

### 13.1 Etkinliğe kişi ekle

Sağ sütundaki Kişiler'in + düğmesi ekibi etkinliğe katar. Eklenen kişi etkinliği düzenleyebilir, etkinlik sohbetinde bildirim alır.

![Etkinliğe kişi ekle](shots/142-kisi-ekle.jpg)

### 13.2 Kişiyi ara ve seç

Yazdıkça liste daralır. Can Özdemir'i seç; zaten ekli olanlar listede çıkmaz.

![Kişiyi ara ve seç](shots/143-kisi-sec.jpg)

### 13.3 Can etkinlikte

Kişi listeye girdi. Yanındaki balon simgesi o kişiyle etkinlik sohbetinde yazışmayı başlatır (özel mesaj yok, sohbet kayıtta yapılır); × kişiyi etkinlikten çıkarır.

![Can etkinlikte](shots/144-kisi-sonuc.jpg)

### 13.4 Takımları bağla

Takımlar bölümünün +'sı etkinliği bir ya da birkaç takıma bağlar: onlar için ayrı iş kaydı açabilirsin.

![Takımları bağla](shots/145-takim-ekle.jpg)

### 13.5 Teknik Atölye'yi seç

Takım listesi Takımlar sayfasındakiyle aynı. Atölye için eğitmenin takımı olan Teknik Atölye'yi bağla.

![Teknik Atölye'yi seç](shots/146-takim-sec.jpg)

### 13.6 Takım için iş kaydı aç

Bağlı takımın yanındaki + Kayıt, takımı hazır gelen yeni bir kayıt formu açar. Oluşan kayıt etkinliğe otomatik bağlanır.

![Takım için iş kaydı aç](shots/147-takim-kayit.jpg)

### 13.7 Formda takım zaten seçili

Pencere takımı (Teknik Atölye) doldurmuş geldi. Başlığı ve açıklamayı yaz, Birim'i seç, Kaydı aç'a bas.

![Formda takım zaten seçili](shots/148-takim-kayit-form.jpg)

### 13.8 Kayıt widget olarak bağlandı

Widget'lar altında yeni bir Kayıt kartı çıktı: kaydın durumu, eylemleri ve sahipleri etkinlik sayfasından izlenir. Başlığa tıklarsan kaydın kendi sayfasına gidersin.

![Kayıt widget olarak bağlandı](shots/149-takim-kayit-sonuc.jpg)

### 13.9 Başka bir widget ekle

Widget ekle menüsünde Kayıt (var olan ya da yeni bir kaydı bağlar) ve eksikse OTF formu ile Satın alımlar bulunur. Diğer widget'lar için Etkinlik widget'larını düzenle yetkisi gerekir.

![Başka bir widget ekle](shots/150-widget-ekle.jpg)

### 13.10 Kayıt'ı seç

Kayıt bir yer tutucu açar; ya yeni kayıt açarsın ya da mevcut bir kaydı seçersin.

![Kayıt'ı seç](shots/151-widget-menu.jpg)

### 13.11 Var olanı ekle

Etkinliğe bağlı olmayan kayıtlar arasında arama yaparak bağla. Örneğin vardiya çizelgesi birçok etkinliğe lazımdır; bir kayıt birden çok etkinliğe bağlanabilir.

![Var olanı ekle](shots/152-widget-var-olan.jpg)

### 13.12 Kaydı seç

Listede kayıt adı ve türü görünür. Seçince kart etkinliğe bağlanır; × yalnız bağlantıyı kaldırır, kayıt silinmez.

![Kaydı seç](shots/153-widget-var-olan-sec.jpg)

### 13.13 Etkinliğin sohbeti kaydında

Başlığın yanındaki takvim | balon düğmesi etkinlik sayfası ile etkinliğin kaydı arasında geçiş yapar. Sohbet ve arşiv kayıttadır; ikisi aynı etkinliğin iki yüzü.

![Etkinliğin sohbeti kaydında](shots/154-etkinlik-sohbet.jpg)

### 13.14 Etkinlik kaydı

Burada etkinliğin sohbeti, eylemleri ve eklenen görseller durur. Etkinlik değişiklikleri (tarih, yer, kişi) sohbet akışına sistem satırı olarak düşer. Aynı düğmeyle etkinlik sayfasına dönülür.

![Etkinlik kaydı](shots/155-etkinlik-sohbet-sayfa.jpg)


<a id="bolum-14"></a>
## 14. Satın alımlar: malzemeyi takip et

*Elif Şahin — Bütçe ve satın alma.* Atölyeye iki hafta kala Elif malzeme listesini takip ediyor: hangisi onaylandı, hangisinin tedarikçisi yok, kritik olan ne bekliyor?

### 14.1 Satın alımlar widget'ı

Etkinliğin malzeme ve hizmet listesi burada tutulur. Her satırda önem, ad, tür (sarf / alet / hizmet), süreç noktaları, en iyi fiyat ve en yakın varış tarihi görünür. Zaten var işaretli malzemeler en alta iner.

![Satın alımlar widget'ı](shots/156-satin-genel.jpg)

### 14.2 Başlıktaki renkli nokta genel durumu söyler

Nokta, “gerekli” diye işaretlenmiş malzemelerin onay durumunu özetler: yeşil hepsi onaylı, turuncu onay bekleyen var, kırmızı kritik bir malzeme bekliyor. Şu an kırmızı: röle modülü gelmeden atölye testi yapılamaz.

![Başlıktaki renkli nokta genel durumu söyler](shots/157-satin-saglik.jpg)

### 14.3 Süreç adımlarını noktalarla ilerlet

Her malzemenin adımları var: Gerekli mi? → Tedarikçi bulundu → Onaylandı (sponsorlu olanlara Sponsor adımı da eklenir). Röle modülü tedarikçisi bulundu: ikinci noktaya bas.

![Süreç adımlarını noktalarla ilerlet](shots/158-satin-adim.jpg)

### 14.4 Sipariş onaylanınca son noktaya bas

Onay gelince üçüncü noktaya bas; önceki adımlar da tamamlanmış sayılır. Dolu bir noktaya basmak o adımı ve sonrasını geri alır.

![Sipariş onaylanınca son noktaya bas](shots/159-satin-adim-onay.jpg)

### 14.5 Kritik engel kalktı

Başlıktaki nokta kırmızıdan turuncuya döndü: artık kritik bekleyen yok, ama onay bekleyen başka malzemeler var.

![Kritik engel kalktı](shots/160-satin-adim-sonuc.jpg)

### 14.6 Satıra tıklayıp tedarikçileri gör

Satırın solundaki oka tıklayınca tedarikçi tablosu açılır: bağlantı ya da telefon, fiyat ve varış tarihi. En ucuz teklif vurgulanır; tablo başlıklarına tıklayarak sıralayabilirsin.

![Satıra tıklayıp tedarikçileri gör](shots/161-satin-detay.jpg)

### 14.7 Teklifleri kıyasla

Üç tedarikçi var; en düşük fiyatlı olan satır vurgulu. Satırın başlığındaki fiyat ve tarih bu tablodan otomatik hesaplanır, elle girilmez.

![Teklifleri kıyasla](shots/162-satin-detay-tablo.jpg)

### 14.8 Yeni teklif ekle

Bağlantıyı (ya da telefon numarasını) yaz, fiyat ve varış tarihini gir, + Tedarikçi'ye bas. Eksik tarih ya da fiyat bırakılabilir.

![Yeni teklif ekle](shots/163-satin-tedarikci.jpg)

### 14.9 En iyi fiyat güncellendi

Yeni teklif tabloya girdi ve daha ucuz olduğu için vurgulandı; satır başlığındaki fiyat da 4.290,00 ₺ oldu.

![En iyi fiyat güncellendi](shots/164-satin-tedarikci-sonuc.jpg)

### 14.10 Listeye yeni malzeme ekle

Listenin altındaki kutuya malzeme ya da hizmet adını yaz, Ekle'ye bas. Yeni malzeme ilk adımda başlar; sonra noktalarla ilerletirsin.

![Listeye yeni malzeme ekle](shots/165-satin-ekle.jpg)

### 14.11 Satırın ⋯ menüsü

Menüde üç şey var: Zaten var olarak işaretle (stokta olan malzeme sona iner, süreç adımları kalkar), Sponsorlu (adım ekle) ve Sil.

![Satırın ⋯ menüsü](shots/166-satin-menu.jpg)

### 14.12 Sponsorlu malzemeye ek adım

Sponsorlu seçilirse süreç dört adıma çıkar: sponsor onayı da beklenir (DHT22 sensörü gibi). Sponsor çıkarsa menüden adımı kaldırırsın.

![Sponsorlu malzemeye ek adım](shots/167-satin-menu-ac.jpg)

### 14.13 Dört adımlı süreç

Satırda artık dört nokta var: Gerekli mi? → Tedarikçi bulundu → Sponsor → Onaylandı.

![Dört adımlı süreç](shots/168-satin-menu-sonuc.jpg)


<a id="bolum-15"></a>
## 15. OTF formu: doldur, gözden geçir, gönder

*Selin Arslan — SEB iletişim sorumlusu.* Üniversiteye etkinlikten en geç üç iş günü önce OTF gönderilmeli. Selin Arduino atölyesinin formunu daha önce doldurulmuş bir formdan başlatıp hazırlıyor.

### 15.1 Etkinlik sayfasındaki OTF widget'ı

OTF üniversitenin etkinlik talep formudur. Başlıkta son gönderim günü hesaplanır: etkinlikten 3 iş günü önce (hafta sonu sayılmaz). Tarih değişirse bu gün de kendiliğinden kayar.

![Etkinlik sayfasındaki OTF widget'ı](shots/169-otf-baslik.jpg)

### 15.2 Önceki formdan başlat

Otomatik doldur, etkinlikten gelmeyen alanları (amaç, danışman, ekipman talepleri, sorumlular) en son kaydedilen başka bir etkinliğin formundan kopyalar. Hazır bir kalıp olduğu için en hızlı yol bu.

![Önceki formdan başlat](shots/170-otf-otomatik.jpg)

### 15.3 Kopya gözden geçirilene kadar kilitli

Kopyalanan formun uyarısı çıktı: Word indir kilitli, çünkü eski etkinliğin bilgileri yeni etkinliğe karışabilir. Önce bu etkinliğe göre en az bir alanı güncelle, sonra “gözden geçirdim” de.

![Kopya gözden geçirilene kadar kilitli](shots/171-otf-kilit.jpg)

### 15.4 Etkinliğe özel alanları güncelle

Üstteki gri kutu etkinlikten gelir (ad, tarih, saat, yer, kişi sayısı); onlar burada değişmez. Amaç, bitiş saati, danışman, yaş grubu ve kazanımlar'ı bu etkinliğe göre yaz.

![Etkinliğe özel alanları güncelle](shots/172-otf-alanlar.jpg)

### 15.5 Talep edilen hizmetleri işaretle

Düzen, ses-görüntü, teknik, ağırlama, temizlik ve diğer hizmetler gruplar halinde. Kutuyu işaretlersen yanında adet kutusu çıkar: örneğin her katılımcı masası için 8 priz.

![Talep edilen hizmetleri işaretle](shots/173-otf-ekipman.jpg)

### 15.6 Etkinlik sorumlularını seç

Form en fazla 3 sorumlu ister; telefonları kişilerin profilinden gelir. Kopyalanan formdaki iki kişi duruyor, üçüncüyü ekle.

![Etkinlik sorumlularını seç](shots/174-otf-sorumlu.jpg)

### 15.7 Kaan Demir'i ekle

Listeden kişiyi seç. Yok seçeneği o yuvayı boşaltır.

![Kaan Demir'i ekle](shots/175-otf-sorumlu-sec.jpg)

### 15.8 Kaydet

Form tek parça kaydedilir; Kaydet'e basmadıkça yazdıkların sunucuya gitmez (altta “Kaydedilmemiş değişiklikler indirilen dosyaya girmez” uyarısı çıkar). Vazgeç son kayıtlı hale döndürür.

![Kaydet](shots/176-otf-kaydet.jpg)

### 15.9 “Formu gözden geçirdim”

Bu etkinliğe göre bir alan güncellediğin için onay kutusu etkinleşti. İşaretle: form gözden geçirildi sayılır ve Word indir açılır.

![“Formu gözden geçirdim”](shots/177-otf-gozden.jpg)

### 15.10 Word dosyasını indir

Word indir kayıtlı formla doldurulmuş .docx dosyasını indirir. Dosyayı kulüp mail adresinden, mailin konusuyla birlikte SEB'e gönder; son gün: etkinlikten 3 iş günü önce.

![Word dosyasını indir](shots/178-otf-indir.jpg)

### 15.11 Dosya adını ve mail konusunu kopyala

SEB'in beklediği dosya adı ve mail konusu hazır gelir; yanlarındaki simgeyle kopyalayıp mailine yapıştır. Etkinlik adı ya da tarihi değişirse bunlar da güncellenir.

![Dosya adını ve mail konusunu kopyala](shots/179-otf-kopyala.jpg)


<a id="bolum-16"></a>
## 16. Takımlar: ekibini ve duvarını gör

*Kaan Demir — Etkinlik koordinatörü.* Kaan takımların neye baktığını, kimlerin üye olduğunu ve açık işleri görmek için Takımlar'a geçiyor; Teknik Atölye'nin duvarına bir not bırakıyor.

### 16.1 Takımlar'ı aç

Kenar çubuğundan Takımlar'a tıkla. Takım, birlikte çalışan insanlardır; ağaçtaki birimlerden bağımsızdır.

![Takımlar'ı aç](shots/180-takim-ac.jpg)

### 16.2 Her takım bir kart

Kartta takımın adı, açıklaması, çalıştığı birimler, üyeleri ve açık kayıt sayısı var. Üyesi olduğun takımlar önde ve Üyesin rozetiyle işaretli.

![Her takım bir kart](shots/181-takim-liste.jpg)

### 16.3 Takıma tıkla

Kartın herhangi bir yerine tıkla; takımın sayfası açılır. Aynı sayfaya kenar çubuğundaki takım listesinden de ulaşılır.

![Takıma tıkla](shots/182-takim-sec.jpg)

### 16.4 Takım sayfasının dört bölümü

Solda Üyeler (rolleriyle), Çalıştığı birimler ve takımın Kayıtlar'ı, sağda Takım duvarı. Her bölümün başlığına tıklarsan katlanır; katlama cihazında hatırlanır.

![Takım sayfasının dört bölümü](shots/183-takim-genel.jpg)

### 16.5 Takım duvarına not bırak

Takım duvarı takımın ortak sohbetidir. Takıma ait duyuruları, kısa soruları buraya yaz; üyelik değişiklikleri de akışa sistem satırı olarak düşer. Duvara yalnız takım üyeleri yazar, herkes okur.

![Takım duvarına not bırak](shots/184-takim-duvar.jpg)

### 16.6 Not duvarda

Mesajın takım üyelerine bildirim olarak gider. Grup anmaları da çalışır: @team yazarsan takımın tamamı anılır.

![Not duvarda](shots/185-takim-duvar-sonuc.jpg)

### 16.7 Bölümlerin sırasını kendine göre ayarla

Sayfa başlığındaki Düzen düğmesi bölümleri yukarı/aşağı taşıtır. Sıra yalnız senin cihazında geçerlidir; başkalarını etkilemez.

![Bölümlerin sırasını kendine göre ayarla](shots/186-takim-duzen.jpg)

### 16.8 Oklarla taşı, bitince Düzeni bitir

Her bölümün başlığında yukarı ve aşağı okları çıktı. Bitirince Düzeni bitir'e bas.

![Oklarla taşı, bitince Düzeni bitir](shots/187-takim-duzen-oklar.jpg)

### 16.9 Takım için kayıt aç

Kayıt aç, takımı hazır gelen yeni kayıt penceresini açar: takımın bütün üyeleri o kaydı düzenleyebilir.

![Takım için kayıt aç](shots/188-takim-kayit.jpg)

### 16.10 Takım çipi dolu geldi

Pencere Yeni kayıt penceresinin aynısı; Takım alanı seçili geldi. Doldurup açabilir ya da Vazgeç diyebilirsin.

![Takım çipi dolu geldi](shots/189-takim-kayit-form.jpg)


<a id="bolum-17"></a>
## 17. Takım kur, üye ve birim ekle

*Ayşe Çelik — Takım yöneticisi.* Ekip sponsor görüşmeleri için yeni bir takım kuruyor. Takım yönetme yetkisi olan Ayşe takımı açıyor, üyeleri rolleriyle ekliyor ve çalıştığı birimi bağlıyor.

### 17.1 Yeni takım düğmesi

Yeni takım düğmesi yalnız takım yönetme yetkisi (manage_teams) olanlara ve yöneticilere görünür. Diğer üyeler takımları görür ama kuramaz.

![Yeni takım düğmesi](shots/190-ty-yeni.jpg)

### 17.2 Ad, açıklama ve renk

Ad en az 5, açıklama (isteğe bağlı) en az 30 karakter olmalı. Renk, takımın kenar çubuğundaki noktasını ve kartını boyar.

![Ad, açıklama ve renk](shots/191-ty-form.jpg)

### 17.3 Takım kuruldu, henüz üyesi yok

Takımın sayfası açıldı. Duvarda “Sponsorluk” takımını kurdu satırı var. Şimdi üye ekleyelim: Üyeler kutusunun üstüne gelince çıkan kalem simgesine bas.

![Takım kuruldu, henüz üyesi yok](shots/192-ty-sayfa.jpg)

### 17.4 Kutuyu düzenleme moduna al

Her kutunun kalemi o kutuyu düzenleme moduna alır: ekleme ve çıkarma denetimleri yalnız bu modda görünür, böylece yanlışlıkla bir şey silinmez.

![Kutuyu düzenleme moduna al](shots/193-ty-kalem.jpg)

### 17.5 Kişiyi seç

Kişi ekle… listesinden takıma katılacak kişiyi seç; arama kutusu kişi çoğalınca işine yarar.

![Kişiyi seç](shots/194-ty-kisi.jpg)

### 17.6 Elif Şahin'i seç

Elif bütçe ve sponsor katkılarına bakıyor; takımın lideri olsun.

![Elif Şahin'i seç](shots/195-ty-kisi-sec.jpg)

### 17.7 Rolünü seç

Takımda üç rol var: Lider, Mentor ve Üye. Rol yalnız bilgilendirme içindir; kayıt yetkisi vermez (kayıt yetkisi takım üyeliğinden gelir).

![Rolünü seç](shots/196-ty-rol.jpg)

### 17.8 Lider'i seç

Rolü seçince liste kapanır; Ekle ile üyeliği kaydet.

![Lider'i seç](shots/197-ty-rol-sec.jpg)

### 17.9 Ekle'ye bas

Kişi takıma eklenir; duvara da “Elif Şahin kişisini takıma ekledi (Lider)” satırı düşer.

![Ekle'ye bas](shots/198-ty-ekle.jpg)

### 17.10 Üye listesi

Düzenleme modunda her satırda rol seçici ve × (takımdan çıkar) var. Bitince sağ üstteki Bitti'ye bas.

![Üye listesi](shots/199-ty-uyeler.jpg)

### 17.11 Takımın çalıştığı birimi bağla

Çalıştığı birimler kutusu, takımı birim ağacının bir dalına bağlar (bir takım birden çok birimde çalışabilir). Bağlanan birim takım kartında ve Veri yönetimi'nde görünür; kayıtlar etkilenmez.

![Takımın çalıştığı birimi bağla](shots/200-ty-birim.jpg)

### 17.12 Birime bağla…

Birim ağacı açılır; aramayla bulup seç.

![Birime bağla…](shots/201-ty-birim-ac.jpg)

### 17.13 Malzeme ve Kaynak Planlama

Sponsorluk işleri malzeme ve kaynak planıyla ilgili: o birimi seç. Bağlantı hemen kurulur.

![Malzeme ve Kaynak Planlama](shots/202-ty-birim-sec.jpg)

### 17.14 Takım hazır

Takımın üyesi ve birimi var; artık kayıtlar bu takıma atanabilir, duvar da kullanıma hazır.

![Takım hazır](shots/203-ty-sonuc.jpg)


<a id="bolum-18"></a>
## 18. Ekip, profil ve bildirimler

*Kaan Demir — Etkinlik koordinatörü.* Kaan bir ekip arkadaşının telefonuna ihtiyaç duyuyor, sonra kendi profilini ve bildirim tercihlerini gözden geçiriyor.

### 18.1 Ekip'i aç

Kenar çubuğundan Ekip'e tıkla: kulübün herkesi tek sayfada.

![Ekip'i aç](shots/204-ekip-ac.jpg)

### 18.2 Herkesin profil kartı

Kartta ad, takma ad, rol rozetleri (yetki demetleri), telefon, doğum günü (yıl gösterilmez) ve üye olduğu takımlar var. Doğum günü olanın yanında pasta simgesi ve “bugün!” yazar.

![Herkesin profil kartı](shots/205-ekip-liste.jpg)

### 18.3 Adla, takma adla ya da telefonla ara

Arama kutusu ad, takma ad ve telefon numarasında arar. Telefon numarasına tıklamak aramayı başlatır (telefonda).

![Adla, takma adla ya da telefonla ara](shots/206-ekip-ara.jpg)

### 18.4 Kendi bilgilerin sol-alttaki menüde

Sol altta adına tıkla: Profilim, Bildirimler, Tema (açık / koyu / sistem) ve Çıkış yap.

![Kendi bilgilerin sol-alttaki menüde](shots/207-profil-menu.jpg)

### 18.5 Profilim'i seç

Bilgilerini herkes kendi girer: başkasının profilini yalnız yöneticiler düzenleyebilir.

![Profilim'i seç](shots/208-profil-menu-ac.jpg)

### 18.6 Fotoğraf, takma ad, telefon, doğum günü

Telefon zorunlu (ekip arkadaşların sana ulaşabilsin); biçimi kendiliğinden düzenlenir. Takma ad sohbette adının altında görünür, doğum günü Ekip sayfasında ve bugünse Panolar'da çıkar.

![Fotoğraf, takma ad, telefon, doğum günü](shots/209-profil-form.jpg)

### 18.7 Bildirimler

Menüden Bildirimler'i seç: hangi hareketlerde haber alacağını sen belirlersin.

![Bildirimler](shots/210-bildirim-menu.jpg)

### 18.8 Varsayılan bildirim düzeyi

Her hareket, yalnızca anıldığımda ya da sessize al. Sessiz saat yalnız anlık bildirimi susturur, liste yine dolar. Bu cihaz bölümünden telefonda ya da tarayıcıda anlık bildirim açılır; bir sohbette farklı düzey için o sohbetin zil simgesini kullan.

![Varsayılan bildirim düzeyi](shots/211-bildirim-ayar.jpg)


<a id="bolum-19"></a>
## 19. Pillar'lar: kesişen sorumluluklar

*Kaan Demir — Etkinlik koordinatörü.* Bazı işler tek bir birime sığmaz: atölye güvenliği ya da sürdürülebilirlik gibi. Kaan bu kesişen alanları Pillar'lar sayfasından izliyor.

### 19.1 Pillar'lar'ı aç

Kenar çubuğundan Pillar'lar'a tıkla. Pillar, birimlerden bağımsız bir sorumluluk alanıdır: bir kayıt hem bir birimde (ne işi) hem de bir pillar'da (hangi alan) durabilir.

![Pillar'lar'ı aç](shots/212-pillar-ac.jpg)

### 19.2 Pillar kartları

Her pillar'ın kendi takımı ve sohbeti vardır. Kartta açıklama, kişi sayısı ve açık kayıt sayısı görünür.

![Pillar kartları](shots/213-pillar-liste.jpg)

### 19.3 Atölye Güvenliği'ne tıkla

Pillar sayfası, takım sayfasına benzer: üyeler, kayıtlar ve sohbet.

![Atölye Güvenliği'ne tıkla](shots/214-pillar-sec.jpg)

### 19.4 Pillar sayfası

Üyeler, bu pillar'a bağlı kayıtlar (birimi ne olursa olsun), ileride gösterge panelleri için ayrılmış Göstergeler alanı ve sağda pillar sohbeti. Kayıtlara pillar bağlamak için kayıt sayfasındaki Pillar satırı kullanılır.

![Pillar sayfası](shots/215-pillar-sayfa.jpg)


<a id="bolum-20"></a>
## 20. Veri yönetimi: birim ağacı

*Kaan Demir — Birim editörü.* Kayıtların hangi işe ait olduğunu söyleyen birim ağacı, Veri yönetimi'nde tutulur. Kaan Etkinlik dalının yapısına bakıyor ve yeni bir birim ekliyor.

### 20.1 Veri yönetimi'ni aç

Kenar çubuğundan Veri yönetimi'ne tıkla. Burası kayıtların, etkinliklerin ve formların dayandığı ortak listelerin düzenlendiği yer.

![Veri yönetimi'ni aç](shots/216-veri-ac.jpg)

### 20.2 Üç kök liste

Birimler serbest bir ağaçtır (türünü ve yapısını sen seçersin). Etkinlik Türleri ve Etkinlik Yerleri yönetilen listelerdir. Kökler koddan gelir (kilit simgesi), yalnız adları ve açıklamaları değişir. Her değişiklik anında uygulanır.

![Üç kök liste](shots/217-veri-kokler.jpg)

### 20.3 Birimler'in okuna bas

Satırdaki ok alt dalları açar. Birimler'in altında tek dal var: Etkinlik.

![Birimler'in okuna bas](shots/218-veri-birimler-ac.jpg)

### 20.4 Etkinlik dalı: hücre → makine → görev/adım

Her düğümün yanında türü yazar: Cell (ana hücre), Makine (iş kolu), Görev ve Adım. Altındaki satır kısa açıklamadır. Sağdaki sayı alt düğüm sayısı; renkli bağlantılar o birimde çalışan takımlardır.

![Etkinlik dalı: hücre → makine → görev/adım](shots/219-veri-agac.jpg)

### 20.5 Düğümü düzenle

Satırdaki kalem düğümün adını, türünü, yapısını, üst düğümünü (taşımak için) ve açıklamasını değiştirir. Ad en az 5, açıklama (varsa) en az 30 karakter olmalı.

![Düğümü düzenle](shots/220-veri-duzenle.jpg)

### 20.6 Düzenleme paneli satırın altında açılır

Tür seçenekleri üst düğümün kuralına göre gelir (makinenin altına görev ya da adım eklenir). Üst düğüm listesi yalnız bu türü kabul eden dalları gösterir. Vazgeçmek için Vazgeç.

![Düzenleme paneli satırın altında açılır](shots/221-veri-duzenle-form.jpg)

### 20.7 Alt düğüm ekle

Satırdaki + o birimin altına yeni bir düğüm ekler. Etkinlik Planlama'nın altına yeni bir görev ekleyelim.

![Alt düğüm ekle](shots/222-veri-ekle.jpg)

### 20.8 Adı, türü ve açıklamayı gir

Tür ve Yapı (ağaç / liste / yaprak) seçilir; Açıklama isteğe bağlıdır ama ekibe neyin nereye ait olduğunu anlatır. Ekle'ye bas.

![Adı, türü ve açıklamayı gir](shots/223-veri-ekle-form.jpg)

### 20.9 Yeni birim ağaçta

Yeni düğüm kardeşlerinin sonuna eklendi. Bu andan itibaren Yeni kayıt penceresinde ve kayıt sayfasında Birim listesinde seçilebilir.

![Yeni birim ağaçta](shots/224-veri-ekle-sonuc.jpg)

### 20.10 Silme yerine pasifleştir

Artık kullanılmayan bir birimi silme, pasifleştir. Geçmiş kayıtlar adını göstermeye devam eder; yeni kayıt ve listelerde çıkmaz. İstersen Yeniden aç ile geri getirirsin.

![Silme yerine pasifleştir](shots/225-veri-pasif.jpg)

### 20.11 Düğüm pasif

Satır soluklaştı ve yanında pasif yazıyor. Kalıcı silme yalnızca “kalıcı sil” yetkisi olanlarda, düzenleme panelinin içinde ve bağlı kayıt sayısı gösterilerek yapılır.

![Düğüm pasif](shots/226-veri-pasif-sonuc.jpg)

### 20.12 Ağaçta ara

Arama kutusu ad ve açıklamada arar; eşleşen düğümleri ve üstlerini gösterir, dalları kendiliğinden açar. Aramayı silince bulduğun yerde kalırsın.

![Ağaçta ara](shots/227-veri-ara.jpg)


<a id="bolum-21"></a>
## 21. Veri yönetimi: etkinlik türleri ve yerleri

*Kaan Demir — Liste yöneticisi.* Yeni etkinlik açarken seçilen türler ve yerler de Veri yönetimi'nden gelir. Kaan atölye türünün şablonuna ve yer listesine bakıyor, eksik bir yer ekliyor.

### 21.1 Etkinlik Türleri'ni aç

Etkinlik Türleri kökünün okuna bas: ekibin tanımladığı türler listelenir. Yeni etkinlik oluştururken Tür listesi buradan gelir.

![Etkinlik Türleri'ni aç](shots/228-tur-ac.jpg)

### 21.2 Sekiz tür

Her tür bir seçenek (option) düğümüdür: Toplantı, Atölye, Eğitim, Saha ziyareti, Konferans, Yarışma, Sosyal… Sayı, türün altındaki bölümleri gösterir. Tür düğümünü sistem atar; yalnız ad ve açıklamayı değiştirirsin.

![Sekiz tür](shots/229-tur-liste.jpg)

### 21.3 Her türün iki bölümü var

Adımlar o türdeki etkinliğe otomatik gelecek zaman çizelgesi adımlarını, Widget'lar otomatik eklenecek widget'ları (OTF formu, satın alımlar) tutar. İkisi de kendiliğinden açılır, silinemez (kilit).

![Her türün iki bölümü var](shots/230-tur-bolum.jpg)

### 21.4 Adımlar: etkinlikten kaç gün önce?

Her adımın yanında gün farkı yazar (örneğin −21 gün = etkinlikten 21 gün önce). Yeni bir atölye açıldığında bu adımlar kendi tarihleriyle zaman çizelgesine kopyalanır. Hazırlık en geç 7 gün önce bitmeli: daha yakın adım uyarı simgesi alır.

![Adımlar: etkinlikten kaç gün önce?](shots/231-tur-adimlar.jpg)

### 21.5 Şablona yeni adım ekle

Adımlar satırındaki + şablona adım ekler. Eklenen adım yalnızca bundan sonra açılan atölyelere gelir; mevcut etkinlikler değişmez.

![Şablona yeni adım ekle](shots/232-tur-adim-ekle.jpg)

### 21.6 Adı ve gün farkını yaz

Eksi değer etkinlikten önce demektir: −8 etkinlikten 8 gün önce. Alanları doldurup Ekle'ye bas.

![Adı ve gün farkını yaz](shots/233-tur-adim-form.jpg)

### 21.7 Adım şablonda

Yeni adım listeye girdi. Yanlışlık olursa satırdaki pasifleştir düğmesi adımı şablondan çıkarır; silmeden geri getirilebilir.

![Adım şablonda](shots/234-tur-adim-sonuc.jpg)

### 21.8 Etkinlik Yerleri

Etkinlik Yerleri, etkinlik sayfasındaki Yer listesidir. Düz bir listedir: her yer tek bir düğümdür. Listede olmayan bir yer için etkinlikte Diğer… (yaz) kullanılır; sık kullanılanları buraya ekle.

![Etkinlik Yerleri](shots/235-yer-liste.jpg)

### 21.9 Yeni yer ekle

Etkinlik Yerleri satırındaki +'ya bas.

![Yeni yer ekle](shots/236-yer-ekle.jpg)

### 21.10 Yerin adını ve açıklamasını yaz

Yer türü sabittir (yer), Tür ya da Yapı sorulmaz. Açıklamaya kapasite, ekipman gibi bilgileri yazmak etkinlik planlayanlara yardım eder.

![Yerin adını ve açıklamasını yaz](shots/237-yer-form.jpg)

### 21.11 Yeni yer listede

Yer anında kullanıma açıldı: etkinliklerin Yer listesinde ve tablo aramasında çıkar. Artık kullanılmayan yer pasifleştirilir; eski etkinlikler adını göstermeye devam eder.

![Yeni yer listede](shots/238-yer-sonuc.jpg)


<a id="bolum-22"></a>
## 22. Yönetim: kim girer, neyi yapabilir

*Defne Aksoy — Kulüp başkanı (yönetici).* Ekibe yeni bir üye katılıyor. Yönetici Defne onu kullanıcı listesine ekliyor, rolünü veriyor ve yetkilerin nasıl işlediğini gösteriyor.

### 22.1 Yönetim'i aç

Kenar çubuğundaki Yönetim yalnızca yöneticilere ve kullanıcı yönetme yetkisi (manage_users) olanlara görünür. Burası kimin girebileceğini ve neyi değiştirebileceğini belirler.

![Yönetim'i aç](shots/239-yon-ac.jpg)

### 22.2 Üç bölüm

Kişiler ve roller kullanıcıları ve yetki demetlerini, Aktivite kimin ne kadar uğradığını, Kalite kapısı (yalnız yönetici) metin kontrolü sorularını yönetir.

![Üç bölüm](shots/240-yon-genel.jpg)

### 22.3 Yeni kullanıcıyı ekle

Yalnızca burada kayıtlı e-postalar giriş yapabilir (Google hesabıyla). E-posta ve ad yaz, Kullanıcı ekle'ye bas; kişiye davet postası otomatik hazırlanır.

![Yeni kullanıcıyı ekle](shots/241-yon-ekle.jpg)

### 22.4 Kullanıcı listede

Her satırda ad, e-posta, son görülme, bildirim ayarı ve sahip olduğu kapsamlar var. Yeni eklenen kişi henüz hiç girmedi, kapsamı yok.

![Kullanıcı listede](shots/242-yon-liste.jpg)

### 22.5 Düzenle'yi aç

Satırın altındaki Düzenle kapsam, rol ve dal izni denetimlerini açar. Liste kapalıyken taranabilir kalsın diye denetimler gizli durur.

![Düzenle'yi aç](shots/243-yon-duzenle.jpg)

### 22.6 Rol ver

Rol, birden çok yetkiyi tek seferde veren bir demettir. Deniz tasarım takımına katılıyor: Rol ver'e bas.

![Rol ver](shots/244-yon-rol.jpg)

### 22.7 Tasarım rolünü seç

Beş rol var: Birim Editörü, Etkinlik Koordinatörü, Liste Yöneticisi, Maliye, Tasarım. Rolün kapsamları sahiplerine anında yansır.

![Tasarım rolünü seç](shots/245-yon-rol-sec.jpg)

### 22.8 Rol atandı

Satırda rol rozeti göründü (✕ ile geri alınır). Kişi Ekip sayfasında bu rozetle görünür; rolün kapsamları üstteki rozetlerde ayrıca listelenmez.

![Rol atandı](shots/246-yon-rol-sonuc.jpg)

### 22.9 Tek tek kapsam da verilebilir

Rolden bağımsız, doğrudan kapsam verebilirsin. Listedeki her kapsamın altında ne işe yaradığı yazar (örneğin edit_deadline: son tarih değiştirme).

![Tek tek kapsam da verilebilir](shots/247-yon-kapsam.jpg)

### 22.10 Kapsamlar ve anlamları

manage_events etkinlikleri yönetir, manage_purchases satın alımları, edit_nodes birim ağacını, manage_teams takımları, manage_users kullanıcıları. Seçince kapsam hemen verilir; Esc ile vazgeç.

![Kapsamlar ve anlamları](shots/248-yon-kapsam-liste.jpg)

### 22.11 Dal izni: yapıyı nerede değiştirebilir?

Dal izni, birim ağacında bir dalı kişiye (ya da role) açar. Birim ağacını değiştirme gibi yapı yetkileri yalnızca izinli dalda ve altında geçer; kayıt düzenleme yetkisi de bu dallardaki kayıtlara uzanır.

![Dal izni: yapıyı nerede değiştirebilir?](shots/249-yon-dal.jpg)

### 22.12 Ağaçtan dalı seç

Birim ağacı açılır; Etkinlik Planlama gibi bir dal seçtiğinde kişi o dalın altındaki birimlerde yetkili olur.

![Ağaçtan dalı seç](shots/250-yon-dal-agac.jpg)

### 22.13 Hesabı kapat, yönetici yap

Satırın en altında Hesabı kapat (giriş izni kalkar, geçmiş kayıtlarda adı durur) ve yalnızca yöneticiye görünen Yönetici yap düğmeleri var. Mezun olan üyelerin hesabı silinmez, kapatılır.

![Hesabı kapat, yönetici yap](shots/251-yon-hesap.jpg)

### 22.14 Birden çok kişiye aynı anda işlem

Kişilerin solundaki kutuları işaretlersen üstte Toplu işlemler çıkar: Rol ver, Rol al, Hesapları kapat/aç. Dönem sonunda mezunları tek seferde kapatmak için ideal.

![Birden çok kişiye aynı anda işlem](shots/252-yon-toplu.jpg)

### 22.15 Roller bir kapsam demetidir

Her rolün adı, rengi, kapsamları ve dal izinleri vardır. Rolü değiştirirsen sahipleri anında etkilenir. Rol oluşturma ve silme yalnız yöneticide.

![Roller bir kapsam demetidir](shots/253-yon-roller.jpg)

### 22.16 Rolü düzenle

Rolün Düzenle'si ad, renk, kapsam kutucukları ve dal izinlerini açar. Kutucukları işaretleyip Kaydet'e bas.

![Rolü düzenle](shots/254-yon-rol-duzenle.jpg)

### 22.17 Kapsamları işaretle

Her kapsamın altında kısa açıklaması var; işaret sayısı başlıkta (x / y seçili) görünür. Vazgeçmek için paneli kapat, değişiklik kaydedilmedikçe uygulanmaz.

![Kapsamları işaretle](shots/255-yon-rol-form.jpg)


<a id="bolum-23"></a>
## 23. Yönetim: aktivite ve kalite kapısı

*Defne Aksoy — Kulüp başkanı (yönetici).* Dönem ortasında Defne ekibin sisteme ne kadar uğradığına ve kayıt metinlerini tartan kalite kapısının nasıl ayarlandığına bakıyor.

### 23.1 Aktivite sekmesi

Aktivite kimin ne zaman uğradığını ve ne kadar iş çıkardığını gösterir. Amaç kimseyi denetlemek değil, kimin takılıp kaldığını ya da yardıma ihtiyaç duyduğunu görmek.

![Aktivite sekmesi](shots/256-akt-ac.jpg)

### 23.2 Kişi başına özet

Her satırda son giriş, son hareket, son 30 günde aktif gün, son 7 günde sekmenin açık kaldığı süre ve katkı (mesaj + kayıt, alan, eylem değişiklikleri) var. Başlığa tıklarsan sıralar.

![Kişi başına özet](shots/257-akt-tablo.jpg)

### 23.3 Bir kişiye tıkla

Satıra tıklayınca altta kişinin katkı matrisi açılır: son haftalarda gün gün katkı (koyu = çok).

![Bir kişiye tıkla](shots/258-akt-kisi.jpg)

### 23.4 Katkı matrisi ve seriler

Matris GitHub'daki gibi okunur. Yanındaki satırlarda son 7/30 günlük katkı, en katkılı gün, günlük ortalama süre ve ardışık seri (gün) var. “Süre” sekmenin açık kaldığı dakikadır, “katkı” ise yapılan işlerdir.

![Katkı matrisi ve seriler](shots/259-akt-matris.jpg)

### 23.5 Kalite kapısı sekmesi

Yalnız yöneticiye görünen Kalite kapısı, kayıt, etkinlik ve kapanış notlarının yazı kalitesini tartan modelin sorularını tutar. Kaydedince hemen geçerli olur.

![Kalite kapısı sekmesi](shots/260-kalite-ac.jpg)

### 23.6 Üç soru ve eşik

Somutluk, Bağlam ve kapanış notu Gerekçe soruları: her biri model yönergesi, “evet / hayır” ölçütü ve bir eşik içerir. Metin eşiğin altında kalırsa yazana uyarı çıkar; “Yine de gönder” ile geçilebilir.

![Üç soru ve eşik](shots/261-kalite-sorular.jpg)


<a id="bolum-24"></a>
## 24. Mobil uygulama: sahada telefonla

*Kaan Demir — Etkinlik koordinatörü.* Atölyeye iki gün kala Kaan sahada, telefonuyla çalışıyor: eylemlerine bakıyor, etkinliğin adımlarını işaretliyor, sohbete yazıyor ve fotoğraf paylaşıyor.

### 24.1 Telefonda ilk sayfa: Eylemler

app. adresi (ya da ana ekrana eklediğin uygulama) doğrudan Eylemler'i açar: sana atanmış, bitmemiş eylemler; bu haftakiler üstte. Altta dört sekme ve ortada + düğmesi var; sekmelerdeki kırmızı sayı bekleyen iş sayısıdır.

![Telefonda ilk sayfa: Eylemler](shots/262-mobil-eylemler.jpg)

### 24.2 Sahibi olduğun kayıtlar

En üstteki Sahibi olduğum açık kayıtlar başlığına dokununca kayıtlar açılır. Eylemin olmasa bile sorumlusu olduğun işleri buradan görürsün.

![Sahibi olduğun kayıtlar](shots/263-mobil-sahip.jpg)

### 24.3 Etkinliğin kaydını aç

Liste kısa kayıt kartlarıdır: tür, önem ve başlık. Etkinliğin kendi kaydı (Etkinlik etiketli) etkinliğin sohbetini ve adımlarını taşır; dokunup aç.

![Etkinliğin kaydını aç](shots/264-mobil-kayit-sec.jpg)

### 24.4 Etkinlik şeridi

Etkinlik kayıtlarında başlığın altında bir şerit çıkar: durum, tarih, yer ve ilerleme çubuğu (tamamlanan adım / toplam). Altında kaydın alanları, eylemleri ve kartları masaüstüyle aynı.

![Etkinlik şeridi](shots/265-mobil-kayit.jpg)

### 24.5 Adım sayısına dokun

x/y adım düğmesi etkinliğin zaman çizelgesini açar. Sahada bir iş bitince buradan işaretlersin; sorumlu ve etkinlik yöneticisi doğrudan işaretler, diğerleri onay ister.

![Adım sayısına dokun](shots/266-mobil-adimlar.jpg)

### 24.6 OTF gönderildi'yi işaretle

SEB'e OTF mailini az önce attın: adımın kutusuna dokun. Kutu dolar, ilerleme çubuğu uzar; değişiklik etkinliğin sohbetine de yazılır.

![OTF gönderildi'yi işaretle](shots/267-mobil-adim-isaretle.jpg)

### 24.7 Adım tamamlandı

İşaretlenen adım üstü çizili ve dolu görünür, sayaç bir arttı. Yanlışsa aynı kutuya tekrar dokunarak geri alabilirsin.

![Adım tamamlandı](shots/268-mobil-adim-sonuc.jpg)

### 24.8 Sağ alttaki balon: sohbet

Kaydın sohbeti masaüstündeki gibi sağda değil, sağ alttaki balonda. Üzerindeki sayı mesaj sayısıdır; dokununca sohbet tam ekran açılır.

![Sağ alttaki balon: sohbet](shots/269-mobil-sohbet-ac.jpg)

### 24.9 Mesajını yaz ve gönder

Mesaj kutusu masaüstündekiyle aynı: @ ile kişi anabilir, resim simgesiyle görsel ekleyebilir, ⚡ Hızlı eylem ile eylem açabilirsin. Telefonda Enter satır atlar; Gönder düğmesi gönderir.

![Mesajını yaz ve gönder](shots/270-mobil-sohbet-yaz.jpg)

### 24.10 Mesaj gitti

Mesajın mor balonda; üstte adımı işaretlediğin sistem satırı da akışta. Sol üstteki × ile sohbeti kapatıp kayda dönersin.

![Mesaj gitti](shots/271-mobil-sohbet-sonuc.jpg)

### 24.11 Ortadaki + düğmesi

+ üç işi tek dokunuşa indirir: Arama, Yeni kayıt ve Fotoğraf çek / seç.

![Ortadaki + düğmesi](shots/272-mobil-ekle.jpg)

### 24.12 Fotoğraf çek / seç

Sahada bir şey gördün mü (örneğin kurulumun son hali): Fotoğraf çek / seç'e dokun; kamera açılır ya da galeriden seçersin.

![Fotoğraf çek / seç](shots/273-mobil-ekle-menu.jpg)

### 24.13 Önizleme ve açıklama

Seçtiğin fotoğrafın önizlemesi gelir; istersen açıklama yaz. Aşağı kaydırınca fotoğrafı göndereceğin konuşmalar listelenir.

![Önizleme ve açıklama](shots/274-mobil-foto.jpg)

### 24.14 Hangi sohbetlere gitsin?

Kayıt sohbetlerini ve takım duvarlarını işaretle; Gönder fotoğrafı her birine ayrı gönderir. Biri başarısız olursa yalnızca o tekrar denenir.

![Hangi sohbetlere gitsin?](shots/275-mobil-foto-hedef.jpg)

### 24.15 Konuşmalar sekmesi

Konuşmalar yazabildiğin bütün sohbetleri son mesaja göre sıralar: kayıt sohbetleri ve takım duvarları tek listede.

![Konuşmalar sekmesi](shots/276-mobil-konusmalar-ac.jpg)

### 24.16 Tek gelen kutusu

Her satırda sohbetin adı, son mesaj ve türü (Kayıt ya da Takım) var. Dokununca ilgili kaydın ya da takımın sohbeti açılır.

![Tek gelen kutusu](shots/277-mobil-konusmalar.jpg)

### 24.17 Bildirim sekmesi

Bildirim seni anan, sana eylem atayan ya da kayıtlarında olay olan kişileri toplar; kırmızı sayı okunmamışları gösterir.

![Bildirim sekmesi](shots/278-mobil-bildirim-ac.jpg)

### 24.18 Bildirim listesi

Okunmamışlar vurgulu. Satıra dokununca olayın geçtiği kayda gidersin. En üstteki Bildirim ayarları anlık bildirimi (telefona düşen) açıp kapatır.

![Bildirim listesi](shots/279-mobil-bildirim.jpg)

### 24.19 Takımlar sekmesi

Takımlar takımlarını ve üyelerini gösterir; ekip arkadaşını aramak gerektiğinde telefon simgesi hazır.

![Takımlar sekmesi](shots/280-mobil-takimlar-ac.jpg)

### 24.20 Takım kartları

Kartta açıklama, üye ve açık kayıt sayısı var. Dokunup takım sayfasını aç.

![Takım kartları](shots/281-mobil-takimlar.jpg)

### 24.21 Üyeler ve telefon

Üyeler açılınca her kişinin rolü ve telefon simgesi görünür; simgeye dokunmak numarayı arar. Takım duvarına da sağ alttaki balondan yazılır.

![Üyeler ve telefon](shots/282-mobil-takim.jpg)

### 24.22 Arama

+ → Arama kayıt ve eylem başlıklarında arar; yazdıkça sonuçlar gelir. Sonuca dokununca kayıt açılır.

![Arama](shots/283-mobil-arama.jpg)

### 24.23 Hesap menüsü

Sağ üstteki avatar Profilim, Bildirimler, Tema (açık / koyu / sistem) ve Çıkış yap'ı açar; masaüstündeki menünün aynısı.

![Hesap menüsü](shots/284-mobil-hesap.jpg)

### 24.24 Menü açık

Profil bilgilerini ve bildirim tercihlerini telefonda da güncelleyebilirsin; telefona anlık bildirim bu menüden açılır.

![Menü açık](shots/285-mobil-hesap-menu.jpg)

