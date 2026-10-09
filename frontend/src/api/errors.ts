// API hata kodu -> Turkce ileti. TEK sozluk (spec/16 §3.6).
//
// `satisfies Record<ApiErrorCode, string>`: birlige eklenen her kodun iletisi
// olmak zorunda. Rust'a eklenip buraya hic yazilmayan kodu derleyici GORMEZ;
// onu errors.test.ts yakalar (backend kaynagini tarar).

export type ApiErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "csrf"
  | "internal"
  | "invalid_body"
  | "invalid_title"
  | "invalid_description"
  | "invalid_unit"
  | "invalid_pillar"
  | "invalid_reply"
  | "unknown_user"
  | "unknown_team"
  | "open_actions"
  | "stale_field"
  | "bad_origin"
  | "invalid_name"
  | "invalid_parent"
  | "inactive_parent"
  | "root_only"
  | "move_cycle"
  | "type_locked"
  | "invalid_email"
  | "user_exists"
  | "self_admin"
  | "last_admin"
  | "invalid_scope"
  | "unknown_role"
  | "role_exists"
  | "empty_file"
  | "file_too_big"
  | "bad_file_type"
  | "corrupt_image"
  | "storage_offline"
  | "invalid_attachment"
  | "invalid_card_type"
  | "invalid_when"
  | "invalid_link"
  | "invalid_answer"
  | "invalid_type"
  | "invalid_color"
  | "invalid_node"
  | "name_taken"
  | "team_is_pillar"
  | "invalid_phone"
  | "invalid_nickname"
  | "invalid_birthday"
  | "invalid_avatar"
  | "invalid_banner"
  | "invalid_access_mode"
  | "invalid_options"
  | "invalid_vote"
  | "poll_closed"
  | "invalid_quiet_hours"
  | "invalid_subscription"
  | "invalid_host"
  | "invalid_config"
  | "event_needs_date"
  | "invalid_time"
  | "invalid_place"
  | "invalid_attendees"
  | "invalid_role"
  | "invalid_label"
  | "checkpoint_state"
  | "own_record"
  | "unknown_record"
  | "invalid_record"
  | "invalid_notes"
  | "invalid_state"
  | "invalid_contact"
  | "invalid_price"
  | "invalid_budget"
  | "invalid_qty"
  | "invalid_provider"
  | "no_sponsor"
  | "owned_no_sponsor"
  | "not_approved"
  | "purchased_locked"
  | "invalid_otf_item"
  | "invalid_quantity"
  | "too_many_contacts"
  | "otf_template"
  | "otf_no_source"
  | "otf_review_needs_edit"
  | "otf_unreviewed"
  | "root_locked"
  | "operational_locked"
  | "name_locked"
  | "shape_violation"
  | "type_not_allowed"
  | "invalid_attrs"
  | "unit_outside_units"
  | "node_in_use"
  | "invalid_kind"
  | "invalid_location"
  | "self_permissions"
  | "grant_not_held"
  | "grant_manage_users"
  | "name_not_allowed"
  | "owner_change_denied"
  | "network"
  | "name_too_short"
  | "title_too_short"
  | "description_too_short"
  | "description_required"
  | "closing_note_required"
  | "closing_note_too_short"
  | "invalid_closing_note"
  | "quality_questions_mismatch"
  | "quality_text_invalid"
  | "quality_min_invalid"
  | "low_quality";

