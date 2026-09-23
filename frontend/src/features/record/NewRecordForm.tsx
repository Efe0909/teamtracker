// Yeni kayit formu — masaustu dialogu ve mobil sayfasi AYNI formu cizer.

import { useState } from "react";
import { errorText } from "../../api/client";
import { useCreateRecord } from "../../api/hooks";
import type { Priority, RecordKind, Uuid } from "../../api/types";
import { PRIORITY, PRIORITY_ORDER } from "../../lib/labels";
import { useLookup } from "../../lib/lookup";
import { Button, ui } from "../../ui/ui";

export function NewRecordForm(props: {
  onCreated: (id: Uuid) => void;
  onCancel?: () => void;
  defaults?: { team_id?: Uuid; unit_id?: Uuid };
}) {
  const L = useLookup();
  const m = useCreateRecord();
  const [err, setErr] = useState<string | null>(null);
  const [kind, setKind] = useState<RecordKind>("issue");
  const [title, setTitle] = useState("");
  const [unit, setUnit] = useState<string>(props.defaults?.unit_id ?? L.units[0]?.id ?? "");
  const [team, setTeam] = useState<string>(props.defaults?.team_id ?? "");
  const [pillar, setPillar] = useState("");
  // Sorumlu varsayilani ACAN kisi; bos secim "sorumlusuz ac" demek.
  const [owner, setOwner] = useState<string>(L.me.id);
  const [priority, setPriority] = useState<Priority>("medium");
  const [desc, setDesc] = useState("");

  return (
    <form
      className={ui.formStack}
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        m.mutate(
          {
            kind,
            title,
            description: desc.trim() === "" ? null : desc,
            unit_id: unit,
            team_id: team === "" ? null : team,
            pillar_id: pillar === "" ? null : pillar,
            owner_id: owner === "" ? null : owner,
            priority,
          },
          { onSuccess: (r) => props.onCreated(r.id), onError: (x) => setErr(errorText(x)) },
        );
      }}
    >
      {err !== null && <p className={ui.error} role="alert">{err}</p>}
      <label className={ui.field}>
        Başlık
        <input className={ui.input} value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder="Kısa ve aranabilir bir başlık" required maxLength={200} autoFocus />
      </label>
      <div className={ui.grid2}>
        <label className={ui.field}>
          Tür
          <select className={ui.input} value={kind} onChange={(e) => setKind(e.target.value as RecordKind)}>
            <option value="issue">Hata — bir şey ters gitti</option>
            <option value="task">Görev — yapılacak iş</option>
          </select>
        </label>
        <label className={ui.field}>
          Öncelik
          <select className={ui.input} value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            {PRIORITY_ORDER.map((p) => (
              <option key={p} value={p}>{PRIORITY[p]}</option>
            ))}
          </select>
        </label>
      </div>
      <label className={ui.field}>
        Birim
        <select className={ui.input} value={unit} onChange={(e) => setUnit(e.target.value)} required>
          {L.units.map((n) => (
            <option key={n.id} value={n.id}>
              {"  ".repeat(n.depth)}{n.name}
            </option>
          ))}
        </select>
      </label>
      {/* Pillar ORTOGONAL (KNOW-261): kaydin atasi olmak zorunda degil, ayri secilir. */}
      {L.pillars.length > 0 && (
        <label className={ui.field}>
          Pillar
          <select className={ui.input} value={pillar} onChange={(e) => setPillar(e.target.value)}>
            <option value="">Pillar yok</option>
            {L.pillars.map((n) => (
              <option key={n.id} value={n.id}>{n.name}</option>
            ))}
          </select>
        </label>
      )}
      <div className={ui.grid2}>
        <label className={ui.field}>
          Takım
          <select className={ui.input} value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="">Takım yok</option>
            {L.meta.teams.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </label>
        <label className={ui.field}>
          Sorumlu
          <select className={ui.input} value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">Sorumlusuz</option>
            {L.meta.users.map((u) => (
              <option key={u.id} value={u.id}>{u.id === L.me.id ? `${u.name} (sen)` : u.name}</option>
            ))}
          </select>
        </label>
      </div>
      <label className={ui.field}>
        Açıklama
        <textarea className={ui.input} value={desc} onChange={(e) => setDesc(e.target.value)}
          placeholder="Ne oldu, nerede, ne zaman?" rows={4} />
      </label>
      <div className={ui.dact}>
        {props.onCancel !== undefined && <Button onClick={props.onCancel}>Vazgeç</Button>}
        <Button type="submit" variant="primary" big disabled={m.isPending || title.trim() === "" || unit === ""}>
          Kaydı aç
        </Button>
      </div>
    </form>
  );
}
