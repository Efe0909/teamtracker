//! LLM'e giden serbest metnin kisisel/kurumsal veriden temizlenmesi.
//!
//! Uc kural, yonetimden ayri ayri acilip kapanir (`LlmConfig`):
//!   * `patterns`: e-posta, baglanti, 10+ haneli sayi (telefon, TC no, IBAN).
//!   * `known_names`: veritabanindaki kisi adlari (`users`) ve kurum adlari
//!     (takim, tedarikci, kulup) kelime kelime; "Ahmet'e", "Ahmetin" yakalanir.
//!   * `capitalized`: cumle basinda olmayan buyuk harfli her kelime (kaba; "Lehim Teli"
//!     -> "Lehim {{ISIM}}"). Kayitli olmayan adlari yakalamanin tek yolu.
//!
//! Temizleyici GARANTI degil: kayitsiz tek bir ad `capitalized` kapaliyken gecer.
//! Bu yuzden serbest metin varsayilan olarak LLM yuklenicisine hic gitmez
//! (`?free_text=true` ister). Kimlik alanlari zaten yapisal olarak yuke girmez.

use serde::{Deserialize, Serialize};

/// Sunucu, model cevabindaki bu yer tutuculari gercek degerle doldurur (`restore`).
pub const CLUB: &str = "{{KULUP}}";
pub const PLACE: &str = "{{YER}}";

const PERSON: &str = "{{KISI}}";
const ORG: &str = "{{KURUM}}";
const NAME: &str = "{{ISIM}}";
const EMAIL: &str = "{{EPOSTA}}";
const LINK: &str = "{{BAGLANTI}}";
const NUMBER: &str = "{{NO}}";

const TLDS: [&str; 9] = ["com", "net", "org", "edu", "gov", "io", "tr", "info", "co"];
/// Bu kadar ya da daha cok rakam: telefon (10), TC no (11), IBAN (>=20).
const NUMBER_DIGITS: usize = 10;
/// Bu uzunluktan kisa adlar yalniz tam eslesir, daha uzunlar ek alir ("Ahmetin").
const PREFIX_MIN: usize = 4;
const NAME_MIN: usize = 3;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Rules {
    pub patterns: bool,
    pub known_names: bool,
    pub capitalized: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct LlmConfig {
    /// Kapaliyken `?free_text=true` reddedilir.
    pub free_text_allowed: bool,
    pub rules: Rules,
}

impl LlmConfig {
    /// Orta siddet: kaliplar + kayitli adlar.
    pub fn defaults() -> Self {
        Self { free_text_allowed: true, rules: Rules { patterns: true, known_names: true, capitalized: false } }
    }
}

/// Veritabanindan toplanan, metinde aranacak adlar (katlanmis kelimeler).
#[derive(Default)]
pub struct Known {
    people: Vec<String>,
    orgs: Vec<String>,
}

impl Known {
    pub fn people<'a>(mut self, names: impl IntoIterator<Item = &'a str>) -> Self {
        add(&mut self.people, names);
        self
    }

    pub fn orgs<'a>(mut self, names: impl IntoIterator<Item = &'a str>) -> Self {
        add(&mut self.orgs, names);
        self
    }
}

fn add<'a>(into: &mut Vec<String>, names: impl IntoIterator<Item = &'a str>) {
    for name in names {
        for (s, e) in word_spans(name) {
            let f = fold(&name[s..e]);
            if f.chars().count() >= NAME_MIN && !into.contains(&f) {
                into.push(f);
            }
        }
    }
}

fn matches(list: &[String], word: &str) -> bool {
    list.iter().any(|n| word == n || (n.chars().count() >= PREFIX_MIN && word.starts_with(n.as_str())))
}

/// Kucuk harfe, Turkce harfler ASCII'ye: "AYŞE", "Ayşe", "ayse" ayni kelime.
pub fn fold(w: &str) -> String {
    w.chars()
        .map(|c| match c {
            'İ' | 'I' | 'ı' => 'i',
            c => match c.to_lowercase().next().unwrap_or(c) {
                'ç' => 'c',
                'ğ' => 'g',
                'ö' => 'o',
                'ş' => 's',
                'ü' => 'u',
                c => c,
            },
        })
        .collect()
}