export const ERRORS = {
  unauthorized: "Oturumun kapanmış. Yeniden giriş yap.",
  forbidden: "Bunu yapmaya yetkin yok.",
  not_found: "Aradığın şey bulunamadı. Silinmiş ya da taşınmış olabilir.",
  csrf: "Oturum doğrulaması tutmadı. Sayfayı yenile.",
  internal: "Sunucuda bir hata oldu. Biraz sonra tekrar dene.",
  invalid_body: "Gönderilen bilgi geçersiz.",
  invalid_title: "Başlık boş olamaz ve 200 karakteri aşamaz.",
  invalid_description: "Açıklama çok uzun.",
  invalid_unit: "Seçilen konu geçersiz ya da pasif.",
  invalid_pillar: "Seçilen pillar geçersiz.",
  invalid_reply: "Yanıtlanan mesaj bu sohbette değil.",
  unknown_user: "Seçilen kişi bulunamadı ya da hesabı kapalı.",
  unknown_team: "Seçilen takım bulunamadı.",
  open_actions: "Kayıt, açık eylemleri varken kapanmaz. Önce eylemleri kapat.",
  bad_origin: "Canlı bağlantı bu adresten kurulamaz. Sayfayı uygulamanın kendi adresinden aç.",
  stale_field: "Bu alanı sen bakarken başkası değiştirdi. Güncel değer yüklendi; hâlâ istiyorsan yeniden uygula.",
  invalid_name: "Ad boş olamaz ve 200 karakteri aşamaz.",
  invalid_parent: "Seçilen üst düğüm bulunamadı.",
  inactive_parent: "Pasif bir düğümün altına düğüm eklenemez ya da taşınamaz.",
  root_only: "Bu tür yalnız kökte durabilir.",
  move_cycle: "Düğüm kendi altına taşınamaz.",
  type_locked: "Bu düğüme bağlı bir takım kartı var; türü değiştirilemez.",
  invalid_email: "E-posta adresi geçersiz.",
  user_exists: "Bu e-postayla bir kullanıcı zaten var.",
  self_admin: "Kendi yönetici yetkini kapatamazsın.",
  last_admin: "Son aktif yönetici kapatılamaz. Önce başka birini yönetici yap.",
  invalid_scope: "Böyle bir kapsam yok.",
  unknown_role: "Seçilen rol bulunamadı.",
  role_exists: "Bu adla bir rol zaten var.",
  empty_file: "Dosya boş.",
  file_too_big: "Dosya çok büyük. En fazla 10 MB.",
  bad_file_type: "Yalnız JPEG, PNG, WebP ve GIF yüklenebilir.",
  corrupt_image: "Görsel bozuk ya da okunamıyor.",
  storage_offline: "Depolama diski şu an erişilemiyor. Metin mesajları çalışıyor; görseli sonra dene.",
  invalid_attachment: "Bu görsel iliştirilemez (başkasının ya da zaten kullanılmış).",
  invalid_card_type: "Bu kart türü bu işlemi desteklemiyor.",
  invalid_when: "Tarih ve saat geçersiz.",
  invalid_link: "Bağlantı http:// ya da https:// ile başlamalı.",
  invalid_answer: "Bu kartta böyle bir cevap yok.",
  invalid_type: "Bu düğüm türü burada kullanılamaz.",
  invalid_color: "Renk değeri geçersiz.",
  invalid_node: "Seçilen düğüm bulunamadı ya da pasif.",
  name_taken: "Bu adla bir takım ya da pillar zaten var.",
  team_is_pillar: "Bu takım bir pillar'ın özel takımı; adı ve silinmesi pillar sayfasından yönetilir.",
  invalid_phone: "Telefon numarası geçersiz. Örnek: 0532 000 00 00",
  invalid_nickname: "Takma ad en fazla 40 karakter olabilir.",
  invalid_birthday:"Doğum günü geçersiz. Gün ve ay birlikte girilmeli.",
  invalid_avatar: "Bu fotoğraf profil resmi olarak kullanılamaz.",
  invalid_banner: "Bu görsel kapak olarak kullanılamaz.",
  invalid_access_mode: "Erişim türü geçersiz.",
  invalid_options: "Seçenekler geçersiz. Boş ya da çok uzun seçenek olamaz.",
  invalid_vote: "Oy geçersiz. Seçimini kontrol et.",
  poll_closed: "Oylama kapandı.",
  invalid_quiet_hours: "Sessiz saatler geçersiz. Başlangıç ve bitiş birlikte girilmeli.",
  invalid_subscription: "Bildirim aboneliği kurulamadı. Sayfayı yenileyip tekrar dene.",
  invalid_host: "Bu adresten giriş yapılamıyor.",
  invalid_config: "Giriş ayarları eksik. Yöneticiye haber ver.",
  event_needs_date: "Kesinleşmiş ya da yapılmış etkinliğin tarihi olmalı; saat de tarihsiz girilemez.",
  invalid_time: "Saat geçersiz. Örnek: 14:30",
  invalid_place: "Yer en fazla 200 karakter olabilir.",
  invalid_attendees: "Katılımcı sayısı geçersiz.",
  invalid_role: "Rol en fazla 60 karakter olabilir.",
  invalid_label: "Checkpoint adı boş olamaz ve 120 karakteri aşamaz.",
  checkpoint_state: "Adım zaten bu durumda; onay istenecek bir şey yok.",
  own_record: "Etkinliğin kendi kaydı widget olarak bağlanamaz.",
  unknown_record: "Seçilen kayıt bulunamadı.",
  invalid_record: "Kayıt widget'ı için bir kayıt seçilmeli.",
  invalid_notes: "Not çok uzun.",
  invalid_state: "Süreç adımı geçersiz.",
  invalid_contact: "Tedarikçi boş olamaz ve 300 karakteri aşamaz.",
  invalid_price: "Fiyat geçersiz.",
  invalid_budget: "Bütçe 0'dan büyük olmalı; boş bırakmak bütçeyi siler.",
  invalid_qty: "Adet 1 ile 1.000.000 arasında olmalı.",
  invalid_provider: "Seçilen teklif bu kaleme ait değil. Sayfayı yenile.",
  no_sponsor: "Önce kalemi sponsordan iste.",
  owned_no_sponsor: "Elde olan kalem sponsordan istenmez.",
  not_approved: "Önce kalemi Onaylandı adımına getir.",
  purchased_locked: "Maliye satın alındı olarak işaretlemiş. Tedariği değiştirmek için önce o işaret kaldırılmalı.",
  invalid_otf_item: "Formda olmayan bir kalem seçildi. Sayfayı yenile.",
  invalid_quantity: "Adet 1 ile 10000 arasında olmalı.",
  too_many_contacts: "Formda en çok 3 etkinlik sorumlusu yer alır.",
  otf_template: "Form şablonu okunamadı. Yöneticiye haber ver.",
  otf_no_source: "Kopyalanacak başka bir OTF formu yok.",
  otf_review_needs_edit: "Kopyalanan formda en az bir alanı bu etkinliğe göre güncellemeden gözden geçirildi işaretlenemez.",
  otf_unreviewed: "Form başka bir etkinlikten kopyalandı; indirmeden önce gözden geçirip işaretle.",
  root_locked: "Kök düğümler kodla gelir: yalnız adı ve açıklaması değişir; taşınamaz, kapatılamaz, silinemez.",
  operational_locked: "Bu düğüm sistemin yapısının parçası: yalnız adı ve açıklaması değişir.",
  name_locked: "Bu düğümün adı koddan gelir ve değişmez (Adımlar, Widget'lar, widget'lar); açıklaması değişebilir.",
  shape_violation: "Bu düğümün yapısına uymuyor (yaprak düğüme alt düğüm eklenemez; listede bütün öğeler aynı türde olmalı).",
  type_not_allowed: "Bu tür buraya eklenemez ya da taşınamaz.",
  invalid_attrs: "Düğüm ayarları geçersiz.",
  unit_outside_units: "Seçilen düğüm bir konu değil (Konular altında olmalı).",
  node_in_use: "Bu öğe kullanımda (ör. bir etkinlik bu türü ya da yeri kullanıyor). Silmek yerine kapat.",
  invalid_kind: "Seçilen etkinlik türü geçersiz ya da kapalı.",
  invalid_location: "Seçilen yer geçersiz ya da kapalı.",
  self_permissions: "Kendi yetkilerini değiştiremezsin. Bir yöneticiden iste.",
  grant_not_held: "Yalnız kendinde olan yetkiyi, rolü ya da dalı verip alabilirsin.",
  grant_manage_users: "Kişi yönetimi yetkisini yalnız bir yönetici verip alabilir.",
  name_not_allowed: "Ad değiştirmek için “kullanıcı adını değiştir” yetkisi gerekir. Bir yöneticiden iste.",
  owner_change_denied: "Sorumluyu yalnız mevcut sorumlu, konunun dal yetkilisi ya da yönetici değiştirebilir. Sorumlusuz kaydı kendin üstlenebilirsin.",
  network: "Sunucuya ulaşılamadı. Bağlantını kontrol et.",
  name_too_short: "Ad en az 5 karakter olmalı.",
  title_too_short: "Başlık en az 5 karakter olmalı.",
  description_too_short: "Açıklama en az 30 karakter olmalı.",
  description_required: "Açıklama boş olamaz.",
  closing_note_required: "Kapatırken en az 30 karakterlik kapanış notu yaz.",
  closing_note_too_short: "Kapanış notu en az 30 karakter olmalı.",
  invalid_closing_note: "Kapanış notu çok uzun.",
  quality_questions_mismatch: "Soru listesi bozuk: üç soru da bulunmalı.",
  quality_text_invalid: "Sorular ve ölçütler boş olamaz; soru en çok 3000, ölçüt en çok 400 karakter.",
  quality_min_invalid: "Eşik 0,05 ile 0,95 arasında olmalı.",
  low_quality: "Metin yeterli bilgi içermiyor.",
} satisfies Record<ApiErrorCode, string>;

export function isErrorCode(s: string): s is ApiErrorCode {
  return s in ERRORS;
}
