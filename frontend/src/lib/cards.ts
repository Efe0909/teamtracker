// Kart turlerinin EKRAN tarafi: etiket, ipucu, alan etiketleri, cevap metni.
// Davranis (hangi alan kabul edilir, hangi cevap anlamli) Rust
// `backend/src/api/cards.rs` TYPES'ta — alan anahtarlari iki yerde ayni.
// Python `shared/cards.py` CARD_TYPES/FIELDS/SIGNUP metinleri.

import type { SignupAnswer } from "../api/types";
import type { IconName } from "../ui/icons";

export type CardType = "media" | "meeting" | "pool";

export interface CardField {
  key: string;
  label: string;
  kind: "text" | "textarea" | "datetime-local" | "url" | "number";
}

export const CARD: Record<CardType, {
  label: string;
  icon: IconName;
  hint: string;
  fields: CardField[];
  answers: Partial<Record<SignupAnswer, string>>;
}> = {
  media: {
    label: "Medya eki",
    icon: "image",
    hint: "Görseller bu kutuya asılır — sohbete dağılmaz, kayıtla kalır.",
    fields: [{ key: "description", label: "Açıklama", kind: "textarea" }],
    answers: {},
  },
  meeting: {
    label: "Toplantı planı",
    icon: "calendar",
    hint: "Ne zaman, nerede, kim — konuşulacaklar tek yerde.",
    fields: [
      { key: "when", label: "Tarih ve saat", kind: "datetime-local" },
      { key: "place", label: "Yer", kind: "text" },
      { key: "link", label: "Bağlantı (Meet/Zoom)", kind: "url" },
      { key: "agenda", label: "Gündem", kind: "textarea" },
    ],
    answers: { yes: "Katılıyorum", maybe: "Belki", no: "Katılamıyorum" },
  },
  pool: {
    label: "Havuz kartı",
    icon: "teams",
    hint: "İş burada durur, isteyen üstüne alır — atama yok, gönüllülük var.",
    fields: [
      { key: "need", label: "Kaç kişi lazım", kind: "number" },
      { key: "detail", label: "Ne yapılacak", kind: "textarea" },
    ],
    answers: { yes: "Bu işi alıyorum" },
  },
};

export const CARD_TYPES = Object.keys(CARD) as CardType[];

export function isCardType(t: string): t is CardType {
  return t in CARD;
}

const whenFmt = new Intl.DateTimeFormat("tr", { dateStyle: "medium", timeStyle: "short" });

/** "2026-09-20T14:30" -> "20 Eyl 2026 14:30". Ayristirilamayan deger oldugu gibi. */
export function whenLabel(v: string): string {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : whenFmt.format(d);
}
