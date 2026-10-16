// Baska ekrandan "buraya bak" diye gelinen bolum: gorunume kaydirilir, ilk
// tiklamaya kadar nabiz halkasi tasir (spec/81 D-6). Hareket azaltilmissa
// sabit halka. Alan bilmez: sarilan icerik ne olursa.

import { useEffect, useRef, useState, type ReactNode } from "react";
import s from "./focusRing.module.css";

/** className: sarmalayiciya ek sinif (ornek: izgarada tam genislik); halka ile birlikte uygulanir. */
export function FocusRing({ active, children, className }: { active: boolean; children: ReactNode; className?: string }) {
  const [on, setOn] = useState(active);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) box.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [active]);
  return (
    <div ref={box} className={[on ? s.ring : "", className ?? ""].filter(Boolean).join(" ") || undefined} onClickCapture={() => setOn(false)}>
      {children}
    </div>
  );
}
