// fetch sarmalayici: JSON, CSRF basligi, hata kodu. Bilesen `fetch` cagirmaz;
// uc basina islevler hooks.ts'te bunu kullanir.

import { ERRORS, isErrorCode, type ApiErrorCode } from "./errors";

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly reasons: string[];
  constructor(code: ApiErrorCode, status: number, reasons: string[] = []) {
    super(ERRORS[code]);
    this.code = code;
    this.status = status;
    this.reasons = reasons;
  }
}

/** Hata nesnesinden kullaniciya gosterilecek ileti. */
export function errorText(e: unknown): string {
  return e instanceof ApiError ? ERRORS[e.code] : ERRORS.internal;
}

// CSRF token'i `/api/me` ile gelir (Session.tsx kurar). Degistiren her istek
// `X-CSRF-Token` olarak geri yollar.
let csrf: string | null = null;
export function setCsrf(token: string | null): void {
  csrf = token;
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (method !== "GET") {
    if (csrf !== null) headers["X-CSRF-Token"] = csrf;
    if (body !== undefined) headers["Content-Type"] = "application/json";
  }
  let r: Response;
  try {
    r = await fetch(path, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError("network", 0);
  }
  if (r.status === 204) return undefined as T;
  const data: unknown = await r.json().catch(() => null);
  if (!r.ok) {
    const code =
      typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
        ? data.error
        : "internal";
    const reasons = typeof data === "object" && data !== null && "reasons" in data && Array.isArray(data.reasons)
      ? data.reasons.filter((x): x is string => typeof x === "string") : [];
    throw new ApiError(isErrorCode(code) ? code : "internal", r.status, reasons);
  }
  return data as T;
}

/** Ham dosya yukleme (JSON degil): ek sahipsiz dogar, mesaj/kart sonra baglar. */
export async function upload<T>(file: File): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (csrf !== null) headers["X-CSRF-Token"] = csrf;
  let r: Response;
  try {
    r = await fetch(`/api/attachments${qs({ name: file.name })}`, { method: "POST", headers, body: file });
  } catch {
    throw new ApiError("network", 0);
  }
  const data: unknown = await r.json().catch(() => null);
  if (!r.ok) {
    const code =
      typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
        ? data.error
        : r.status === 413 ? "file_too_big" : "internal";
    const reasons = typeof data === "object" && data !== null && "reasons" in data && Array.isArray(data.reasons)
      ? data.reasons.filter((x): x is string => typeof x === "string") : [];
    throw new ApiError(isErrorCode(code) ? code : "internal", r.status, reasons);
  }
  return data as T;
}

/** Sorgu dizgisi: bos/undefined degerler atlanir. */
export function qs(params: Record<string, string | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") u.set(k, v);
  const s = u.toString();
  return s === "" ? "" : `?${s}`;
}
