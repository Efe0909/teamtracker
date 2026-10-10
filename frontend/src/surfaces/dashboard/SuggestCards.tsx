// Malzeme önerisi: kalem eklemenin yanında silik "hayalet" kartlar (spec/79 §9). Üzerine
// gelince ✓ kabul (kalem olur) / ✕ ret. Üçü de karara bağlanmadan sıradaki üçlü gelmez; yeni
// parti yalnız kullanıcı isteyince çekilir (her parti para harcar). Parti ve reddedilenler
// oturumda (sessionStorage) durur; sunucu durumsuzdur.

import { errorText } from "../../api/client";
import { eventOps, useMaterialSuggestions } from "../../api/hooks";
import type { MaterialSuggestion, Uuid } from "../../api/types";
import { PAGE, resolve, useSuggestStore, visible, withBatch } from "../../lib/suggestions";
import { Icon } from "../../ui/icons";
import { useToast } from "../../ui/ui";
import type { Run } from "./purchaseParts";
import s from "./purchases.module.css";

export function SuggestCards({ eventId, existing, run, busy }: {
  eventId: Uuid;
  /** Etkinliğin kalem adları: zaten eklenen öneri gösterilmez. */
  existing: string[];
  run: Run;
  busy: boolean;
}) {
  const [state, update] = useSuggestStore(eventId);
  const ask = useMaterialSuggestions(eventId);
  const toast = useToast();
  const shown = visible(state, existing);

  const fetchBatch = () =>
    ask.mutate(state.rejected, {
      onSuccess: (b) => {
        const before = visible(state, existing).length;
        const next = withBatch(state, b.items);
        update(() => next);
        if (visible(next, existing).length === before) toast({ text: "Yeni öneri çıkmadı.", error: false });
      },
      onError: (e) => toast({ text: errorText(e), error: true }),
    });

  const accept = (g: MaterialSuggestion) =>
    run(eventOps.addMaterial(eventId, g.name, g.description === "" ? undefined : g.description),
      () => update((st) => resolve(st, g.name, false)));
  const reject = (g: MaterialSuggestion) => update((st) => resolve(st, g.name, true));

  if (ask.isPending) {
    return (
      <div className={s.suggest} aria-busy="true" aria-label="Öneriler hazırlanıyor">
        {Array.from({ length: PAGE }, (_, i) => <div key={i} className={`${s.ghost} ${s.ghostWait}`} aria-hidden="true" />)}
      </div>
    );
  }
  if (shown.length === 0) {
    return (
      <button type="button" className={s.suggestAsk} onClick={fetchBatch}>
        <Icon name="sparkles" size={14} />
        {state.rejected.length > 0 ? "Yeni öneriler getir" : "Yapay zekâdan öneri al"}
      </button>
    );
  }
  return (
    <div className={s.suggest}>
      {shown.map((g) => (
        <div key={g.name} role="group" aria-label={`Öneri: ${g.name}`} className={s.ghost}>
          <div className={s.mcTop}>
            <span className={s.ghostMark} title="Yapay zekâ önerisi"><Icon name="sparkles" size={14} /></span>
            <span className={s.mcName}>{g.name}</span>
          </div>
          {g.description !== "" && <p className={s.ghostWhy}>{g.description}</p>}
          <span className={s.ghostActs}>
            <button type="button" className={s.ghostOk} disabled={busy} aria-label={`Kabul et: ${g.name}`}
              title="Kalem olarak ekle" onClick={() => accept(g)}>
              <Icon name="check" size={14} />
            </button>
            <button type="button" className={s.ghostNo} aria-label={`Reddet: ${g.name}`}
              title="Reddet" onClick={() => reject(g)}>
              <Icon name="x" size={14} />
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}
