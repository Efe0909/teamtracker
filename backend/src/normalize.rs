//! Serbest metnin normalize anahtari (spec/84 §3): yazim farklarindan arinmis
//! ad. Ayni anahtar = ayni sey, kesin; tedarikcide yeni satir acilmaz (M2).
//!
//! Turkce katlama `mentions::handle` ile ayni tablo (I/ı/İ -> i); sozcukler
//! SIRALANIR ("Matbaa Ekin" = "Ekin Matbaa"). Tedarikcide sirket ekleri
//! (ltd, şti, a.ş. …) ve tek harfli parcalar atilir.
// ponytail: NFKC yok (unicode-normalization sandigi yok); bilesik aksanli
// harf gelirse noktalama gibi bosluga duser. Gerekirse sandik eklenir.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Vendor,
    Plain,
}

/// Tedarikci adindaki gurultu sozcukleri (katlanmis halleriyle).
const VENDOR_NOISE: &[&str] = &[
    "ltd", "sti", "as", "tic", "san", "ve", "limited", "sirketi", "ticaret", "sanayi", "ltdsti",
];

fn fold(c: char) -> Option<char> {
    let c = match c {
        'İ' | 'I' | 'ı' | 'Î' | 'î' | 'Í' | 'í' => 'i',
        'Ç' | 'ç' => 'c',
        'Ğ' | 'ğ' => 'g',
        'Ö' | 'ö' | 'Ô' | 'ô' => 'o',
        'Ş' | 'ş' => 's',
        'Ü' | 'ü' | 'Û' | 'û' => 'u',
        'Â' | 'â' | 'Á' | 'á' | 'À' | 'à' | 'Ä' | 'ä' => 'a',
        'É' | 'é' | 'È' | 'è' | 'Ê' | 'ê' => 'e',
        c => c.to_ascii_lowercase(),
    };
    c.is_ascii_alphanumeric().then_some(c)
}

pub fn key(kind: Kind, s: &str) -> String {
    let mut buf = String::with_capacity(s.len());
    for c in s.replace('&', " ve ").chars() {
        buf.push(fold(c).unwrap_or(' '));
    }
    let mut words: Vec<&str> = buf.split_whitespace()
        .filter(|w| kind == Kind::Plain || (w.len() > 1 && !VENDOR_NOISE.contains(w)))
        .collect();
    words.sort_unstable();
    words.dedup();
    words.join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tedarikci_anahtari() {
        let k = key(Kind::Vendor, "Matbaa Ekin");
        assert_eq!(k, "ekin matbaa");
        assert_eq!(key(Kind::Vendor, "MATBAA EKİN Ltd. Şti."), k);
        assert_eq!(key(Kind::Vendor, "ekin   matbaa"), k);
        assert_eq!(key(Kind::Vendor, "Ekin Matbaa A.Ş."), k);
        assert_eq!(key(Kind::Vendor, "Işık & Çiçek Tic."), "cicek isik");
        assert_eq!(key(Kind::Vendor, "Koli Market"), "koli market");
        assert_eq!(key(Kind::Plain, "Bardak (200 adet)"), "200 adet bardak");
        assert_eq!(key(Kind::Vendor, "!!!"), "");
    }
}
