// Yonetim > Veri isleme ve LLM > Profil (tam sayfa, spec/79 §11): model + parametre +
// dolar limitleri. Modelini degistirmek ona bagli butun gorevleri degistirir; bu yuzden
// model degisikligi bu profille son 30 dk'da gecen bir "Dene" ister (sunucu kurali).

import { useEffect, useState } from "react";
import { ApiError, errorText } from "../../api/client";
import { useLlmLimitWrite, useLlmModels, useLlmProfile, useLlmProfileWrite, useLlmTasks } from "../../api/hooks";
import type { LlmParams, LlmProfileView } from "../../api/types";
import { ago } from "../../lib/labels";
import { compat, featureLabel, UNIT_MINUTES, usd, validWindow, windowLabel, WINDOWS, type WindowUnit } from "../../lib/llm";
import { navigate } from "../../lib/router";
import { Button, Empty, Link, Loading, Tag, ui, useToast } from "../../ui/ui";
import { ErrorScreen } from "../errors/ErrorScreen";
import { ENDPOINT_LABEL, LlmPage, MODEL_LIST, ModelOptions, Section, TryBox } from "./AdminLlmSettings";
import { href } from "./routes";
import c from "./AdminLlm.module.css";

export function AdminLlmProfile({ id }: { id: string }) {
  const q = useLlmProfile(id);
  useEffect(() => {
    document.title = `${q.data?.name ?? "Profil"} — Yönetim — EkipTakip`;
  }, [q.data?.name]);
  if (q.error !== null) {
    const code = q.error instanceof ApiError ? q.error.code : "network";
    return <ErrorScreen code={code === "forbidden" ? "forbidden" : code === "not_found" ? "not_found" : "network"} />;
  }
  if (q.data === undefined) return <Loading />;
  return <ProfileScreen key={q.data.updated_at} p={q.data} />;
}

interface Draft {
  name: string;
  model: string;
  max_tokens: string;
  temperature: string;
  timeout_s: string;
  reasoning_off: boolean;
}

function draftOf(p: LlmProfileView): Draft {
  const s = (n: number | undefined) => (n === undefined ? "" : String(n));
  return {
    name: p.name, model: p.model, max_tokens: s(p.params.max_tokens), temperature: s(p.params.temperature),
    timeout_s: p.params.timeout_ms === undefined ? "" : String(p.params.timeout_ms / 1000), reasoning_off: p.effective.reasoning_off,
  };
}

/** Bos alan = uc turunun varsayilani (gonderilmez). */
function paramsOf(d: Draft, chat: boolean): LlmParams {
  const num = (s: string) => (s.trim() === "" ? undefined : Number(s.replace(",", ".")));
  const p: LlmParams = {};
  const timeout = num(d.timeout_s);
  if (timeout !== undefined) p.timeout_ms = Math.round(timeout * 1000);
  if (chat) {
    const mt = num(d.max_tokens);
    const t = num(d.temperature);
    if (mt !== undefined) p.max_tokens = mt;
    if (t !== undefined) p.temperature = t;
    if (!d.reasoning_off) p.reasoning_off = false;
  }
  return p;
}

