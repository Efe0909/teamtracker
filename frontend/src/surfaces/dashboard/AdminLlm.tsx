// Yonetim > Veri isleme ve LLM (spec/79 §11): admin ya da manage_llm.
// Okuma ekranlari burada (Genel, Analiz, Cagrilar); ayarlar AdminLlmSettings.tsx'te.
// Hesaplar lib/llm.ts'te (test edilir); burada yalniz cizim.

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLlmCall, useLlmCalls, useLlmKey, useLlmLimits, useLlmStatus, useLlmUsage } from "../../api/hooks";
import type { LlmCall, LlmFilter, LlmStatusView, LlmUsageView } from "../../api/types";
import { ago } from "../../lib/labels";
import {
  breakdown, buckets, colorMap, count, emptyFilter, featureLabel, FEATURE_LABEL, ms, rangeDates, RANGES, STATUS_LABEL,
  totals, usd, windowLabel, type Range,
} from "../../lib/llm";
import { useLookup } from "../../lib/lookup";
import { useSort, type Accessors } from "../../lib/sort";
import { useStored } from "../../lib/stored";
import { SortTh } from "../../ui/SortTh";
import { Button, cx, Empty, IconButton, Loading, Segmented, ui } from "../../ui/ui";
import { AdminLlmCleaning, AdminLlmData, AdminLlmLimits, AdminLlmModels, AdminLlmPrompts } from "./AdminLlmSettings";
import { AdminQuality } from "./AdminQuality";
import c from "./AdminLlm.module.css";

type Sub = "overview" | "analysis" | "calls" | "models" | "limits" | "prompts" | "quality" | "cleaning" | "data";

const SUBS: { value: Sub; label: string }[] = [
  { value: "overview", label: "Genel" },
  { value: "analysis", label: "Analiz" },
  { value: "calls", label: "Çağrılar" },
  { value: "models", label: "Modeller" },
  { value: "limits", label: "Limitler" },
  { value: "prompts", label: "İstemler" },
  { value: "quality", label: "Kalite kapısı" },
  { value: "cleaning", label: "Temizleme" },
  { value: "data", label: "Veri" },
];

export function AdminLlm() {
  const L = useLookup();
  // Kalite sorulari kayit kararlarini degistirir: yalniz admin (uc da 403 verir).
  const admin = L.meta.me.is_admin;
  const [stored, setSub] = useStored<string>("admin.llm.tab", "overview");
  const known = SUBS.some((s) => s.value === stored) && (admin || stored !== "quality");
  const sub: Sub = known ? (stored as Sub) : "overview";
  const [filter, setFilter] = useState<LlmFilter>(() => emptyFilter(new Date()));
  const [range, setRange] = useState<Range>("30d");
  const status = useLlmStatus();
  const qc = useQueryClient();
  const filtered = sub === "overview" || sub === "analysis" || sub === "calls";
  return (
    <>
      <div className={c.top}>
        <Segmented label="LLM bölümü" value={sub} onChange={setSub}
          options={SUBS.map((s) => ({ ...s, locked: s.value === "quality" && !admin }))} />
        <div className={c.topRight}>
          <StatusPill s={status.data} />
          <IconButton icon="restore" label="Yenile" onClick={() => void qc.invalidateQueries({ queryKey: ["admin", "llm"] })} />
        </div>
      </div>
      {filtered && (
        <Filters f={filter} range={range} onRange={(r) => {
          setRange(r);
          setFilter({ ...filter, ...rangeDates(r, new Date()) });
        }} onChange={(f) => setFilter(f)} />
      )}
      {sub === "overview" ? <Overview f={filter} />
        : sub === "analysis" ? <Analysis f={filter} />
        : sub === "calls" ? <Calls key={JSON.stringify(filter)} f={filter} />
        : sub === "models" ? <AdminLlmModels />
        : sub === "limits" ? <AdminLlmLimits />
        : sub === "prompts" ? <AdminLlmPrompts />
        : sub === "quality" ? <AdminQuality />
        : sub === "cleaning" ? <AdminLlmCleaning />
        : <AdminLlmData />}
    </>
  );
}

