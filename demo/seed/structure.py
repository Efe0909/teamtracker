"""Demo dunyasinin iskeleti: kisiler, roller, birimler, yerler, etkinlik turleri, takimlar.

Bu dosya yalniz VERI. Ekranda gorunen her metin Turkce; tanimlayicilar Ingilizce
(CLAUDE.md "Kod dili"). Kisiler kurgusal; e-postalar ayrilmis `example` alan adinda.
"""

from __future__ import annotations

# --- kisiler -----------------------------------------------------------------
# key: kod icinde kisa ad. phone: bilerek sahte (000 blogu). birth: (gun, ay, yil).
PEOPLE = [
    dict(key="defne", name="Defne Aksoy", email="defne.aksoy@demo.example", phone="0555 000 01 01",
         nick=None, birth=(14, 3, 2004), admin=True),
    dict(key="kaan", name="Kaan Demir", email="kaan.demir@demo.example", phone="0555 000 01 02",
         nick="Koordinatör", birth=(2, 11, 2003)),
    dict(key="elif", name="Elif Şahin", email="elif.sahin@demo.example", phone="0555 000 01 03",
         nick=None, birth=(21, 1, 2005)),
    dict(key="mert", name="Mert Yıldız", email="mert.yildiz@demo.example", phone="0555 000 01 04",
         nick="Piksel", birth=(30, 7, 2004)),
    dict(key="zeynep", name="Zeynep Koç", email="zeynep.koc@demo.example", phone="0555 000 01 05",
         nick=None, birth=(9, 10, 2004)),
    dict(key="can", name="Can Özdemir", email="can.ozdemir@demo.example", phone="0555 000 01 06",
         nick="Lehim Ustası", birth="today"),
    dict(key="selin", name="Selin Arslan", email="selin.arslan@demo.example", phone="0555 000 01 07",
         nick=None, birth=(17, 12, 2004)),
    dict(key="ayse", name="Ayşe Çelik", email="ayse.celik@demo.example", phone="0555 000 01 08",
         nick=None, birth=(28, 2, 2003)),
    dict(key="burak", name="Burak Kaya", email="burak.kaya@demo.example", phone="0555 000 01 09",
         nick=None, birth=(5, 5, 2006)),
    # Mezun olup ayrilan uye: hesabi kapali, gecmis kayitlarda adi durur.
    dict(key="ece", name="Ece Tunç", email="ece.tunc@demo.example", phone="0555 000 01 10",
         nick=None, birth=(11, 6, 2002), left=True),
]

# --- roller ------------------------------------------------------------------
# branches: Birimler altinda dal izni (ad). Rol canli hesaplanir (spec/75 §2).
ROLES = [
    dict(key="coordinator", name="Etkinlik Koordinatörü", color="#5b8cff",
         scopes=["manage_events", "manage_event_widgets", "edit_deadline", "tag_media"],
         branches=["Etkinlik"]),
    dict(key="unit_editor", name="Birim Editörü", color="#22a06b",
         scopes=["edit_nodes"], branches=["Etkinlik"]),
    dict(key="finance", name="Maliye", color="#d99a2b",
         scopes=["manage_purchases", "edit_deadline"], branches=[]),
    dict(key="design", name="Tasarım", color="#7c5bff",
         scopes=["tag_media", "create_tags"], branches=[]),
    dict(key="lists", name="Liste Yöneticisi", color="#b4501a",
         scopes=["manage_event_types", "manage_event_locations"], branches=[]),
]

# Kime hangi rol / dogrudan kapsam / dogrudan dal izni.
GRANTS = {
    "kaan": dict(roles=["coordinator", "unit_editor", "lists"]),
    "selin": dict(roles=["coordinator"], branches=["SEB iletişim"]),
    "elif": dict(roles=["finance"]),
    "mert": dict(roles=["design"]),
    "zeynep": dict(roles=["design"]),
    "can": dict(scopes=["manage_purchases", "tag_media"]),
    "ayse": dict(roles=["lists"], scopes=["manage_users", "manage_teams"]),
}

