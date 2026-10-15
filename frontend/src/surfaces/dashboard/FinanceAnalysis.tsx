// Maliye > Analiz (spec/81 §12): ay / donem / etkinlik / kategori kirilimi. SEB ve kasa
// harcamasi AYRI sutun + toplam; yigilmis cubuk `--chart-*`. Excel ayni tablo.

import { useState } from "react";
import { errorText } from "../../api/client";
import { useAnalysis } from "../../api/hooks";
import type { AnalysisGroup, IsoDate } from "../../api/types";
import { money } from "../../lib/money";
import { DateField } from "../../ui/DateField";
import { cx, Loading, Segmented, ui } from "../../ui/ui";
import s from "./fin.module.css";

const GROUPS: { value: AnalysisGroup; label: string }[] = [
  { value: "month", label: "Ay" },
  { value: "period", label: "Dönem" },
  { value: "event", label: "Etkinlik" },
  { value: "category", label: "Kategori" },
];

export function FinanceAnalysis() {
  const [group, setGroup] = useState<AnalysisGroup>("month");
  const [from, setFrom] = useState<IsoDate | null>(null);
  const [to, setTo] = useState<IsoDate | null>(null);
  const q = useAnalysis(group, from, to);
  const a = q.data;
  const rows = a?.rows ?? [];
  const peak = Math.max(1, ...rows.map((r) => r.spent_seb + r.spent_general));
  const tot = (k: "spent_seb" | "spent_general" | "committed" | "claimed" | "received" | "budget" | "income") =>
    rows.reduce((x, r) => x + r[k], 0);
  const qs = new URLSearchParams({ group, ...(from !== null ? { from } : {}), ...(to !== null ? { to } : {}) });
  return (
    <div className={s.panel}>
      <div className={s.ph}>
        <h2>Analiz</h2>
        {a !== undefined && <span className={s.sub}>{a.from} – {a.to}</span>}
        <span className={s.grow} />
        <a className={cx(ui.btn, ui["v-default"], ui["z-sm"])} href={`/api/finance/analysis.xlsx?${qs}`}>Excel</a>
      </div>
      <div className={s.filters}>
        <Segmented label="Kırılım" value={group} onChange={setGroup} options={GROUPS} />
        <DateField aria-label="Başlangıç" placeholder="Başlangıç (son 12 ay)" value={from} clearable onChange={setFrom} />
        <DateField aria-label="Bitiş" placeholder="Bitiş (bugün)" value={to} clearable onChange={setTo} />
        <span className={s.chips}>
          <span className={cx(s.legend, s.legSeb)}>SEB</span>
          <span className={cx(s.legend, s.legGen)}>Kasa</span>
        </span>
      </div>
      {q.error !== null ? <p role="alert" className={s.empty}>{errorText(q.error)}</p>
        : a === undefined ? <Loading />
        : rows.length === 0 ? <div className={s.empty}>Bu aralıkta harcama ya da taahhüt yok.</div>
        : (
          <div className={s.tblWrap}>
            <table className={s.tbl}>
              <thead>
                <tr>
                  <th scope="col">{GROUPS.find((g) => g.value === group)?.label}</th>
                  <th scope="col" className={s.thBar}><span className={s.srOnly}>Dağılım</span></th>
                  <th scope="col">SEB</th><th scope="col">Kasa</th><th scope="col">Toplam</th>
                  <th scope="col">Taahhüt</th><th scope="col">SEB talep</th><th scope="col">SEB yatan</th>
                  {group !== "month" && <th scope="col">Bütçe</th>}
                  <th scope="col">Kasa geliri</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const total = r.spent_seb + r.spent_general;
                  return (
                    <tr key={r.label}>
                      <th scope="row">{r.label}</th>
                      <td>
                        <span className={s.stack} role="img" aria-label={`SEB ${money(r.spent_seb)}, kasa ${money(r.spent_general)}`}>
                          <span className={s.stSeb} style={{ width: `${(r.spent_seb / peak) * 100}%` }} />
                          <span className={s.stGen} style={{ width: `${(r.spent_general / peak) * 100}%` }} />
                        </span>
                      </td>
                      <td className={s.num}>{money(r.spent_seb)}</td>
                      <td className={s.num}>{money(r.spent_general)}</td>
                      <td className={s.num}><b>{money(total)}</b></td>
                      <td className={s.num}>{r.committed > 0 ? money(r.committed) : "—"}</td>
                      <td className={s.num}>{r.claimed > 0 ? money(r.claimed) : "—"}</td>
                      <td className={s.num}>{r.received > 0 ? money(r.received) : "—"}</td>
                      {group !== "month" && <td className={s.num}>{r.budget > 0 ? money(r.budget) : "—"}</td>}
                      <td className={s.num}>{r.income > 0 ? money(r.income) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Toplam</th><td />
                  <td className={s.num}>{money(tot("spent_seb"))}</td>
                  <td className={s.num}>{money(tot("spent_general"))}</td>
                  <td className={s.num}><b>{money(tot("spent_seb") + tot("spent_general"))}</b></td>
                  <td className={s.num}>{money(tot("committed"))}</td>
                  <td className={s.num}>{money(tot("claimed"))}</td>
                  <td className={s.num}>{money(tot("received"))}</td>
                  {group !== "month" && <td className={s.num}>{money(tot("budget"))}</td>}
                  <td className={s.num}>{money(tot("income"))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      <p className={cx(s.sub, s.foot)}>
        Harcanan fatura gününe göre; taahhüt etkinlik günü (yoksa gerektiği gün) ile. “SEB yatan” dosyası ödenmiş kalemlerin
        tutarıdır; bankaya giren gerçek tutar iade dosyasında görünür.
      </p>
    </div>
  );
}
