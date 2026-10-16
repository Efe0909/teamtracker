//! Maliye'nin saf kurallari (spec/81): para kurusta, kur TCMB'den.
//!
//! Para JSON'da sayi olarak gelir ama hesap ve karsilastirma KURUSTA (i64)
//! yapilir; veritabanina `$::bigint::numeric / 100` ile yazilir. Boylece
//! "kalemlerin toplami faturanin toplamina esit" kurali float yuvarlamasina
//! takilmaz (0.1 + 0.2).

use chrono::{Datelike, Duration, NaiveDate};

/// numeric(12,2) ust siniri, kurus.
pub const MAX_CENTS: i64 = 999_999_999_999;

/// Sayi -> kurus. Sonlu, pozitif, en fazla iki ondalik ve sinir icinde degilse None.
pub fn cents(v: f64) -> Option<i64> {
    if !v.is_finite() || v <= 0.0 {
        return None;
    }
    let c = (v * 100.0).round();
    if (v * 100.0 - c).abs() > 1e-6 || c > MAX_CENTS as f64 {
        return None;
    }
    Some(c as i64)
}

/// Isaretli tutar (defter): sifir olamaz, iki ondalik.
pub fn signed_cents(v: f64) -> Option<i64> {
    cents(v.abs()).map(|c| if v < 0.0 { -c } else { c })
}

/// Kur: pozitif, en fazla 6 ondalik; milyonda bir birimle.
pub fn micros(v: f64) -> Option<i64> {
    if !v.is_finite() || v <= 0.0 || v > 999_999.0 {
        return None;
    }
    let m = (v * 1_000_000.0).round();
    ((v * 1_000_000.0 - m).abs() <= 1e-3).then_some(m as i64)
}

/// ISO 4217 bicimi (3 buyuk harf). Listede olmasi gerekmez: TCMB bilmiyorsa
/// kur elle girilir.
pub fn currency(s: &str) -> Option<String> {
    let c = s.trim().to_ascii_uppercase();
    (c.len() == 3 && c.bytes().all(|b| b.is_ascii_uppercase())).then_some(c)
}

/// TCMB gunluk kur dosyasi: `https://www.tcmb.gov.tr/kurlar/202610/10102026.xml`.
pub fn tcmb_url(day: NaiveDate) -> String {
    format!(
        "https://www.tcmb.gov.tr/kurlar/{:04}{:02}/{:02}{:02}{:04}.xml",
        day.year(), day.month(), day.day(), day.month(), day.year()
    )
}

/// TCMB XML'inden birimin DOVIZ SATIS kuru (`ForexSelling`). XML ayristirici
/// yerine dar arama: dosya bicimi yillardir ayni ve yalniz bir alan okunuyor.
pub fn parse_tcmb(xml: &str, currency: &str) -> Option<f64> {
    let start = xml.find(&format!("CurrencyCode=\"{currency}\""))?;
    let block = &xml[start..];
    let block = &block[..block.find("</Currency>").unwrap_or(block.len())];
    let unit: f64 = between(block, "<Unit>", "</Unit>").and_then(|s| s.trim().parse().ok()).unwrap_or(1.0);
    let rate: f64 = between(block, "<ForexSelling>", "</ForexSelling>")?.trim().parse().ok()?;
    // Birim 100 (JPY) bolmesi float artigi birakir; kur 6 ondalikla saklanir.
    (rate > 0.0 && unit > 0.0).then(|| (rate / unit * 1e6).round() / 1e6)
}

fn between<'a>(s: &'a str, open: &str, close: &str) -> Option<&'a str> {
    let a = s.find(open)? + open.len();
    let b = s[a..].find(close)? + a;
    Some(&s[a..b])
}

/// Hafta sonu ve tatilde dosya yok: o gunden geriye en fazla 7 gun (spec/81 §13).
pub fn lookback(day: NaiveDate) -> impl Iterator<Item = NaiveDate> {
    (0..=7).map(move |d| day - Duration::days(d))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kurus() {
        assert_eq!(cents(0.1), Some(10));
        assert_eq!(cents(0.1 + 0.2), Some(30));
        assert_eq!(cents(1045.5), Some(104_550));
        assert_eq!(cents(12.345), None, "uc ondalik");
        assert_eq!(cents(0.0), None);
        assert_eq!(cents(-5.0), None);
        assert_eq!(cents(f64::NAN), None);
        assert_eq!(cents(10_000_000_000.0), None, "numeric(12,2) disi");
        assert_eq!(signed_cents(-820.0), Some(-82_000));
        assert_eq!(micros(41.82), Some(41_820_000));
        assert_eq!(micros(41.8234567), None);
        assert_eq!(currency(" usd "), Some("USD".into()));
        assert_eq!(currency("US"), None);
    }

    #[test]
    fn tcmb() {
        let day = NaiveDate::from_ymd_opt(2026, 10, 9).unwrap_or_default();
        assert_eq!(tcmb_url(day), "https://www.tcmb.gov.tr/kurlar/202610/09102026.xml");
        let xml = r#"<Tarih_Date><Currency CrossOrder="0" Kod="USD" CurrencyCode="USD"><Unit>1</Unit>
            <ForexBuying>41.7400</ForexBuying><ForexSelling>41.8200</ForexSelling></Currency>
            <Currency CrossOrder="9" Kod="JPY" CurrencyCode="JPY"><Unit>100</Unit>
            <ForexSelling>27.9000</ForexSelling></Currency></Tarih_Date>"#;
        assert_eq!(parse_tcmb(xml, "USD"), Some(41.82));
        assert_eq!(parse_tcmb(xml, "JPY"), Some(0.279));
        assert_eq!(parse_tcmb(xml, "EUR"), None);
        assert_eq!(lookback(day).count(), 8);
    }
}
