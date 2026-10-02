#!/usr/bin/env python3
"""OTF (FORM.GN.05) taslagini Rust'in dolduracagi sablona cevirir.

Universitenin taslagindaki 56 icerik denetiminin (w:sdt) hicbirinde etiket yok.
Bu arac her denetime, ONUNDEKI yaziyi dogrulayarak, `w:tag` olarak bir anahtar
ekler; metin denetimlerinin yer tutucusunu `{{anahtar}}` yapar. Rust
(`backend/src/otf.rs`) yalniz bu iki isareti tanir.

Yalniz gelistirmede (Mac) kosar; yayinda Python yok. Universite taslagi
degisince (yeni Surum) yeniden kosulur; etiket eslesmezse DURUR — sessizce
yanlis kutuya isaret koymaktansa.

    python3 backend/tools/otf_template.py "OTF TASLAK 2026 .docx"

Anahtar listesi `backend/src/otf.rs` ile AYNI sirada; biri degisirse oteki de.
"""

import re
import sys
import zipfile
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "assets" / "otf.docx"

# (anahtar, denetimin onundeki yazinin icermesi gereken parca). Belge sirasi.
TEXT, BOX = "text", "box"
FIELDS = [
    (TEXT, "club", "KULÜP/BÖLÜM"),
    (TEXT, "name_purpose", "ADI, AMACI"),
    (TEXT, "date", "TARİHİ"),
    (TEXT, "time", "BİTİŞ SAATİ"),
    (TEXT, "place", "YERİ"),
    (TEXT, "advisor", "DANIŞMAN"),
    (TEXT, "attendees", "KATILIMCI SAYISI"),
    (TEXT, "age_group", "YAŞ GRUBU"),
    (TEXT, "outcomes", "KAZANIMLAR"),
    (BOX, "layout_u", "U DÜZEN"),
    (BOX, "layout_class", "SINIF DÜZENİ"),
    (BOX, "layout_open_air", "AÇIK HAVA"),
    (BOX, "layout_cinema", "SİNEMA"),
    (TEXT, "layout_notes", "AÇIKLAMA"),
    (BOX, "av_projector", "PROJEKSIYON"),
    (BOX, "av_screen", "PERDE"),
    (BOX, "av_camera", "KAMERA KAYIT"),
    (BOX, "av_speaker", "HOPARLÖR"),
    (BOX, "av_mic_hand", "MİKROFON (EL)"),
    (BOX, "av_concert", "KONSER"),
    (BOX, "av_mic_lapel", "MİKROFON (YAKA)"),
    (BOX, "av_music", "MÜZİK YAYINI"),
    (BOX, "av_mic_podium", "MİKROFON (KÜRSÜ)"),
    (BOX, "av_staff", "TEKNİK ELEMAN"),
    (TEXT, "av_notes", "AÇIKLAMA"),
    (BOX, "tech_power", "ELEKTRİK"),
    (BOX, "tech_lighting", "AYDINLATMA"),
    (BOX, "tech_irrigation", "SULAMA"),
    (BOX, "tech_staff", "TEKNİK ELEMAN"),
    (BOX, "tech_hvac", "İKLİMLENDİRME"),
    (BOX, "tech_other", "DİĞER"),
    (TEXT, "tech_notes", "AÇIKLAMA"),
    (BOX, "host_coffee", "KAHVE"),
    (BOX, "host_campus", "KAMPÜS İŞLETMELERİ"),
    (BOX, "host_dining", "YEMEKHANE"),
    (TEXT, "host_notes", "AÇIKLAMA"),
    (BOX, "care_cleaning", "TEMİZLİK"),
    (BOX, "care_furniture", "MOBİLYA"),
    (BOX, "care_pest", "İLAÇLAMA"),
    (BOX, "care_flipchart", "FLIP CHART"),
    (BOX, "care_visual", "GÖRSEL MATERYAL"),
    (BOX, "care_other", "DİĞER"),
    (TEXT, "care_notes", "AÇIKLAMA"),
    (BOX, "other_sports", "SPOR MERKEZİ"),
    (BOX, "other_security", "GÜVENLİK"),
    (BOX, "other_lodging", "KONAKLAMA"),
    (BOX, "other_parking", "OTOPARK"),
    (BOX, "other_transport", "ULAŞIM"),
    (BOX, "other_other", "DİĞER"),
    (TEXT, "other_notes", "AÇIKLAMA"),
    (TEXT, "contact1_name", "Ad Soyad"),
    (TEXT, "contact1_phone", "Tel"),
    (TEXT, "contact2_name", "Ad Soyad"),
    (TEXT, "contact2_phone", "Tel"),
    (TEXT, "contact3_name", "Ad Soyad"),
    (TEXT, "contact3_phone", "Tel"),
]

SDT = re.compile(r"<w:sdt>.*?</w:sdt>", re.S)
TEXT_RUN = re.compile(r"<w:t(?: [^>]*)?>([^<]*)</w:t>")
PLACEHOLDER = "Click or tap here to enter text."


def label_before(xml: str, end: int) -> str:
    """Denetimden onceki son ~300 karakterlik gorunur yazi."""
    return "".join(TEXT_RUN.findall(xml[max(0, end - 6000):end]))[-300:]


def convert(xml: str) -> str:
    sdts = list(SDT.finditer(xml))
    if len(sdts) != len(FIELDS):
        sys.exit(f"denetim sayisi {len(sdts)}, beklenen {len(FIELDS)} — taslak degismis, FIELDS'i guncelle")
    out, last = [], 0
    for m, (kind, key, label) in zip(sdts, FIELDS):
        s = m.group(0)
        before = label_before(xml, m.start())
        if label not in before:
            sys.exit(f"{key}: onundeki yazida {label!r} yok: ...{before[-80:]!r}")
        is_box = "<w14:checkbox>" in s
        if is_box != (kind == BOX):
            sys.exit(f"{key}: denetim turu {'kutu' if is_box else 'metin'}, beklenen {kind}")
        s = s.replace("<w:sdtPr>", f'<w:sdtPr><w:tag w:val="{key}"/>', 1)
        if kind == TEXT:
            if s.count(PLACEHOLDER) != 1:
                sys.exit(f"{key}: yer tutucu metni bulunamadi")
            # Yer tutucu gri stili ve "yer tutucu gosteriliyor" bayragi gider:
            # doldurulan deger normal yazi gibi gorunsun.
            s = s.replace("<w:showingPlcHdr/>", "")
            s = s.replace('<w:rStyle w:val="YerTutucuMetni"/>', "")
            s = s.replace(f"<w:t>{PLACEHOLDER}</w:t>", f'<w:t xml:space="preserve">{{{{{key}}}}}</w:t>')
        out.append(xml[last:m.start()])
        out.append(s)
        last = m.end()
    out.append(xml[last:])
    return "".join(out)


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    src = Path(sys.argv[1])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "word/document.xml":
                data = convert(data.decode("utf-8")).encode("utf-8")
            zout.writestr(item, data)
    print(f"yazildi: {OUT} ({len(FIELDS)} denetim)")


if __name__ == "__main__":
    main()
