import { useEffect, useState } from "react";
import "./welcome.css";
import { deviceDefault, fetchMe, surfaceUrl } from "../../api/session";

// Apex koku (`polonyum.com/`): giris duvari DEGIL, yonlendirici. Oturum varsa
// cihaza gore app. ya da dashboard.'a, yoksa herkese acik /welcome'a.
// `replace`: geri tusu bu ara sayfaya donmesin.
export function Entry() {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetchMe().then(
      (me) => location.replace(me.user !== null ? surfaceUrl(deviceDefault()) : "/welcome"),
      () => setFailed(true),
    );
  }, []);
  return (
    <main className="uc" aria-busy={!failed}>
      <p className="uc-label">{failed ? "Sunucuya ulaşılamadı. Sayfayı yenile." : "Yönlendiriliyor…"}</p>
    </main>
  );
}
