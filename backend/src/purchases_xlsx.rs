//! Satin alim Excel dokumu. Sablon `assets/satin-alimlar.xlsx` (elle duzenlendi): "Satın alımlar"
//! sayfasi sutunlari A Malzeme · B Tür · C Adet · D Tedarikçi · E Toplam · F Birim fiyat ·
//! G Bütçe · H Kargo varış · I Not. Ayni dosyadaki "Mail özet" sayfasi bu sayfanin A, C, D, E
//! sutunlarini 5. satirdan okur (FILTER + toplam). Bu yuzden sayfada toplam satiri YOK ve veri
//! 5. satirdan bitisik yazilir: arada bos satir ya da "Toplam" etiketi ozeti bozar.
//! Sablondaki 4. satir (basliklar) ve veri disi satirlardaki bicimler oldugu gibi kalir.

use std::collections::BTreeMap;
use std::io::{Cursor, Read, Write};

use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

static TEMPLATE: &[u8] = include_bytes!("../assets/satin-alimlar.xlsx");
const SHEET: &str = "xl/worksheets/sheet1.xml";
const WORKBOOK: &str = "xl/workbook.xml";
/// Basliklar 4. satirda, veri 5. satirdan.
const FIRST_ROW: u32 = 5;

// Sablondaki stiller (cellXfs): 2 = baslik (kalin 14), 3 = metin, 7 = #,##0.00 beyaz zemin.
const S_TITLE: u8 = 2;
const S_TEXT: u8 = 3;
const S_MONEY: u8 = 7;
/// 8 = sablonun tarih bicimi (m/d/yy).
const S_DATE: u8 = 8;

/// Tek kalemin satiri. `None` alan hucre yazilmaz (Mail özet'te bos kalir).
pub struct Row {
    pub name: String,
    pub kind: String,
    pub qty: i32,
    pub supplier: String,
    pub total: Option<f64>,
    pub budget: Option<f64>,
    /// Kargo varis tarihi: Excel seri numarasi (1899-12-30'dan gun). Beklenen varis; teslim tarihi degil.
    pub arrival: Option<i64>,
    pub notes: String,
}

pub fn render(title: &str, summary: &str, rows: &[Row]) -> Result<Vec<u8>, String> {
    let mut src = ZipArchive::new(Cursor::new(TEMPLATE)).map_err(|e| e.to_string())?;
    let mut template_sheet = String::new();
    src.by_name(SHEET).map_err(|e| e.to_string())?
        .read_to_string(&mut template_sheet).map_err(|e| e.to_string())?;
    let sheet = fill(&template_sheet, title, summary, rows)?;

    let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let mut out = ZipWriter::new(Cursor::new(Vec::new()));
    for i in 0..src.len() {
        let mut f = src.by_index(i).map_err(|e| e.to_string())?;
        if f.name() == SHEET {
            drop(f);
            out.start_file(SHEET, opts).map_err(|e| e.to_string())?;
            out.write_all(sheet.as_bytes()).map_err(|e| e.to_string())?;
        } else if f.name() == WORKBOOK {
            // Formul onbellegi yok: acilista tum hesap, yoksa F sutunu bos gorunur.
            let mut wb = String::new();
            f.read_to_string(&mut wb).map_err(|e| e.to_string())?;
            drop(f);
            out.start_file(WORKBOOK, opts).map_err(|e| e.to_string())?;
            out.write_all(wb.replacen("<calcPr calcId=\"191029\"/>", "<calcPr calcId=\"191029\" fullCalcOnLoad=\"1\"/>", 1).as_bytes())
                .map_err(|e| e.to_string())?;
        } else {
            out.raw_copy_file(f).map_err(|e| e.to_string())?;
        }
    }
    Ok(out.finish().map_err(|e| e.to_string())?.into_inner())
}

/// Sayfa XML'i: sablonun satirlari, uzerine 1-2. satirlar (baslik) ve veri satirlari yazilir.
/// Sablonda olup uretilmeyen satirlar (4. satir, bos bicimli satirlar) aynen kalir.
fn fill(template: &str, title: &str, summary: &str, rows: &[Row]) -> Result<String, String> {
    let open = template.find("<sheetData>").ok_or("sheetData yok")?;
    let close = template.find("</sheetData>").ok_or("sheetData kapanisi yok")?;
    let mut lines: BTreeMap<u32, String> = BTreeMap::new();
    let body = &template[open + "<sheetData>".len()..close];
    for xml in split_rows(body) {
        let r = row_number(xml)?;
        lines.insert(r, xml.to_string());
    }
    lines.insert(1, format!("<row r=\"1\">{}</row>", text("A1", S_TITLE, title)));
    lines.insert(2, format!("<row r=\"2\">{}</row>", text("A2", 0, summary)));
    for (i, row) in rows.iter().enumerate() {
        let r = FIRST_ROW + i as u32;
        lines.insert(r, data_row(r, row));
    }
    let rows_xml: String = lines.values().map(String::as_str).collect();
    Ok(format!("{}<sheetData>{}</sheetData>{}", &template[..open], rows_xml, &template[close + "</sheetData>".len()..]))
}

