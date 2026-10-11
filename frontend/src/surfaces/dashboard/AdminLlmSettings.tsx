// Yonetim > Veri isleme ve LLM: ayar ekranlari (spec/79 §11.4-11.8).
// Modeller (+ Dene, fiyat tablosu), Limitler, Istemler, Temizleme, Veri.
// Kurallar sunucuda: model degisikligi ve istem etkinlestirme son 30 dk'daki basarili
// bir "Dene" ister; burada yalniz akis ve anlatim.

import { useEffect, useState } from "react";
import { errorText } from "../../api/client";
import {
  useLlmConfig, useLlmConfigWrite, useLlmFeatures, useLlmFeatureWrite, useLlmLimits, useLlmLimitWrite, useLlmModels,
  useLlmPrompts, useLlmPromptWrite, useLlmRedactTry, useLlmStatus, useLlmTry, useLlmUsage,
} from "../../api/hooks";
import type {
  LlmConfig, LlmFeature, LlmFeatureView, LlmModelInfo, LlmModelsView, LlmParams, LlmRules, LlmTryOut,
} from "../../api/types";
import { ago } from "../../lib/labels";
import {
  breakdown, bytes, compat, count, isoDay, ms, STATUS_LABEL, UNIT_MINUTES, usd, validWindow, windowLabel, WINDOWS,
  type WindowUnit,
} from "../../lib/llm";
import { Button, Empty, Loading, Segmented, Tag, ui, useToast } from "../../ui/ui";
import c from "./AdminLlm.module.css";

const MODEL_LIST = "llm-model-list";

