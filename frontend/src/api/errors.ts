// API hata kodu -> Turkce ileti. TEK sozluk (spec/16 §3.6).
//
// `satisfies Record<ApiErrorCode, string>`: Rust'a yeni kod eklenip buraya
// yazilmazsa ApiErrorCode birligine eklendigi an derleme duser.

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
  | "invalid_name"
  | "invalid_parent"
  | "inactive_parent"
  | "root_only"
  | "move_cycle"
  | "type_locked"
  | "network";

export const ERRORS = {
  unauthorized: "Oturumun kapanmış. Yeniden giriş yap.",
  forbidden: "Bunu yapmaya yetkin yok.",
  not_found: "Aradığın şey bulunamadı. Silinmiş ya da taşınmış olabilir.",
  csrf: "Oturum doğrulaması tutmadı. Sayfayı yenile.",
  internal: "Sunucuda bir hata oldu. Biraz sonra tekrar dene.",
  invalid_body: "Gönderilen bilgi geçersiz.",
  invalid_title: "Başlık boş olamaz ve 200 karakteri aşamaz.",
  invalid_description: "Açıklama çok uzun.",
  invalid_unit: "Seçilen birim geçersiz ya da pasif.",
  invalid_pillar: "Seçilen pillar geçersiz.",
  invalid_reply: "Yanıtlanan mesaj bu sohbette değil.",
  unknown_user: "Seçilen kişi bulunamadı ya da hesabı kapalı.",
  unknown_team: "Seçilen takım bulunamadı.",
  open_actions: "Kayıt, açık eylemleri varken kapanmaz. Önce eylemleri kapat.",
  invalid_name: "Ad boş olamaz ve 200 karakteri aşamaz.",
  invalid_parent: "Seçilen üst düğüm bulunamadı.",
  inactive_parent: "Pasif bir düğümün altına düğüm eklenemez ya da taşınamaz.",
  root_only: "Bu tür yalnız kökte durabilir.",
  move_cycle: "Düğüm kendi altına taşınamaz.",
  type_locked: "Bu düğüme bağlı bir takım kartı var; türü değiştirilemez.",
  network: "Sunucuya ulaşılamadı. Bağlantını kontrol et.",
} satisfies Record<ApiErrorCode, string>;

export function isErrorCode(s: string): s is ApiErrorCode {
  return s in ERRORS;
}
