// Kalici silme dugmesi (`delete_records`): onay penceresi, geri donus yok.
// Kapsami olmayana hic gorunmez. Gorev ve etkinlik sayfasi AYNI bileseni kullanir.

import { useState } from "react";
import { errorText } from "../../api/client";
import type { Uuid } from "../../api/types";
import { useLookup } from "../../lib/lookup";
import { Button, Dialog, IconButton, ui } from "../../ui/ui";
import { useDeleteRecord } from "../../api/hooks";

export function DeleteButton(props: { kind: "records" | "events"; id: Uuid; title: string; consequence: string; onDeleted: () => void }) {
  const L = useLookup();
  const del = useDeleteRecord(props.kind);
  const [open, setOpen] = useState(false);
  if (!L.can("delete_records")) return null;
  const what = props.kind === "events" ? "etkinliği" : "görevi";
  return (
    <>
      <IconButton icon="trash" label={`${props.kind === "events" ? "Etkinliği" : "Görevi"} sil`} onClick={() => setOpen(true)} />
      <Dialog open={open} onClose={() => setOpen(false)} title={`${props.kind === "events" ? "Etkinlik" : "Görev"} silinsin mi?`}>
        <div className={ui.formStack}>
          <p><b>{props.title}</b> {what} kalıcı olarak sileceksin. {props.consequence} Bu işlem geri alınamaz.</p>
          {del.isError && <p className={ui.error} role="alert">{errorText(del.error)}</p>}
          <div className={ui.dact}>
            <Button onClick={() => setOpen(false)}>Vazgeç</Button>
            <Button variant="danger" disabled={del.isPending}
              onClick={() => del.mutate(props.id, { onSuccess: () => { setOpen(false); props.onDeleted(); } })}>
              Kalıcı sil
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