/// Alfasayisal kelime araliklari (bayt).
fn word_spans(text: &str) -> Vec<(usize, usize)> {
    let mut spans = Vec::new();
    let mut start = None;
    for (i, c) in text.char_indices() {
        match (c.is_alphanumeric(), start) {
            (true, None) => start = Some(i),
            (false, Some(s)) => {
                spans.push((s, i));
                start = None;
            }
            _ => {}
        }
    }
    if let Some(s) = start {
        spans.push((s, text.len()));
    }
    spans
}

/// Her kelimeyi `f(kelime, cumle_basi_mi)` ile degistirir; `None` = dokunma.
/// `{{...}}` yer tutucularinin ici atlanir (yeniden maskelenmesin).
fn rewrite(text: &str, mut f: impl FnMut(&str, bool) -> Option<&'static str>) -> String {
    let mut out = String::with_capacity(text.len());
    let mut pos = 0;
    let mut sentence_start = true;
    for (s, e) in word_spans(text) {
        let gap = &text[pos..s];
        if gap.contains(['.', '!', '?', '\n']) {
            sentence_start = true;
        }
        out.push_str(gap);
        let word = &text[s..e];
        let replaced = if text[..s].ends_with("{{") { None } else { f(word, sentence_start) };
        out.push_str(replaced.unwrap_or(word));
        sentence_start = false;
        pos = e;
    }
    out.push_str(&text[pos..]);
    out
}

pub fn redact(text: &str, rules: &Rules, known: &Known) -> String {
    let mut s = text.to_string();
    if rules.patterns {
        s = numbers(&chunks(&s));
    }
    if rules.known_names {
        s = rewrite(&s, |w, _| {
            let f = fold(w);
            if matches(&known.people, &f) {
                Some(PERSON)
            } else if matches(&known.orgs, &f) {
                Some(ORG)
            } else {
                None
            }
        });
    }
    if rules.capitalized {
        s = rewrite(&s, |w, start| (!start && name_like(w)).then_some(NAME));
    }
    s
}

/// Buyuk harfle baslar ama kisaltma degil (OTF, LED, USB tamami buyuk).
fn name_like(w: &str) -> bool {
    w.chars().next().is_some_and(char::is_uppercase)
        && w.chars().any(char::is_lowercase)
}

/// Bosluklarla ayrilmis parcalar: e-posta ve baglanti.
fn chunks(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for chunk in text.split_inclusive(char::is_whitespace) {
        let core = chunk.trim_end();
        let trail = &chunk[core.len()..];
        let t = core.trim_matches(|c: char| !c.is_alphanumeric());
        if is_email(t) {
            out.push_str(&core.replacen(t, EMAIL, 1));
        } else if is_link(t) {
            out.push_str(&core.replacen(t, LINK, 1));
        } else {
            out.push_str(core);
        }
        out.push_str(trail);
    }
    out
}

fn is_email(t: &str) -> bool {
    t.split_once('@').is_some_and(|(l, d)| !l.is_empty() && d.contains('.') && !d.ends_with('.'))
}

fn is_link(t: &str) -> bool {
    let l = t.to_lowercase();
    if l.starts_with("www.") || l.contains("://") {
        return true;
    }
    l.split('/').next().and_then(|host| host.rsplit_once('.'))
        .is_some_and(|(name, tld)| !name.is_empty() && TLDS.contains(&tld))
}

/// 10+ rakamli diziler; rakam gruplari bosluk, tire, parantezle bolunmus olabilir
/// ("0532 123 45 67"). Tarih ("25.10.2026") nokta ile yazildigindan bunlara girmez.
fn numbers(text: &str) -> String {
    let cs: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < cs.len() {
        let digit_start = cs[i].is_ascii_digit() || (cs[i] == '+' && cs.get(i + 1).is_some_and(char::is_ascii_digit));
        // "A4", "M12" gibi kelime icindeki rakamlar bir numara baslangici degil.
        if !digit_start || (i > 0 && cs[i - 1].is_alphanumeric()) {
            out.push(cs[i]);
            i += 1;
            continue;
        }
        let (mut j, mut end, mut digits) = (i, i, 0);
        while j < cs.len() {
            match cs[j] {
                c if c.is_ascii_digit() => {
                    digits += 1;
                    j += 1;
                    end = j;
                }
                ' ' | '-' | '(' | ')' => j += 1,
                '+' if j == i => j += 1,
                _ => break,
            }
        }
        if digits >= NUMBER_DIGITS {
            out.push_str(NUMBER);
        } else {
            out.extend(&cs[i..end]);
        }
        i = end.max(i + 1);
    }
    out
}

