//! OTF (FORM.GN.05, "Organizasyon ve Etkinlik Talep Formu") doldurucu.
//!
//! Sablon `assets/otf.docx`: universitenin taslagi, `tools/otf_template.py`
//! ile her icerik denetimine `w:tag` eklenmis, metin denetimlerinde `{{anahtar}}`.
//! Burada yalniz iki islem var: `{{anahtar}}` -> deger, isaretli kutu -> ☒.
//! Python yayinda YOK; sablon binary'ye gomulu.
//!
//! Anahtarlar `tools/otf_template.py` FIELDS ile ayni; testler sablonda her
//! anahtarin bulundugunu dogrular — taslak degisip arac yeniden kosulmazsa
//! derleme degil test duser.

use std::io::{Cursor, Read, Write};

use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

static TEMPLATE: &[u8] = include_bytes!("../assets/otf.docx");

/// Kutulu bolum: kutular + bolumun AÇIKLAMA alani. Adetler aciklamaya yazilir
/// (taslak: "Ekipman ihtiyac adetlerini aciklamada belirtiniz").
pub struct Section {
    pub key: &'static str,
    pub label: &'static str,
    pub notes: &'static str,
    pub items: &'static [(&'static str, &'static str)],
}

pub const SECTIONS: &[Section] = &[
    Section { key: "layout", label: "Talep edilen düzen", notes: "layout_notes", items: &[
        ("layout_u", "U düzeni"), ("layout_class", "Sınıf düzeni"),
        ("layout_open_air", "Açık hava toplantı düzeni"), ("layout_cinema", "Sinema düzeni"),
    ] },
    Section { key: "av", label: "Ses ve görüntü sistemleri", notes: "av_notes", items: &[
        ("av_projector", "Projeksiyon"), ("av_screen", "Perde"), ("av_camera", "Kamera kayıt"),
        ("av_speaker", "Hoparlör"), ("av_mic_hand", "Mikrofon (el)"), ("av_concert", "Konser düzeni"),
        ("av_mic_lapel", "Mikrofon (yaka)"), ("av_music", "Müzik yayını"),
        ("av_mic_podium", "Mikrofon (kürsü)"), ("av_staff", "Teknik eleman desteği"),
    ] },
    Section { key: "tech", label: "Teknik hizmetler", notes: "tech_notes", items: &[
        ("tech_power", "Elektrik"), ("tech_lighting", "Aydınlatma"), ("tech_irrigation", "Sulama"),
        ("tech_staff", "Teknik eleman desteği"), ("tech_hvac", "İklimlendirme"), ("tech_other", "Diğer"),
    ] },
    Section { key: "host", label: "Ağırlama hizmetleri", notes: "host_notes", items: &[
        ("host_coffee", "Çay & kahve arası"), ("host_campus", "Kampüs işletmeleri"),
        ("host_dining", "Yemekhane kullanımı"),
    ] },
    Section { key: "care", label: "Temizlik ve taşıma", notes: "care_notes", items: &[
        ("care_cleaning", "Temizlik"), ("care_furniture", "Mobilya taşıma (koltuk, masa, şemsiye)"),
        ("care_pest", "İlaçlama"), ("care_flipchart", "Flip chart"),
        ("care_visual", "Görsel materyal (roll up, yönlendirme)"), ("care_other", "Diğer"),
    ] },
    Section { key: "other", label: "Diğer hizmetler", notes: "other_notes", items: &[
        ("other_sports", "Spor merkezi kullanımı"), ("other_security", "Güvenlik"),
        ("other_lodging", "Konaklama hizmeti"), ("other_parking", "Otopark hizmeti"),
        ("other_transport", "Ulaşım"), ("other_other", "Diğer"),
    ] },
];

/// Duz metin denetimleri (bolum aciklamalari haric).
pub const TEXT_KEYS: &[&str] = &[
    "club", "name_purpose", "date", "time", "place", "advisor", "attendees", "age_group", "outcomes",
    "contact1_name", "contact1_phone", "contact2_name", "contact2_phone", "contact3_name", "contact3_phone",
];

pub fn section_of(item: &str) -> Option<&'static Section> {
    SECTIONS.iter().find(|s| s.items.iter().any(|(k, _)| *k == item))
}

