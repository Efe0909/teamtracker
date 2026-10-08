// Aciklama yerinde duzenlenir: okunan blok markdown editorle yer degistirir, dialog yok.
// Kayit ve etkinlik ayni bilesen; kaydetmeyi cagiran taraf verir.

import { useState } from "react";
import { ApiError, errorText } from "../../api/client";
import { MarkdownField, MarkdownText } from "../../ui/MarkdownField";
import { Icon } from "../../ui/icons";
import { Button, cx, ui } from "../../ui/ui";
import { QualityNote } from "./QualityNote";
import s from "./record.module.css";

const QUALITY_LABEL: Record<string, string> = { specific: "somut iş veya sonuç", context: "ekip için yeterli bağlam" };

export function InlineDescription({ value, canEdit, bypassQuality, save }: {
  value: string | null;
  canEdit: boolean;
  bypassQuality: boolean;
  /** Bos metin null olarak gider. Kalite reddinde ApiError (low_quality) firlatmali.
   *  `base`: duzenleme ACILDIGINDA gorulen metin; alan arada degistiyse sunucu 409
   *  `stale_field` doner. Desteklemeyen kaydedici (etkinlik) yok sayar. */
  save: (description: string | null, quality_override: boolean, base: string | null) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState("");
  const [opened, setOpened] = useState<string | null>(null);
  // 409'dan sonra kullanici guncel metni gordu: bilerek ustune yazar (taban = guncel).
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [qualityReasons, setQualityReasons] = useState<string[] | null>(null);
  const current = value ?? "";
  const len = Array.from(v.trim()).length;
  const valid = v.trim() !== "" && (bypassQuality || len >= 30 || v.trim() === current);

  const open = () => {
    setV(current);
    setOpened(value);
    setStale(false);
    setErr(null);
    setQualityReasons(null);
    setEditing(true);
  };

  const submit = async (quality_override = false) => {
    setBusy(true);
    setErr(null);
    try {
      await save(v.trim() === "" ? null : v, quality_override, stale ? value : opened);
      setQualityReasons(null);
      setEditing(false);
    } catch (x) {
      if (x instanceof ApiError && x.code === "low_quality") setQualityReasons(x.reasons);
      else {
        setStale(x instanceof ApiError && x.code === "stale_field");
        setErr(errorText(x));
      }
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <>
        {value !== null ? <MarkdownText value={value} className={s.desc} /> : <p className={cx(s.desc, s.descEmpty)}>Açıklama yok.</p>}
        {canEdit && (
          <button type="button" className={s.editLink} onClick={open}>
            <Icon name="edit" size={13} /> {value === null ? "Açıklama ekle" : "Açıklamayı düzenle"}
          </button>
        )}
      </>
    );
  }

  return (
    <form className={ui.formStack} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <MarkdownField value={v} onChange={setV} label="Açıklama" rows={6} placeholder="Ne oldu, nerede, ne zaman?" />
      {err !== null && <p className={ui.error} role="alert">{err}</p>}
      {stale && (
        <div>
          <small className={ui.fieldHint}>Güncel hâli:</small>
          <MarkdownText value={value ?? "(boş)"} className={s.desc} />
        </div>
      )}
      {qualityReasons !== null && (
        <div role="alert">
          <p>Metin bazı ölçütlerde zayıf bulundu: {qualityReasons.map((r) => QUALITY_LABEL[r] ?? r).join(", ")}.</p>
          <div className={ui.dact}>
            <Button onClick={() => setQualityReasons(null)}>Düzenle</Button>
            <Button variant="primary" disabled={busy} onClick={() => void submit(true)}>Yine de gönder</Button>
          </div>
        </div>
      )}
      <small className={ui.fieldHint}>{len}{bypassQuality ? " karakter" : "/30 karakter"}</small>
      {!bypassQuality && <QualityNote />}
      <div className={ui.dact}>
        <Button onClick={() => setEditing(false)}>Vazgeç</Button>
        <Button type="submit" variant="primary" aria-busy={busy} disabled={busy || !valid}>
          {busy ? "Kaydediliyor…" : stale ? "Yine de kaydet" : "Kaydet"}
        </Button>
      </div>
    </form>
  );
}
