# 61 — Araştırma sentezi: IWS ve ekip araçlarından bizim ölçeğe

Web taramasının ham notlarındaki ~100 kaynaktan zayıf/konu dışı olanlar (patent PDF'leri, kamera/
görü tabanlı kalite kontrolü, TPM donanım detayları, ISO 14224 beş katmanlı varlık
modelleri) elendi. Aşağıda kalan malzeme, `spec/60-kaynak-uyarlama.md`'nin yanına
oturacak şekilde bizim 20–25 kişilik, çoğunluğu yönetici, haftalık kadanslı ekibimize
süzüldü. Her iddianın yanında kaynak URL'si var; URL yoksa iddia bu belgede yok sayılır.

---

## 1. Kaynak sistemlerin ortak kalıpları

IWS/bağlı-saha araçları (Tulip, Intellect/Zaptic, L2L, Redzone) ile küçük-ekip görev
araçları (Asana, ClickUp, Trello, Basecamp) birbirinden habersiz iki dünya, ama üç
noktada aynı çözüme varmışlar:

| Kalıp | IWS tarafı | Küçük-ekip tarafı |
|---|---|---|
| Rapor/eylem ayrımı | "Ne oldu" (defect/olay) ile "kim ne yapacak" (work order) ayrı kayıt; birine çok eylem bağlanır | Asana/ClickUp'ta görev tek varlık ama alt görev ile aynı fikri taklit eder |
| Takıma atama, kişiye değil | İş istasyonuna/hücreye açılır, operatör üstlenir | "Unassigned queue": göreve kimse değil takım atanır, aktif olunca herkesin listesinde belirir, biri üstlenince başkalarınınkinden kaybolur ([support.teamwork.com](https://support.teamwork.com/projects/efficiency/quickly-assigning-tasks-to-a-person-or-team), [aproove.com](https://www.aproove.com/features/team-tasks)) |
| Varlık/iş hiyerarşisi omurga | Facility→Department→System→Asset→Component; her filtre bu ağaca bakar ([fiixsoftware.com](https://fiixsoftware.com/blog/how-to-set-up-asset-hierarchy-for-maintenance/), [getmaintainx.com](https://www.getmaintainx.com/blog/asset-hierarchy)) | Proje/portföy ağacı daha sığ ama aynı rol: filtre ve rapor buradan türer |
| Tek merkezi hub | Dağınık form/tablo/e-posta yerine "connected operations hub" ([intellect.com](https://intellect.com/platform/connected-frontline-worker)) | Aynı motivasyon: "yanlış araç seçimi 3 ay içinde ekibin yarısının girişi bırakması" ([work-management.org](https://work-management.org/project-management/clickup-vs-asana/)) |

Ayrıştıkları yer **kadans**: IWS günlük/vardiya eksenli (DDS — "zamanında karar,
önceliklerde hizalanma" [linkedin.com/…iws…](https://www.linkedin.com/pulse/iws-integrated-work-system-shezan-ahmed-fxztc)), küçük-ekip araçları haftalık veya daha gevşek bir ritme
oturur ([catapultlabs.com](https://www.catapultlabs.com/blog/agile-best-practices-for-remote-teams-a-comprehensive-guide)). Bizim WDS kararı ikinci kampa daha yakın — `60-kaynak-uyarlama.md`'nin zaten
söylediği şey, kaynaklarla da doğrulanıyor.

---

## 2. Bizim ölçeğe uyan pratikler

| Pratik | Ne, somut olarak | Neden bize uyuyor | Kaynak |
|---|---|---|---|
| **Atanmamış havuz, takıma açık, kişiye değil** | Kayıt takıma bağlanır (`items.team_id` — zaten karar); atanmayan iş takımın tüm üyelerinin görev listesinde görünür, biri üstlenince kaybolur | Az sayıda aktif üyeyle "kim yapacak" belirsizliğini PM'siz çözer; bizde de proje yöneticisi yok | [support.teamwork.com](https://support.teamwork.com/projects/efficiency/quickly-assigning-tasks-to-a-person-or-team), [aproove.com](https://www.aproove.com/features/team-tasks) |
| **"Benim işlerim" kişisel görünüm** | Kullanıcının tüm takımlardan atanan/dahil olduğu kayıtlar tek listede, "bugün/yaklaşan" değil "açık eylemim" gibi bize uyan kesitlerle | Çoğu üye yönetici, birden fazla takımda olabilir; tek bakışta "benden ne bekleniyor" sorusu — pasif üyeyi de içeri çeker | [asana.com/My Tasks](https://asana.com/features/project-management/my-tasks), [clickup.com](https://clickup.com/learn/topic/task-management/tools/asana/) |
| **Basit gelen kutusu filtreleri: bugün / son tarihsiz** | Hızlı filtre şeridine "son tarihi olmayan" gibi bir seçenek | Düşük aktiflikte "hiç işaretlenmemiş" işi öne çıkarmak, unutulanı azaltır | [productivity.academy](https://productivity.academy/news/manage-personal-tasks-with-clickup/) |
| **Haftalık kadans, günlük stand-up yok** | WDS tek haftalık checkpoint; ara güncellemeler yazılı/asenkron | Uzak ekipte haftalık ritim çoğu ekipte işliyor; günlük toplantı zorunlu değil | [catapultlabs.com](https://www.catapultlabs.com/blog/agile-best-practices-for-remote-teams-a-comprehensive-guide) |
| **Asenkron "check-in" — insanlar kendi hızında yanıtlar** | WDS öncesi herkese "bu hafta ne yaptın / bu hafta neye odaklanıyorsun" sorusu; yanıtlar tek konuya (takım duvarına) toplanır | Basecamp'in yönetici tetiklediği, insanların kendi hızında cevapladığı otomatik check-in modeli; senkron toplantı zorunluluğu olmadan pasif üyeyi konuşturur | [github.com/ways-of-working](https://github.com/ways-of-working/ways-of-working/blob/main/doc/how-we-structure-our-work-and-teams-at-basecamp/index.md) |
| **Haftalık 1:1'de üç sabit soru** | Lider–üye haftalık kısa görüşmede: "iyi giden ne, nerede takıldın, benden ne istiyorsun" | Kısa, tutarlı, iki yönlü — 20-25 kişide lider zamanını korur, üyeyi görünür kılar | [deepersignals.com](https://www.deepersignals.com/blog/how-to-improve-remote-team-engagement/) |
| **Takım duvarı = pasif üyenin giriş kapısı** | Takım sohbeti + o takıma düşen eylem listesi tek ekranda | Genel tabloyu hiç açmayan biri, kendi takımının duvarından sistemde kalır (zaten `60-`'ta karar, kaynakla teyit) | [hrcloud.com](https://www.hrcloud.com/blog/top-13-internal-communication-tools) (basit, mobil-öncelikli arayüz benimsemeyi artırıyor) |
| **Bildirim = asıl bağlılık motoru** | `notifications` tablosu zaten var; "kime ne oldu"yu anında, geri kalanı özet olarak ilet | Araç içi bildirim, kullanıcıyı tutan en etkili mekanizma olarak öne çıkıyor | [learn.microsoft.com](https://learn.microsoft.com/cs-cz/microsoftteams/platform/concepts/design/design-app-notification) |
| **Aktiflik farkını ölçüp görünür kılmak** | "Kaç kişiden kaçı bu hafta bir şey yaptı" gibi basit bir oran WDS panosunda | Kullanılabilir kullanıcı ile fiili kullanıcı arasındaki farkı görmek benimseme sorununu erken yakalar | [blog.ciaops.com](https://blog.ciaops.com/2025/06/26/measuring-the-success-of-teams-adoption/) |
| **Küçük, görünür takdir** | WDS özetinde/duvarda "bu hafta kapananlar" gibi bir liste — isim geçsin | Uzak ekipte görünürlük azaldığından takdir etkisi büyüyor; ilk 3 ayda bağlılık düşüşünü frenleyen faktör | [teamland.com](https://www.teamland.com/post/remote-team-engagement) |
| **Sade arayüz, niş özellik değil** | Kolon bütçesi 8, form-builder yok — zaten kararımız | Kullanılabilirlik zayıf olursa niş özellik zenginliği benimsemeyi kurtarmıyor; temiz arayüz + net bildirim daha belirleyici | [blogs.psico-smart.com](https://blogs.psico-smart.com/blog-what-innovative-features-in-employee-engagement-management-software-ca-187812) |
| **Yanlış araç riskini ciddiye almak** | Erken kullanıcı testinde "3 ay sonra yarısı girmiyor" senaryosunu WDS panosundaki aktiflik oranıyla erken yakala | Küçük ekipte kırılma sessiz olur, geç fark edilir | [work-management.org](https://work-management.org/project-management/clickup-vs-asana/) |

---

## 3. Bizim ölçeğe uymayanlar

| Pratik | Neden almıyoruz |
|---|---|
| DDS / vardiya devri, günlük CIL (Clean-Inspect-Lubricate) rutinleri | Uzak ekipte vardiya yok, gün içi devir yok; kadans hafta ([augmentir.ai](https://www.augmentir.ai/autonomous-maintenance/clean-inspect-lubricate-cil-in-manufacturing)) |
| 5S fiziksel disiplini + fotoğraf kanıtı zorunluluğu | Fiziksel istasyon/ekipman yok, "Sustain" adımının zorlanma mekanizması bize aktarılamaz ([fabrico.io](https://www.fabrico.io/blog/best-5s-software-lean-manufacturing/)) |
| Beş katmanlı varlık hiyerarşisi (Site→Area→System→Asset→Component, ISO 14224) | `node_type` serbest metin kalıyor; tip kataloğu 25 kişide yönetim yükü, getirisi yok — zaten karar ([getmaintainx.com](https://www.getmaintainx.com/blog/asset-hierarchy), [fiixsoftware.com](https://fiixsoftware.com/blog/how-to-set-up-asset-hierarchy-for-maintenance/)) |
| Kusur sayısının ebeveyn/büyükebeveyn varlığa otomatik yayılması | Ölçülebilir "kayıp sayacı" kavramımız yok; bizde eskalasyon zaten kart bazında tutuluyor ([fabrico.io](https://www.fabrico.io/blog/cmms-software-parent-child-asset-hierarchy-manufacturing/)) |
| WPI/12 sütun gibi ağır pillar çerçevesi bütün hâlde | Bizde tek `pillar` alanı yetiyor; 12 sütunlu resmi çerçeve 25 kişilik kulüpte orantısız ([maecos.com](https://www.maecos.com/learn/integrated-work-systems/), [scribd.com/WPI](https://www.scribd.com/document/836240094/WPI-Work-Process-Improvement-Guidebook)) |
| Kamera/görü tabanlı kusur tespiti, poka-yoke donanımı | Fiziksel üretim hattı yok, uygulanacak bir "istasyon" yok ([tulip.co](https://tulip.co/blog/mistake-proof-poka-yoke-your-factory/)) |
| ClickUp tarzı "kurulumla kazanılan güç" (extensive setup, feature density) | Az aktif kullanıcı + çoğu ara sıra giren yönetici; kurulum yatırımını geri ödeyecek kullanım sıklığı yok, "overwhelming interface" riski büyür ([lovable.dev](https://lovable.dev/guides/clickup-vs-asana)) |
| Linear'ın mühendislik-ekibi odaklı iş akışı | Bizde "mühendislik dışı" takımlar (maliye, satın alım, tasarım) çoğunlukta; niş araç pazarlama/satış tarafını sıkıştırıyor, bizim karışık takım yapımıza da aynı sebeple uymaz ([eesel.ai](https://www.eesel.ai/blog/linear-vs-clickup)) |
| Basecamp altı-haftalık döngü + tek seferlik ad-hoc proje ekipleri | Bizim kadansımız hafta; altı haftalık "büyük proje" çerçevesi WDS'nin üstüne binen ayrı bir planlama katmanı olurdu — şimdilik gereksiz karmaşıklık ([3.basecamp-help.com](https://3.basecamp-help.com/article/35-the-six-week-cycle)) |
| Fabrika KPI panoları (gerçekleşen/planlanan üretim adedi, vardiya filtresi) | Üretim hattı yok, "gerçekleşen vs planlanan birim" ölçülemez; düğüm KPI'ları ayrı açık nokta olarak zaten bekletiliyor ([excellerant-mfg.com](https://excellerant-mfg.com/feeds/blog/manufacturing-analytics-dashboard-examples-best-practices)) |

---

## 4. WDS panosu için öneriler

Kaynaklarda resmi bir "Weekly Direction Setting" tanımı yok — notlar bunu doğruluyor
([linkedin.com/…iws…](https://www.linkedin.com/pulse/iws-integrated-work-system-shezan-ahmed-fxztc)). Bu yüzden WDS panosunu iki kaynaktan damıtıyoruz: DDS'in "hizalanma +
zamanlı karar" ilkesi ve genel görsel yönetim panosu pratiği, hafta eksenine çevrilerek.

| Panoda ne olmalı | Kaynak ilke | Not |
|---|---|---|
| Tek bakışta durum: bu hafta açılan/kapanan, geciken eylem sayısı | Görsel yönetim panosu — bilgiyi tabloya inmeden özetlemek ([tervene.com](https://tervene.com/blog/visual-management-board/)) | `60-`'taki "sayaçlar en üstte" ilkesiyle aynı; SQL tarafı zaten `items`/`actions` üstünde tek sorgu |
| Kişi/takım × tamamlanma matrisi (✓/✗) | CL panosunun rol × vardiya matrisi, ekseni vardiyadan haftaya çevrilmiş | Rutin tablosu gelene kadar (açık nokta 5) bu satır boş kalabilir, sadece kayıt/eylem nabzıyla açılır |
| Eksik kalanların listesi (kim, ne, ne zamandır) | Aynı CL panosu ilkesi: "tamamlanmayanlar" ayrı liste, gizlenmiyor ([tervene.com](https://tervene.com/blog/visual-management-board/)) | Atanmamış havuzun görünürlüğüyle aynı felsefe: eksik iş saklanmaz |
| Haftalık asenkron check-in özeti | Basecamp otomatik check-in — herkesin kendi hızında yazdığı yanıtlar tek yerde toplanır | WDS toplantısından *önce* okunacak girdi; toplantıyı kısaltır |
| Aktiflik oranı (bu hafta en az bir hareket yapan / toplam üye) | Kullanılabilir vs fiili kullanıcı farkını izleme pratiği ([blog.ciaops.com](https://blog.ciaops.com/2025/06/26/measuring-the-success-of-teams-adoption/)) | Pasif üye sorununu erken yakalamak için tek sayı yeter, ayrı analitik modülü gerekmez |
| "Bu hafta öne çıkanlar" — kapanan iş, isimlerle | Görünür takdir, uzak ekipte etkisi büyük ([teamland.com](https://www.teamland.com/post/remote-team-engagement)) | Panonun en ucuz, en yüksek etkili satırı — ekstra şema gerektirmiyor, mevcut `items`/`events`'ten türer |
| Öncelik/haftalık odak hizalaması | DDS'in "önceliklerde hizalanma" ilkesi, güne değil haftaya taşınmış ([linkedin.com/…iws…](https://www.linkedin.com/pulse/iws-integrated-work-system-shezan-ahmed-fxztc)) | Panonun açılış satırı: "bu hafta hangi düğüm/takım öncelikli" — serbest metin yeter, ayrı alan açmaya gerek yok |

Rutin (tekrarlayan görev tanımı) şeması netleşene kadar (`spec/20-sema.md` açık nokta 5)
matris satırı boş/pasif başlar; panonun geri kalanı bugünkü `items`/`actions` ile
çalışır — ayrı bir veri hattı beklemeye gerek yok.

---

## 5. Kaynaklar

- https://www.linkedin.com/pulse/iws-integrated-work-system-shezan-ahmed-fxztc
- https://www.maecos.com/learn/integrated-work-systems/
- https://www.scribd.com/document/836240094/WPI-Work-Process-Improvement-Guidebook
- https://www.augmentir.ai/autonomous-maintenance/clean-inspect-lubricate-cil-in-manufacturing
- https://www.fabrico.io/blog/best-5s-software-lean-manufacturing/
- https://tervene.com/blog/visual-management-board/
- https://tulip.co/blog/mistake-proof-poka-yoke-your-factory/
- https://intellect.com/platform/connected-frontline-worker
- https://www.fabrico.io/blog/cmms-software-parent-child-asset-hierarchy-manufacturing/
- https://fiixsoftware.com/blog/how-to-set-up-asset-hierarchy-for-maintenance/
- https://www.getmaintainx.com/blog/asset-hierarchy
- https://excellerant-mfg.com/feeds/blog/manufacturing-analytics-dashboard-examples-best-practices
- https://support.teamwork.com/projects/efficiency/quickly-assigning-tasks-to-a-person-or-team
- https://www.aproove.com/features/team-tasks
- https://asana.com/features/project-management/my-tasks
- https://clickup.com/learn/topic/task-management/tools/asana/
- https://productivity.academy/news/manage-personal-tasks-with-clickup/
- https://3.basecamp-help.com/article/35-the-six-week-cycle
- https://github.com/ways-of-working/ways-of-working/blob/main/doc/how-we-structure-our-work-and-teams-at-basecamp/index.md
- https://www.catapultlabs.com/blog/agile-best-practices-for-remote-teams-a-comprehensive-guide
- https://www.deepersignals.com/blog/how-to-improve-remote-team-engagement/
- https://learn.microsoft.com/cs-cz/microsoftteams/platform/concepts/design/design-app-notification
- https://blog.ciaops.com/2025/06/26/measuring-the-success-of-teams-adoption/
- https://www.teamland.com/post/remote-team-engagement
- https://blogs.psico-smart.com/blog-what-innovative-features-in-employee-engagement-management-software-ca-187812
- https://www.hrcloud.com/blog/top-13-internal-communication-tools
- https://work-management.org/project-management/clickup-vs-asana/
- https://lovable.dev/guides/clickup-vs-asana
- https://www.eesel.ai/blog/linear-vs-clickup
