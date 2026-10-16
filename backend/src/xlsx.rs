//! Tek sayfalik, bicimsiz Excel tablosu (baslik satiri + veri). Sablon gerekmez:
//! dokuman paketi `zip` ile elde yazilir (OOXML'in asgari parcalari). Metin
//! `inlineStr`, sayi duz `<v>`; sutun genisligi ve bicim istemcide (Excel) ayarlanir.
//! Dokum sayfasi gerektiren cikti (satin alimlar) icin `purchases_xlsx` kullanilir.

use std::io::{Cursor, Write};

use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

pub enum Cell {
    Text(String),
    Num(f64),
}

impl From<&str> for Cell {
    fn from(s: &str) -> Self {
        Cell::Text(s.to_string())
    }
}
impl From<String> for Cell {
    fn from(s: String) -> Self {
        Cell::Text(s)
    }
}
impl From<f64> for Cell {
    fn from(n: f64) -> Self {
        Cell::Num(n)
    }
}

fn esc(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => o.push_str("&amp;"),
            '<' => o.push_str("&lt;"),
            '>' => o.push_str("&gt;"),
            '"' => o.push_str("&quot;"),
            // XML 1.0'da kontrol karakteri yok: bosluga cevrilir.
            c if (c as u32) < 0x20 && c != '\n' && c != '\t' => o.push(' '),
            c => o.push(c),
        }
    }
    o
}

/// A, B, ... Z, AA, ...
fn col(mut i: usize) -> String {
    let mut s = String::new();
    loop {
        s.insert(0, (b'A' + (i % 26) as u8) as char);
        if i < 26 {
            break;
        }
        i = i / 26 - 1;
    }
    s
}

/// `sheet` en fazla 31 karakter, `[]:*?/\` yok (Excel kurali); fazlasi sessizce elenir.
pub fn table(sheet: &str, header: &[&str], rows: &[Vec<Cell>]) -> Result<Vec<u8>, String> {
    let name: String = sheet.chars().filter(|c| !"[]:*?/\\".contains(*c)).take(31).collect();
    let name = if name.trim().is_empty() { "Sayfa1".to_string() } else { name };

    let mut data = String::new();
    let mut push_row = |r: usize, cells: Vec<Cell>| {
        data.push_str(&format!("<row r=\"{r}\">"));
        for (i, c) in cells.iter().enumerate() {
            let at = format!("{}{r}", col(i));
            match c {
                Cell::Text(t) => data.push_str(&format!("<c r=\"{at}\" t=\"inlineStr\"><is><t xml:space=\"preserve\">{}</t></is></c>", esc(t))),
                Cell::Num(n) if n.is_finite() => data.push_str(&format!("<c r=\"{at}\"><v>{n}</v></c>")),
                Cell::Num(_) => {}
            }
        }
        data.push_str("</row>");
    };
    push_row(1, header.iter().map(|h| Cell::Text((*h).to_string())).collect());
    for (i, r) in rows.iter().enumerate() {
        push_row(i + 2, r.iter().map(|c| match c {
            Cell::Text(t) => Cell::Text(t.clone()),
            Cell::Num(n) => Cell::Num(*n),
        }).collect());
    }

    let sheet_xml = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
         <worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">\
         <sheetViews><sheetView workbookViewId=\"0\"><pane ySplit=\"1\" topLeftCell=\"A2\" activePane=\"bottomLeft\" state=\"frozen\"/></sheetView></sheetViews>\
         <sheetData>{data}</sheetData></worksheet>");
    let workbook = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
         <workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" \
         xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">\
         <sheets><sheet name=\"{}\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>", esc(&name));
    const CONTENT_TYPES: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
        <Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">\
        <Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>\
        <Default Extension=\"xml\" ContentType=\"application/xml\"/>\
        <Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>\
        <Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>\
        </Types>";
    const ROOT_RELS: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
        <Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
        <Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/>\
        </Relationships>";
    const WB_RELS: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
        <Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
        <Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/>\
        </Relationships>";

    let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let mut out = ZipWriter::new(Cursor::new(Vec::new()));
    for (path, body) in [
        ("[Content_Types].xml", CONTENT_TYPES),
        ("_rels/.rels", ROOT_RELS),
        ("xl/workbook.xml", workbook.as_str()),
        ("xl/_rels/workbook.xml.rels", WB_RELS),
        ("xl/worksheets/sheet1.xml", sheet_xml.as_str()),
    ] {
        out.start_file(path, opts).map_err(|e| e.to_string())?;
        out.write_all(body.as_bytes()).map_err(|e| e.to_string())?;
    }
    Ok(out.finish().map_err(|e| e.to_string())?.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    #[test]
    fn tablo_acilir_ve_kacisli() {
        let bytes = table("Bütçe", &["Ad", "Tutar"], &[vec!["A & B <x>".into(), 12.5.into()], vec!["".into(), 3.0.into()]]).unwrap();
        let mut z = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
        let mut sheet = String::new();
        z.by_name("xl/worksheets/sheet1.xml").unwrap().read_to_string(&mut sheet).unwrap();
        assert!(sheet.contains("A &amp; B &lt;x&gt;"));
        assert!(sheet.contains("<c r=\"B2\"><v>12.5</v></c>"));
        assert!(sheet.contains("<c r=\"B3\"><v>3</v></c>"));
        assert_eq!(col(0), "A");
        assert_eq!(col(26), "AA");
    }
}
