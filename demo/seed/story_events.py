"""Demo etkinlikleri: gecmis, planlanan, havuz, iptal. Hepsi kurgusal.

Hazirlik adimlarinin (checkpoint) bitis gunu etkinlik tarihine gore hesaplanir
(spec/73 §4); `done` listesi hangisinin ne zaman tamamlandigini soyler.
"""

from cal import A
from story_lib import Event, Material, msg

# Tedarikci iletisimi: baglanti ya da telefon (spec/73 §5). Hepsi `example`/sahte.
EK = "https://elektrokutu.example"
DM = "https://devremarket.example"
SH = "https://sensorhane.example"

EVENTS: list[Event] = [
    # ============================================================ GECMIS ===
    Event("e6", "Dönem Açılış Tanışma Buluşması", "Sosyal", "Etkinlik Öncesi Hazırlık",
          "Yeni ve eski üyelerin tanıştığı dönem açılış buluşması: kısa sunum, tanışma oyunları ve kulüp projelerinin sergisi.",
          owner="defne", at=(40, "11:00"), date=-20, start="17:00", place="Konferans Salonu (A Blok)",
          attendees=85, priority="high", status="done", status_at=(19, "09:00"),
          people=[("defne", "Genel koordinasyon"), ("zeynep", "Duyuru ve fotoğraf"), ("mert", "Sahne ve görsel"), ("kaan", "Mekan ve akış")],
          teams=["Tasarım", "İletişim", "Lojistik"],
          done=[("Bütçe onayı", 39, "10:00", "defne"), ("Mekan ayarlandı", 33, "16:00", "defne"),
                ("OTF gönderildi", 27, "11:00", "defne"), ("Duyuru", 27, "13:00", "defne")],
          otf=dict(
              fields=dict(purpose="Dönem açılış buluşması: tanışma, kısa sunum ve proje sergisi", end_time="19:30",
                          advisor="Dr. Öğr. Üyesi Nihan Bulut", age_group="18-24",
                          outcomes="Yeni üyelerin kulüple ve projelerle tanışması, birlikte çalışacak ekiplerin oluşması.",
                          layout_notes="Sinema düzeni", av_notes="Projeksiyon, perde ve iki el mikrofonu",
                          tech_notes="Elektrik ve aydınlatma", host_notes="Çay ve kahve arası, 85 kişilik",
                          care_notes="Etkinlik sonrası temizlik", other_notes=None),
              items=[("layout_cinema", None), ("av_projector", None), ("av_screen", None), ("av_mic_hand", 2),
                     ("tech_power", None), ("tech_lighting", None), ("host_coffee", None), ("care_cleaning", None)],
              contacts=["defne", "selin"], at=(27, "11:30")),
          chat=[
              msg(40, "11:20", "defne", "Dönem açılışı {DW-20}, konferans salonunda. Hedef 80 kişi."),
              msg(33, "16:10", "kaan", "Salon onayı geldi, yazıyı kayda ekledim. Ses sistemi hazır."),
              msg(20, "17:40", "zeynep", "Etkinlik harika geçti, 85 kişi katıldı! Fotoğrafları paylaşılan klasöre yükledim."),
              msg(19, "09:05", "defne", "Geri bildirim formunda memnuniyet 4,6/5. Bir sonraki etkinlikte kayıt masasını daha erken kuralım."),
          ]),

    Event("e7", "Dönem Başı Yönetim Kurulu Toplantısı", "Toplantı", "Takvim Oluşturma",
          "Dönemin ilk yönetim kurulu toplantısı: takvim taslağı, bütçe sınırı ve üye alım tarihleri görüşülecek.",
          owner="defne", at=(22, "10:00"), date=-9, start="18:30", place="Öğrenci Merkezi Toplantı Odası",
          attendees=9, priority="medium", status="done", status_at=(8, "09:00"),
          people=[("defne", "Toplantı başkanı"), ("kaan", "Etkinlikler"), ("elif", "Maliye"), ("ayse", "Tutanak")],
          teams=[], records=["yk_notlari"], drop_cp=["OTF gönderildi"], widgets_drop=["otf"],
          done=[("Gündem toplandı", 19, "10:00", "defne"), ("Davet gönderildi", 16, "10:00", "defne")],
          chat=[
              msg(22, "10:10", "defne", "Gündem: takvim taslağı, bütçe üst sınırı, üye alımı. Eklemek istediğiniz madde varsa yazın."),
              msg(12, "20:00", "elif", "Bütçe için 12.000 ₺ üst sınır öneriyorum, sponsor gelirse artırırız."),
              msg(9, "20:45", "ayse", "Tutanak hazır, kayda ekliyorum."),
          ]),

    Event("e5", "3B Yazıcı Kullanım Eğitimi", "Eğitim", "Etkinlik Planlama",
          "Katılımcılara 3B yazıcıda modelleme, dilimleme ve ilk baskıyı öğreten uygulamalı eğitim; yazıcılar atölyede hazır olacak.",
          owner="can", at=(33, "15:00"), date=-11, start="11:00", place="Maker Atölyesi (B Blok)",
          attendees=22, priority="medium", status="done", status_at=(10, "09:00"),
          people=[("can", "Eğitmen"), ("burak", "Yardımcı"), ("elif", "Satın alma"), ("selin", "SEB formları")],
          teams=["Teknik Atölye", "Maliye"],
          done=[("Eğitmen kesinleşti", 32, "10:00", "can"), ("Mekan ayarlandı", 25, "14:00", "can"),
                ("OTF gönderildi", 17, "16:30", "can"), ("Malzeme hazır", 14, "12:00", "can")],
          materials=[
              Material("PLA filament 1 kg (4 makara)", "consumable", "high", 3, providers=[(f"{EK}/pla-filament", 1160.00, -14), (f"{DM}/pla", 1240.00, -13)]),
              Material("Baskı tablası yapıştırıcısı", "consumable", "low", 3, providers=[(f"{EK}/yapistirici", 85.00, -14)]),
              Material("Katılım sertifikası baskısı", "service", "low", 3, providers=[("Kampüs Matbaa 0555 000 02 03", 198.00, -13)]),
          ],
          otf=dict(
              fields=dict(purpose="3B yazıcıya giriş: modelleme, dilimleme ve ilk baskı", end_time="15:00",
                          advisor="Dr. Öğr. Üyesi Nihan Bulut", age_group="18-24",
                          outcomes="Katılımcılar basit bir parçayı modelleyip dilimler ve 3B yazıcıda basabilir hale gelir.",
                          layout_notes="Sınıf düzeni, dört çalışma grubu", av_notes="Projeksiyon ve perde, eğitmen için yaka mikrofonu",
                          tech_notes="Elektrik: her masaya bir priz", host_notes="Çay ve kahve arası",
                          care_notes="Mobilya taşıma ve flip chart", other_notes=None),
              items=[("layout_class", None), ("av_projector", 1), ("av_screen", None), ("av_mic_lapel", 1),
                     ("tech_power", 6), ("tech_lighting", None), ("host_coffee", None), ("care_furniture", None),
                     ("care_flipchart", 1)],
              contacts=["can", "selin"], at=(18, "11:00")),
          chat=[
              msg(33, "15:20", "can", "3B yazıcı eğitimi {DW-11} atölyede. Dört yazıcı hazır, 22 kişilik grup yeterli."),
              msg(25, "14:10", "elif", "PLA filament siparişi onaylandı, teslim tarihi {D-25}."),
              msg(18, "09:00", "selin", "OTF bu sefer zamanında gitti: checkpoint kuralı işe yarıyor. SEB onayı da aynı gün döndü."),
              msg(10, "18:20", "can", "Eğitim güzel geçti, herkes ilk baskısını aldı. Fotoğrafları sosyal medya ekibine ilettim."),
          ]),

    Event("e10", "Drone Gösterisi", "Sosyal", "Etkinlik Planlama",
          "Kampüste açık havada düzenlemeyi planladığımız drone gösterisi; havacılık ve kampüs güvenliği izinleri gerekiyordu.",
          owner="can", at=(30, "12:00"), date=-4, start="16:00", place="Merkez Kampüs Meydanı",
          attendees=80, priority="low", status="cancelled", status_at=(7, "10:05"),
          people=[("can", "Gösteri sorumlusu"), ("kaan", "İzin süreci")],
          teams=[], records=["drone_izin"],
          done=[("Bütçe onayı", 25, "11:00", "can")],
          chat=[
              msg(7, "10:08", "can", "İzin çıkmadığı için etkinliği iptal ediyoruz. Fikir bahar dönemine kalsın."),
          ]),

    # ========================================================== PLANLANAN ===
    Event("e4", "Haftalık Koordinasyon Toplantısı", "Toplantı", "Ekip ve Görev Dağılımı",
          "Ekiplerin hafta içindeki işlerini, engelleri ve kararları paylaştığı haftalık toplantı; gündem önceden sohbete yazılır.",
          owner="defne", at=(14, "20:00"), date=A.e4, start="18:30", place="Öğrenci Merkezi Toplantı Odası",
          attendees=10, priority="medium", status="confirmed", status_at=(2, "10:00"),
          people=[("defne", "Toplantı başkanı"), ("kaan", "Etkinlikler"), ("elif", "Maliye"), ("zeynep", "İletişim"), ("mert", "Tasarım"), ("can", "Teknik")],
          teams=[], records=["takvim_taslak", "vize_cakisma"], drop_cp=["OTF gönderildi"], widgets_drop=["otf"],
          done=[("Gündem toplandı", 9, "10:00", "defne"), ("Davet gönderildi", 6, "10:30", "defne")],
          chat=[
              msg(2, "10:35", "defne", "{W:e4} gündemi: Maker Fest tarihi, Arduino atölyesi durumu, sponsor mektubu. Başka madde varsa yazın."),
              msg(1, "14:10", "kaan", "Takvim taslağını da gündeme alalım, vize çakışması orada çözülür."),
          ]),

    Event("e1", "Arduino ile Akıllı Ev Atölyesi", "Atölye", "Etkinlik Planlama",
          "Dört saatlik uygulamalı atölyede 30 katılımcı Arduino, sıcaklık sensörü ve röle ile ışığı ve ısıyı kontrol eden bir akıllı ev maketi kuracak. "
          "Eğitmen Can Özdemir; malzemeler kulüp bütçesi ve sponsor katkısıyla karşılanıyor.",
          owner="kaan", at=(14, "14:00"), date=A.e1, start="10:00", place="Maker Atölyesi (B Blok)",
          attendees=30, priority="high",
          people=[("can", "Teknik eğitmen"), ("mert", "Afiş ve görsel tasarım"), ("zeynep", "Duyuru ve sosyal medya"),
                  ("elif", "Bütçe ve satın alma"), ("selin", "SEB formları (ETF/OTF)"), ("burak", "Kayıt masası gönüllüsü")],
          teams=["Teknik Atölye", "Tasarım", "Lojistik", "Maliye", "İletişim"],
          records=["kayit_formu", "malzeme_listesi", "afis", "vardiya", "otf_arduino"],
          done=[("Eğitmen kesinleşti", 11, "08:55", "kaan")],
          materials=[
              Material("Arduino Uno R3 (30 adet)", "equipment", "high", 3,
                       "Orijinal kart tercih edilecek; arıza için 2 yedek kart eklenmeli.",
                       providers=[(f"{EK}/arduino-uno-r3", 4350.00, 4), (f"{DM}/uno-r3", 4575.00, 5), (f"{SH}/arduino-uno", 4470.00, 7)]),
              Material("Breadboard + jumper kablo seti (30 set)", "consumable", "high", 2,
                       providers=[(f"{DM}/breadboard-set", 1860.00, 6), (f"{EK}/breadboard-jumper", 1935.00, 5)]),
              Material("DHT22 sıcaklık sensörü (30 adet)", "equipment", "medium", 2,
                       "Sponsor katkısı bekleniyor; sponsor mektubu imza aşamasında.", sponsor=True,
                       providers=[(f"{SH}/dht22", 1740.00, 6)]),
              Material("Röle modülü 5V (30 adet)", "equipment", "critical", 1,
                       "Röle modülleri gelmeden akıllı ev uygulaması test edilemez.",
                       providers=[(f"{DM}/role-modulu", 1020.00, 7)]),
              Material("Lehim teli ve flux", "consumable", "low", 3, providers=[(f"{EK}/lehim-teli", 420.00, 4)]),
              Material("Lazer kesim sensör tutucu paneller", "service", "medium", 1,
                       "3 mm akrilik, 30 adet; çizim dosyası Mert'te.",
                       providers=[("Atölye Ahmet 0555 000 02 02", 900.00, 6)]),
              Material("Topraklı çoklu priz (10 adet)", "equipment", "medium", 0, owned=True),
              Material("Katılım sertifikası baskısı", "service", "low", 3, providers=[("Kampüs Matbaa 0555 000 02 03", 315.00, 2)]),
          ],
          chat=[
              msg(14, "14:20", "kaan", "Arduino atölyesinin kaydını açtım. Tarih {DW:e1}, yer Maker Atölyesi. @can-ozdemir eğitmen olarak uygun musun?"),
              msg(14, "14:45", "can", "Uygunum. Kontenjanı 30'da tutalım, daha fazlası lehim ve kablo yönetimi için zor olur. Malzeme listesini ben çıkarırım."),
              msg(13, "10:10", "elif", "Bütçe için kabaca 10.600 ₺ çıkıyor, sponsor gelirse net 7.800 civarı. Detaylar malzeme kaydında."),
              msg(12, "18:30", "mert", "Afiş taslağı hazır, afiş kaydına yükledim. Yorumlarınızı bekliyorum."),
              msg(11, "09:00", "kaan", "Eğitmen adımını tamamladım. Sıradaki: mekan onayı."),
              msg(8, "13:40", "selin", "ETF ve OTF için son günleri hesapladım: OTF'yi en geç {OTF:e1} gönderebiliriz. Bir iş günü pay bırakıp {OTFp:e1} gününü hedefleyelim."),
              msg(6, "20:15", "zeynep", "Duyuru metni ve reels planı hazır, afiş onaylanınca paylaşıyorum. @mert-yildiz son sürümü ne zaman görürüz?"),
              msg(5, "08:50", "mert", "Dünkü yorumlarla v2'yi çıkardım. Başlık büyüdü, kayıt bilgisi alta taşındı."),
              msg(3, "16:00", "can", "Kayıtlar 42'ye çıkmış! Kontenjanı aştık. İkinci oturum için salon bulabilir miyiz? @kaan-demir"),
              msg(3, "16:20", "kaan", "Aynı gün 15:00-19:00 için salonu soracağım. Bekleme listesini de açalım."),
              msg(2, "11:00", "elif", "DHT22 sponsor onayı geldi mi? Sipariş için {W+3} günü son gün."),
              msg(1, "19:40", "kaan", "Bina yönetimi cumartesi açılışını hâlâ onaylamadı. Yarın sabah yeniden arayacağım."),
              msg(1, "21:40", "defne", "Gerekirse cumartesi için dekanlığa dilekçe yazarım, haber verin."),
          ]),

    Event("e3", "Gebze OSB Teknoloji Gezisi", "Saha ziyareti", "Etkinlik Planlama",
          "Gebze Organize Sanayi Bölgesi'nde bir otomasyon fabrikasına yarım günlük teknik gezi: üretim hattı turu ve mühendislerle söyleşi.",
          owner="can", at=(10, "11:00"), date=A.e3, start="08:00", place_text="Gebze Organize Sanayi Bölgesi",
          attendees=25, priority="medium",
          people=[("can", "Gezi sorumlusu"), ("kaan", "Ulaşım ve lojistik"), ("selin", "İzin yazışmaları"), ("burak", "Katılımcı listesi")],
          teams=["Teknik Atölye", "Lojistik"], records=["gezi_onay", "gezi_ulasim"],
          chat=[
              msg(10, "11:20", "can", "Fabrika {DW:e3} gününü önerdi. 25 kişilik kontenjan, otobüs ve öğle yemeği için teklif alıyoruz."),
              msg(5, "17:30", "selin", "Üniversiteden gezi izin yazısını hazırlıyorum, fabrikanın onay yazısı gelince birlikte gönderirim."),
          ]),

    Event("e2", "Maker Fest 2026", "Konferans", "Etkinlik",
          "Öğrenci projelerinin sergilendiği, atölyelerin ve konuşmaların yer aldığı yıllık festival: 12 stand, sahne programı ve sponsor alanı.",
          owner="defne", at=(20, "14:00"), date=A.e2, start="10:00", place="Merkez Kampüs Meydanı",
          attendees=250, priority="critical",
          people=[("zeynep", "Duyuru ve stand başvuruları"), ("mert", "Görsel kimlik ve sahne"), ("elif", "Bütçe ve sponsorlar"),
                  ("kaan", "Lojistik"), ("can", "Teknik altyapı")],
          teams=["Tasarım", "İletişim", "Maliye", "Lojistik"],
          records=["maker_fest_standlar", "vize_cakisma", "tema_anketi"],
          done=[("Başvuru", 16, "11:00", "defne")],
          materials=[
              Material("Stand çadırı 3x3 (12 adet)", "equipment", "high", 2,
                       "Kampüs ofisinden kiralama da mümkün; fiyatlar iki seçenek için kıyaslanıyor.",
                       providers=[("Etkinlik Kiralama 0555 000 02 04", 7200.00, 25), (f"{EK}/cadir-3x3", 8400.00, 20)]),
              Material("Roll-up banner (6 adet)", "service", "medium", 1, providers=[("Kampüs Matbaa 0555 000 02 03", 2340.00, 22)]),
              Material("Elektrik dağıtım panosu kiralama", "service", "high", 1, providers=[]),
              Material("Katılım ve ödül sertifikaları", "service", "low", 3, providers=[("Kampüs Matbaa 0555 000 02 03", 640.00, 24)]),
          ],
          chat=[
              msg(20, "14:30", "defne", "Maker Fest {DW:e2}, kampüs meydanında. 12 stand, sahne programı ve sponsor köşesi planlıyoruz."),
              msg(9, "16:00", "zeynep", "Stand başvuru formunu bu hafta açabilirim, ölçütleri @defne-aksoy yazınca yayınlarız."),
              msg(5, "10:15", "defne", "Vize haftası sorunu için ayrı kayıt açıldı. Alternatif tarihleri perşembe toplantısında konuşuyoruz."),
              msg(4, "11:05", "elif", "Sponsor görüşmeleri tarihe esnek; ama yazılı bilgilendirme bekliyorlar."),
          ]),

    # ============================================================== HAVUZ ===
    Event("e8", "Yazılım Hackathonu", "Yarışma", "Etkinlik fikiri bulma",
          "Takımların 24 saatte bir kampüs sorununa yazılım çözümü geliştirdiği hackathon fikri; sponsor ve mekan henüz belli değil.",
          owner="kaan", at=(29, "16:00"), date=None, attendees=60, priority="low",
          people=[("zeynep", "Sponsorluk"), ("can", "Teknik jüri")], teams=[], records=["hackathon_sponsor"],
          chat=[
              msg(29, "16:20", "kaan", "Anket sonucunda en çok oy alan fikirlerden biri. Tarih ve sponsor netleşmeden havuzda bekleyecek."),
              msg(9, "16:50", "zeynep", "Sponsor listesini çıkarınca takvime önerebiliriz."),
          ]),

    Event("e9", "Mezunlar Buluşması", "Sosyal", "Etkinlik fikiri bulma",
          "Kulübün mezun üyeleriyle yapılacak bir akşam buluşması: kariyer deneyimleri, mentorluk ve ağ kurma.",
          owner="defne", at=(18, "18:00"), date=None, attendees=40, priority="low",
          people=[("ayse", "Mezun iletişimi")], teams=[],
          chat=[
              msg(18, "18:10", "defne", "Mezunlarla bağlantı kurmak için bir buluşma düşünüyoruz. Takvim netleşince tarih seçeriz."),
          ]),
]
