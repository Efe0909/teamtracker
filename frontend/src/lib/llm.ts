// Yonetim > Veri isleme ve LLM: saf yardimcilar (para, pencere, toplama, uyumluluk).
// Ekran AdminLlm*.tsx'te; burada yalniz hesap, test edilir (llm.test.ts).

import type { IsoDate, LlmDayRow, LlmFilter, LlmModelInfo, LlmStatus } from "../api/types";

// --- bicim ----------------------------------------------------------------------

const small = new Intl.NumberFormat("tr-TR", { maximumSignificantDigits: 2 });
const cents = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** USD: `$0,0042` kucuk tutari gosterir, `$12,34` buyugu; null = maliyet bilinmiyor. */
export function usd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  if (n === 0) return "$0";
  return `$${Math.abs(n) < 0.01 ? small.format(n) : cents.format(n)}`;
}

const compact = new Intl.NumberFormat("tr-TR", { notation: "compact", maximumFractionDigits: 1 });
export const count = (n: number): string => compact.format(n);

export function ms(n: number): string {
  return n >= 1000 ? `${(n / 1000).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} sn` : `${Math.round(n)} ms`;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} KB`;
  return `${(n / 1024 / 1024).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} MB`;
}

export const STATUS_LABEL: Record<LlmStatus, string> = {
  ok: "Başarılı",
  limit: "Limit doldu",
  http: "HTTP hatası",
  timeout: "Zaman aşımı",
  network: "Ağ hatası",
  parse: "Bozuk yanıt",
  schema: "Şema uyumsuz",
};

export const FEATURE_LABEL: Readonly<Partial<Record<string, string>>> = {
  material_suggestions: "Malzeme önerisi",
  quality_gate: "Kalite kapısı",
};
export const featureLabel = (f: string): string => FEATURE_LABEL[f] ?? f;

// --- limit penceresi ---------------------------------------------------------------

/** Hazir pencereler (dakika); elle giris de serbest (15 dk - 31 gun). */
export const WINDOWS: { minutes: number; label: string }[] = [
  { minutes: 15, label: "15 dk" },
  { minutes: 30, label: "30 dk" },
  { minutes: 60, label: "1 sa" },
  { minutes: 120, label: "2 sa" },
  { minutes: 480, label: "8 sa" },
  { minutes: 1440, label: "1 gün" },
  { minutes: 10080, label: "1 hafta" },
  { minutes: 43200, label: "1 ay" },
];
export const WINDOW_MIN = 15;
export const WINDOW_MAX = 44640;

export type WindowUnit = "dk" | "sa" | "gün";
export const UNIT_MINUTES: Record<WindowUnit, number> = { dk: 1, sa: 60, "gün": 1440 };

export function windowLabel(m: number): string {
  const preset = WINDOWS.find((w) => w.minutes === m);
  if (preset !== undefined) return preset.label;
  if (m % 1440 === 0) return `${m / 1440} gün`;
  if (m % 60 === 0) return `${m / 60} sa`;
  return `${m} dk`;
}

export function validWindow(m: number): boolean {
  return Number.isInteger(m) && m >= WINDOW_MIN && m <= WINDOW_MAX;
}

// --- zaman araligi -----------------------------------------------------------------

export type Range = "today" | "7d" | "30d" | "month" | "all";
export const RANGES: { value: Range; label: string }[] = [
  { value: "today", label: "Bugün" },
  { value: "7d", label: "7 gün" },
  { value: "30d", label: "30 gün" },
  { value: "month", label: "Bu ay" },
  { value: "all", label: "Tümü" },
];

/** Yerel takvim gunu (sunucu da gunleri Turkiye saatiyle keser). */
export function isoDay(d: Date): IsoDate {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function rangeDates(r: Range, today: Date): { from: IsoDate; to: IsoDate } {
  const to = isoDay(today);
  const back = (days: number) => isoDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - days));
  switch (r) {
    case "today": return { from: to, to };
    case "7d": return { from: back(6), to };
    case "30d": return { from: back(29), to };
    case "month": return { from: isoDay(new Date(today.getFullYear(), today.getMonth(), 1)), to };
    case "all": return { from: "2020-01-01", to };
  }
}

export function emptyFilter(today: Date): LlmFilter {
  return { ...rangeDates("30d", today), feature: "", model: "", user: "", status: "" };
}

// --- toplama -----------------------------------------------------------------------

export interface Totals {
  calls: number;
  errors: number;
  limited: number;
  promptTokens: number;
  completionTokens: number;
  cost: number;
  unpriced: number;
  avgMs: number | null;
  /** Hata haric (limit cagri degil). null = hic cagri yok. */
  successRate: number | null;
}

export function totals(rows: LlmDayRow[]): Totals {
  const t = rows.reduce(
    (a, r) => ({
      calls: a.calls + r.calls, errors: a.errors + r.errors, limited: a.limited + r.limited,
      promptTokens: a.promptTokens + r.prompt_tokens, completionTokens: a.completionTokens + r.completion_tokens,
      cost: a.cost + r.cost_usd, unpriced: a.unpriced + r.unpriced, ms: a.ms + r.ms_total,
    }),
    { calls: 0, errors: 0, limited: 0, promptTokens: 0, completionTokens: 0, cost: 0, unpriced: 0, ms: 0 },
  );
  const { ms: msTotal, ...rest } = t;
  return {
    ...rest,
    avgMs: t.calls === 0 ? null : msTotal / t.calls,
    successRate: t.calls === 0 ? null : (t.calls - t.errors) / t.calls,
  };
}

export interface Breakdown {
  key: string;
  calls: number;
  errors: number;
  cost: number;
  tokens: number;
}

/** Model ya da ozellik basina; maliyete, sonra cagriya gore azalan. */
export function breakdown(rows: LlmDayRow[], by: "model" | "feature"): Breakdown[] {
  const m = new Map<string, Breakdown>();
  for (const r of rows) {
    const k = r[by];
    const b = m.get(k) ?? { key: k, calls: 0, errors: 0, cost: 0, tokens: 0 };
    b.calls += r.calls;
    b.errors += r.errors;
    b.cost += r.cost_usd;
    b.tokens += r.prompt_tokens + r.completion_tokens;
    m.set(k, b);
  }
  return [...m.values()].sort((a, b) => b.cost - a.cost || b.calls - a.calls || a.key.localeCompare(b.key));
}

export interface Bucket {
  /** Gun (YYYY-AA-GG) ya da ay (YYYY-AA). */
  key: string;
  label: string;
  total: number;
  calls: number;
  errors: number;
  parts: { model: string; cost: number }[];
}

/** En cok bu kadar gun gunluk cizilir; daha uzun aralik aylik toplanir. */
export const DAILY_MAX = 92;

/** Grafik kovalari: araliktaki HER gun (bos gunler dahil) ya da uzun aralikta ay. */
export function buckets(rows: LlmDayRow[], from: IsoDate, to: IsoDate): Bucket[] {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const monthly = days > DAILY_MAX;
  // "Tumu" araliginda ilk veriden once bos aylar cizilmesin.
  const first = rows.reduce<string | null>((a, r) => (a === null || r.day < a ? r.day : a), null);
  const keyOf = (day: string) => (monthly ? day.slice(0, 7) : day);
  const order: string[] = [];
  const d = new Date(start);
  while (d <= end) {
    const k = keyOf(isoDay(d));
    if (order.at(-1) !== k && (!monthly || first === null || k >= first.slice(0, 7))) order.push(k);
    d.setDate(d.getDate() + 1);
  }
  const map = new Map<string, Bucket>(order.map((k) => [k, {
    key: k, label: monthly ? k : `${k.slice(8, 10)}.${k.slice(5, 7)}`, total: 0, calls: 0, errors: 0, parts: [],
  }]));
  for (const r of rows) {
    const b = map.get(keyOf(r.day));
    if (b === undefined) continue;
    b.total += r.cost_usd;
    b.calls += r.calls;
    b.errors += r.errors;
    const p = b.parts.find((x) => x.model === r.model);
    if (p === undefined) b.parts.push({ model: r.model, cost: r.cost_usd });
    else p.cost += r.cost_usd;
  }
  return order.map((k) => map.get(k)).filter((b): b is Bucket => b !== undefined);
}

/** Model -> grafik rengi (`--chart-1..6`); sira verilen listenin sirasi, 6'dan sonra doner. */
export function colorMap(models: string[]): Map<string, string> {
  return new Map(models.map((m, i) => [m, `var(--chart-${(i % 6) + 1})`]));
}

// --- model uyumlulugu ------------------------------------------------------------

export interface Compat {
  level: "ok" | "warn" | "bad" | "unknown";
  notes: string[];
}

/** Sohbet sozlesmesi icin model listesi bilgisinden uyari. Liste yoksa bilinmiyor. */
export function compat(m: LlmModelInfo | undefined, endpoint: "chat" | "decisions", reasoningOff: boolean): Compat {
  if (m === undefined) return { level: "unknown", notes: ["Model OpenRouter listesinde bulunamadı (ya da liste alınamadı): “Dene” ile doğrula."] };
  const notes: string[] = [];
  let level: Compat["level"] = "ok";
  if (endpoint === "chat") {
    if (!m.structured_outputs || !m.response_format) {
      level = "bad";
      notes.push("Yapılandırılmış çıktıyı (json_schema) desteklemiyor: öneri sözleşmesi çalışmaz.");
    }
    if (reasoningOff && !m.reasoning) {
      if (level === "ok") level = "warn";
      notes.push("Düşünmeyi kapatma parametresini desteklemiyor; “düşünme kapalı” açıkken çağrı düşer.");
    }
  }
  if (m.prompt_per_m === null || m.completion_per_m === null) {
    if (level === "ok") level = "warn";
    notes.push("Fiyatı önceden bilinmiyor (yönlendirici model): maliyet yalnız cevapta gelirse görünür.");
  }
  return { level, notes };
}
