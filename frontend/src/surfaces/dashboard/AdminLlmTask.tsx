// Yonetim > Veri isleme ve LLM > Gorev (tam sayfa, spec/79 §11): koddaki bir sozlesme
// (malzeme onerisi, kalite kapisi...) hangi profili kullanir, partisi, acik/kapali, govde
// saklama; istem surumleri; kalite kapisinda sorular (yalniz admin).
// Baska profile baglamak o profille bu gorevin son 30 dk'da gecen bir "Dene"sini ister.

import { useEffect, useState } from "react";
import { ApiError, errorText } from "../../api/client";
import { useLlmProfiles, useLlmPrompts, useLlmPromptWrite, useLlmTask, useLlmTasks, useLlmTaskWrite, useLlmTry } from "../../api/hooks";
import type { LlmFeature, LlmTaskView, LlmTryOut } from "../../api/types";
import { ago } from "../../lib/labels";
import { featureLabel } from "../../lib/llm";
import { useLookup } from "../../lib/lookup";
import { Icon } from "../../ui/icons";
import { Button, Link, Loading, Tag, ui, useToast } from "../../ui/ui";
import { ErrorScreen } from "../errors/ErrorScreen";
import { AdminQuality } from "./AdminQuality";
import { ENDPOINT_LABEL, LlmPage, Section, TryBox, TryResult } from "./AdminLlmSettings";
import { href } from "./routes";
import c from "./AdminLlm.module.css";

export function AdminLlmTask({ feature }: { feature: string }) {
  const q = useLlmTask(feature as LlmFeature);
  useEffect(() => {
    document.title = `${q.data?.label ?? "Görev"} — Yönetim — EkipTakip`;
  }, [q.data?.label]);
  if (q.error !== null) {
    const code = q.error instanceof ApiError ? q.error.code : "network";
    return <ErrorScreen code={code === "forbidden" ? "forbidden" : code === "not_found" ? "not_found" : "network"} />;
  }
  if (q.data === undefined) return <Loading />;
  return <TaskScreen key={q.data.updated_at ?? ""} t={q.data} />;
}

function TaskScreen({ t }: { t: LlmTaskView }) {
  const L = useLookup();
  const profiles = useLlmProfiles();
  const tasks = useLlmTasks();
  const write = useLlmTaskWrite();
  const toast = useToast();
  const [profileId, setProfileId] = useState(t.profile?.id ?? "");
  const [batch, setBatch] = useState(t.batch === null ? "" : String(t.batch));
  const [enabled, setEnabled] = useState(t.effective.enabled);
  const [bodies, setBodies] = useState(t.effective.store_bodies);
  const [err, setErr] = useState<string | null>(null);
  const options = (profiles.data ?? []).filter((p) => p.endpoint === t.endpoint);
  const chosen = options.find((p) => p.id === profileId);
  const switching = profileId !== (t.profile?.id ?? "");
  const batchNum = batch.trim() === "" ? undefined : Number(batch);
  const save = () => {
    setErr(null);
    write.mutate({ feature: t.feature, body: {
      profile_id: profileId, enabled, store_bodies: bodies, ...(batchNum !== undefined ? { batch: batchNum } : {}),
    } }, {
      onSuccess: () => toast({ text: `${t.label}: kaydedildi`, error: false }),
      onError: (x) => setErr(errorText(x)),
    });
  };
  const self = (tasks.data ?? []).filter((x) => x.feature === t.feature);
  return (
    <LlmPage title={t.label}
      tags={<>
        <Tag tone="neutral">{ENDPOINT_LABEL[t.endpoint]}</Tag>
        {!t.effective.enabled && <Tag tone="high">kapalı</Tag>}
        {!t.service_on && <Tag tone="critical">servis kapalı</Tag>}
      </>}
      sub={<>Görev: koddaki sözleşme (cevap şeması, sunucu süzgeci) ve onu çalıştıran profil.{t.updated_at !== null ? ` Son değişiklik ${ago(t.updated_at)}.` : ""}</>}>

      <Section title="Profil ve ayarlar"
        sub={switching ? "Profil değişiyor: kaydetmeden önce aşağıda bu profille “Dene”." : "Model ve limit profilden gelir."}
        aside={chosen !== undefined && <Link href={href({ name: "llmProfile", id: chosen.id })} className={c.chipLink}>Profili aç <Icon name="chevron" size={12} /></Link>}>
        <div className={c.fields}>
          <label className={`${ui.field} ${c.wide}`}>
            <span>Profil <span className={ui.fieldHint}>(yalnız {t.endpoint === "chat" ? "sohbet" : "karar"} türü)</span></span>
            <select className={ui.input} value={profileId} onChange={(e) => setProfileId(e.target.value)}>
              {options.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.model}</option>)}
            </select>
          </label>
          {t.has_batch && (
            <label className={ui.field}>
              <span>Parti <span className={ui.fieldHint}>(3–15 öneri, boş: 9)</span></span>
              <input className={ui.input} inputMode="numeric" value={batch} placeholder="9" onChange={(e) => setBatch(e.target.value)} />
            </label>
          )}
        </div>
        <div className={c.fields}>
          <label className={c.check}>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Görev açık
          </label>
          <label className={c.check}>
            <input type="checkbox" checked={bodies} onChange={(e) => setBodies(e.target.checked)} />
            Gövdeyi 7 gün sakla
          </label>
        </div>
        {chosen !== undefined && (
          <p className={c.sub}>
            {chosen.model} · {chosen.limits.length === 0 ? "limit yok" : `${chosen.limits.length} limit`} · bu profili kullanan:
            {" "}{chosen.used_by.length === 0 ? "—" : chosen.used_by.map(featureLabel).join(", ")}
          </p>
        )}
        {err !== null && <p className={ui.error} role="alert">{err}</p>}
        <div className={ui.dact}>
          <Button variant="primary" disabled={write.isPending || profileId === ""} onClick={save}>Kaydet</Button>
          <Button disabled={write.isPending} onClick={() => {
            setProfileId(t.profile?.id ?? ""); setBatch(t.batch === null ? "" : String(t.batch));
            setEnabled(t.effective.enabled); setBodies(t.effective.store_bodies);
          }}>Geri al</Button>
        </div>
      </Section>

      <Section title="Dene" sub="Seçili profil ve parti ile; istem etkin olan.">
        {tasks.data === undefined || profileId === "" ? <Loading /> : (
          <TryBox key={profileId} tasks={self} fixedFeature={t.feature} profileId={profileId}
            {...(t.has_batch && batchNum !== undefined ? { batch: batchNum } : {})} serviceOn={t.service_on} />
        )}
      </Section>

      {t.has_prompt && <Prompts t={t} profileId={profileId} />}

      {t.feature === "quality_gate" && (
        <Section title="Kalite soruları" sub="Kayıt ve kapanış notlarını tartan soruların metinleri ve eşikleri.">
          {L.meta.me.is_admin ? <AdminQuality /> : (
            <p className={c.sub} style={{ margin: 0 }}><Icon name="lock" size={13} /> Sorular kayıt kararlarını değiştirir: yalnız yönetici düzenler.</p>
          )}
        </Section>
      )}
    </LlmPage>
  );
}

