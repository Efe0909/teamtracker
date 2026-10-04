// Yonetim > Kalite kapisi (yalniz admin): karar modeline giden sorular ve esikler.
// Kayit/kapanis metinleri bu sorularla tartilir (spec/76); degisiklik yeniden
// derleme istemez, kaydedilince hemen gecerli olur. Soru adlari sabit.

import { useEffect, useState } from "react";
import { errorText } from "../../api/client";
import { useQualityConfig, useQualityTry, useQualityWrite } from "../../api/hooks";
import type { Quality, QualityConfig, QualityView } from "../../api/types";
import { ago } from "../../lib/labels";
import { Button, Loading, Segmented, ui, useToast } from "../../ui/ui";

/** Hangi alanin hangi sorusu; sira ekrandaki sira. */
const QUESTIONS: { key: string; kind: "entry" | "closing"; title: string; hint: string }[] = [
  { key: "specific", kind: "entry", title: "Kayıt / etkinlik · Somutluk", hint: "Başlık ve açıklama birlikte okunur; açıklama somut mu?" },
  { key: "context", kind: "entry", title: "Kayıt / etkinlik · Bağlam", hint: "Orada olmayan biri neden/kim için/nerede-ne zaman anlar mı?" },
  { key: "closing_justified", kind: "closing", title: "Kapanış notu · Gerekçe", hint: "Kayıt ya da eylem kapanırken yazılan not ne yapıldığını söylüyor mu?" },
];

const EXAMPLE = {
  entry: "Başlık: Sponsor sunumu\nAçıklama: Cuma günkü görüşme için sponsorun logosunu ve bütçe tablosunu sunuma ekle.",
  closing: "Kayıt: Sponsor görüşmesi\nKapanış notu: Sponsor A ile görüşüldü, 5.000 TL destek onaylandı.",
};

export function AdminQuality() {
  const q = useQualityConfig();
  if (q.data === undefined) return <Loading />;
  return <QualityForm view={q.data} />;
}

