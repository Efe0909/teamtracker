// Metin alanlarinin altindaki tek not: kalite kontrolu kapaliysa bunu, aciksa
// kisisel veri uyarisini soyler (spec/76). Alti yerde ayni cumle tekrarlanmasin diye.

import { privacyUrl } from "../../api/session";
import { useLookup } from "../../lib/lookup";
import { ui } from "../../ui/ui";

export function QualityNote() {
  const off = useLookup().meta.external_off;
  if (off?.includes("decision")) {
    return <p className={ui.fieldHint}>Kalite kontrolü kapalı (dış servis devre dışı)</p>;
  }
  return (
    <p className={ui.fieldHint}>
      Lütfen telefon, e-posta, adres ya da kişi adı yazmamaya çalış. Metin kalite kontrolü için bir yapay zekâ
      modeline gider; kişisel veriler ona ulaşmadan maskelenir.{" "}
      <a href={privacyUrl()} target="_blank" rel="noreferrer">Ayrıntı</a>
    </p>
  );
}
