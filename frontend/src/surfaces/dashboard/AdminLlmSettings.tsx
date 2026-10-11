// Yonetim > Veri isleme ve LLM: ayar ekranlari ve ortak parcalar (spec/79 §11).
//
// "Modeller ve gorevler" genel bakisi: solda PROFILLER (model + parametre + limit), sagda
// GOREVLER (sozlesme + istem + hangi profil). Her kart tam sayfa ayrintiya gider
// (AdminLlmProfile.tsx, AdminLlmTask.tsx). Temizleme ve Veri de burada.
// Kurallar sunucuda: model degisikligi, goreve profil baglama ve istem etkinlestirme son
// 30 dk'daki basarili bir "Dene" ister; burada yalniz akis ve anlatim.

import { useState, type ReactNode } from "react";
import { errorText } from "../../api/client";
import {
  useLlmConfig, useLlmConfigWrite, useLlmModels, useLlmProfiles, useLlmProfileWrite, useLlmRedactTry, useLlmStatus,
  useLlmTasks, useLlmTaskWrite, useLlmTry, useLlmUsage,
} from "../../api/hooks";
import type {
  LlmConfig, LlmEndpoint, LlmFeature, LlmModelInfo, LlmModelsView, LlmParams, LlmRules, LlmTaskView, LlmTryOut,
} from "../../api/types";
import { ago } from "../../lib/labels";
import { breakdown, bytes, count, featureLabel, isoDay, ms, STATUS_LABEL, usd, windowLabel } from "../../lib/llm";
import { navigate } from "../../lib/router";
import { Icon } from "../../ui/icons";
import { Button, Empty, Link, Loading, Segmented, Tag, ui, useToast } from "../../ui/ui";
import { href } from "./routes";
import c from "./AdminLlm.module.css";
import s from "./dashboard.module.css";

export const MODEL_LIST = "llm-model-list";

export const ENDPOINT_LABEL: Record<LlmEndpoint, string> = { chat: "sohbet · json_schema", decisions: "karar ucu · noul" };

