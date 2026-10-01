// Pillar sayfasi KPI iskeleti: veri kaynagi henuz yok, yerini tutan bos
// cubuk + cizgi grafik. Gercek metrikler baglaninca bu bilesen yerine gecer.

import s from "./dashboard.module.css";
import { Widget, type WidgetMove } from "./Widget";

const BARS = [38, 62, 45, 80, 55, 70, 48];

export function KpiSkeleton({ move }: { move: WidgetMove | undefined }) {
  return (
    <Widget id="kpi" title="Göstergeler" move={move} actions={<span className={s.dim}>Henüz veri bağlı değil</span>}>
      {() => (
        <div className={s.kpiGrid} aria-hidden="true">
          <svg viewBox="0 0 280 120" className={s.kpiChart} role="presentation">
            {BARS.map((h, i) => (
              <rect key={i} x={12 + i * 38} y={110 - h} width="24" height={h} rx="4" className={s.kpiBar} />
            ))}
          </svg>
          <svg viewBox="0 0 280 120" className={s.kpiChart} role="presentation">
            <polyline points="8,90 52,70 96,78 140,45 184,58 228,30 272,40" className={s.kpiLine} />
          </svg>
        </div>
      )}
    </Widget>
  );
}
