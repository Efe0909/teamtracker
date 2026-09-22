// Tam ekran durumlar: yukleniyor, bulunamadi, yetki yok, baglanti yok.
// Ham JSON hata sayfasi YOK (spec/16 P1 #4) — her durumun cikis yolu var.

import { welcomeUrl } from "../../api/session";
import s from "./errors.module.css";

type Code = "loading" | "not_found" | "forbidden" | "network" | "unauthorized";

const TEXT: Record<Exclude<Code, "loading">, { title: string; body: string }> = {
  not_found: { title: "Sayfa bulunamadı", body: "Aradığın şey silinmiş, taşınmış ya da adres yanlış olabilir." },
  forbidden: { title: "Bu sayfaya yetkin yok", body: "Gerekiyorsa yöneticine yaz." },
  network: { title: "Sunucuya ulaşılamadı", body: "Bağlantını kontrol edip sayfayı yenile." },
  unauthorized: { title: "Oturumun kapanmış", body: "Devam etmek için yeniden giriş yap." },
};

export function ErrorScreen({ code, detail, home = "/" }: { code: Code; detail?: string; home?: string }) {
  if (code === "loading") {
    return (
      <main className={s.wrap} aria-busy="true">
        <p className={s.dim}>Yükleniyor…</p>
      </main>
    );
  }
  const t = TEXT[code];
  return (
    <main className={s.wrap}>
      <h1 className={s.title}>{t.title}</h1>
      <p className={s.dim}>{detail ?? t.body}</p>
      <div className={s.row}>
        {code === "network" && (
          <button type="button" className={s.btn} onClick={() => location.reload()}>
            Yenile
          </button>
        )}
        {code === "unauthorized" ? (
          <a className={s.btn} href={welcomeUrl()}>Giriş yap</a>
        ) : (
          code !== "network" && <a className={s.btn} href={home}>Ana sayfaya dön</a>
        )}
      </div>
    </main>
  );
}