/** OpenRouter model adlari (`<datalist>`): elle yazmak da serbest. */
function ModelOptions({ models }: { models: LlmModelInfo[] }) {
  return <datalist id={MODEL_LIST}>{models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</datalist>;
}

// --- Modeller ----------------------------------------------------------------------

export function AdminLlmModels() {
  const f = useLlmFeatures();
  const [refresh, setRefresh] = useState(0);
  const m = useLlmModels(refresh);
  if (f.data === undefined) return <Loading />;
  const models = m.data?.models ?? [];
  return (
    <>
      <p className={c.note}>
        Her özellik kodda bir sözleşmedir (uç, cevap şeması, sunucu süzgeci); hangi model ve hangi parametrelerle
        çağrılacağı buradan değişir, dağıtım gerekmez. Model değişikliği, aynı model için son 30 dakikada başarılı bir
        “Dene” ister.
      </p>
      <ModelOptions models={models} />
      {f.data.map((v) => <FeatureEditor key={`${v.feature}-${v.updated_at ?? ""}`} v={v} models={models} />)}
      <PriceTable data={m.data} onRefresh={() => setRefresh(refresh + 1)} />
    </>
  );
}

interface Draft {
  model: string;
  max_tokens: string;
  temperature: string;
  timeout_s: string;
  reasoning_off: boolean;
  batch: string;
  enabled: boolean;
  store_bodies: boolean;
}

function draftOf(v: LlmFeatureView): Draft {
  const p = v.params;
  const s = (n: number | undefined) => (n === undefined ? "" : String(n));
  return {
    model: v.effective.model, max_tokens: s(p.max_tokens), temperature: s(p.temperature),
    timeout_s: p.timeout_ms === undefined ? "" : String(p.timeout_ms / 1000), reasoning_off: v.effective.reasoning_off,
    batch: s(p.batch), enabled: v.effective.enabled, store_bodies: v.effective.store_bodies,
  };
}

/** Bos alan = sozlesmenin varsayilani (gonderilmez). */
function paramsOf(d: Draft, v: LlmFeatureView): LlmParams {
  const num = (s: string) => (s.trim() === "" ? undefined : Number(s.replace(",", ".")));
  const timeout = num(d.timeout_s);
  const p: LlmParams = {};
  if (timeout !== undefined) p.timeout_ms = Math.round(timeout * 1000);
  if (v.endpoint === "chat") {
    const mt = num(d.max_tokens);
    const t = num(d.temperature);
    if (mt !== undefined) p.max_tokens = mt;
    if (t !== undefined) p.temperature = t;
    if (!d.reasoning_off) p.reasoning_off = false;
    if (v.has_batch) {
      const b = num(d.batch);
      if (b !== undefined) p.batch = b;
    }
  }
  return p;
}

function FeatureEditor({ v, models }: { v: LlmFeatureView; models: LlmModelInfo[] }) {
  const write = useLlmFeatureWrite();
  const toast = useToast();
  const [d, setD] = useState<Draft>(() => draftOf(v));
  const [err, setErr] = useState<string | null>(null);
  const set = (p: Partial<Draft>) => setD({ ...d, ...p });
  const params = paramsOf(d, v);
  const info = models.find((m) => m.id === d.model.trim());
  const cp = models.length === 0 ? null : compat(info, v.endpoint, d.reasoning_off);
  const chat = v.endpoint === "chat";
  const save = () => {
    setErr(null);
    write.mutate({ feature: v.feature, body: { model: d.model.trim(), params, enabled: d.enabled, store_bodies: d.store_bodies } }, {
      onSuccess: () => toast({ text: `${v.label}: kaydedildi`, error: false }),
      onError: (x) => setErr(errorText(x)),
    });
  };
  return (
    <section className={c.feature} aria-label={v.label}>
      <div className={c.featureHead}>
        <h3>{v.label}</h3>
        <Tag tone="neutral">{chat ? "sohbet · json_schema" : "karar ucu · noul"}</Tag>
        {!v.effective.enabled && <Tag tone="high">kapalı</Tag>}
        {!v.service_on && <Tag tone="critical">servis kapalı</Tag>}
        {v.customized && v.tested_at === null && <Tag tone="high">denenmeden kaydedildi</Tag>}
        <span className={c.sub}>
          {v.customized && v.updated_at !== null ? `Son değişiklik ${ago(v.updated_at)}` : `Varsayılan (manifest): ${v.default_model}`}
        </span>
      </div>
      <div className={c.fields}>
        <label className={`${ui.field} ${c.wide}`}>
          <span>Model <span className={ui.fieldHint}>(OpenRouter adı: sağlayıcı/model)</span></span>
          <input className={ui.input} list={MODEL_LIST} value={d.model} onChange={(e) => set({ model: e.target.value })} spellCheck={false} />
        </label>
        {chat && (
          <label className={ui.field}>
            <span>En çok jeton <span className={ui.fieldHint}>(boş: {v.effective.max_tokens})</span></span>
            <input className={ui.input} inputMode="numeric" value={d.max_tokens} placeholder={String(v.effective.max_tokens)}
              onChange={(e) => set({ max_tokens: e.target.value })} />
          </label>
        )}
        {chat && (
          <label className={ui.field}>
            <span>Sıcaklık <span className={ui.fieldHint}>(0–2, boş: modelin)</span></span>
            <input className={ui.input} inputMode="decimal" value={d.temperature} onChange={(e) => set({ temperature: e.target.value })} />
          </label>
        )}
        <label className={ui.field}>
          <span>Zaman aşımı, sn <span className={ui.fieldHint}>(boş: {v.effective.timeout_ms / 1000})</span></span>
          <input className={ui.input} inputMode="decimal" value={d.timeout_s} placeholder={String(v.effective.timeout_ms / 1000)}
            onChange={(e) => set({ timeout_s: e.target.value })} />
        </label>
        {chat && v.has_batch && (
          <label className={ui.field}>
            <span>Parti <span className={ui.fieldHint}>(3–15 öneri)</span></span>
            <input className={ui.input} inputMode="numeric" value={d.batch} placeholder={String(v.effective.batch)}
              onChange={(e) => set({ batch: e.target.value })} />
          </label>
        )}
      </div>
      <div className={c.fields}>
        {chat && (
          <label className={c.check}>
            <input type="checkbox" checked={d.reasoning_off} onChange={(e) => set({ reasoning_off: e.target.checked })} />
            Düşünme kapalı (kısa yapılandırılmış çıktı)
          </label>
        )}
        <label className={c.check}>
          <input type="checkbox" checked={d.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          Özellik açık
        </label>
        <label className={c.check}>
          <input type="checkbox" checked={d.store_bodies} onChange={(e) => set({ store_bodies: e.target.checked })} />
          Gövdeyi 7 gün sakla
        </label>
      </div>
      {cp !== null && (
        <div className={c.compat} data-level={cp.level} role="note">
          {cp.level === "ok" ? "OpenRouter listesine göre uyumlu." : "Uyumluluk:"}
          {info !== undefined && info.prompt_per_m !== null && ` Fiyat ${usd(info.prompt_per_m)} / ${usd(info.completion_per_m)} (1M jeton, giriş/çıkış).`}
          {cp.notes.length > 0 && <ul>{cp.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
        </div>
      )}
      {err !== null && <p className={ui.error} role="alert">{err}</p>}
      <div className={ui.dact}>
        <Button variant="primary" disabled={write.isPending || d.model.trim() === ""} onClick={save}>Kaydet</Button>
        <Button disabled={write.isPending} onClick={() => setD(draftOf(v))}>Geri al</Button>
      </div>
      <TryBox v={v} model={d.model.trim()} params={params} />
    </section>
  );
}

function TryBox({ v, model, params }: { v: LlmFeatureView; model: string; params: LlmParams }) {
  const t = useLlmTry();
  const [input, setInput] = useState(() => JSON.stringify(v.sample_input, null, 2));
  const [res, setRes] = useState<LlmTryOut | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = () => {
    setErr(null);
    setRes(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(input);
    } catch {
      setErr("Girdi JSON değil.");
      return;
    }
    t.mutate({ feature: v.feature, model, params, input: parsed }, { onSuccess: setRes, onError: (x) => setErr(errorText(x)) });
  };
  return (
    <div className={c.tryBox}>
      <h4 style={{ margin: "0 0 4px" }}>Dene</h4>
      <p className={ui.fieldHint}>
        Yukarıdaki (kaydedilmemiş) model ve parametrelerle gerçek uca tek çağrı; kaydetmez ama harcamaya sayılır.
        {v.endpoint === "chat"
          ? " Girdi örnek bir özet ({\"brief\": …}) ya da gerçek etkinlik ({\"event_id\": …, \"free_text\": false}) olabilir."
          : " Girdi {\"kind\": \"entry\" | \"closing\", \"state\": …}."}
        {" "}Gerçek kişi adı ya da telefon yazma.
      </p>
      <textarea className={`${ui.input} ${c.mono}`} rows={8} value={input} onChange={(e) => setInput(e.target.value)} aria-label={`${v.label} deneme girdisi`} />
      <div className={ui.dact}>
        <Button disabled={t.isPending || model === "" || !v.service_on} onClick={run}>{t.isPending ? "Soruluyor…" : "Dene"}</Button>
        {!v.service_on && <span className={c.sub}>Servis kapalı: deneme yapılamaz.</span>}
      </div>
      {err !== null && <p className={ui.error} role="alert">{err}</p>}
      {res !== null && <TryResult r={res} />}
    </div>
  );
}

export function TryResult({ r }: { r: LlmTryOut }) {
  const t = r.trace;
  return (
    <div className={c.detail}>
      <p>
        <strong className={r.ok ? c.statusOk : c.statusBad}>{r.ok ? "Geçti" : t === null ? "Çağrı yapılmadı" : STATUS_LABEL[t.status]}</strong>
        <span className={c.sub}> · {r.model}{t !== null ? ` · ${ms(t.ms)} · ${usd(t.cost_usd)}${t.prompt_tokens !== null ? ` · ${t.prompt_tokens}/${t.completion_tokens ?? 0} jeton` : ""}` : ""}</span>
      </p>
      {t?.error != null && <p className={c.statusBad}>{t.http_status !== null ? `HTTP ${t.http_status} · ` : ""}{t.error}</p>}
      {t !== null && t.asked !== null && <p className={c.sub}>Modelden {t.asked} öneri, süzgeçten geçen {t.kept ?? 0}.</p>}
      {r.output !== null && r.output !== undefined && (
        <>
          <h4>Çıktı (süzgeçten sonra)</h4>
          <pre className={c.pre}>{JSON.stringify(r.output, null, 2)}</pre>
        </>
      )}
      <details>
        <summary>Tam iz: istek ve ham cevap</summary>
        <h4>İstek</h4>
        <pre className={c.pre}>{JSON.stringify(r.request, null, 2)}</pre>
        <h4>Ham cevap / hata gövdesi</h4>
        <pre className={c.pre}>{r.raw ?? "—"}</pre>
      </details>
    </div>
  );
}

function PriceTable({ data, onRefresh }: { data: LlmModelsView | undefined; onRefresh: () => void }) {
  const [search, setSearch] = useState("");
  const all = useLlmUsage({ from: "2020-01-01", to: isoDay(new Date()), feature: "", model: "", user: "", status: "" });
  const ours = new Map(breakdown(all.data?.rows ?? [], "model").map((b) => [b.key, b]));
  const needle = search.trim().toLowerCase();
  const rows = (data?.models ?? [])
    .filter((m) => needle === "" ? ours.has(m.id) || m.structured_outputs : m.id.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle))
    .sort((a, b) => Number(ours.has(b.id)) - Number(ours.has(a.id)) || a.id.localeCompare(b.id));
  const shown = rows.slice(0, 60);
  const yes = (b: boolean) => (b ? "✓" : "✗");
  return (
    <section className={c.card} aria-label="Model fiyatları">
      <div className={c.cardHead}>
        <div>
          <h3>Model fiyatları</h3>
          <span className={c.sub}>
            OpenRouter listesi{data?.fetched_at != null ? ` · ${ago(data.fetched_at)} alındı` : ""} · {data?.models.length ?? 0} model.
            {" "}Aramasızken bizde kullanılan ve yapılandırılmış çıktı destekleyenler.
          </span>
        </div>
        <Button size="sm" onClick={onRefresh}>Fiyatları yenile</Button>
      </div>
      {data?.error === true && <p className={ui.error}>Model listesi alınamadı; model adı elle yazılabilir.</p>}
      <input className={ui.input} placeholder="Model ara…" aria-label="Model ara" value={search} onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: "var(--s-3)" }} />
      {data === undefined ? <Loading /> : shown.length === 0 ? <Empty title="Model bulunamadı." /> : (
        <div className={c.tableWrap}>
          <table className={c.table}>
            <thead>
              <tr>
                <th scope="col">Model</th>
                <th scope="col" className={c.num}>Giriş $/1M</th>
                <th scope="col" className={c.num}>Çıkış $/1M</th>
                <th scope="col" className={c.num}>Bağlam</th>
                <th scope="col">json_schema</th>
                <th scope="col">Düşünme ayarı</th>
                <th scope="col" className={c.num}>Bizde</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => {
                const o = ours.get(m.id);
                return (
                  <tr key={m.id}>
                    <td><span className={c.cell2}><span className={c.mono}>{m.id}</span><small>{m.name}</small></span></td>
                    <td className={c.num}>{m.prompt_per_m === null ? "değişken" : usd(m.prompt_per_m)}</td>
                    <td className={c.num}>{m.completion_per_m === null ? "değişken" : usd(m.completion_per_m)}</td>
                    <td className={c.num}>{m.context_length === null ? "—" : count(m.context_length)}</td>
                    <td className={m.structured_outputs && m.response_format ? c.statusOk : c.statusBad}>{yes(m.structured_outputs && m.response_format)}</td>
                    <td>{yes(m.reasoning)}</td>
                    <td className={c.num}>{o === undefined ? "—" : `${o.calls} · ${usd(o.cost)}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length > shown.length && <div className={c.pager}>{rows.length - shown.length} model daha: aramayı daralt.</div>}
        </div>
      )}
    </section>
  );
}

// --- Limitler ----------------------------------------------------------------------

export function AdminLlmLimits() {
  const l = useLlmLimits();
  const f = useLlmFeatures();
  const m = useLlmModels(0);
  const w = useLlmLimitWrite();
  const toast = useToast();
  const used = [...new Set((f.data ?? []).map((x) => x.effective.model))];
  const [model, setModel] = useState("");
  const [preset, setPreset] = useState<string>("1440");
  const [amount, setAmount] = useState("1");
  const [unit, setUnit] = useState<WindowUnit>("sa");
  const [usdText, setUsd] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (model === "" && used[0] !== undefined) setModel(used[0]);
  }, [model, used]);
  const minutes = preset === "custom" ? Math.round(Number(amount.replace(",", ".")) * UNIT_MINUTES[unit]) : Number(preset);
  const value = Number(usdText.replace(",", "."));
  const ok = model.trim() !== "" && validWindow(minutes) && Number.isFinite(value) && value > 0;
  const add = () => {
    setErr(null);
    w.mutate({ put: { model: model.trim(), window_minutes: minutes, usd: value } }, {
      onSuccess: () => { setUsd(""); toast({ text: "Limit kaydedildi", error: false }); },
      onError: (x) => setErr(errorText(x)),
    });
  };
  const byModel = new Map<string, NonNullable<typeof l.data>>();
  for (const r of l.data ?? []) byModel.set(r.model, [...(byModel.get(r.model) ?? []), r]);
  return (
    <>
      <p className={c.note}>
        Model başına dolar tavanı; pencere kayar (“1 ay” = son 30 gün). Bir modele istediğin kadar pencere eklenir; herhangi
        biri dolunca o modelle yeni çağrı yapılmaz: öneri “limit doldu” der, kalite kapısı kullanıcıyı engellemeden atlanır.
        Limit yoksa harcama sınırsızdır. Maliyeti bilinmeyen çağrılar (ör. değişken fiyatlı karar modeli) tavana sayılmaz.
      </p>
      <ModelOptions models={m.data?.models ?? []} />
      <section className={c.card} aria-label="Limit ekle" style={{ marginBottom: "var(--s-4)" }}>
        <div className={c.inline}>
          <label>Model
            <input className={ui.input} list={MODEL_LIST} value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false} style={{ minWidth: 240 }} />
          </label>
          <label>Pencere
            <select className={ui.input} value={preset} onChange={(e) => setPreset(e.target.value)}>
              {WINDOWS.map((x) => <option key={x.minutes} value={String(x.minutes)}>{x.label}</option>)}
              <option value="custom">Özel…</option>
            </select>
          </label>
          {preset === "custom" && (
            <>
              <label>Süre
                <input className={ui.input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 80 }} />
              </label>
              <label>Birim
                <select className={ui.input} value={unit} onChange={(e) => setUnit(e.target.value as WindowUnit)}>
                  {(Object.keys(UNIT_MINUTES) as WindowUnit[]).map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </label>
            </>
          )}
          <label>Tavan (USD)
            <input className={ui.input} inputMode="decimal" placeholder="ör. 2,5" value={usdText} onChange={(e) => setUsd(e.target.value)} style={{ width: 110 }} />
          </label>
          <Button variant="primary" disabled={!ok || w.isPending} onClick={add}>Ekle</Button>
        </div>
        {preset === "custom" && !validWindow(minutes) && <p className={ui.fieldHint}>Pencere 15 dakika ile 31 gün arasında olmalı.</p>}
        {err !== null && <p className={ui.error} role="alert">{err}</p>}
      </section>
      {l.data === undefined ? <Loading /> : l.data.length === 0 ? <Empty title="Limit yok: harcama sınırsız." icon="wallet" /> : (
        [...byModel.entries()].map(([mod, rows]) => (
          <section key={mod} className={c.card} aria-label={`${mod} limitleri`} style={{ marginBottom: "var(--s-3)" }}>
            <div className={c.cardHead}><h3 className={c.mono}>{mod}</h3><span className={c.sub}>{rows.length} pencere</span></div>
            <ul className={c.list}>
              {rows.map((r) => (
                <li key={r.id}>
                  <div className={c.listHead}>
                    <span>{windowLabel(r.window_minutes)}</span>
                    <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                      <b>{usd(r.spent)} / {usd(r.usd)}</b>
                      <Button size="sm" variant="ghost" disabled={w.isPending} onClick={() => w.mutate({ remove: r.id }, { onError: (x) => setErr(errorText(x)) })}>Sil</Button>
                    </span>
                  </div>
                  <div className={c.progress}>
                    <div className={c.progressFill} data-full={r.spent >= r.usd} style={{ width: `${Math.min(100, (r.spent / r.usd) * 100)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}

// --- Istemler ----------------------------------------------------------------------

export function AdminLlmPrompts() {
  const f = useLlmFeatures();
  const withPrompt = (f.data ?? []).filter((v) => v.has_prompt);
  const [picked, setPicked] = useState<LlmFeature | null>(null);
  const v = withPrompt.find((x) => x.feature === picked) ?? withPrompt[0];
  if (f.data === undefined) return <Loading />;
  if (v === undefined) return <Empty title="Düzenlenir istemi olan özellik yok." />;
  return (
    <>
      <p className={c.note}>
        İstem sürümlüdür: yeni sürüm etkin olmadan kaydedilir; o sürümle başarılı bir “Dene”den sonra (30 dk içinde)
        etkinleştirilir. İstem güvence değildir: kişi alanlarının yükte olmaması, serbest metin kapısı ve sunucu süzgeci
        istemden bağımsız çalışır (spec/79 §2). Kalite kapısının “istemi” Kalite kapısı sekmesindeki sorulardır.
      </p>
      {withPrompt.length > 1 && (
        <Segmented label="Özellik" value={v.feature} onChange={setPicked} options={withPrompt.map((x) => ({ value: x.feature, label: x.label }))} />
      )}
      <PromptEditor key={v.feature} v={v} />
    </>
  );
}

function PromptEditor({ v }: { v: LlmFeatureView }) {
  const p = useLlmPrompts(v.feature);
  const w = useLlmPromptWrite(v.feature);
  const t = useLlmTry();
  const toast = useToast();
  const [body, setBody] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<{ version: number; out: LlmTryOut } | null>(null);
  if (p.data === undefined) return <Loading />;
  const data = p.data;
  const activeBody = data.active === 0 ? data.code_default : data.versions.find((x) => x.version === data.active)?.body ?? data.code_default;
  const text = body ?? activeBody;
  const versions = [...data.versions, { version: 0, body: data.code_default, created_by: null, created_at: "" }];
  const tryVersion = (version: number) => {
    setErr(null);
    setRes(null);
    t.mutate({ feature: v.feature, model: v.effective.model, params: v.params, prompt_version: version, input: v.sample_input }, {
      onSuccess: (out) => setRes({ version, out }),
      onError: (x) => setErr(errorText(x)),
    });
  };
  return (
    <>
      <section className={c.card} style={{ margin: "var(--s-3) 0 var(--s-4)" }} aria-label="Yeni sürüm">
        <div className={c.cardHead}>
          <h3>Yeni sürüm</h3>
          <span className={c.sub}>Etkin: {data.active === 0 ? "koddaki" : `sürüm ${data.active}`} · model {v.effective.model}</span>
        </div>
        <textarea className={`${ui.input} ${c.mono}`} rows={14} value={text} onChange={(e) => setBody(e.target.value)} aria-label="İstem metni" />
        <p className={ui.fieldHint}>Özet JSON'u `max_items` (parti büyüklüğü) taşır; istem “en çok `max_items`” diyebilir. En çok 8000 karakter.</p>
        <div className={ui.dact}>
          <Button variant="primary" disabled={w.isPending || text.trim() === "" || text === activeBody} onClick={() => w.mutate({ add: text }, {
            onSuccess: () => { setBody(null); toast({ text: "Yeni sürüm kaydedildi (etkin değil)", error: false }); },
            onError: (x) => setErr(errorText(x)),
          })}>Yeni sürüm olarak kaydet</Button>
        </div>
      </section>
      {err !== null && <p className={ui.error} role="alert">{err}</p>}
      <ul className={c.versions} aria-label="Sürümler">
        {versions.map((x) => (
          <li key={x.version} className={c.version} data-active={x.version === data.active}>
            <div className={c.versionHead}>
              <span>
                <b>{x.version === 0 ? "Koddaki istem" : `Sürüm ${x.version}`}</b>
                {x.version === data.active && <> <Tag tone="info">etkin</Tag></>}
                {x.created_at !== "" && <span className={c.sub}> · {ago(x.created_at)}</span>}
              </span>
              <span style={{ display: "inline-flex", gap: 8 }}>
                <Button size="sm" disabled={t.isPending || !v.service_on} onClick={() => tryVersion(x.version)}>Dene</Button>
                <Button size="sm" disabled={w.isPending || x.version === data.active} onClick={() => w.mutate({ activate: x.version }, {
                  onSuccess: () => toast({ text: "İstem etkinleştirildi", error: false }),
                  onError: (e) => setErr(errorText(e)),
                })}>Etkinleştir</Button>
              </span>
            </div>
            <details>
              <summary className={c.sub}>Metni göster</summary>
              <pre className={c.pre}>{x.body}</pre>
            </details>
            {res !== null && res.version === x.version && <TryResult r={res.out} />}
          </li>
        ))}
      </ul>
    </>
  );
}

// --- Temizleme ---------------------------------------------------------------------

type Preset = "low" | "medium" | "high" | "custom";
const PRESETS: Record<Exclude<Preset, "custom">, LlmRules> = {
  low: { patterns: true, known_names: false, capitalized: false },
  medium: { patterns: true, known_names: true, capitalized: false },
  high: { patterns: true, known_names: true, capitalized: true },
};
const presetOf = (r: LlmRules): Preset =>
  (Object.entries(PRESETS) as [Exclude<Preset, "custom">, LlmRules][]).find(([, p]) =>
    p.patterns === r.patterns && p.known_names === r.known_names && p.capitalized === r.capitalized)?.[0] ?? "custom";

export function AdminLlmCleaning() {
  const q = useLlmConfig();
  const write = useLlmConfigWrite();
  const tryIt = useLlmRedactTry();
  const toast = useToast();
  const [draft, setDraft] = useState<LlmConfig | null>(null);
  const [text, setText] = useState("Selin ile cuma görüş, ahmet@firma.com · 0532 555 01 17 · www.ornek.com.tr");
  const [out, setOut] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (q.data === undefined) return <Loading />;
  const view = q.data;
  const d = draft ?? view.config;
  const dirty = JSON.stringify(d) !== JSON.stringify(view.config);
  const setRule = (k: keyof LlmRules, on: boolean) => setDraft({ ...d, rules: { ...d.rules, [k]: on } });
  const save = (cfg: LlmConfig | null) => {
    setErr(null);
    write.mutate(cfg, {
      onSuccess: () => { setDraft(null); toast({ text: cfg === null ? "Varsayılana dönüldü" : "Temizleme kuralları kaydedildi", error: false }); },
      onError: (x) => setErr(errorText(x)),
    });
  };
  const preset = presetOf(d.rules);
  return (
    <>
      <p className={c.note}>
        Modele giden etkinlik verisinin temizlenmesi (spec/79 §4). Kişi ve firma alanları yükte yapısal olarak yok;
        bu kurallar metin alanlarına uygulanır. Garanti değildir: kayıtsız bir ad “büyük harf” kuralı kapalıyken geçer.
        {view.customized && view.updated_at !== null ? ` Son değişiklik ${ago(view.updated_at)}.` : " Şu an kodun varsayılanı (orta) geçerli."}
      </p>
      <section className={c.feature} aria-label="Temizleme kuralları">
        <div className={c.featureHead}>
          <h3>Yoğunluk</h3>
          <Segmented label="Yoğunluk" value={preset}
            onChange={(p) => p !== "custom" && setDraft({ ...d, rules: PRESETS[p] })}
            options={[
              { value: "low", label: "Düşük" }, { value: "medium", label: "Orta" }, { value: "high", label: "Yüksek" },
              ...(preset === "custom" ? [{ value: "custom" as const, label: "Özel" }] : []),
            ]} />
        </div>
        <div className={c.fields}>
          <label className={c.check}>
            <input type="checkbox" checked={d.rules.patterns} onChange={(e) => setRule("patterns", e.target.checked)} />
            Kalıplar: e-posta, bağlantı, 10+ rakam (telefon, TC, IBAN)
          </label>
          <label className={c.check}>
            <input type="checkbox" checked={d.rules.known_names} onChange={(e) => setRule("known_names", e.target.checked)} />
            Kayıtlı adlar: kişi → {"{{KISI}}"}, takım/tedarikçi/kulüp → {"{{KURUM}}"}
          </label>
          <label className={c.check}>
            <input type="checkbox" checked={d.rules.capitalized} onChange={(e) => setRule("capitalized", e.target.checked)} />
            Büyük harfli her kelime → {"{{ISIM}}"} (kaba)
          </label>
          <label className={c.check}>
            <input type="checkbox" checked={d.free_text_allowed} onChange={(e) => setDraft({ ...d, free_text_allowed: e.target.checked })} />
            Serbest metin gönderilebilir (başlık, açıklama, notlar; istekte ayrıca açılmalı)
          </label>
        </div>
        {err !== null && <p className={ui.error} role="alert">{err}</p>}
        <div className={ui.dact}>
          <Button variant="primary" disabled={!dirty || write.isPending} onClick={() => save(d)}>Kaydet</Button>
          <Button disabled={!view.customized || write.isPending} onClick={() => save(null)}>Varsayılana dön</Button>
        </div>
        <div className={c.tryBox}>
          <h4 style={{ margin: "0 0 4px" }}>Dene</h4>
          <p className={ui.fieldHint}>Metin modele gitmez: yukarıdaki (kaydedilmemiş) kurallarla temizlenmiş hali gösterilir.</p>
          <textarea className={ui.input} rows={3} value={text} onChange={(e) => setText(e.target.value)} aria-label="Temizlenecek metin" />
          <div className={ui.dact}>
            <Button disabled={tryIt.isPending || text.trim() === ""} onClick={() => tryIt.mutate({ text, config: d }, {
              onSuccess: (r) => setOut(r.text), onError: (x) => setErr(errorText(x)),
            })}>Temizle</Button>
          </div>
          {out !== null && <pre className={c.pre}>{out}</pre>}
        </div>
      </section>
    </>
  );
}

// --- Veri --------------------------------------------------------------------------

export function AdminLlmData() {
  const s = useLlmStatus();
  const f = useLlmFeatures();
  const write = useLlmFeatureWrite();
  const toast = useToast();
  if (s.data === undefined || f.data === undefined) return <Loading />;
  const st = s.data;
  const toggle = (v: LlmFeatureView, on: boolean) =>
    write.mutate({ feature: v.feature, body: { model: v.effective.model, params: v.params, enabled: v.effective.enabled, store_bodies: on } }, {
      onSuccess: () => toast({ text: on ? `${v.label}: gövdeler 7 gün saklanacak` : `${v.label}: gövde saklama kapandı`, error: false }),
      onError: (x) => toast({ text: errorText(x), error: true }),
    });
  return (
    <>
      <div className={c.kpis}>
        <div className={c.kpi}><div className={c.kpiLabel}>Çağrı kaydı</div><div className={c.kpiValue}>{count(st.calls)}</div><div className={c.kpiSub}>{st.retention_days} gün saklanır</div></div>
        <div className={c.kpi}><div className={c.kpiLabel}>Saklanan gövde</div><div className={c.kpiValue}>{count(st.bodies)}</div><div className={c.kpiSub}>{st.body_ttl_days} gün saklanır</div></div>
        <div className={c.kpi}><div className={c.kpiLabel}>Günlük özet</div><div className={c.kpiValue}>{count(st.daily_rows)}</div><div className={c.kpiSub}>kalıcı, kişi yok</div></div>
        <div className={c.kpi}><div className={c.kpiLabel}>Boyut</div><div className={c.kpiValue}>{bytes(st.size_bytes)}</div><div className={c.kpiSub}>{st.oldest_call === null ? "kayıt yok" : `en eski ${ago(st.oldest_call)}`}</div></div>
      </div>
      <section className={c.card} aria-label="Gövde saklama">
        <div className={c.cardHead}><h3>Gövde saklama</h3><span className={c.sub}>özellik başına, varsayılan kapalı</span></div>
        <p className={c.sub}>
          Açıkken modele giden istek (temizlenmiş haliyle) ve cevap {st.body_ttl_days} gün saklanır; amaç hata ayıklamak. Kalite
          kapısında istek kaydın ham başlık ve açıklamasıdır (temizleyiciden geçmez). Açıp kapamak denetim izine yazılır.
        </p>
        {f.data.map((v) => (
          <label key={v.feature} className={c.check} style={{ marginTop: 8 }}>
            <input type="checkbox" checked={v.effective.store_bodies} disabled={write.isPending} onChange={(e) => toggle(v, e.target.checked)} />
            {v.label}
          </label>
        ))}
      </section>
      <p className={c.note} style={{ marginTop: "var(--s-3)" }}>
        Gece süpürmesi: kapalı günler özete yazılır, {st.retention_days} günden eski çağrılar ve {st.body_ttl_days} günden eski gövdeler silinir.
        Özet sınırı şu an {st.boundary}.
      </p>
    </>
  );
}
