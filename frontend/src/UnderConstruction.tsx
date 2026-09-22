import { useEffect } from "react";
import { welcomeUrl, type Dest } from "./api/session";

const NAMES: Record<Dest, string> = { app: "Mobil uygulama", dashboard: "Masaüstü paneli" };

export function UnderConstruction({ surface }: { surface: Dest }) {
  useEffect(() => {
    document.title = `${NAMES[surface]} — EkipTakip`;
  }, [surface]);
  return (
    <main className="uc">
      <p className="uc-label">{NAMES[surface]}</p>
      <h1>Yapım aşamasında</h1>
      <a href={welcomeUrl()}>Ana sayfaya dön</a>
    </main>
  );
}
