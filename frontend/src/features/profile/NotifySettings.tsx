// Bildirim varsayilanlari: kademe + sessiz saat. Sohbet basina ozel secim
// sohbetin kendi zil menusunden (`features/chat/ChatBell.tsx`).

import { useEffect, useState } from "react";
import { errorText } from "../../api/client";
import { useNotifyPrefs, usePatchNotifyPrefs } from "../../api/hooks";
import type { NotifyLevel } from "../../api/types";
import { NOTIFY } from "../../lib/labels";
import { useLookup } from "../../lib/lookup";
import { disablePush, enablePush, pushState, type PushState } from "../../lib/push";
import { Button, Choices, Dialog, ui, useToast } from "../../ui/ui";

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

export function NotifySettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const q = useNotifyPrefs();
  const L = useLookup();
  const m = usePatchNotifyPrefs();
  const toast = useToast();
  const fail = (e: unknown) => toast({ text: errorText(e), error: true });
  const p = q.data;
  const [device, setDevice] = useState<PushState>("unsupported");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) void pushState().then(setDevice);
  }, [open]);
  const toggleDevice = () => {
    setBusy(true);
    (device === "on" ? disablePush() : enablePush())
      .then(() => pushState().then(setDevice))
      .catch((e: unknown) => {
        const m = e instanceof Error ? e.message : "";
        toast({
          text: m === "push_disabled" ? "Sunucuda anlık bildirim henüz kurulu değil."
            : m === "permission_denied" ? "Bildirim izni verilmedi. Tarayıcı ayarlarından açabilirsin."
            : errorText(e),
          error: true,
        });
        void pushState().then(setDevice);
      })
      .finally(() => setBusy(false));
  };
  const quiet = p !== undefined && p.quiet_start !== null && p.quiet_end !== null;
  return (
    <Dialog open={open} onClose={onClose} title="Bildirimler"
      hint="Varsayılan seçimin. Bir sohbette farklı istersen, o sohbetin zil simgesinden ayrıca seç.">
      {p === undefined ? null : (
        <div className={ui.formStack}>
          <Choices<NotifyLevel> current={p.level} busy={m.isPending}
            options={(Object.keys(NOTIFY) as NotifyLevel[]).map((v) => ({ value: v, label: NOTIFY[v].label }))}
            onPick={(level) => m.mutate({ level }, { onError: fail })} />
          {L.meta.external_off?.includes("push") && <p className={ui.fieldHint}>Anlık bildirim servisi kapalı</p>}
          <fieldset className={ui.field}>
            <legend>Bu cihaz <span className={ui.fieldHint}>— anlık bildirim yalnız izin verdiğin cihazlara gider</span></legend>
            {device === "unsupported" ? (
              <span className={ui.fieldHint}>
                Bu tarayıcı anlık bildirimi desteklemiyor. iPhone'da önce Paylaş → Ana Ekrana Ekle, sonra uygulamayı ana ekrandan aç.
              </span>
            ) : device === "denied" ? (
              <span className={ui.fieldHint}>Tarayıcıda bildirim engelli; site ayarlarından izin ver.</span>
            ) : (
              <Button onClick={toggleDevice} disabled={busy}>
                {device === "on" ? "Bu cihazda bildirimi kapat" : "Bu cihazda bildirimi aç"}
              </Button>
            )}
          </fieldset>
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