/// Model cevabindaki `{{KULUP}}` ve `{{YER}}` gercek degerle doldurulur.
pub fn restore(text: &str, club: &str, place: &str) -> String {
    text.replace(CLUB, club).replace(PLACE, place)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn all() -> Rules {
        Rules { patterns: true, known_names: true, capitalized: false }
    }

    fn known() -> Known {
        Known::default().people(["Ahmet Yılmaz", "Ayşe Kaya", "Ali"]).orgs(["Elektrohat A.Ş.", "Robotik Takımı"])
    }

    #[test]
    fn kaliplar_eposta_baglanti_numara() {
        let r = |t| redact(t, &all(), &Known::default());
        assert_eq!(r("Yaz: ahmet@firma.com.tr, sonra ara."), "Yaz: {{EPOSTA}}, sonra ara.");
        assert_eq!(r("bak https://elektrohat.com/lehim ve www.x.org."), "bak {{BAGLANTI}} ve {{BAGLANTI}}.");
        assert_eq!(r("elektrohat.com.tr/urun"), "{{BAGLANTI}}");
        assert_eq!(r("Ara: 0532 123 45 67 veya +90 (532) 123 45 67."), "Ara: {{NO}} veya {{NO}}.");
        assert_eq!(r("TC 12345678901 yazıldı"), "TC {{NO}} yazıldı");
        assert_eq!(r("TR33 0006 1005 1978 6457 8413 26"), "TR33 {{NO}}");
    }

    #[test]
    fn tarih_ve_adet_dokunulmaz() {
        let r = |t| redact(t, &all(), &Known::default());
        for t in ["25 Ekim 2026 saat 14:00", "25.10.2026 14:00", "40 adet, 1500 TL", "A4 kâğıt, M12 cıvata", "3.5 mm tel"] {
            assert_eq!(r(t), t);
        }
    }

    #[test]
    fn kayitli_adlar_ek_alsa_da_yakalanir() {
        let r = |t| redact(t, &all(), &known());
        assert_eq!(r("Ahmet'e söyle"), "{{KISI}}'e söyle");
        assert_eq!(r("Ahmetin projektörü"), "{{KISI}} projektörü");
        assert_eq!(r("AYŞE ve ayse"), "{{KISI}} ve {{KISI}}");
        assert_eq!(r("Elektrohat teklifi, Robotik toplantısı"), "{{KURUM}} teklifi, {{KURUM}} toplantısı");
        // 3 harfli ad yalniz tam eslesir: "alışveriş" etkilenmez.
        assert_eq!(r("Ali geldi, alışveriş yapıldı"), "{{KISI}} geldi, alışveriş yapıldı");
    }

    #[test]
    fn buyuk_harfli_kelime_yalniz_cumle_ortasinda() {
        let r = Rules { patterns: false, known_names: false, capitalized: true };
        assert_eq!(redact("Toplantı OTF ile Mehmet Bey'den sonra. Yarın Cuma", &r, &Known::default()),
            "Toplantı OTF ile {{ISIM}} {{ISIM}}'den sonra. Yarın {{ISIM}}");
    }

    #[test]
    fn kapali_kural_dokunmaz_yer_tutucu_yeniden_maskelenmez() {
        let off = Rules { patterns: false, known_names: false, capitalized: false };
        assert_eq!(redact("ahmet@x.com Ahmet", &off, &known()), "ahmet@x.com Ahmet");
        let all3 = Rules { patterns: true, known_names: true, capitalized: true };
        // Ilk geciste konan yer tutucu ikinci geciste ({{KISI}} -> {{ISIM}}) bozulmaz.
        assert_eq!(redact("Not: Ahmet geldi", &all3, &known()), "Not: {{KISI}} geldi");
    }

    #[test]
    fn yer_tutucular_geri_doldurulur() {
        assert_eq!(restore("Merhaba, {{KULUP}} olarak {{YER}}'de", "Robotik", "B-201"), "Merhaba, Robotik olarak B-201'de");
    }
}