/// Word metni: XML kacisi, satir sonu `w:br`.
fn escape(v: &str) -> String {
    let mut out = String::with_capacity(v.len());
    for c in v.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\n' => out.push_str(r#"</w:t><w:br/><w:t xml:space="preserve">"#),
            '\r' => {}
            c => out.push(c),
        }
    }
    out
}

/// `text`: (anahtar, deger) — TEXT_KEYS ve bolum aciklamalari; verilmeyen bos
/// kalir. `checked`: isaretlenecek kutu anahtarlari.
pub fn render(text: &[(&str, String)], checked: &[&str]) -> Result<Vec<u8>, String> {
    let mut doc = document_xml()?;
    for (key, value) in text {
        doc = doc.replace(&format!("{{{{{key}}}}}"), &escape(value));
    }
    // Doldurulmayan metin denetimleri bos.
    for key in TEXT_KEYS.iter().copied().chain(SECTIONS.iter().map(|s| s.notes)) {
        doc = doc.replace(&format!("{{{{{key}}}}}"), "");
    }
    for key in checked {
        doc = check(&doc, key)?;
    }
    rezip(&doc)
}

fn document_xml() -> Result<String, String> {
    let mut zip = ZipArchive::new(Cursor::new(TEMPLATE)).map_err(|e| e.to_string())?;
    let mut f = zip.by_name("word/document.xml").map_err(|e| e.to_string())?;
    let mut s = String::new();
    f.read_to_string(&mut s).map_err(|e| e.to_string())?;
    Ok(s)
}

/// Etiketli kutu denetimini isaretler: `w14:checked` 1, gorunen ☐ -> ☒.
fn check(doc: &str, key: &str) -> Result<String, String> {
    let tag = format!(r#"<w:tag w:val="{key}"/>"#);
    let start = doc.find(&tag).ok_or_else(|| format!("sablonda kutu yok: {key}"))?;
    let end = start + doc[start..].find("</w:sdt>").ok_or("bozuk sdt")?;
    let sdt = doc[start..end]
        .replacen(r#"<w14:checked w14:val="0"/>"#, r#"<w14:checked w14:val="1"/>"#, 1)
        .replacen('☐', "☒", 1);
    Ok(format!("{}{}{}", &doc[..start], sdt, &doc[end..]))
}

fn rezip(doc: &str) -> Result<Vec<u8>, String> {
    let mut src = ZipArchive::new(Cursor::new(TEMPLATE)).map_err(|e| e.to_string())?;
    let mut out = ZipWriter::new(Cursor::new(Vec::new()));
    for i in 0..src.len() {
        let f = src.by_index(i).map_err(|e| e.to_string())?;
        if f.name() == "word/document.xml" {
            drop(f);
            out.start_file("word/document.xml", SimpleFileOptions::default().compression_method(CompressionMethod::Deflated))
                .map_err(|e| e.to_string())?;
            out.write_all(doc.as_bytes()).map_err(|e| e.to_string())?;
        } else {
            out.raw_copy_file(f).map_err(|e| e.to_string())?;
        }
    }
    Ok(out.finish().map_err(|e| e.to_string())?.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn template_has_every_key() {
        let doc = document_xml().unwrap_or_default();
        for key in TEXT_KEYS.iter().copied().chain(SECTIONS.iter().map(|s| s.notes)) {
            assert_eq!(doc.matches(&format!("{{{{{key}}}}}")).count(), 1, "metin: {key}");
        }
        for s in SECTIONS {
            for (key, _) in s.items {
                assert!(doc.contains(&format!(r#"<w:tag w:val="{key}"/>"#)), "kutu: {key}");
            }
        }
    }

    #[test]
    fn fills_text_and_boxes() {
        let bytes = render(&[("club", "A & B <x>".into()), ("outcomes", "bir\niki".into())], &["av_projector"])
            .unwrap_or_default();
        let mut zip = ZipArchive::new(Cursor::new(bytes)).expect("zip");
        let mut doc = String::new();
        zip.by_name("word/document.xml").expect("doc").read_to_string(&mut doc).expect("utf8");
        assert!(doc.contains("A &amp; B &lt;x&gt;"));
        assert!(doc.contains("bir</w:t><w:br/>"));
        assert!(!doc.contains("{{"));
        assert_eq!(doc.matches('☒').count(), 1);
        assert_eq!(doc.matches(r#"<w14:checked w14:val="1"/>"#).count(), 1);
    }
}
