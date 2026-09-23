// Ekranda gorunen metinler: durum/oncelik/tur etiketleri, tarih bicimleri.
// API anahtar doner, cumleyi ve etiketi on yuz kurar (spec/15 kural 3).
// `Record<Birlik, string>`: yeni durum eklenip etiketi yazilmazsa derleme duser.

import type { ActionStatus, IsoDate, IsoTime, NodeType, Priority, RecordKind, RecordStatus, TeamRole } from "../api/types";

export const STATUS: Record<RecordStatus, string> = {
  open: "Açık",
  in_progress: "Devam",
  pending: "Beklemede",
  closed: "Kapandı",
  cancelled: "İptal",
};

export const ACTION_STATUS: Record<ActionStatus, string> = {
  open: "Açık",
  in_progress: "Devam",
  closed: "Kapandı",
  cancelled: "İptal",
};

export const PRIORITY: Record<Priority, string> = {
  critical: "Kritik",
  high: "Yüksek",
  medium: "Orta",
  low: "Düşük",
};

export const KIND: Record<RecordKind, string> = { issue: "Hata", task: "Görev" };

export const TEAM_ROLE: Record<TeamRole, string> = { lead: "Lider", mentor: "Mentor", member: "Üye" };

export const NODE_TYPE: Record<NodeType, string> = {
  cell: "Cell",
  machine: "Makine",
  pillar: "Pillar",
  team: "Takım",
  task: "Görev",
  step: "Adım",
  operational: "Operational",
  generic: "Genel",
};

/** Kapsam anahtari -> ne yapmaya izin verdigi (Python `SCOPES` degerleri).
 *  Anahtar listesi sunucudan gelir; burada olmayan yeni kapsam anahtariyla gorunur. */
export const SCOPE: Readonly<Partial<Record<string, string>>> = {
  edit_nodes: "Yapıyı düzenle — düğüm ekle, adlandır, taşı, pasifleştir",
  hard_delete_nodes: "Bağımlısı olan düğümü kalıcı sil (kayıtlar ve alt ağaç dahil)",
  manage_users: "Kullanıcı ekle, kapat, yetki ver",
  manage_teams: "Takım kur, üye ekle ve çıkar",
  create_tags: "Etiket sözlüğünü genişlet — yeni etiket adı tanımla",
  edit_deadline: "Son tarih değiştir — kayıtların ve eylemlerin teslim tarihi",
  tag_media: "Ekleri etiketle — katıldığın sohbetlerdeki görsellere etiket ekle/çıkar",
};

/** Secim listelerinin sirasi (Record anahtar sirasi garanti degil). */
export const STATUS_ORDER: RecordStatus[] = ["open", "in_progress", "pending", "closed"];
export const ACTION_STATUS_ORDER: ActionStatus[] = ["open", "in_progress", "closed", "cancelled"];
export const PRIORITY_ORDER: Priority[] = ["critical", "high", "medium", "low"];

export function isDone(s: RecordStatus | ActionStatus): boolean {
  return s === "closed" || s === "cancelled";
}

// --- tarih -----------------------------------------------------------------

const rtf = new Intl.RelativeTimeFormat("tr", { numeric: "auto" });
const dayFmt = new Intl.DateTimeFormat("tr", { day: "numeric", month: "short" });
const dayYearFmt = new Intl.DateTimeFormat("tr", { day: "numeric", month: "short", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("tr", { hour: "2-digit", minute: "2-digit" });

function today(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** "2026-09-23" yerel gun olarak (UTC'ye kaymadan). */
export function parseDay(s: IsoDate): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function toIsoDay(d: Date): IsoDate {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function daysFromToday(s: IsoDate): number {
  return Math.round((parseDay(s).getTime() - today().getTime()) / 86_400_000);
}

/** Son tarih: "bugün", "yarın", "3 gün sonra", "2 gün gecikti". */
export function dueLabel(s: IsoDate): string {
  const n = daysFromToday(s);
  if (n < 0) return `${-n} gün gecikti`;
  if (Math.abs(n) <= 6) return rtf.format(n, "day");
  return formatDay(s);
}

export function formatDay(s: IsoDate): string {
  const d = parseDay(s);
  return (d.getFullYear() === new Date().getFullYear() ? dayFmt : dayYearFmt).format(d);
}

/** Hareket zamani: "5 dk önce", "dün", "12 Eyl". */
export function ago(t: IsoTime): string {
  const diff = (new Date(t).getTime() - Date.now()) / 1000;
  const a = Math.abs(diff);
  if (a < 60) return "şimdi";
  if (a < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (a < 86_400) return rtf.format(Math.round(diff / 3600), "hour");
  if (a < 7 * 86_400) return rtf.format(Math.round(diff / 86_400), "day");
  return dayFmt.format(new Date(t));
}

export function clock(t: IsoTime): string {
  return timeFmt.format(new Date(t));
}