function Prompts({ t, profileId }: { t: LlmTaskView; profileId: string }) {
  const p = useLlmPrompts(t.feature);
  const w = useLlmPromptWrite(t.feature);
  const tr = useLlmTry();
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
    tr.mutate({ feature: t.feature, profile_id: profileId, prompt_version: version, input: t.sample_input }, {
      onSuccess: (out) => setRes({ version, out }),
      onError: (x) => setErr(errorText(x)),
    });
  };
  return (
    <Section title="İstem"
      sub={<>Sürümlü: yeni sürüm etkin olmadan kaydedilir; görevin profiliyle başarılı bir “Dene”den sonra (30 dk içinde)
        etkinleştirilir. İstem güvence değildir: kişi alanlarının yükte olmaması, serbest metin kapısı ve sunucu süzgeci
        istemden bağımsız çalışır (spec/79 §2).</>}>
      <textarea className={`${ui.input} ${c.mono}`} rows={12} value={text} onChange={(e) => setBody(e.target.value)} aria-label="İstem metni" />
      <p className={ui.fieldHint}>Özet JSON'u `max_items` (parti büyüklüğü) taşır; istem “en çok `max_items`” diyebilir. En çok 8000 karakter.</p>
      <div className={ui.dact}>
        <Button variant="primary" disabled={w.isPending || text.trim() === "" || text === activeBody} onClick={() => w.mutate({ add: text }, {
          onSuccess: () => { setBody(null); toast({ text: "Yeni sürüm kaydedildi (etkin değil)", error: false }); },
          onError: (x) => setErr(errorText(x)),
        })}>Yeni sürüm olarak kaydet</Button>
      </div>
      {err !== null && <p className={ui.error} role="alert">{err}</p>}
      <ul className={c.versions} aria-label="Sürümler" style={{ marginTop: "var(--s-3)" }}>
        {versions.map((x) => (
          <li key={x.version} className={c.version} data-active={x.version === data.active}>
            <div className={c.versionHead}>
              <span>
                <b>{x.version === 0 ? "Koddaki istem" : `Sürüm ${x.version}`}</b>
                {x.version === data.active && <> <Tag tone="info">etkin</Tag></>}
                {x.created_at !== "" && <span className={c.sub}> · {ago(x.created_at)}</span>}
              </span>
              <span style={{ display: "inline-flex", gap: 8 }}>
                <Button size="sm" disabled={tr.isPending || !t.service_on || profileId === ""} onClick={() => tryVersion(x.version)}>Dene</Button>
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
    </Section>
  );
}