# --- birimler ----------------------------------------------------------------
# (ad, tur, bir satirlik aciklama, [cocuklar]). Ad ve tur BIREBIR kullanicinin istedigi;
# `short=True`: ad 5 karakterden kisa — API reddeder, SQL ile eklenir (eski kisa veri
# gibi, spec/76: yalniz YENI yazimda sorulur).
UNITS = (
    "Etkinlik", "cell",
    "Kulübün bütün etkinliklerinin fikirden sonuç raporuna kadar yürüdüğü ana hücre.",
    [
        ("Takvim Planlama", "machine",
         "Dönemin etkinlik takvimini kurar: girdisi fikir havuzu, çıktısı onaylı takvimdir.",
         [
             ("Etkinlik fikiri bulma", "task",
              "Üyelerden gelen önerileri toplayıp değerlendirerek takvime girecek fikirleri seçmek.", []),
             ("Takvim Oluşturma", "task",
              "Seçilen fikirleri tarih, yer ve sorumlu ile dönem takvimine yerleştirip yayınlamak.", []),
         ]),
        ("Etkinlik Planlama", "machine",
         "Tek bir etkinliğin hazırlığını yürütür: girdisi onaylı fikir, çıktısı hazır etkinliktir.",
         [
             ("Katılımcı Sayısı Belirleme", "step",
              "Beklenen katılımcı sayısını kayıt formu ve geçmiş etkinliklerle tahmin etme adımı.", []),
             ("Mekan ve Yer Seçimi", "step",
              "Katılımcı sayısına ve ihtiyaca uygun mekanı seçip rezervasyonunu alma adımı.", []),
             ("Malzeme ve Kaynak Planlama", "task",
              "Etkinlik için gereken malzeme, bütçe ve sponsor kaynaklarını listeleyip temin etmek.", []),
             ("Etkinlik Öncesi Hazırlık", "task",
              "Afiş, duyuru, kayıt masası ve son kontroller gibi etkinlik öncesi işleri tamamlamak.", []),
             ("Ekip ve Görev Dağılımı", "task",
              "Etkinlik gününde kimin hangi görevi ve vardiyayı üstleneceğini belirlemek.", []),
         ]),
        ("SEB iletişim", "machine",
         "SEB ile yazışmaları yürütür: girdisi etkinlik bilgisi, çıktısı onaylanmış formlardır.",
         [
             ("ETF", "step", "ETF formunun hazırlanıp SEB'e iletildiği adım.", [], True),
             ("OTF", "step",
              "Organizasyon ve Etkinlik Talep Formu'nu (OTF) en geç 3 iş günü önce SEB'e göndermek.", [], True),
             ("Ek talepler", "task",
              "Projeksiyon, ses sistemi, güvenlik gibi formlara sığmayan ek ihtiyaçları SEB'den istemek.", []),
         ]),
    ],
)

# --- etkinlik yerleri (Veri Yonetimi > Etkinlik Yerleri) ---------------------
# `live=True` olan yer tohumda ACILMAZ; yuruyusun icinde ekrandan eklenir.
LOCATIONS = [
    ("Maker Atölyesi (B Blok)", "Lehim, 3B yazıcı ve elektronik tezgâhların bulunduğu atölye; en fazla 30 kişi."),
    ("Konferans Salonu (A Blok)", "Sunum ve panel için 120 kişilik salon; projeksiyon ve ses sistemi hazır."),
    ("Öğrenci Merkezi Toplantı Odası", "Yönetim kurulu ve haftalık koordinasyon toplantıları için 15 kişilik oda."),
    ("Merkez Kampüs Meydanı", "Açık hava etkinlikleri ve stand kurulumları için kampüsün orta alanı."),
    ("Kütüphane Çalışma Salonu", "Sessiz çalışma ve küçük grup eğitimleri için kütüphanenin üst kat salonu."),
    ("Yemekhane Önü", "Tanıtım standı ve imza toplama etkinlikleri için yoğun geçiş alanı."),
]

