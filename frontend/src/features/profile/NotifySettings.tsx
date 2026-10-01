// Bildirim varsayilanlari: kademe + sessiz saat. Sohbet basina ozel secim
// sohbetin kendi zil menusunden (`features/chat/ChatBell.tsx`).

import { errorText } from "../../api/client";
import { useNotifyPrefs, usePatchNotifyPrefs } from "../../api/hooks";
import type { NotifyLevel } from "../../api/types";
import { NOTIFY } from "../../lib/labels";
import { Choices, Dialog, ui, useToast } from "../../ui/ui";

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

export function NotifySettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const q = useNotifyPrefs();
  const m = usePatchNotifyPrefs();
  const toast = useToast();
  const fail = (e: unknown) => toast({ text: errorText(e), error: true });
  const p = q.data;
  const quiet = p !== undefined && p.quiet_start !== null && p.quiet_end !== null;
  return (
    <Dialog open={open} onClose={onClose} title="Bildirimler"
      hint="Varsayılan seçimin. Bir sohbette farklı istersen, o sohbetin zil simgesinden ayrıca seç.">
      {p === undefined ? null : (
        <div className={ui.formStack}>
          <Choices<NotifyLevel> current={p.level} busy={m.isPending}
            options={(Object.keys(NOTIFY) as NotifyLevel[]).map((v) => ({ value: v, label: NOTIFY[v].label }))}
            onPick={(level) => m.mutate({ level }, { onError: fail })} />
          <fieldset className={ui.field}>
            <legend>Sessiz saat <span className={ui.fieldHint}>— yalnız anlık bildirimi susturur, liste yine dolar</span></legend>
            <label className={ui.check}>
              <input type="checkbox" checked={quiet} disabled={m.isPending}
                onChange={(e) => m.mutate(e.target.checked ? { quiet_start: 22, quiet_end: 7 } : { quiet_start: null, quiet_end: null },
                  { onError: fail })} />
              Sessiz saat kullan
            </label>
            {quiet && (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <select className={ui.input} aria-label="Başlangıç" value={p.quiet_start ?? 22}
                  onChange={(e) => m.mutate({ quiet_start: Number(e.target.value), quiet_end: p.quiet_end ?? 7 }, { onError: fail })}>
                  {HOURS.map((h) => <option key={h} value={h}>{hh(h)}</option>)}
                </select>
                <span>–</span>
                <select className={ui.input} aria-label="Bitiş" value={p.quiet_end ?? 7}
                  onChange={(e) => m.mutate({ quiet_start: p.quiet_start ?? 22, quiet_end: Number(e.target.value) }, { onError: fail })}>
                  {HOURS.map((h) => <option key={h} value={h}>{hh(h)}</option>)}
                </select>
              </div>
            )}
          </fieldset>
        </div>
      )}
    </Dialog>
  );
}
