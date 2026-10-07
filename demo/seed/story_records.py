"""Demo kayitlari: bir kulubun son ~6 haftasi. Hepsi kurgusal.

Birim adlari `structure.UNITS` agacindan; kisi anahtarlari `structure.PEOPLE`.
Kart verilerinde `{d+N}` = bugunden N gun sonrasinin tarihi (kosucu doldurur).
Kapanis notlari >= 30 karakter (sunucu kurali, spec/76).
"""

from cal import A
from story_lib import Rec, act, attach, card, done, join, msg, part, pin, prog, rec, signup, vote

RECORDS: list[Rec] = [
    # ------------------------------------------------------------------ fikir ---
    Rec("anket", "Etkinlik fikiri bulma", "task", "Güz dönemi etkinlik fikirleri anketi",
        "Üyelerden Google Form ile dönem etkinlik fikirlerini topluyoruz. Sonuçlar tabloya aktarılıp en çok oy alan beş fikir takvime girecek.",
        owner="kaan", creator="kaan", priority="medium", at=(36, "10:00"), items=[
            part(36, "10:05", "kaan", "zeynep"), part(36, "10:06", "kaan", "mert"),
            act(36, "10:15", "kaan", "Form sorularını hazırla", owner="zeynep", key="a1"),
            act(36, "10:16", "kaan", "Formu üyelere duyur", owner="zeynep", key="a2"),
            act(36, "10:17", "kaan", "Yanıtları tabloya aktar", owner="kaan", key="a3"),
            msg(35, "09:20", "zeynep", "Form hazır, altı soru var: etkinlik türü, tercih edilen gün ve gönüllü olma isteği. Bakıp onaylayabilir misiniz?"),
            msg(35, "09:48", "kaan", "Gönüllü olma sorusu çok iyi olmuş. Tek eksik: önceki etkinliklerden memnuniyet için 1-5 ölçeği ekleyelim."),
            done(35, "16:30", "zeynep", "a1", "Form altı soruyla hazırlandı, memnuniyet ölçeği eklendi ve yönetim kurulu onayladı."),
            msg(34, "11:05", "zeynep", "Form duyurusu hem WhatsApp grubuna hem Instagram hikâyesine gitti."),
            done(34, "11:10", "zeynep", "a2", "Duyuru WhatsApp grubu ve Instagram hikâyesi üzerinden üyelere ulaştırıldı."),
            msg(29, "14:20", "kaan", "Anket 47 yanıtla kapandı. En çok oy: Arduino atölyesi, Maker Fest, 3B yazıcı eğitimi, teknik gezi ve hackathon."),
            done(29, "14:40", "kaan", "a3", "Yanıtlar tabloya aktarıldı ve en çok oy alan beş fikir ayrı bir sekmeye taşındı."),
            rec(28, "10:00", "kaan", "status", "closed",
                note="Anket 47 yanıtla kapandı; en çok oy alan beş fikir takvim taslağına aktarıldı, sonuç tablosu ortak klasörde duruyor."),
        ]),

    Rec("tema_anketi", "Etkinlik fikiri bulma", "task", "Maker Fest ana temasını belirle",
        "Maker Fest afişi, stand yerleşimi ve konuşmacı seçimi temaya bağlı. Üyelerden oylamayla tema seçilecek; süre {W+2} akşamı doluyor.",
        owner="zeynep", creator="zeynep", priority="medium", at=(6, "12:00"), due=5, team="İletişim", items=[
            part(6, "12:05", "zeynep", "mert"), part(6, "12:06", "zeynep", "defne"),
            card(6, "12:20", "zeynep", "poll", "Kasım Maker Fest'in ana teması ne olsun?", key="p1",
                 options=["Yeşil Teknoloji", "Giyilebilir Elektronik", "Robotik ve Otomasyon", "Açık Kaynak Donanım"],
                 allow_other=True, timer_enabled=True, closes_at="{d+2}T18:00"),
            msg(6, "12:30", "zeynep", "Oylama açıldı! {W+2} 18:00'e kadar oy verebilirsiniz. Önerisi olan 'Diğer' seçeneğine yazabilir."),
            vote(6, "13:10", "defne", "p1", [2]),
            vote(6, "14:05", "mert", "p1", [1]),
            vote(5, "09:30", "kaan", "p1", [2]),
            vote(5, "10:40", "can", "p1", [2]),
            vote(5, "17:15", "elif", "p1", [0]),
            vote(4, "11:00", "ayse", "p1", [0]),
            vote(3, "20:30", "selin", "p1", [3]),
            vote(2, "13:45", "burak", "p1", other="Yapay zekâ ve görüntü işleme"),
            msg(2, "13:50", "zeynep", "Şu an Robotik önde ama Yeşil Teknoloji ile arasındaki fark küçük. Son güne kadar sürpriz olabilir."),
            act(2, "14:00", "zeynep", "Tema sonucunu tasarım ekibine ilet", owner="zeynep", due=3, key="a1"),
        ]),

    Rec("hackathon_sponsor", "Etkinlik fikiri bulma", "task", "Hackathon için sponsor adaylarını listele",
        "Yazılım hackathonu için ödül ve yemek desteği verebilecek şirketleri ve kampüs girişimlerini araştırıp bir liste çıkaracağız.",
        owner=None, creator="defne", priority="low", at=(9, "16:30"), items=[
            msg(9, "16:35", "defne", "Hackathon fikri havuzda bekliyor ama sponsor olmadan ilerleyemeyiz. Bu işe gönüllü olan @elif-sahin ya da @zeynep-koc varsa üstlensin."),
        ]),

    # ------------------------------------------------------------------ takvim ---
    Rec("takvim_taslak", "Takvim Oluşturma", "task", "Güz dönemi etkinlik takvimi taslağı",
        "Ankette seçilen fikirleri tarih, mekan ve sorumlu ile bir takvime yerleştiriyoruz; vize haftaları ve resmi tatillerle çakışma kontrol edilecek.",
        owner="kaan", creator="kaan", priority="high", at=(26, "11:00"), due=3, items=[
            part(26, "11:03", "kaan", "mert"), part(26, "11:04", "kaan", "can"),
            act(26, "11:15", "kaan", "Vize haftalarını akademik takvimden işaretle", owner="elif", key="a1"),
            act(26, "11:16", "kaan", "Resmi tatilleri takvime ekle", owner="ayse", key="a2"),
            msg(26, "11:30", "kaan", "Anket sonuçlarına göre ilk taslağı çıkarıyorum. @elif-sahin akademik takvimdeki vize haftalarını işaretleyebilir misin?"),
            rec(25, "15:00", "kaan", "status", "in_progress"),
            done(23, "17:40", "elif", "a1", "Vize haftaları {WEEK:e2} ve Ocak sonundaki final haftası olarak takvime işlendi, haftalar sarı ile işaretlendi."),
            msg(20, "20:10", "ayse", "Resmi tatilleri ekledim. 29 Ekim Perşembe günü Cumhuriyet Bayramı, 28 Ekim yarım gün; atölye ve gezi planlarında buna dikkat edelim."),
            done(20, "20:12", "ayse", "a2", "Cumhuriyet Bayramı ve yarım gün tatil takvime işlendi, hafta sonu birleşimleri de eklendi."),
            act(4, "10:00", "kaan", "Taslağı yönetim kuruluna sun", owner="kaan", due=2, key="a3"),
            card(4, "13:00", "kaan", "meeting", "Takvim toplantısı", key="c1",
                 when="{d+1}T19:00", place="Öğrenci Merkezi Toplantı Odası", link="https://meet.example/takvim-toplantisi",
                 agenda="1) Taslak takvimin gözden geçirilmesi\n2) Vize haftası çakışmaları\n3) Etkinlik sorumlularının atanması"),
            signup(3, "10:15", "mert", "c1", "yes"),
            signup(3, "11:00", "can", "c1", "yes"),
            signup(3, "12:30", "zeynep", "c1", "maybe", "19:30'a kadar dersim var"),
            signup(2, "09:00", "elif", "c1", "no", "Maliye raporu için başka toplantım var"),
            signup(2, "21:10", "kaan", "c1", "yes"),
            msg(2, "21:15", "kaan", "Toplantı gündemi hazır, {W+1} 19:00. En çok tartışacağımız konu Maker Fest tarihi; @defne-aksoy hazırlıklı gel lütfen."),
        ]),

    Rec("vize_cakisma", "Takvim Oluşturma", "issue", "Vize haftası ile Maker Fest tarihi çakışıyor",
        "Maker Fest için seçtiğimiz {D:e2}, bazı bölümlerin ara sınav haftasına denk geliyor; katılım düşebilir. Alternatif tarih önerisi gerekiyor.",
        owner="kaan", creator="zeynep", priority="critical", at=(5, "09:40"), due=-1, items=[
            part(5, "09:45", "kaan", "defne"), part(5, "09:46", "kaan", "elif"),
            act(5, "09:55", "kaan", "Bölümlerin sınav takvimini öğren", owner="zeynep", due=-2, key="a1"),
            act(5, "09:56", "kaan", "Alternatif iki tarih öner", owner="kaan", due=1, key="a2"),
            msg(5, "10:05", "zeynep", "Mühendislik fakültesinde {WEEK:e2} ara sınav haftası. Stand açacağımız gün tam vize haftasının cuması."),
            msg(5, "10:20", "defne", "O hafta meydan boş olduğu için o tarihi seçmiştik. Bir hafta sonrasına ({D:e2+7}) kaydırırsak da olur ama hava soğuyor."),
            msg(4, "08:55", "elif", "Sponsor tarafı tarihe esnek, sadece yazılı bilgilendirme istiyorlar. Karar çıkınca haber verin."),
            prog(4, "09:30", "kaan", "a2"),
            msg(1, "22:05", "kaan", "İki aday: {DW:e2+7} ve {DW:e2+14}. {W+1} toplantısında oylayıp karar verelim."),
        ]),

    # ------------------------------------------------------------- katilimci ---
    Rec("kayit_formu", "Katılımcı Sayısı Belirleme", "task", "Arduino atölyesi kayıt formunu hazırla",
        "Kayıt formu ad, bölüm, deneyim düzeyi ve diyet tercihini sorar. 30 kişilik kontenjan dolunca bekleme listesi otomatik açılacak.",
        owner="burak", creator="kaan", priority="high", at=(13, "10:00"), due=4, team="Teknik Atölye", items=[
            part(13, "10:05", "kaan", "can"),
            act(13, "10:15", "kaan", "Form sorularını Can'la netleştir", owner="burak", key="a1"),
            act(13, "10:16", "kaan", "Kontenjan dolunca formu kapat", owner="burak", due=2, key="a2"),
            act(13, "10:17", "kaan", "Form bağlantısını afişteki QR koda bağla", owner="mert", due=3, key="a3"),
            msg(13, "10:30", "burak", "Merhaba! İlk kez form hazırlıyorum, soruları taslak olarak ekledim. @can-ozdemir bakabilir misin?"),
            msg(12, "09:10", "can", "Güzel başlangıç. Deneyim sorusunu 'hiç yok / biraz / rahat' diye üçe indirelim, lehim isteyip istemediğini de soralım."),
            card(12, "09:30", "can", "poll", "Kayıt formunda hangi sorular olsun?", key="p1",
                 options=["Bölüm ve sınıf", "Deneyim düzeyi", "Diyet / alerji", "Dizüstü getirecek mi?"],
                 multiple_choice=True),
            vote(12, "10:00", "burak", "p1", [0, 1, 3]),
            vote(12, "11:20", "can", "p1", [0, 1, 2, 3]),
            done(12, "16:45", "burak", "a1", "Sorular Can ile netleştirildi: bölüm, deneyim düzeyi ve diyet tercihi forma eklendi."),
            vote(11, "15:30", "kaan", "p1", [1, 2]),
            msg(8, "14:00", "burak", "Form yayında. Kontenjan ayarını açtım, 30 kişide kapanıyor."),
            pin(8, "14:05", "kaan"),
        ]),

    Rec("kontenjan_asimi", "Katılımcı Sayısı Belirleme", "issue", "Kayıtlar kontenjanı aştı, bekleme listesi gerekiyor",
        "Form açıldıktan üç gün sonra 42 başvuru geldi, kontenjan 30. Bekleme listesi ve ikinci oturum seçeneğini değerlendirmeliyiz.",
        owner="selin", creator="can", priority="high", at=(2, "10:30"), due=2, items=[
            part(2, "10:35", "selin", "kaan"), part(2, "10:36", "selin", "burak"),
            act(2, "10:50", "selin", "Bekleme listesi sütununu forma ekle", owner="burak", key="a1"),
            act(2, "10:51", "selin", "İkinci oturum için salon müsaitliğini sor", owner="selin", due=1, key="a2"),
            msg(2, "10:55", "can", "Kayıt sayısı 42'ye çıktı. 30 kişiden fazlasıyla çalışmak lehim güvenliği açısından riskli, ikinci oturum açmak daha mantıklı."),
            msg(2, "11:15", "selin", "ETF'de 30 kişi yazdım. İkinci oturum eklersek toplam sayı değişeceği için SEB'e not düşmem gerekiyor."),
            msg(2, "11:40", "kaan", "İkinci oturumu aynı gün 15:00-19:00 olarak soralım. @burak-kaya bekleme listesi sütunu bugün biter mi?"),
            msg(2, "12:05", "burak", "Evet, akşama kadar hallederim."),
            prog(1, "09:10", "burak", "a1"),
            msg(1, "18:30", "selin", "Salon sorusunu gönderdim, yarın yanıt bekliyorum."),
        ]),

    # ------------------------------------------------------------------- mekan ---
    Rec("atolye_rezervasyon", "Mekan ve Yer Seçimi", "issue", "Maker Atölyesi rezervasyonu bina yönetiminden onay bekliyor",
        "{DW:e1} için B Blok atölyesi talebi iletildi; hafta sonu açılış izni bina yönetiminden henüz gelmedi.",
        owner="kaan", creator="kaan", priority="high", at=(8, "11:30"), due=5, team="Lojistik", items=[
            part(8, "11:35", "kaan", "can"), part(8, "11:36", "kaan", "ayse"),
            act(8, "11:45", "kaan", "Bina yönetimini ara, açılış iznini takip et", owner="kaan", due=1, key="a1"),
            act(8, "11:46", "kaan", "Alternatif salon için konferans salonunu opsiyonla", owner="ayse", key="a2"),
            rec(8, "11:50", "kaan", "status", "pending"),
            msg(8, "12:00", "kaan", "Dilekçe gitti, bina yönetimi hafta sonları ek güvenlik görevlisi istiyor. Yanıt gelene kadar kayıt beklemede."),
            msg(7, "10:20", "ayse", "Konferans salonu 17 Ekim için boş, opsiyon koydum ama masa düzeni atölyeye uymuyor. Yedek olarak duruyor."),
            msg(5, "15:10", "can", "Atölye anahtarı benim elimde; izin çıkarsa cuma akşamı yerleşimi kurabiliriz."),
            msg(1, "19:45", "kaan", "Bugün de arayıp yanıt alamadım. Yarın sabah ilk iş yeniden arayacağım."),
        ]),

    Rec("a_blok_dilekce", "Mekan ve Yer Seçimi", "task", "A Blok konferans salonu rezervasyon dilekçesi",
        "Dönem açılış buluşması için A Blok konferans salonunun rezervasyon dilekçesi hazırlanıp bina yönetimine teslim edilecek.",
        owner="kaan", creator="kaan", priority="medium", at=(39, "15:00"), items=[
            act(39, "15:10", "kaan", "Dilekçeyi yaz ve imzaya çıkar", owner="kaan", key="a1"),
            msg(38, "10:00", "kaan", "Dilekçe danışman hocaya imzaya gitti, perşembe teslim ederim."),
            done(33, "09:10", "kaan", "a1", "Dilekçe imzalandı ve bina yönetimine elden teslim edildi, onay yazısı alındı."),
            rec(33, "09:20", "kaan", "status", "closed",
                note="Konferans salonu {D-20} için onaylandı; onay yazısı ortak klasöre eklendi ve rezervasyon takvime işlendi."),
        ]),

    # ----------------------------------------------------------------- malzeme ---
    Rec("malzeme_listesi", "Malzeme ve Kaynak Planlama", "task", "Arduino atölyesi malzeme listesini kesinleştir",
        "30 kişilik atölye için Arduino, sensör, röle ve sarf malzemelerin listesi çıkarıldı; fiyat karşılaştırması yapılıp sponsor katkısı netleşecek.",
        owner="elif", creator="can", priority="high", at=(13, "09:00"), due=2, team="Maliye", items=[
            part(13, "09:05", "elif", "can"), part(13, "09:06", "elif", "kaan"),
            act(13, "09:15", "elif", "Üç tedarikçiden fiyat al", owner="elif", key="a1"),
            act(13, "09:16", "elif", "Sponsor mektubunu gönder", owner="elif", due=1, key="a2"),
            act(13, "09:17", "elif", "Kablo ve breadboard sayılarını doğrula", owner="can", due=2, key="a3"),
            msg(13, "09:30", "can", "Listeyi ekledim: 30 Arduino, 30 breadboard seti, DHT22 ve röle modülleri, lehim sarfı. Eksik varsa yazın."),
            msg(11, "14:20", "elif", "Üç tedarikçiden teklif aldım, en ucuz Arduino 145 ₺. Tabloyu kayda ekledim, bütçe taslağı v2 de burada."),
            card(11, "14:30", "elif", "media", "Bütçe taslağı v2", key="c1", description="Kalem kalem bütçe: net toplam sponsor katkısıyla yaklaşık 7.845 ₺."),
            attach(11, "14:35", "elif", "c1", ["budget.png"]),
            done(10, "11:05", "elif", "a1", "Üç tedarikçiden teklif alındı ve karşılaştırma tablosu bütçe taslağına eklendi."),
            msg(8, "10:10", "kaan", "Bütçe makul. Röle modüllerini kritik işaretleyelim, onlar gelmeden test edemeyiz."),
            prog(6, "16:00", "can", "a3"),
            msg(3, "12:00", "elif", "Sponsor mektubu hâlâ imza bekliyor, o yüzden DHT22 siparişi askıda. Bunu ayrı kayıt olarak açtım."),
            pin(3, "12:05", "elif"),
            pin(3, "12:06", "kaan"),
        ]),

    Rec("sponsor_mektup", "Malzeme ve Kaynak Planlama", "issue", "Sponsor teklif mektubu hâlâ imzasız",
        "Mektup danışman öğretim üyesinin imzasını bekliyor; imza çıkmadan sponsor firmaya iletemiyoruz ve DHT22 sensör siparişi bekliyor.",
        owner="elif", creator="elif", priority="critical", at=(12, "10:00"), due=-3, team="Maliye", items=[
            part(12, "10:05", "elif", "ayse"), part(12, "10:06", "elif", "defne"),
            act(12, "10:15", "elif", "Danışman ofisine randevu al", owner="ayse", due=-2, key="a1"),
            msg(12, "10:25", "elif", "Mektup hazır ama hoca bu hafta kampüste değil. @ayse-celik ofisinden randevu alabilir misin?"),
            msg(11, "16:10", "ayse", "Sekreteri aradım, perşembe 14:00'te yarım saat ayırabilirmiş."),
            msg(8, "17:30", "ayse", "Perşembe görüşmesi hocanın toplantısı yüzünden iptal oldu. Yeni randevu bekliyorum."),
            msg(4, "09:00", "defne", "Bu iş üç gündür gecikmede. İmza bu hafta çıkmazsa sponsorsuz bütçeye geçelim, DHT22'yi kulüp bütçesinden alırız."),
        ]),

    Rec("kalan_malzeme", "Malzeme ve Kaynak Planlama", "task", "Geçen atölyeden kalan malzemeyi say ve etiketle",
        "3B yazıcı eğitiminden artan filament, sarf malzeme ve kabloların sayımını yapıp depo listesine ekleyeceğiz; Arduino atölyesinde kullanılabilir.",
        owner=None, creator="can", priority="medium", at=(11, "13:00"), due=8, items=[
            msg(11, "13:05", "can", "Dolapta yarım rulo PLA, bir kutu jumper kablo ve iki breadboard var. Birisi sayıp listeye geçirse iyi olur."),
        ]),

    # ------------------------------------------------------------------ hazirlik ---
    Rec("afis", "Etkinlik Öncesi Hazırlık", "task", "Arduino atölyesi afiş ve duyuru görselleri",
        "Atölye için basılı afiş, Instagram gönderisi ve hikâye görselleri hazırlanacak. Tarih, yer ve kayıt bağlantısı net okunmalı.",
        owner="mert", creator="kaan", priority="high", at=(12, "14:00"), due=3, team="Tasarım", items=[
            part(12, "14:05", "mert", "zeynep"), part(12, "14:06", "mert", "kaan"),
            act(12, "14:15", "mert", "Afiş taslağını hazırla", owner="mert", key="a1"),
            act(12, "14:16", "mert", "Instagram gönderi ve hikâye boyutlarını çıkar", owner="mert", due=3, key="a2"),
            act(12, "14:17", "mert", "Kayıt QR kodunu afişe yerleştir", owner="burak", due=3, key="a3"),
            card(12, "14:30", "mert", "media", "Afiş taslakları", key="c1", description="Taslaklar bu kartta; yorumları sohbete yazın, son sürüm en altta."),
            attach(12, "18:10", "mert", "c1", ["poster-v1.png"]),
            msg(12, "18:15", "mert", "İlk taslak hazır. Koyu mavi tema, vurgu rengi turkuaz. Yorumlarınızı bekliyorum.", img=["poster-v1.png"]),
            msg(12, "19:00", "zeynep", "Çok iyi! Ama başlık biraz küçük kalmış, Instagram'da küçük ekranda zor okunur.", key="m1"),
            msg(12, "19:30", "kaan", "Kayıt bilgisi altta kaybolmuş gibi. QR kodu daha belirgin yapalım.", key="m2"),
            done(12, "21:00", "mert", "a1", "Birinci afiş taslağı tamamlandı ve ekibe sohbet üzerinden gösterilip yorum alındı."),
            msg(9, "10:40", "mert", "Yorumlara göre ikinci bir tasarım çıkardım: açık zemin, turuncu vurgu, başlık çok daha büyük.", reply="m1", img=["poster-v2.png"]),
            attach(9, "10:45", "mert", "c1", ["poster-v2.png"]),
            msg(9, "11:10", "kaan", "v2 okunaklı, ben bunu seçerdim. Ama v1'in renkleri atölye temasına daha çok yakışıyor; oylayalım mı?"),
            msg(9, "11:25", "zeynep", "Hikâyede v1 daha iyi duruyor, afişte v2. İkisini de kullanabiliriz: basılı v2, sosyal medya v1."),
            msg(9, "11:40", "mert", "Anlaştık. Sosyal medya boyutlarını çıkarıyorum."),
            pin(9, "11:45", "kaan"), pin(9, "11:46", "mert"), pin(9, "11:47", "zeynep"),
            prog(8, "09:30", "mert", "a2"),
            msg(2, "17:05", "mert", "Basılı afişler için baskı teklifi 12 ₺/adet. 15 adet yeterli olur mu @elif-sahin?"),
        ]),

    Rec("instagram_takvim", "Etkinlik Öncesi Hazırlık", "task", "Atölye duyuruları için Instagram yayın takvimi",
        "Atölyeden önceki iki hafta için gönderi, hikâye ve reels planı çıkarılacak; afiş onaylandığında yayın tarihleri kesinleşecek.",
        owner="zeynep", creator="zeynep", priority="medium", at=(6, "10:00"), due=6, team="İletişim", items=[
            part(6, "10:05", "zeynep", "mert"),
            act(6, "10:15", "zeynep", "Hikâye şablonunu Mert'ten al", owner="zeynep", due=1, key="a1"),
            act(6, "10:16", "zeynep", "Yayın takvimini paylaş", owner="zeynep", due=4, key="a2"),
            msg(6, "10:30", "zeynep", "Plan: {D-3} günü teaser, {D+3} günü kayıt hatırlatması, etkinlik günü canlı hikâye. Bütün gönderiler afiş onayından sonra."),
        ]),

    Rec("kayit_masasi", "Etkinlik Öncesi Hazırlık", "task", "Kayıt masası ve yönlendirme tabelaları",
        "Atölye günü giriş masasının kurulumu, katılımcı listesi ve yönlendirme tabelaları için gönüllü bulunacak.",
        owner="kaan", creator="kaan", priority="medium", at=(5, "16:00"), due=9, team="Lojistik", items=[
            part(5, "16:05", "kaan", "burak"),
            card(5, "16:20", "kaan", "pool", "Kayıt masasında karşılama", key="c1",
                 need="3", detail="Atölye günü 09:00-10:30 arası katılımcıları karşılayıp listeden işaretleyecek ve yönlendirecek kişiler."),
            signup(4, "10:05", "burak", "c1", "yes"),
            signup(4, "12:40", "zeynep", "c1", "yes"),
            msg(4, "12:45", "kaan", "Bir kişi daha lazım. Gönüllü olan bu karttan üstlensin, atama yapmayacağım."),
        ]),

    Rec("vardiya", "Ekip ve Görev Dağılımı", "task", "Atölye günü vardiya çizelgesi",
        "Atölye günü kimin hangi saatte hangi masada yer alacağını gösteren vardiya çizelgesi hazırlanacak; eğitmen ve yardımcılar belirlenecek.",
        owner="kaan", creator="kaan", priority="medium", at=(4, "11:00"), due=8, team="Lojistik", items=[
            part(4, "11:03", "kaan", "can"), part(4, "11:04", "kaan", "burak"),
            act(4, "11:15", "kaan", "Eğitmen ve yardımcı sayısını netleştir", owner="can", due=3, key="a1"),
            act(4, "11:16", "kaan", "Masa adalarına isim ver", owner="burak", key="a2"),
            act(4, "11:17", "kaan", "Vardiya çizelgesinin ilk taslağını çıkar", owner="kaan", due=6, key="a3"),
            card(4, "11:40", "kaan", "media", "Salon yerleşim planı", key="c1", description="Altı çalışma adası, her adada beş katılımcı; giriş solda, malzeme tezgâhı sağda."),
            attach(4, "11:45", "kaan", "c1", ["layout.png"]),
            card(3, "09:00", "kaan", "meeting", "Atölye günü kısa toplantısı", key="c2",
                 when=f"{{d+{A.e1 - 1}}}T18:00", place="Maker Atölyesi (B Blok)", link="https://meet.example/atolye-briefing",
                 agenda="Cuma akşamı yerleşim kurulumu ve cumartesi sabahı rol dağılımı."),
            msg(3, "09:10", "kaan", "Yerleşim planını ekledim. 6 ada × 5 kişi. Masa isimlerini @burak-kaya verecek."),
            done(2, "20:00", "burak", "a2", "Masa adaları renklerle adlandırıldı: Kırmızı, Mavi, Yeşil, Sarı, Mor ve Turuncu ada."),
            signup(2, "20:30", "can", "c2", "yes"),
            signup(2, "21:00", "mert", "c2", "yes"),
        ]),

    Rec("yk_notlari", "Ekip ve Görev Dağılımı", "task", "Dönem başı yönetim kurulu toplantı notları",
        "Toplantı kararları: takvim taslağı, bütçe sınırı ve üye alım tarihleri not edildi ve ortak klasöre yüklenecek.",
        owner="ayse", creator="ayse", priority="low", at=(9, "21:00"), items=[
            act(9, "21:05", "ayse", "Notları ortak klasöre yükle", owner="ayse", key="a1"),
            msg(9, "21:10", "ayse", "Kararlar: bütçe üst sınırı 12.000 ₺, üye alımı Ekim'in son haftası, haftalık koordinasyon toplantıları perşembe 18:30."),
            done(8, "09:20", "ayse", "a1", "Toplantı notları PDF olarak ortak klasöre yüklendi ve yönetim kurulu grubuna iletildi."),
            rec(8, "09:25", "ayse", "status", "closed",
                note="Notlar yönetim kuruluna iletildi, kararlar ilgili kayıtlara işlendi; bir sonraki toplantı gündemi ayrı kayıtta."),
        ]),

    # --------------------------------------------------------------------- SEB ---
    Rec("etf_arduino", "ETF", "task", "Arduino atölyesi ETF formunu doldur",
        "ETF formu etkinlik adı, tarihi, katılımcı sayısı ve sorumlu danışman bilgileriyle doldurulup SEB'e iletilecek.",
        owner="selin", creator="selin", priority="high", at=(7, "10:00"), due=1, team="İletişim", items=[
            act(7, "10:10", "selin", "Danışman bilgilerini formdaki alanlara yaz", owner="selin", key="a1"),
            act(7, "10:11", "selin", "Katılımcı sayısını kayıt formuna göre güncelle", owner="burak", due=1, key="a2"),
            msg(7, "10:30", "selin", "Formu geçen eğitimden kopyalıyorum, tarih ve katılımcı sayısı dışında çoğu alan aynı kalıyor."),
            done(5, "14:20", "selin", "a1", "Danışman adı, unvanı ve iletişim bilgileri ETF formuna işlendi ve kontrol edildi."),
        ]),

    Rec("etf_imza", "ETF", "issue", "ETF'de sorumlu öğretim üyesi imzası eksik",
        "Formun son sayfasında danışman imzası görünmüyor; SEB eksik imzalı formu işleme almıyor, ıslak imza ya da e-imza gerekiyor.",
        owner="selin", creator="selin", priority="high", at=(3, "15:00"), due=1, items=[
            msg(3, "15:10", "selin", "Form taranırken imza sayfası kesilmiş. Hocaya e-imza için mail attım."),
            msg(2, "09:30", "kaan", "Hoca e-postalara geç dönüyor, bölüm sekreterinden de ricada bulunalım."),
        ]),

    Rec("otf_arduino", "OTF", "task", "Arduino atölyesi OTF formunu hazırla ve gönder",
        "OTF kulüp adresinden, Word biçiminde ve etkinlikten en geç 3 iş günü önce gönderilmeli; dosya adı ve konu başlığı kurala uygun olacak.",
        owner="selin", creator="selin", priority="high", at=(7, "10:40"), due=4, team="İletişim", items=[
            part(7, "10:45", "selin", "kaan"),
            act(7, "10:50", "selin", "OTF'yi etkinlik sayfasından otomatik doldur", owner="selin", due=2, key="a1"),
            act(7, "10:51", "selin", "Gözden geçirilmiş formu Word olarak indir", owner="selin", due=3, key="a2"),
            act(7, "10:52", "selin", "Kulüp adresinden SEB'e gönder", owner="selin", due=4, key="a3"),
            msg(7, "11:00", "selin", "Son gönderim günü {OTF:e1}. Bir iş günü pay bırakıp {OTFp:e1} günü göndermeyi planlıyorum."),
        ]),

    Rec("otf_gec", "OTF", "issue", "Dönem açılışının OTF'si SEB'e geç ulaştı",
        "Form son güne bırakıldığı için SEB'e etkinlikten yalnızca iki iş günü önce ulaştı; ek mesai tanındı ama süreci kayıt altına alıyoruz.",
        owner="selin", creator="selin", priority="medium", at=(28, "16:00"), items=[
            msg(28, "16:10", "selin", "SEB formu etkinlikten iki iş günü önce işleme aldı. 3 iş günü kuralını hesaplarken hafta sonunu da saymışım."),
            msg(27, "09:30", "kaan", "Uygulamadaki OTF sayfası son günü hafta sonu hariç hesaplıyor, oraya güvenelim. Checkpoint'i de 7 gün önceye alalım."),
            rec(21, "11:00", "selin", "status", "closed",
                note="Form son güne bırakıldığı için geç ulaştı; OTF adımı artık etkinlikten 7 gün önce checkpoint olarak işaretleniyor."),
        ]),

    Rec("ek_talep_projeksiyon", "Ek talepler", "task", "SEB'den projeksiyon ve uzatma kablosu talebi",
        "Atölye salonunda iki ek projeksiyon ve on adet uzatma kablosu gerekiyor; SEB'e ek talep dilekçesiyle iletilecek.",
        owner="selin", creator="selin", priority="medium", at=(6, "15:00"), due=5, team="İletişim", items=[
            act(6, "15:10", "selin", "Ek talep dilekçesini yaz", owner="selin", due=3, key="a1"),
            msg(6, "15:20", "selin", "Projeksiyonlar eğitmen masası ve arka duvar için. Kablo ihtiyacını Can'a sordum."),
            msg(5, "13:15", "can", "Kablo için on adet yeterli, ama topraklı çoklu priz de lazım; her adaya bir tane."),
        ]),

    Rec("guvenlik_izni", "Ek talepler", "task", "Cumartesi kapı ve güvenlik görevlisi izni",
        "Hafta sonu atölye girişinin açılması ve güvenlik görevlisinin bilgilendirilmesi için SEB'e yazı gönderilecek.",
        owner="selin", creator="selin", priority="medium", at=(5, "11:00"), due=6, access="request", items=[
            msg(5, "11:10", "selin", "Bina yönetimi ayrıca güvenlik istiyor. Bu kaydı izinle katılım olarak açtım, ilgili kişiler istek göndersin."),
            join(2, "18:40", "burak"),
        ]),

    Rec("seb_gecikme", "SEB iletişim", "issue", "SEB onay süreleri uzadı, alternatif kanal araştırılıyor",
        "Son iki formun yanıtı yedi iş günü sürdü. Birim sorumlusuyla görüşüp hızlı onay için ortak bir takvim önereceğiz.",
        owner="defne", creator="defne", priority="high", at=(15, "11:00"), access="private", items=[
            part(15, "11:05", "defne", "selin"), part(15, "11:06", "defne", "kaan"), part(15, "11:07", "defne", "zeynep"),
            rec(15, "11:10", "defne", "status", "pending"),
            msg(15, "11:20", "defne", "Bu kayıt gizli: SEB ile ilişkiyi yalnızca ilgili kişiler görsün. Son iki formda yedi iş günü bekledik."),
            msg(14, "10:00", "selin", "Birim sorumlusuyla {D-17} için görüşme ayarladım. Form önceliklendirme için kulüplere ortak bir tarih penceresi istiyorum."),
            msg(10, "16:45", "kaan", "Görüşme iyi geçti: formlar için 3 iş günü hedefi var ama garanti vermediler. Önerimiz haftalık kontrol e-postası."),
            msg(3, "10:30", "defne", "Kararımız: her OTF/ETF gönderiminden sonra ertesi gün kontrol e-postası atılacak. Takip eden Selin."),
        ]),

    # ------------------------------------------------------------------- genel ---
    Rec("etkinlik_kurallari", "Etkinlik", "task", "Yeni dönem etkinlik düzenleme kuralları dokümanı",
        "Etkinlik açma, form gönderme ve bütçe onayı adımlarını tek sayfalık bir rehberde toplayacağız; yeni üyeler bundan okuyacak.",
        owner="defne", creator="defne", priority="medium", at=(10, "10:00"), due=14, items=[
            part(10, "10:05", "defne", "kaan"), part(10, "10:06", "defne", "selin"),
            act(10, "10:15", "defne", "OTF ve ETF adımlarını rehbere yaz", owner="selin", due=7, key="a1"),
            act(10, "10:16", "defne", "Bütçe onay akışını rehbere yaz", owner="elif", due=8, key="a2"),
            msg(10, "10:30", "defne", "Yeni üyeler her şeyi sorarak öğreniyor. Tek sayfalık bir rehberde adımları toplayalım; EkipTakip'te nereye bakılacağını da yazalım."),
            msg(9, "13:00", "kaan", "Etkinlik açma kısmını ben yazarım, ekran görüntülü bir sunum da çıkarabiliriz."),
        ]),

    Rec("drone_izin", "Etkinlik Planlama", "task", "Drone gösterisi izin yazısı",
        "Kampüste drone gösterisi için gerekli güvenlik ve havacılık izinleri araştırılıp resmi yazı hazırlanacak.",
        owner="can", creator="can", priority="low", at=(24, "12:00"), items=[
            msg(24, "12:10", "can", "Kampüs üstünde drone uçurmak için ek izin gerekiyor, yazışma uzun sürecek gibi."),
            msg(7, "10:00", "can", "İzin çıkmadığı için bu etkinliği iptal ediyoruz. Fikir güz sonrasına kalsın."),
            rec(6, "09:00", "can", "status", "cancelled"),
        ]),

    Rec("havalandirma", "Etkinlik Planlama", "issue", "Lehim dumanı için havalandırma yetersiz",
        "B Blok atölyesinde 30 kişilik lehim oturumunda duman çekici sayısı yetersiz; en az üç ek çekici ve koruyucu gözlük gerekiyor.",
        owner="can", creator="can", priority="high", at=(4, "14:00"), due=6, pillar="Atölye Güvenliği", items=[
            part(4, "14:05", "can", "kaan"), part(4, "14:06", "can", "mert"),
            act(4, "14:15", "can", "Duman çekici fiyat teklifi al", owner="can", due=3, key="a1"),
            act(4, "14:16", "can", "Koruyucu gözlük stoğunu kontrol et", owner="burak", due=4, key="a2"),
            msg(4, "14:30", "can", "Dört lehim istasyonunda çekici var, 30 kişi için en az yedi lazım. Dumanlı ortamda çalışmak hem sağlıksız hem kural dışı."),
            msg(3, "10:20", "kaan", "Kulüp bütçesinden ek çekiciyi onaylayabiliriz ama etkinlik öncesi gelmesi lazım. @elif-sahin bütçe uygun mu?"),
        ]),

    Rec("atik_kutusu", "Etkinlik Öncesi Hazırlık", "task", "Atölye sonrası elektronik atık toplama kutusu",
        "Atölye bitiminde kullanılmayan kablo, kart ve eski elektronik parçaları toplamak için işaretli bir geri dönüşüm kutusu hazırlanacak.",
        owner="ayse", creator="ayse", priority="low", at=(7, "12:00"), due=10, pillar="Sürdürülebilirlik", items=[
            act(7, "12:10", "ayse", "Kampüs geri dönüşüm birimiyle iletişime geç", owner="ayse", due=5, key="a1"),
            msg(7, "12:20", "ayse", "Kampüs ofisi elektronik atık kutusunu ödünç verebiliyor. Etkinlik gününe göre teslim alacağım."),
        ]),

    Rec("maker_fest_standlar", "Etkinlik Planlama", "task", "Maker Fest stand başvuru formunu aç",
        "Maker Fest'te yer almak isteyen öğrenci projeleri için stand başvuru formunu açıp seçim ölçütlerini duyuracağız.",
        owner="defne", creator="defne", priority="high", at=(9, "15:00"), due=7, items=[
            part(9, "15:05", "defne", "zeynep"), part(9, "15:06", "defne", "mert"),
            act(9, "15:15", "defne", "Başvuru formunu hazırla", owner="zeynep", due=3, key="a1"),
            act(9, "15:16", "defne", "Seçim ölçütlerini yaz", owner="defne", due=5, key="a2"),
            msg(9, "15:30", "defne", "Stand sayısı en fazla 12 olacak. Ölçüt: özgünlük, çalışan prototip ve kampüste sergilenebilirlik."),
        ]),

    Rec("gezi_ulasim", "Etkinlik Planlama", "task", "Gebze OSB gezisi için otobüs teklifi al",
        "Teknik gezi için 25 kişilik otobüs ve gidiş-dönüş saatleri için en az iki firmadan teklif alınacak.",
        owner="can", creator="can", priority="medium", at=(8, "13:00"), due=10, items=[
            act(8, "13:10", "can", "İki firmadan teklif iste", owner="can", due=6, key="a1"),
            msg(8, "13:20", "can", "Kampüsten sabah 08:00 çıkış, akşam 17:30 dönüş. Öğle yemeğini fabrika veriyor."),
        ]),

    Rec("gezi_onay", "Etkinlik Planlama", "issue", "Fabrika ziyaret onayı yanıt vermedi",
        "Gezi için fabrikanın kurumsal ilişkiler birimine başvuru yaptık ama iki haftadır yanıt yok; onay olmadan otobüs rezervasyonu yapılamaz.",
        owner="can", creator="can", priority="high", at=(10, "10:00"), due=-1, items=[
            part(10, "10:05", "can", "kaan"),
            act(10, "10:10", "can", "Kurumsal ilişkiler birimini ara", owner="can", due=-1, key="a1"),
            msg(10, "10:20", "can", "İlk başvuruyu e-postayla yaptık, ikinci kez telefonla da denedim; yetkili toplantıda dediler."),
            msg(1, "12:00", "kaan", "Onay adımı bugün itibarıyla gecikmiş. Gerekirse hocamızın tanıdığı üzerinden gidelim."),
        ]),
]