# --- etkinlik turleri (Veri Yonetimi > Etkinlik Turleri) ----------------------
# Hazir 5 tur goctan gelir (Toplanti, Egitim, Sosyal, Saha ziyareti, Konferans).
# Burada EKLENENLER: ad, aciklama, adimlar (ad, etkinlige gun farki), widget'lar.
EVENT_TYPES = [
    dict(name="Atölye", desc="Uygulamalı, küçük gruplu eğitim: eğitmen, malzeme ve OTF gerektirir.",
         steps=[("Eğitmen kesinleşti", -21), ("Mekan ayarlandı", -14), ("Duyuru yapıldı", -10),
                ("OTF gönderildi", -7), ("Malzeme hazır", -7)],
         widgets=["otf", "supplies"]),
    dict(name="Yarışma", desc="Takımların yarıştığı hackathon, robot ya da tasarım yarışması.",
         steps=[("Jüri belirlendi", -30), ("Kural kitapçığı yayınlandı", -21), ("Kayıtlar açıldı", -14),
                ("OTF gönderildi", -7), ("Sonuçlar duyuruldu", 1)],  # +1: bilerek uyari ornegi
         widgets=["otf", "supplies"]),
    dict(name="Tanıtım Standı", desc="Kampüste açılan stand: üye toplama, ürün gösterimi, imza günü.",
         steps=[("Stand alanı onaylandı", -14), ("Malzeme hazır", -7)],
         widgets=["supplies"]),
]

# --- takimlar ve pillar'lar ----------------------------------------------------
# members: (anahtar, rol) rol: lead | mentor | member. links: bagli birimler (ad).
TEAMS = [
    dict(name="Tasarım", color="#8e6bff",
         desc="Afiş, sosyal medya görselleri ve sahne tasarımı: etkinliklerin görsel kimliği burada üretilir.",
         members=[("mert", "lead"), ("zeynep", "member"), ("defne", "mentor")],
         links=["Etkinlik Öncesi Hazırlık"]),
    dict(name="Lojistik", color="#1c8a5b",
         desc="Mekan, ulaşım, yerleşim ve etkinlik günü akışı: sahadaki işlerin takibi.",
         members=[("kaan", "lead"), ("can", "member"), ("ayse", "member")],
         links=["Etkinlik Planlama", "Mekan ve Yer Seçimi", "Ekip ve Görev Dağılımı"]),
    dict(name="Maliye", color="#d99a2b",
         desc="Bütçe, sponsor görüşmeleri ve satın alma onaylarının takibi.",
         members=[("elif", "lead"), ("ayse", "member"), ("defne", "mentor")],
         links=["Malzeme ve Kaynak Planlama"]),
    dict(name="İletişim", color="#e5484d",
         desc="Üniversite ve SEB yazışmaları, duyurular ve sosyal medya takvimi.",
         members=[("zeynep", "lead"), ("selin", "member"), ("mert", "member")],
         links=["SEB iletişim", "ETF", "OTF", "Ek talepler"]),
    dict(name="Teknik Atölye", color="#2c74ad",
         desc="Atölye eğitimleri, ekipman bakımı ve teknik içerik hazırlığı.",
         members=[("can", "lead"), ("kaan", "member"), ("burak", "member")],
         links=["Etkinlik Planlama"]),
]

PILLARS = [
    dict(name="Atölye Güvenliği", color="#d13350",
         desc="Atölyede iş güvenliği: koruyucu ekipman, ilk yardım ve kural ihlallerinin takibi.",
         members=[("can", "lead"), ("kaan", "member"), ("mert", "member")]),
    dict(name="Sürdürülebilirlik", color="#2f9e8f",
         desc="Elektronik atık, malzemenin yeniden kullanımı ve çevre dostu etkinlik pratikleri.",
         members=[("ayse", "lead"), ("zeynep", "member")]),
]