fn data_row(r: u32, row: &Row) -> String {
    let mut s = format!("<row r=\"{r}\">");
    s.push_str(&text(&format!("A{r}"), S_TEXT, &row.name));
    s.push_str(&text(&format!("B{r}"), S_TEXT, &row.kind));
    s.push_str(&format!("<c r=\"C{r}\"><v>{}</v></c>", row.qty));
    s.push_str(&text(&format!("D{r}"), S_TEXT, &row.supplier));
    if let Some(t) = row.total {
        s.push_str(&format!("<c r=\"E{r}\" s=\"{S_MONEY}\"><v>{t}</v></c>"));
    }
    s.push_str(&formula(&format!("F{r}"), S_MONEY, &format!("IF(E{r}=\"\",\"\",E{r}/C{r})")));
    if let Some(b) = row.budget {
        s.push_str(&format!("<c r=\"G{r}\" s=\"{S_MONEY}\"><v>{b}</v></c>"));
    }
    if let Some(serial) = row.arrival {
        s.push_str(&format!("<c r=\"H{r}\" s=\"{S_DATE}\"><v>{serial}</v></c>"));
    }
    if !row.notes.is_empty() {
        s.push_str(&text(&format!("I{r}"), S_TEXT, &row.notes));
    }
    s.push_str("</row>");
    s
}

/// Sayfa govdesindeki `<row ...>...</row>` ve `<row .../>` parcalari, sirayla.
fn split_rows(body: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut rest = body;
    while let Some(start) = rest.find("<row ") {
        let Some(gt) = rest[start..].find('>').map(|i| start + i) else { break };
        let end = if rest[..gt].ends_with('/') {
            gt + 1
        } else {
            match rest[gt..].find("</row>") { Some(i) => gt + i + "</row>".len(), None => break }
        };
        out.push(&rest[start..end]);
        rest = &rest[end..];
    }
    out
}

fn row_number(xml: &str) -> Result<u32, String> {
    let start = xml.find("r=\"").ok_or("satir numarasi yok")? + 3;
    let end = xml[start..].find('"').ok_or("satir numarasi kapanmadi")? + start;
    xml[start..end].parse().map_err(|_| "satir numarasi sayi degil".to_string())
}

fn esc(v: &str) -> String {
    v.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn text(cell: &str, style: u8, v: &str) -> String {
    format!("<c r=\"{cell}\" s=\"{style}\" t=\"inlineStr\"><is><t xml:space=\"preserve\">{}</t></is></c>", esc(v))
}

fn formula(cell: &str, style: u8, f: &str) -> String {
    format!("<c r=\"{cell}\" s=\"{style}\"><f>{}</f></c>", esc(f))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(name: &str, total: Option<f64>) -> Row {
        Row { name: name.into(), kind: "Hizmet".into(), qty: 40, supplier: "A & B".into(), total,
            budget: Some(2000.0), arrival: Some(46_309), notes: "Ölçü 3 mm".into() }
    }

    fn sheet_of(bytes: &[u8]) -> String {
        let mut z = ZipArchive::new(Cursor::new(bytes.to_vec())).unwrap();
        let mut s = String::new();
        z.by_name(SHEET).unwrap().read_to_string(&mut s).unwrap();
        s
    }

    #[test]
    fn veri_bitisik_baslik_korunur_toplam_satiri_yok() {
        let s = sheet_of(&render("Robotik <Atölye>", "özet", &[row("Lazer", Some(2480.0)), row("Lehim", None)]).unwrap());
        assert!(s.contains("Robotik &lt;Atölye&gt;"));
        assert!(s.contains("<c r=\"A5\" s=\"3\" t=\"inlineStr\"><is><t xml:space=\"preserve\">Lazer</t>"));
        assert!(s.contains("<c r=\"E5\" s=\"7\"><v>2480</v></c>"));
        assert!(s.contains("<c r=\"A6\" s=\"3\""));
        assert!(!s.contains("<c r=\"E6\""), "fiyatsiz satirda toplam hucresi olmamali");
        assert!(s.contains("F6") && s.contains("IF(E6=&quot;&quot;,&quot;&quot;,E6/C6)"));
        assert!(!s.contains("SUM("), "toplam satiri Mail özet'i iki kez sayar");
        assert!(!s.contains("Toplam</t>"), "A sutununda 'Toplam' etiketi olmamali");
        // Sablondaki 4. satir (basliklar, paylasimli metin) korunur.
        assert!(s.contains("<row r=\"4\""));
        assert!(s.contains("A &amp; B"));
    }

    #[test]
    fn bos_donemde_veri_satiri_yok() {
        let s = sheet_of(&render("t", "o", &[]).unwrap());
        // Sablondaki bos bicimli A5 hucresi kalabilir; deger yazilmamali (FILTER bos sayar).
        assert!(!s.contains("<c r=\"A5\" s=\"3\" t=\"inlineStr\""));
        assert!(s.contains("<row r=\"4\""));
    }
}