/** OpenRouter model adlari (`<datalist>`): elle yazmak da serbest. */
export function ModelOptions({ models }: { models: LlmModelInfo[] }) {
  return <datalist id={MODEL_LIST}>{models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</datalist>;
}

/** Profil ve gorev ayrintisinin kabugu: konum satiri, baslik, alt baslik. */
export function LlmPage(props: { title: string; sub?: ReactNode; tags?: ReactNode; children: ReactNode }) {
  return (
    <div className={s.page} style={{ maxWidth: 980 }}>
      <nav className={s.crumb} aria-label="Konum">
        <Link href={href({ name: "admin" })}>Yönetim</Link>
        <Icon name="chevron" size={13} />
        <Link href={href({ name: "admin" })}>Veri işleme ve LLM</Link>
        <Icon name="chevron" size={13} />
        <b>{props.title}</b>
      </nav>
      <div className={s.pageHead}>
        <div className={s.pageTitle}>
          <h1 style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>{props.title} {props.tags}</h1>
          {props.sub !== undefined && <p className={s.pageSub}>{props.sub}</p>}
        </div>
      </div>
      {props.children}
    </div>
  );
}

/** Ayrinti sayfasinda bir bolum. */
export function Section(props: { title: string; sub?: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className={c.feature} aria-label={props.title}>
      <div className={c.cardHead}>
        <div><h3 style={{ margin: 0 }}>{props.title}</h3>{props.sub !== undefined && <span className={c.sub}>{props.sub}</span>}</div>
        {props.aside}
      </div>
      {props.children}
    </section>
  );
}

// --- Modeller ve gorevler (genel bakis) -----------------------------------------------

export function AdminLlmModels() {
  const p = useLlmProfiles();
  const t = useLlmTasks();
  const [refresh, setRefresh] = useState(0);
  const m = useLlmModels(refresh);
  if (p.data === undefined || t.data === undefined) return <Loading />;
  const tasks = t.data;
  return (
    <>
      <p className={c.note}>
        <b>Profil</b> hangi modelin hangi ayarla ve ne kadar parayla çağrılacağıdır; <b>görev</b> koddaki bir işin
        (sözleşme, istem) hangi profili kullanacağıdır. Profilin modelini değiştirmek ona bağlı bütün görevleri değiştirir.
      </p>
      <div className={c.grid2} style={{ alignItems: "start" }}>
        <section aria-label="Profiller">
          <div className={c.cardHead}><h3 style={{ margin: 0 }}>Profiller</h3><span className={c.sub}>model · parametre · limit</span></div>
          {p.data.map((v) => (
            <Link key={v.id} href={href({ name: "llmProfile", id: v.id })} className={c.linkCard}>
              <div className={c.listHead}>
                <b>{v.name}</b>
                <Tag tone="neutral">{v.endpoint === "chat" ? "sohbet" : "karar"}</Tag>
              </div>
              <div className={c.mono}>{v.model}</div>
              <div className={c.listSub}>
                <span>{v.limits.length === 0 ? "limit yok" : v.limits.map((l) => `${usd(l.usd)}/${windowLabel(l.window_minutes)}`).join(" · ")}</span>
                <span>{v.used_by.length === 0 ? "kullanılmıyor" : v.used_by.map(featureLabel).join(", ")}</span>
              </div>
            </Link>
          ))}
          <NewProfile />
        </section>
        <section aria-label="Görevler">
          <div className={c.cardHead}><h3 style={{ margin: 0 }}>Görevler</h3><span className={c.sub}>sözleşme · istem · profil</span></div>
          {tasks.map((v) => (
            <Link key={v.feature} href={href({ name: "llmTask", feature: v.feature })} className={c.linkCard}>
              <div className={c.listHead}>
                <b>{v.label}</b>
                <span style={{ display: "inline-flex", gap: 6 }}>
                  {!v.effective.enabled && <Tag tone="high">kapalı</Tag>}
                  {!v.service_on && <Tag tone="critical">servis kapalı</Tag>}
                  <Tag tone="info">{v.profile?.name ?? "profil yok"}</Tag>
                </span>
              </div>
              <div className={c.mono}>{v.effective.model}</div>
              <div className={c.listSub}>
                <span>{taskSummary(v)}</span>
                <span>{ENDPOINT_LABEL[v.endpoint]}</span>
              </div>
            </Link>
          ))}
        </section>
      </div>
      <ModelOptions models={m.data?.models ?? []} />
      <PriceTable data={m.data} onRefresh={() => setRefresh(refresh + 1)} />
    </>
  );
}

function taskSummary(v: LlmTaskView): string {
  const parts: string[] = [];
  if (v.has_prompt) parts.push(v.effective.prompt_version === 0 ? "koddaki istem" : `istem sürüm ${v.effective.prompt_version}`);
  if (v.feature === "quality_gate") parts.push("kalite soruları");
  if (v.has_batch) parts.push(`parti ${v.effective.batch}`);
  if (v.effective.store_bodies) parts.push("gövde saklanıyor");
  return parts.join(" · ");
}

function NewProfile() {
  const w = useLlmProfileWrite();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState<LlmEndpoint>("chat");
  const [model, setModel] = useState("");
  const [err, setErr] = useState<string | null>(null);
  if (!open) {
    return (
      <button type="button" className={c.linkCard} style={{ borderStyle: "dashed", width: "100%", textAlign: "left", cursor: "pointer" }}
        onClick={() => setOpen(true)}>
        <span className={c.sub}><Icon name="plus" size={13} /> Profil ekle</span>
      </button>
    );
  }
  return (
    <form className={c.linkCard} onSubmit={(e) => {
      e.preventDefault();
      setErr(null);
      w.mutate({ create: { name: name.trim(), endpoint, model: model.trim(), params: {} } }, {
        onSuccess: (v) => { if (!Array.isArray(v)) navigate(href({ name: "llmProfile", id: v.id })); },
        onError: (x) => setErr(errorText(x)),
      });
    }}>
      <div className={c.fields} style={{ marginBottom: 8 }}>
        <label className={ui.field}><span>Ad</span>
          <input className={ui.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Tasarım" required />
        </label>
        <label className={ui.field}><span>Tür</span>
          <select className={ui.input} value={endpoint} onChange={(e) => setEndpoint(e.target.value as LlmEndpoint)}>
            <option value="chat">Sohbet (json_schema)</option>
            <option value="decisions">Karar (noul)</option>
          </select>
        </label>
        <label className={`${ui.field} ${c.wide}`}><span>Model</span>
          <input className={ui.input} list={MODEL_LIST} value={model} onChange={(e) => setModel(e.target.value)} placeholder="sağlayıcı/model" spellCheck={false} required />
        </label>
      </div>
      {err !== null && <p className={ui.error} role="alert">{err}</p>}
      <div className={ui.dact}>
        <Button type="submit" variant="primary" disabled={w.isPending}>Oluştur</Button>
        <Button onClick={() => setOpen(false)}>Vazgeç</Button>
      </div>
      <p className={ui.fieldHint} style={{ margin: 0 }}>Tür sonradan değişmez: görev yalnız kendi türündeki profili kullanabilir.</p>
    </form>
  );
}

// --- Dene ------------------------------------------------------------------------

/** Bir gorevi bir profille (taslak model/parametre/parti/istem) dener; kaydetmez. */
export function TryBox(props: {
  tasks: LlmTaskView[];
  profileId: string;
  model?: string;
  params?: LlmParams;
  batch?: number;
  promptVersion?: number;
  serviceOn: boolean;
  /** Profil sayfasinda gorev secilir; gorev sayfasinda sabit. */
  fixedFeature?: LlmFeature;
  hint?: ReactNode;
}) {
  const t = useLlmTry();
  const first = props.tasks.find((x) => x.feature === props.fixedFeature) ?? props.tasks[0];
  const [feature, setFeature] = useState<LlmFeature | undefined>(first?.feature);
  const task = props.tasks.find((x) => x.feature === feature) ?? first;
  const [input, setInput] = useState(() => JSON.stringify(first?.sample_input ?? {}, null, 2));
  const [res, setRes] = useState<LlmTryOut | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (task === undefined) return <p className={c.sub}>Bu türde görev yok: denenecek bir şey yok.</p>;
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
    t.mutate({
      feature: task.feature, profile_id: props.profileId, input: parsed,
      ...(props.model !== undefined ? { model: props.model } : {}),
      ...(props.params !== undefined ? { params: props.params } : {}),
      ...(props.batch !== undefined ? { batch: props.batch } : {}),
      ...(props.promptVersion !== undefined ? { prompt_version: props.promptVersion } : {}),
    }, { onSuccess: setRes, onError: (x) => setErr(errorText(x)) });
  };
  return (
    <div>
      <p className={ui.fieldHint}>
        Gerçek uca tek çağrı; kaydetmez ama harcamaya sayılır.
        {task.endpoint === "chat"
          ? " Girdi örnek bir özet ({\"brief\": …}) ya da gerçek etkinlik ({\"event_id\": …, \"free_text\": false}) olabilir."
          : " Girdi {\"kind\": \"entry\" | \"closing\", \"state\": …}."}
        {" "}Gerçek kişi adı ya da telefon yazma. {props.hint}
      </p>
      {props.fixedFeature === undefined && props.tasks.length > 1 && (
        <label className={ui.field} style={{ maxWidth: 280 }}><span>Görev</span>
          <select className={ui.input} value={task.feature} onChange={(e) => {
            const next = props.tasks.find((x) => x.feature === e.target.value);
            setFeature(next?.feature);
            setInput(JSON.stringify(next?.sample_input ?? {}, null, 2));
          }}>
            {props.tasks.map((x) => <option key={x.feature} value={x.feature}>{x.label}</option>)}
          </select>
        </label>
      )}
      <textarea className={`${ui.input} ${c.mono}`} rows={8} value={input} onChange={(e) => setInput(e.target.value)} aria-label={`${task.label} deneme girdisi`} />
      <div className={ui.dact}>
        <Button disabled={t.isPending || !props.serviceOn} onClick={run}>{t.isPending ? "Soruluyor…" : "Dene"}</Button>
        {!props.serviceOn && <span className={c.sub}>Servis kapalı: deneme yapılamaz.</span>}
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

export function PriceTable({ data, onRefresh }: { data: LlmModelsView | undefined; onRefresh: () => void }) {
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
            Serbest metin gönderilir (başlık, açıklama, notlar; malzeme önerisi bu ayara uyar)
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
  const t = useLlmTasks();
  const write = useLlmTaskWrite();
  const toast = useToast();
  if (s.data === undefined || t.data === undefined) return <Loading />;
  const st = s.data;
  const toggle = (v: LlmTaskView, on: boolean) => {
    if (v.profile === null) return;
    write.mutate({ feature: v.feature, body: {
      profile_id: v.profile.id, enabled: v.effective.enabled, store_bodies: on, ...(v.batch !== null ? { batch: v.batch } : {}),
    } }, {
      onSuccess: () => toast({ text: on ? `${v.label}: gövdeler 7 gün saklanacak` : `${v.label}: gövde saklama kapandı`, error: false }),
      onError: (x) => toast({ text: errorText(x), error: true }),
    });
  };
  return (
    <>
      <div className={c.kpis}>
        <div className={c.kpi}><div className={c.kpiLabel}>Çağrı kaydı</div><div className={c.kpiValue}>{count(st.calls)}</div><div className={c.kpiSub}>{st.retention_days} gün saklanır</div></div>
        <div className={c.kpi}><div className={c.kpiLabel}>Saklanan gövde</div><div className={c.kpiValue}>{count(st.bodies)}</div><div className={c.kpiSub}>{st.body_ttl_days} gün saklanır</div></div>
        <div className={c.kpi}><div className={c.kpiLabel}>Günlük özet</div><div className={c.kpiValue}>{count(st.daily_rows)}</div><div className={c.kpiSub}>kalıcı, kişi yok</div></div>
        <div className={c.kpi}><div className={c.kpiLabel}>Boyut</div><div className={c.kpiValue}>{bytes(st.size_bytes)}</div><div className={c.kpiSub}>{st.oldest_call === null ? "kayıt yok" : `en eski ${ago(st.oldest_call)}`}</div></div>
      </div>
      <section className={c.card} aria-label="Gövde saklama">
        <div className={c.cardHead}><h3>Gövde saklama</h3><span className={c.sub}>görev başına, varsayılan kapalı</span></div>
        <p className={c.sub}>
          Açıkken modele giden istek (temizlenmiş haliyle) ve cevap {st.body_ttl_days} gün saklanır; amaç hata ayıklamak. Kalite
          kapısında istek kaydın ham başlık ve açıklamasıdır (temizleyiciden geçmez). Açıp kapamak denetim izine yazılır.
        </p>
        {t.data.map((v) => (
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