function StatusPill({ s }: { s: LlmStatusView | undefined }) {
  if (s === undefined) return null;
  const on = s.services.filter((x) => x.on && x.enabled);
  const text = !s.key_configured ? "Kapalı: anahtar yok"
    : on.length === 0 ? "Kapalı: manifest ya da yönetimden"
    : on.length === s.services.length ? "Servis açık" : `Kısmen açık (${on.map((x) => x.label).join(", ")})`;
  return (
    <span className={c.pill} title={s.services.map((x) => `${x.label}: ${x.on && x.enabled ? "açık" : "kapalı"}`).join(" · ")}>
      <span className={c.dot} data-on={on.length > 0} />
      <b>{text}</b> · {count(s.calls)} kayıt
    </span>
  );
}

// --- suzgec ------------------------------------------------------------------------

function Filters(props: { f: LlmFilter; range: Range; onRange: (r: Range) => void; onChange: (f: LlmFilter) => void }) {
  const L = useLookup();
  const { f } = props;
  // Model secenekleri: bu araliktaki kullanim (suzgecsiz) + secili olan.
  const all = useLlmUsage({ ...f, feature: "", model: "", user: "", status: "" });
  const models = [...new Set([...(all.data?.rows.map((r) => r.model) ?? []), f.model].filter((m) => m !== ""))].sort();
  const set = (patch: Partial<LlmFilter>) => props.onChange({ ...f, ...patch });
  return (
    <>
      <div className={c.filters}>
        <select className={ui.input} aria-label="Zaman" value={props.range}
          onChange={(e) => props.onRange(e.target.value as Range)}>
          {RANGES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <select className={ui.input} aria-label="Özellik" value={f.feature} onChange={(e) => set({ feature: e.target.value })}>
          <option value="">Tüm özellikler</option>
          {Object.entries(FEATURE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className={ui.input} aria-label="Model" value={f.model} onChange={(e) => set({ model: e.target.value })}>
          <option value="">Tüm modeller</option>
          {models.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select className={ui.input} aria-label="Kullanıcı" value={f.user} onChange={(e) => set({ user: e.target.value })}>
          <option value="">Tüm kullanıcılar</option>
          {L.meta.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select className={ui.input} aria-label="Sonuç" value={f.status}
          onChange={(e) => set({ status: e.target.value as LlmFilter["status"] })}>
          <option value="">Tüm sonuçlar</option>
          <option value="ok">Başarılı</option>
          <option value="error">Hatalı</option>
          <option value="limit">Limite takılan</option>
        </select>
      </div>
      {(f.user !== "" || f.status !== "") && all.data !== undefined && f.from < all.data.boundary && (
        <p className={c.note}>Kişi ya da sonuç süzgeciyle en çok {formatShort(all.data.boundary)} tarihine kadar geriye gidilir (ayrıntı 180 gün saklanır).</p>
      )}
    </>
  );
}

const formatShort = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

function useUsage(f: LlmFilter): LlmUsageView | undefined {
  return useLlmUsage(f).data;
}

// --- Genel -------------------------------------------------------------------------

function Overview({ f }: { f: LlmFilter }) {
  const u = useUsage(f);
  if (u === undefined) return <Loading />;
  const t = totals(u.rows);
  const pct = (x: number | null) => (x === null ? "—" : `%${(x * 100).toLocaleString("tr-TR", { maximumFractionDigits: 1 })}`);
  return (
    <>
      <div className={c.kpis}>
        <Kpi label="Çağrı" value={count(t.calls)} sub={t.limited > 0 ? `${t.limited} limite takıldı` : undefined} />
        <Kpi label="Başarı oranı" value={pct(t.successRate)} tone={t.successRate !== null && t.successRate < 0.9 ? "err" : "ok"} sub={`${t.errors} hata`} />
        <Kpi label="Jeton" value={count(t.promptTokens + t.completionTokens)} sub={`giriş ${count(t.promptTokens)} · çıkış ${count(t.completionTokens)}`} />
        <Kpi label="Maliyet" value={usd(t.cost)} tone="acc" sub={t.unpriced > 0 ? `${t.unpriced} çağrının maliyeti bilinmiyor` : "tümü fiyatlı"} />
        <Kpi label="Ortalama süre" value={t.avgMs === null ? "—" : ms(t.avgMs)} />
      </div>
      <div className={c.grid2}>
        <CostChart u={u} />
        <div style={{ display: "grid", gap: "var(--s-4)", alignContent: "start" }}>
          <KeyCard />
          <LimitsCard />
        </div>
      </div>
    </>
  );
}

function Kpi(props: { label: string; value: string; sub?: string | undefined; tone?: "ok" | "acc" | "err" }) {
  return (
    <div className={c.kpi}>
      <div className={c.kpiLabel}>{props.label}</div>
      <div className={c.kpiValue} data-tone={props.tone}>{props.value}</div>
      {props.sub !== undefined && <div className={c.kpiSub}>{props.sub}</div>}
    </div>
  );
}

function CostChart({ u }: { u: LlmUsageView }) {
  const bs = buckets(u.rows, u.from, u.to);
  const models = breakdown(u.rows, "model").map((b) => b.key);
  const colors = colorMap(models);
  const max = Math.max(...bs.map((b) => b.total), 0);
  return (
    <section className={c.card} aria-label="Maliyet grafiği">
      <div className={c.cardHead}>
        <h3>Maliyet</h3>
        <span className={c.sub}>{bs.length > 0 && bs[0]?.key.length === 7 ? "aylık" : "günlük"} · modele göre</span>
      </div>
      {models.length === 0 ? <Empty title="Bu aralıkta çağrı yok." icon="sparkles" /> : (
        <>
          <div className={c.legend}>
            {models.map((m) => (
              <span key={m}><span className={c.swatch} style={{ background: colors.get(m) }} />{m}</span>
            ))}
          </div>
          <div className={c.chart} role="img" aria-label={`Toplam ${usd(bs.reduce((a, b) => a + b.total, 0))}`}>
            {bs.map((b) => (
              <div key={b.key} className={c.col} title={`${b.label}: ${usd(b.total)} · ${b.calls} çağrı${b.errors > 0 ? `, ${b.errors} hata` : ""}`}>
                {max > 0 && b.parts.map((p) => (
                  <div key={p.model} className={c.part}
                    style={{ height: `${(p.cost / max) * 100}%`, background: colors.get(p.model) }} />
                ))}
              </div>
            ))}
          </div>
          <div className={c.axis}>
            <span>{bs[0]?.label}</span>
            <span>en yüksek {usd(max)}</span>
            <span>{bs.at(-1)?.label}</span>
          </div>
        </>
      )}
    </section>
  );
}

function KeyCard() {
  const [refresh, setRefresh] = useState(0);
  const k = useLlmKey(refresh);
  const d = k.data?.data;
  return (
    <section className={c.card} aria-label="OpenRouter anahtarı">
      <div className={c.cardHead}>
        <h3>OpenRouter anahtarı</h3>
        <IconButton icon="restore" label="Anahtar bilgisini yenile" size={14} onClick={() => setRefresh(refresh + 1)} />
      </div>
      {k.data === undefined ? <Loading /> : k.data.off ? (
        <p className={c.sub}>Servis kapalı (anahtar yok ya da manifestte kapatılmış): OpenRouter'a gidilmedi.</p>
      ) : k.data.error || d == null ? (
        <p className={c.sub}>OpenRouter'a ulaşılamadı; biraz sonra yenile.</p>
      ) : (
        <dl className={c.kv}>
          <dt>Bugün</dt><dd>{usd(d.usage_daily)}</dd>
          <dt>Bu hafta</dt><dd>{usd(d.usage_weekly)}</dd>
          <dt>Bu ay</dt><dd>{usd(d.usage_monthly)}</dd>
          <dt>Toplam</dt><dd>{usd(d.usage)}</dd>
          <dt>Anahtar limiti</dt>
          <dd>{d.limit === null ? "sınırsız" : `${usd(d.limit_remaining)} kaldı / ${usd(d.limit)}${d.limit_reset !== null ? ` (${d.limit_reset})` : ""}`}</dd>
          {k.data.fetched_at !== null && <><dt>Alındı</dt><dd>{ago(k.data.fetched_at)}</dd></>}
        </dl>
      )}
      <p className={c.sub} style={{ margin: 0 }}>OpenRouter'ın saydığı tüm kullanım (bu uygulamanın dışındakiler dahil).</p>
    </section>
  );
}

function LimitsCard() {
  const l = useLlmLimits();
  const rows = [...(l.data ?? [])].sort((a, b) => b.spent / b.usd - a.spent / a.usd).slice(0, 3);
  return (
    <section className={c.card} aria-label="Limitler">
      <div className={c.cardHead}>
        <h3>En dolu limitler</h3>
        <span className={c.sub}>{l.data?.length ?? 0} limit</span>
      </div>
      {rows.length === 0 ? <p className={c.sub} style={{ margin: 0 }}>Limit yok: harcama sınırsız. “Limitler” sekmesinden eklenir.</p> : (
        <ul className={c.list}>
          {rows.map((r) => (
            <li key={r.id}>
              <div className={c.listHead}><span>{r.model} · {windowLabel(r.window_minutes)}</span><b>{usd(r.spent)} / {usd(r.usd)}</b></div>
              <div className={c.progress}>
                <div className={c.progressFill} data-full={r.spent >= r.usd} style={{ width: `${Math.min(100, (r.spent / r.usd) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// --- Analiz ------------------------------------------------------------------------

function Analysis({ f }: { f: LlmFilter }) {
  const L = useLookup();
  const u = useUsage(f);
  const [metric, setMetric] = useState<"cost" | "calls">("cost");
  if (u === undefined) return <Loading />;
  const models = breakdown(u.rows, "model");
  const colors = colorMap(models.map((m) => m.key));
  const t = totals(u.rows);
  const failing = models.filter((m) => m.errors > 0).sort((a, b) => b.errors - a.errors).slice(0, 5);
  const users = u.by_user.map((x) => ({ key: x.user_id === null ? "—" : L.user(x.user_id)?.name ?? "silinmiş kişi", calls: x.calls, errors: x.errors, cost: x.cost_usd }));
  const all = t.calls + t.limited;
  return (
    <>
      <div className={c.grid2}>
        <section className={c.card} aria-label="Model tüketimi">
          <div className={c.cardHead}>
            <div><h3>Model tüketimi</h3><span className={c.sub}>Modeller arası pay</span></div>
            <Segmented label="Ölçü" value={metric} onChange={setMetric}
              options={[{ value: "cost", label: "Maliyet" }, { value: "calls", label: "Çağrı" }]} />
          </div>
          <BarList rows={models} metric={metric} color={(k) => colors.get(k)} />
        </section>
        <section className={c.card} aria-label="Sonuçlar">
          <div className={c.cardHead}>
            <h3>Sonuçlar</h3>
            <span className={c.sub}>{count(all)} istek</span>
          </div>
          <div className={c.big}>{t.successRate === null ? "—" : `%${Math.round(t.successRate * 100)}`} <span className={c.sub}>başarı (limit hariç)</span></div>
          {all > 0 && (
            <div className={c.split} aria-hidden="true">
              <div className={c.okFill} style={{ width: `${((t.calls - t.errors) / all) * 100}%` }} />
              <div className={c.errFill} style={{ width: `${(t.errors / all) * 100}%` }} />
              <div className={c.limFill} style={{ width: `${(t.limited / all) * 100}%` }} />
            </div>
          )}
          <dl className={c.kv}>
            <dt>Başarılı</dt><dd>{count(t.calls - t.errors)}</dd>
            <dt>Hatalı</dt><dd>{count(t.errors)}</dd>
            <dt>Limite takılan</dt><dd>{count(t.limited)}</dd>
          </dl>
          <h4 style={{ margin: "var(--s-3) 0 4px" }}>En çok hata veren modeller</h4>
          {failing.length === 0 ? <p className={c.sub}>Hata yok.</p> : failing.map((m) => (
            <div key={m.key} className={c.failLine}><span>{m.key}</span><span><span className={c.errText}>{m.errors}</span> / {m.calls}</span></div>
          ))}
        </section>
      </div>
      <div className={c.grid2}>
        <section className={c.card} aria-label="Özellik kırılımı">
          <div className={c.cardHead}><h3>Özelliğe göre</h3></div>
          <BarList rows={breakdown(u.rows, "feature").map((b) => ({ ...b, key: featureLabel(b.key) }))} metric={metric} />
        </section>
        <section className={c.card} aria-label="Kullanıcı kırılımı">
          <div className={c.cardHead}><h3>Kullanıcıya göre</h3><span className={c.sub}>en çok 180 gün</span></div>
          <BarList rows={users} metric={metric} />
        </section>
      </div>
    </>
  );
}

function BarList(props: { rows: { key: string; calls: number; errors: number; cost: number }[]; metric: "cost" | "calls"; color?: (k: string) => string | undefined }) {
  const value = (r: { calls: number; cost: number }) => (props.metric === "cost" ? r.cost : r.calls);
  const sum = props.rows.reduce((a, r) => a + value(r), 0);
  const max = Math.max(...props.rows.map(value), 0);
  if (props.rows.length === 0) return <p className={c.sub}>Veri yok.</p>;
  return (
    <ul className={c.list}>
      {props.rows.map((r) => (
        <li key={r.key}>
          <div className={c.listHead}>
            <span>{props.color !== undefined && <span className={c.swatch} style={{ background: props.color(r.key) }} />}{r.key}</span>
            <b>{props.metric === "cost" ? usd(r.cost) : count(r.calls)}</b>
          </div>
          <div className={c.track}>
            <div className={c.fill} style={{ width: `${max > 0 ? (value(r) / max) * 100 : 0}%`, background: props.color?.(r.key) ?? "var(--acc)" }} />
          </div>
          <div className={c.listSub}>
            <span>{r.calls} çağrı{r.errors > 0 ? ` · ${r.errors} hata` : ""}</span>
            <span>{sum > 0 ? `%${((value(r) / sum) * 100).toLocaleString("tr-TR", { maximumFractionDigits: 1 })}` : ""}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

// --- Cagrilar ----------------------------------------------------------------------

const SORT: Accessors<LlmCall> = {
  time: (r) => r.created_at,
  model: (r) => r.model,
  status: (r) => r.status,
  ms: (r) => r.ms,
  cost: (r) => r.cost_usd,
};

function statusClass(s: LlmCall["status"]): string {
  return s === "ok" ? c.statusOk : s === "limit" ? c.statusLim : c.statusBad;
}

function Calls({ f }: { f: LlmFilter }) {
  const L = useLookup();
  // Sayfa imlecleri yigini: geri donmek icin oncekiler saklanir.
  const [cursors, setCursors] = useState<string[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const q = useLlmCalls(f, cursors.at(-1));
  const sorter = useSort("llm-calls", q.data?.rows ?? [], SORT);
  if (q.data === undefined) return <Loading />;
  const { total, next } = q.data;
  const first = cursors.length * 50 + 1;
  return (
    <>
      {total === 0 ? <Empty title="Bu süzgece uyan çağrı yok." icon="sparkles" /> : (
        <div className={c.tableWrap}>
          <table className={c.table}>
            <thead>
              <tr>
                <SortTh sorter={sorter} k="time" label="Zaman" />
                <th scope="col">Özellik</th>
                <th scope="col">Kullanıcı</th>
                <SortTh sorter={sorter} k="model" label="Model" />
                <SortTh sorter={sorter} k="status" label="Sonuç" />
                <SortTh sorter={sorter} k="ms" label="Süre" />
                <th scope="col" className={c.num}>Jeton g/ç</th>
                <SortTh sorter={sorter} k="cost" label="Maliyet" />
              </tr>
            </thead>
            <tbody>
              {sorter.rows.map((r) => (
                <tr key={r.id} aria-selected={picked === r.id} onClick={() => setPicked(picked === r.id ? null : r.id)}>
                  <td>
                    <span className={c.cell2}>
                      {new Date(r.created_at).toLocaleTimeString("tr-TR")}
                      <small>{new Date(r.created_at).toLocaleDateString("tr-TR")}</small>
                    </span>
                  </td>
                  <td><span className={c.cell2}>{featureLabel(r.feature)}{r.is_try && <small>Dene</small>}</span></td>
                  <td>{r.user_id === null ? "—" : L.user(r.user_id)?.name ?? "silinmiş kişi"}</td>
                  <td className={c.mono}>{r.model}</td>
                  <td>
                    <span className={cx(c.cell2, statusClass(r.status))}>
                      {STATUS_LABEL[r.status]}
                      <small>{[r.http_status !== null ? `HTTP ${r.http_status}` : null, r.outcome].filter((x) => x !== null).join(" · ")}</small>
                    </span>
                  </td>
                  <td className={c.num}>{r.status === "limit" ? "—" : ms(r.ms)}</td>
                  <td className={c.num}>{r.prompt_tokens === null ? "—" : `${count(r.prompt_tokens)} / ${count(r.completion_tokens ?? 0)}`}</td>
                  <td className={c.num}>{r.status === "limit" ? "—" : usd(r.cost_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={c.pager}>
            <span>{first}–{first + q.data.rows.length - 1} / {count(total)}</span>
            <span style={{ display: "inline-flex", gap: 8 }}>
              <Button size="sm" disabled={cursors.length === 0} onClick={() => setCursors(cursors.slice(0, -1))}>Önceki</Button>
              <Button size="sm" disabled={next === null} onClick={() => next !== null && setCursors([...cursors, next])}>Sonraki</Button>
            </span>
          </div>
        </div>
      )}
      {picked !== null && <CallDetail id={picked} />}
    </>
  );
}

function CallDetail({ id }: { id: string }) {
  const L = useLookup();
  const q = useLlmCall(id);
  const d = q.data;
  if (d === undefined) return <Loading />;
  return (
    <section className={cx(c.card, c.detail)} aria-label="Çağrı ayrıntısı">
      <div className={c.cardHead}>
        <h3>{featureLabel(d.feature)} · <span className={statusClass(d.status)}>{STATUS_LABEL[d.status]}</span></h3>
        <span className={c.sub}>{new Date(d.created_at).toLocaleString("tr-TR")}</span>
      </div>
      <dl className={c.kv}>
        <dt>Model</dt><dd className={c.mono}>{d.model}</dd>
        <dt>Kim</dt><dd>{d.user_id === null ? "—" : L.user(d.user_id)?.name ?? "silinmiş kişi"}{d.is_try ? " (Dene)" : ""}</dd>
        {d.error !== null && <><dt>Hata izi</dt><dd className={c.statusBad}>{d.error}</dd></>}
        {d.http_status !== null && <><dt>HTTP</dt><dd>{d.http_status}</dd></>}
        <dt>Süre</dt><dd>{ms(d.ms)}</dd>
        <dt>Jeton</dt><dd>{d.prompt_tokens ?? "—"} giriş · {d.completion_tokens ?? "—"} çıkış</dd>
        <dt>Maliyet</dt><dd>{usd(d.cost_usd)}</dd>
        {d.asked !== null && <><dt>Öneri</dt><dd>modelden {d.asked}, süzgeçten geçen {d.kept ?? 0}</dd></>}
        {d.outcome !== null && <><dt>Karar</dt><dd>{d.outcome}</dd></>}
        {d.prompt_version !== null && <><dt>İstem</dt><dd>{d.prompt_version === 0 ? "koddaki" : `sürüm ${d.prompt_version}`}</dd></>}
        {d.or_gen_id !== null && <><dt>OpenRouter kimliği</dt><dd className={c.mono}>{d.or_gen_id}</dd></>}
        {d.batch_id !== null && <><dt>Parti</dt><dd className={c.mono}>{d.batch_id}</dd></>}
      </dl>
      {d.has_body ? (
        <>
          <h4>İstek</h4>
          <pre className={c.pre}>{JSON.stringify(d.request, null, 2)}</pre>
          <h4>Cevap</h4>
          <pre className={c.pre}>{d.response ?? "—"}</pre>
        </>
      ) : (
        <p className={c.sub} style={{ margin: 0 }}>Gövde saklanmadı (özellikte “gövdeyi sakla” kapalı ya da 7 gün doldu).</p>
      )}
    </section>
  );
}