function ProfileScreen({ p }: { p: LlmProfileView }) {
  const write = useLlmProfileWrite();
  const tasks = useLlmTasks();
  const m = useLlmModels(0);
  const toast = useToast();
  const [d, setD] = useState<Draft>(() => draftOf(p));
  const [err, setErr] = useState<string | null>(null);
  const set = (x: Partial<Draft>) => setD({ ...d, ...x });
  const chat = p.endpoint === "chat";
  const params = paramsOf(d, chat);
  const models = m.data?.models ?? [];
  const info = models.find((x) => x.id === d.model.trim());
  const cp = models.length === 0 ? null : compat(info, p.endpoint, d.reasoning_off);
  const modelChanged = d.model.trim() !== p.model;
  const sameType = (tasks.data ?? []).filter((t) => t.endpoint === p.endpoint);
  const save = () => {
    setErr(null);
    write.mutate({ put: p.id, body: { name: d.name.trim(), model: d.model.trim(), params } }, {
      onSuccess: () => toast({ text: "Profil kaydedildi", error: false }),
      onError: (x) => setErr(errorText(x)),
    });
  };
  const remove = () => {
    setErr(null);
    write.mutate({ remove: p.id }, {
      onSuccess: () => { toast({ text: "Profil silindi", error: false }); navigate(href({ name: "admin" })); },
      onError: (x) => setErr(errorText(x)),
    });
  };
  return (
    <LlmPage title={p.name}
      tags={<>
        <Tag tone="neutral">{ENDPOINT_LABEL[p.endpoint]}</Tag>
        {!p.service_on && <Tag tone="critical">servis kapalı</Tag>}
        {p.tested_at === null && p.updated_by !== null && <Tag tone="high">denenmeden kaydedildi</Tag>}
      </>}
      sub={<>Profil: hangi model, hangi ayarla, ne kadar parayla. Son değişiklik {ago(p.updated_at)}.</>}>
      <ModelOptions models={models} />

      <Section title="Kullanan görevler" sub="Profilin modelini değiştirmek bunların hepsini değiştirir.">
        {p.used_by.length === 0 ? <p className={c.sub} style={{ margin: 0 }}>Bu profili kullanan görev yok. Görev sayfasından bağlanır.</p> : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {p.used_by.map((f) => (
              <Link key={f} href={href({ name: "llmTask", feature: f })} className={c.chipLink}>{featureLabel(f)}</Link>
            ))}
          </div>
        )}
      </Section>

      <Section title="Ayarlar" sub={modelChanged ? "Model değişiyor: kaydetmeden önce aşağıda “Dene” ile sına." : undefined}>
        <div className={c.fields}>
          <label className={ui.field}>
            <span>Ad</span>
            <input className={ui.input} value={d.name} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label className={`${ui.field} ${c.wide}`}>
            <span>Model <span className={ui.fieldHint}>(OpenRouter adı: sağlayıcı/model)</span></span>
            <input className={ui.input} list={MODEL_LIST} value={d.model} onChange={(e) => set({ model: e.target.value })} spellCheck={false} />
          </label>
          {chat && (
            <label className={ui.field}>
              <span>En çok jeton <span className={ui.fieldHint}>(boş: 1500)</span></span>
              <input className={ui.input} inputMode="numeric" value={d.max_tokens} placeholder="1500" onChange={(e) => set({ max_tokens: e.target.value })} />
            </label>
          )}
          {chat && (
            <label className={ui.field}>
              <span>Sıcaklık <span className={ui.fieldHint}>(0–2, boş: modelin)</span></span>
              <input className={ui.input} inputMode="decimal" value={d.temperature} onChange={(e) => set({ temperature: e.target.value })} />
            </label>
          )}
          <label className={ui.field}>
            <span>Zaman aşımı, sn <span className={ui.fieldHint}>(boş: {chat ? 30 : 3}{chat ? "" : "; en çok 20"})</span></span>
            <input className={ui.input} inputMode="decimal" value={d.timeout_s} placeholder={chat ? "30" : "3"} onChange={(e) => set({ timeout_s: e.target.value })} />
          </label>
        </div>
        {chat && (
          <label className={c.check} style={{ marginBottom: "var(--s-3)" }}>
            <input type="checkbox" checked={d.reasoning_off} onChange={(e) => set({ reasoning_off: e.target.checked })} />
            Düşünme kapalı (kısa yapılandırılmış çıktı için)
          </label>
        )}
        {cp !== null && (
          <div className={c.compat} data-level={cp.level} role="note">
            {cp.level === "ok" ? "OpenRouter listesine göre uyumlu." : "Uyumluluk:"}
            {info !== undefined && info.prompt_per_m !== null && ` Fiyat ${usd(info.prompt_per_m)} / ${usd(info.completion_per_m)} (1M jeton, giriş/çıkış).`}
            {cp.notes.length > 0 && <ul>{cp.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
          </div>
        )}
        {err !== null && <p className={ui.error} role="alert">{err}</p>}
        <div className={ui.dact}>
          <Button variant="primary" disabled={write.isPending || d.model.trim() === "" || d.name.trim() === ""} onClick={save}>Kaydet</Button>
          <Button disabled={write.isPending} onClick={() => setD(draftOf(p))}>Geri al</Button>
          <span style={{ flex: 1 }} />
          <Button variant="danger" disabled={write.isPending || p.used_by.length > 0} onClick={remove}
            title={p.used_by.length > 0 ? "Kullanan görev varken silinemez" : undefined}>Profili sil</Button>
        </div>
      </Section>

      <Section title="Dene" sub="Yukarıdaki (kaydedilmemiş) model ve parametrelerle; görev seçilir.">
        {tasks.data === undefined ? <Loading /> : (
          <TryBox tasks={sameType} profileId={p.id} model={d.model.trim()} params={params} serviceOn={p.service_on} />
        )}
      </Section>

      <Limits p={p} />
    </LlmPage>
  );
}

function Limits({ p }: { p: LlmProfileView }) {
  const w = useLlmLimitWrite();
  const toast = useToast();
  const [preset, setPreset] = useState<string>("1440");
  const [amount, setAmount] = useState("1");
  const [unit, setUnit] = useState<WindowUnit>("sa");
  const [usdText, setUsd] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const minutes = preset === "custom" ? Math.round(Number(amount.replace(",", ".")) * UNIT_MINUTES[unit]) : Number(preset);
  const value = Number(usdText.replace(",", "."));
  const ok = validWindow(minutes) && Number.isFinite(value) && value > 0;
  const add = () => {
    setErr(null);
    w.mutate({ profile: p.id, window_minutes: minutes, usd: value }, {
      onSuccess: () => { setUsd(""); toast({ text: "Limit kaydedildi", error: false }); },
      onError: (x) => setErr(errorText(x)),
    });
  };
  return (
    <Section title="Limitler"
      sub="Profil başına dolar tavanı, kayan pencere (“1 ay” = son 30 gün). Biri dolunca bu profille yeni çağrı yapılmaz: öneri “limit doldu” der, kalite kapısı kullanıcıyı engellemeden atlanır. Maliyeti bilinmeyen çağrılar tavana sayılmaz.">
      {p.limits.length === 0 ? <Empty title="Limit yok: harcama sınırsız." icon="wallet" /> : (
        <ul className={c.list} style={{ marginBottom: "var(--s-4)" }}>
          {p.limits.map((r) => (
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
      )}
      <div className={c.inline}>
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
        <Button variant="primary" disabled={!ok || w.isPending} onClick={add}>Limit ekle</Button>
      </div>
      {preset === "custom" && !validWindow(minutes) && <p className={ui.fieldHint}>Pencere 15 dakika ile 31 gün arasında olmalı.</p>}
      {err !== null && <p className={ui.error} role="alert">{err}</p>}
    </Section>
  );
}