function QualityForm({ view }: { view: QualityView }) {
  const write = useQualityWrite();
  const toast = useToast();
  const [draft, setDraft] = useState<QualityConfig>(view.config);
  const [err, setErr] = useState<string | null>(null);
  // Kayit ya da sifirlama sonrasi sunucudaki hal taslagi yeniler.
  useEffect(() => setDraft(view.config), [view.config]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(view.config);

  const set = (key: string, patch: Partial<QualityConfig["questions"][string]>) =>
    setDraft((d) => ({ questions: { ...d.questions, [key]: { ...d.questions[key]!, ...patch } } }));
  const save = (cfg: QualityConfig | null) => {
    setErr(null);
    write.mutate(cfg, {
      onSuccess: () => toast({ text: cfg === null ? "Varsayılana dönüldü" : "Kalite ayarı kaydedildi", error: false }),
      onError: (x) => setErr(errorText(x)),
    });
  };

  return (
    <>
      <p className={ui.fieldHint}>
        Kayıt, etkinlik ve kapanış notları bu sorularla bir yapay zekâ modeline tartırılır. Kaydedince hemen geçerli olur.
        {view.customized && view.updated_at !== null ? ` Son değişiklik ${ago(view.updated_at)}.` : " Şu an kodun varsayılanları geçerli."}
      </p>
      {!view.service_on && (
        <p className={ui.fieldHint}>Kalite kontrolü kapalı (anahtar yok ya da manifestte kapatılmış): ayarlar saklanır ama "Dene" sonuç vermez.</p>
      )}
      {err !== null && <p className={ui.error} role="alert">{err}</p>}
      {QUESTIONS.map((qn) => {
        const c = draft.questions[qn.key];
        if (c === undefined) return null;
        return (
          <fieldset key={qn.key} className={ui.field}>
            <legend><strong>{qn.title}</strong> <span className={ui.fieldHint}>— {qn.hint}</span></legend>
            <label className={ui.field}>
              <span>Model yönergesi <span className={ui.fieldHint}>(İngilizce yazmak daha tutarlı sonuç veriyor)</span></span>
              <textarea className={ui.input} rows={9} value={c.instructions} onChange={(e) => set(qn.key, { instructions: e.target.value })} />
            </label>
            <label className={ui.field}>
              <span>“Evet” ölçütü</span>
              <input className={ui.input} value={c.yes} onChange={(e) => set(qn.key, { yes: e.target.value })} />
            </label>
            <label className={ui.field}>
              <span>“Hayır” ölçütü</span>
              <input className={ui.input} value={c.no} onChange={(e) => set(qn.key, { no: e.target.value })} />
            </label>
            <label className={ui.field}>
              <span>Eşik <span className={ui.fieldHint}>— evet olasılığı bunun altındaysa metin zayıf (0,05–0,95)</span></span>
              <input className={ui.input} type="number" min={0.05} max={0.95} step={0.05} value={c.min}
                onChange={(e) => set(qn.key, { min: Number(e.target.value) })} style={{ maxWidth: 120 }} />
            </label>
          </fieldset>
        );
      })}
      <div className={ui.dact}>
        <Button variant="primary" disabled={!dirty || write.isPending} onClick={() => save(draft)}>Kaydet</Button>
        <Button disabled={!view.customized || write.isPending} onClick={() => save(null)}>Varsayılana dön</Button>
      </div>
      <Try draft={draft} />
    </>
  );
}

/** Taslak sorularla bir metni dener; kaydetmez, kayıt akışına yazmaz. */
function Try({ draft }: { draft: QualityConfig }) {
  const t = useQualityTry();
  const [kind, setKind] = useState<"entry" | "closing">("entry");
  const [text, setText] = useState(EXAMPLE.entry);
  const [res, setRes] = useState<Quality | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const pick = (k: "entry" | "closing") => {
    setKind(k);
    setText(EXAMPLE[k]);
    setRes(null);
  };
  const names = QUESTIONS.filter((x) => x.kind === kind);
  return (
    <section>
      <h3>Dene</h3>
      <p className={ui.fieldHint}>
        Yukarıdaki (kaydedilmemiş olanlar dahil) sorularla bir metni modele sor. Metin kapıyla aynı biçimde gider;
        gerçek kişi adı/telefon yazma.
      </p>
      <Segmented label="Deneme türü" value={kind} onChange={pick}
        options={[{ value: "entry", label: "Kayıt / etkinlik" }, { value: "closing", label: "Kapanış notu" }]} />
      <textarea className={ui.input} rows={4} value={text} onChange={(e) => setText(e.target.value)} aria-label="Denenecek metin" />
      <div className={ui.dact}>
        <Button disabled={t.isPending || text.trim() === ""} onClick={() => {
          setErr(null);
          t.mutate({ kind, state: text, config: draft }, { onSuccess: setRes, onError: (x) => setErr(errorText(x)) });
        }}>{t.isPending ? "Soruluyor…" : "Dene"}</Button>
      </div>
      {err !== null && <p className={ui.error} role="alert">{err}</p>}
      {res !== null && (
        <div>
          <p>
            <strong>{res.outcome === "pass" ? "Geçer" : res.outcome === "low" ? "Reddedilir" : "Atlandı (servis kapalı ya da yanıt yok)"}</strong>
            {res.model !== undefined && <span className={ui.fieldHint}> · {res.model}{res.provider !== undefined ? ` / ${res.provider}` : ""}</span>}
          </p>
          {res.answers !== undefined && (
            <ul>
              {names.map((n) => {
                const p = res.answers?.[n.key]?.noul;
                const min = draft.questions[n.key]?.min;
                return (
                  <li key={n.key}>
                    {n.title}: <strong>{p === undefined ? "—" : p.toFixed(2)}</strong>
                    {min !== undefined && p !== undefined && <span className={ui.fieldHint}> (eşik {min.toFixed(2)} → {p < min ? "zayıf" : "yeterli"})</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
