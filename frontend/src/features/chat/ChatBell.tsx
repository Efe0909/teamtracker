// Sohbet/kayit basina bildirim secimi (WhatsApp gibi): "Varsayilan" ozel secimi
// kaldirir, digerleri varsayilani ezer. Sunucu tek kapida karar verir
// (backend push::decide).

import { errorText } from "../../api/client";
import { useNotifyPrefs, useSetChatPref } from "../../api/hooks";
import type { NotifyLevel, Uuid } from "../../api/types";
import { NOTIFY } from "../../lib/labels";
import { IconButton, Menu, MenuItem, MenuLabel, MenuSep, useToast } from "../../ui/ui";

const tick = (on: boolean) => (on ? { icon: "check" as const } : {});

export function ChatBell({ chatId }: { chatId: Uuid }) {
  const prefs = useNotifyPrefs();
  const set = useSetChatPref(chatId);
  const toast = useToast();
  if (prefs.data === undefined) return null;
  const own = prefs.data.chats[chatId] ?? null;
  const effective = own ?? prefs.data.level;
  const pick = (m: NotifyLevel | null) => set.mutate(m, { onError: (e) => toast({ text: errorText(e), error: true }) });
  return (
    <span style={{ marginLeft: "auto" }}>
      <Menu align="end" trigger={
        <IconButton icon={effective === "none" ? "bellOff" : "bell"} label={`Bildirim: ${NOTIFY[effective].short}`} />
      }>
        <MenuLabel>Bu sohbetin bildirimleri</MenuLabel>
        <MenuItem {...tick(own === null)} onSelect={() => pick(null)}
          hint={NOTIFY[prefs.data.level].short}>
          Varsayılan
        </MenuItem>
        <MenuSep />
        {(Object.keys(NOTIFY) as NotifyLevel[]).map((m) => (
          <MenuItem key={m} {...tick(own === m)} onSelect={() => pick(m)}>
            {NOTIFY[m].label}
          </MenuItem>
        ))}
      </Menu>
    </span>
  );
}
