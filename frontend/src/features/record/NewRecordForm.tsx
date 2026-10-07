// Yeni kayit formu — masaustu dialogu ve mobil sayfasi AYNI formu cizer.
// Dil: buyuk cercevesiz baslik + aciklama, altinda ozellik cipleri (tur,
// oncelik, konu, takim, sorumlu, pillar). Kutu yigini yok.

import { useState } from "react";
import { ApiError, errorText } from "../../api/client";
import { useCreateRecord } from "../../api/hooks";
import type { AccessMode, Priority, RecordKind, Uuid } from "../../api/types";
import { CARD, CARD_TYPES, type CardType } from "../../lib/cards";
import { KIND, PRIORITY, PRIORITY_ORDER } from "../../lib/labels";
import { useLookup } from "../../lib/lookup";
import { Icon } from "../../ui/icons";
import { Button, Dialog, Picker, PriorityTag, TeamName, ui, Who } from "../../ui/ui";
import { NodeTreePicker, useNodesOf } from "../nodes/NodePicker";
import { ACCESS } from "./Join";
import { QualityNote } from "./QualityNote";
import { MarkdownField } from "../../ui/MarkdownField";
import s from "./form.module.css";

export function NewRecordForm(props: {
  onCreated: (id: Uuid) => void;
  onCancel?: () => void;
  defaults?: { team_id?: Uuid; unit_id?: Uuid; pillar_id?: Uuid };
}) {
  const L = useLookup();
  const m = useCreateRecord();
  const [err, setErr] = useState<string | null>(null);
  const [kind, setKind] = useState<RecordKind>("issue");
  const [title, setTitle] = useState("");
  const units = useNodesOf("units");
  const [unit, setUnit] = useState<string>(props.defaults?.unit_id ?? units[0]?.id ?? "");
  const [team, setTeam] = useState<string | null>(props.defaults?.team_id ?? null);
  const [pillar, setPillar] = useState<string | null>(props.defaults?.pillar_id ?? null);
  const [cards, setCards] = useState<CardType[]>([]);
  // Sorumlu varsayilani ACAN kisi; bos secim "sorumlusuz ac" demek.
  const [owner, setOwner] = useState<string | null>(L.me.id);
  const [priority, setPriority] = useState<Priority>("medium");
  const [desc, setDesc] = useState("");
  const [access, setAccess] = useState<AccessMode>("public");
  const [qualityReasons, setQualityReasons] = useState<string[] | null>(null);
  const bypassQuality = L.can("bypass_text_quality");
  const submit = (quality_override = false) => m.mutate(
    {
      kind, title, description: desc.trim() === "" ? null : desc,
      unit_id: unit, team_id: team, pillar_id: pillar, owner_id: owner,
      priority, card_types: cards, access_mode: access, quality_override,
    },
    {
      onSuccess: (r) => props.onCreated(r.id),
      onError: (x) => x instanceof ApiError && x.code === "low_quality"
        ? setQualityReasons(x.reasons) : setErr(errorText(x)),
    },
  );

  return (
    <form
      className={ui.formStack}
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        submit();
      }}
    >
      {err !== null && <p className={ui.error} role="alert">{err}</p>}
      <div className={s.doc}>
        <input className={ui.titleInput} value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder="Başlık — kısa ve aranabilir" required maxLength={200} autoFocus aria-label="Başlık" />
        <small className={ui.fieldHint}>{Array.from(title.trim()).length}{bypassQuality ? " karakter" : "/5 karakter"}</small>
        <MarkdownField value={desc} onChange={setDesc} label="Açıklama"
          placeholder="Açıklama: ne yapılacak, neden, kim için?" rows={4} />
        <small className={ui.fieldHint}>{desc.trim().length}{bypassQuality ? " karakter" : "/30 karakter"}</small>
      </div>
      {!bypassQuality && <QualityNote />}

      <div className={s.chips} role="group" aria-label="Özellikler">
        <Picker look="chip" active label="Tür" value={kind} onChange={setKind}
          options={[
            { value: "issue", label: KIND.issue, hint: "bir şey ters gitti" },
            { value: "task", label: KIND.task, hint: "yapılacak iş" },
          ]}>
          <Icon name="inbox" size={13} /> {KIND[kind]}
        </Picker>
        <Picker look="chip" active label="Öncelik" value={priority} onChange={setPriority}
          options={PRIORITY_ORDER.map((v) => ({ value: v, label: PRIORITY[v], render: <PriorityTag priority={v} bare /> }))}>
          <PriorityTag priority={priority} bare />
        </Picker>
        <NodeTreePicker rootKey="units" look="chip" label="Konu" value={unit === "" ? null : unit} onChange={setUnit}>
          <Icon name="tree" size={13} /> {L.node(unit)?.name ?? "Konu seç"}
        </NodeTreePicker>
        <Picker look="chip" active label="Sorumlu" value={owner} onChange={setOwner}
          options={[
            { value: null, label: "Sorumlusuz" },
            ...L.meta.users.map((u) => ({ value: u.id as string | null, label: u.name, render: <Who user={u} />, ...(u.id === L.me.id ? { hint: "sen" } : {}) })),
          ]}>
          <Who user={L.user(owner)} empty="Sorumlusuz" size={16} />
        </Picker>
        <Picker look="chip" active={team !== null} label="Takım" value={team} onChange={setTeam}
          options={[
            { value: null, label: "Takım yok" },
            ...L.plainTeams.map((t) => ({ value: t.id as string | null, label: t.name, render: <TeamName team={t} /> })),
          ]}>
          {team === null ? <><Icon name="plus" size={13} /> Takım</> : <TeamName team={L.team(team)} />}
        </Picker>
        <Picker look="chip" active={access !== "public"} label="Erişim" value={access} onChange={setAccess}
          options={(Object.keys(ACCESS) as AccessMode[]).map((v) => ({ value: v, label: ACCESS[v].label, desc: ACCESS[v].hint }))}>
          <Icon name="lock" size={13} /> {ACCESS[access].label}
        </Picker>
        {/* Pillar ORTOGONAL (KNOW-261): kaydin atasi olmak zorunda degil, ayri secilir. */}
        {L.pillars.length > 0 && (
          <Picker look="chip" active={pillar !== null} label="Pillar" value={pillar} onChange={setPillar}
            options={[{ value: null, label: "Pillar yok" }, ...L.pillars.map((n) => ({ value: n.id as string | null, label: n.name }))]}>
            {pillar === null ? <><Icon name="plus" size={13} /> Pillar</> : <><Icon name="pin" size={13} /> {L.pillar(pillar)?.name}</>}
          </Picker>
        )}
      </div>

      {/* Kart bloklari (R4-F12): bos acilir, kayit sayfasinda doldurulur. */}
      <fieldset className={s.cards}>
        <legend>Kart blokları <span className={ui.fieldHint}>— isteğe bağlı, sonra da eklenir</span></legend>
        <div className={s.cardGrid}>
          {CARD_TYPES.filter((t) => t !== "poll").map((t) => (
            <label key={t} className={s.cardOpt}>
              <input type="checkbox" checked={cards.includes(t)}
                onChange={() => setCards((xs) => (xs.includes(t) ? xs.filter((x) => x !== t) : [...xs, t]))} />
              <Icon name={CARD[t].icon} size={16} />
              <span>
                {CARD[t].label}
                <small>{CARD[t].hint}</small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className={`${ui.dact} ${s.foot}`}>
        {props.onCancel !== undefined && <Button onClick={props.onCancel}>Vazgeç</Button>}
        <Button type="submit" variant="primary" big aria-busy={m.isPending}
          disabled={m.isPending || (!bypassQuality && (Array.from(title.trim()).length < 5 || Array.from(desc.trim()).length < 30)) || title.trim() === "" || desc.trim() === "" || unit === ""}>
          {m.isPending ? "Açılıyor…" : "Kaydı aç"}
        </Button>
      </div>
      <Dialog open={qualityReasons !== null} onClose={() => setQualityReasons(null)} title="Kalite kontrolü uyarısı">
        <p>Metin bazı ölçütlerde zayıf bulundu: {(qualityReasons ?? []).map((r) => ({
          specific: "somut iş veya sonuç", context: "ekip için yeterli bağlam", closing_justified: "kapanış gerekçesi",
        }[r] ?? r)).join(", ")}.</p>
        <div className={ui.dact}>
          <Button onClick={() => setQualityReasons(null)}>Düzenle</Button>
          <Button variant="primary" disabled={m.isPending} onClick={() => { setQualityReasons(null); submit(true); }}>Yine de gönder</Button>
        </div>
      </Dialog>
    </form>
  );
}
