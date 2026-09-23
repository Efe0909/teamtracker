//! Sohbette anma: @kisi, @all, @here, @team (R4-F03, KNOW-263).
//!
//! Ayri tablo YOK: anma mesaj govdesinden okunur, kime gidecegi her seferinde
//! katilimci kumesinden hesaplanir. Grup anmalari kumenin disina cikmaz ve
//! push gelene kadar (R2-F04) sunucuda ek is dogurmaz — uygulama ici
//! bildirim zaten sohbetin kendisinden besleniyor.
//!
//! Sunucunun tek isi DAVET: kart sohbetinde `@kisi` ile anilan, kumede
//! olmayan aktif kullanici karta katilimci olur (Python `mentions.resolve`,
//! "mail forward" modeli — karta eklemenin baska yolu yok).

pub const GROUPS: [&str; 3] = ["all", "here", "team"];

/// Addan anma anahtari: "Ayşe Yılmaz" -> "ayse-yilmaz". On yuzdeki
/// `lib/mentions.ts` ile AYNI katlama (Python `attachments.slugify`).
// ponytail: Turkce + yaygin Latin aksanlari elle katlaniyor; baska alfabeden
// ad gelirse `-`'ye duser, o gun unicode-normalization (NFKD) eklenir.
pub fn handle(name: &str) -> String {
    let mut out = String::new();
    for c in name.chars() {
        let c = match c {
            'İ' | 'I' | 'ı' => 'i',
            'Ç' | 'ç' => 'c',
            'Ğ' | 'ğ' => 'g',
            'Ö' | 'ö' | 'Ô' | 'ô' => 'o',
            'Ş' | 'ş' => 's',
            'Ü' | 'ü' | 'Û' | 'û' => 'u',
            'Â' | 'â' | 'Á' | 'á' | 'À' | 'à' | 'Ä' | 'ä' => 'a',
            'Î' | 'î' | 'Í' | 'í' => 'i',
            'É' | 'é' | 'È' | 'è' | 'Ê' | 'ê' => 'e',
            c => c.to_ascii_lowercase(),
        };
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    out.trim_matches('-').to_string()
}

/// Govdedeki anma anahtarlari, yazilis sirasinda, tekrarsiz. Token: `@` +
/// harf/rakam/`_`/`.`/`-`; e-posta icindeki `@` da yakalanir ama hicbir
/// kullanicinin anahtarina eslesmez, sessizce duser.
pub fn tokens(body: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut rest = body;
    while let Some(i) = rest.find('@') {
        rest = &rest[i + 1..];
        let end = rest
            .find(|c: char| !(c.is_alphanumeric() || matches!(c, '_' | '.' | '-')))
            .unwrap_or(rest.len());
        let raw = &rest[..end];
        let low = raw.to_lowercase();
        let key = if GROUPS.contains(&low.as_str()) { low } else { handle(raw) };
        if !key.is_empty() && !out.contains(&key) {
            out.push(key);
        }
        rest = &rest[end..];
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn katlama() {
        assert_eq!(handle("Ayşe Yılmaz"), "ayse-yilmaz");
        assert_eq!(handle("İlker Öztürk"), "ilker-ozturk");
        assert_eq!(handle("Çağrı  Işık"), "cagri-isik");
    }

    #[test]
    fn anahtarlar() {
        assert_eq!(tokens("@Ayşe bak, @ALL ve @ayse tekrar; ali@x.org"), ["ayse", "all", "x-org"]);
        assert!(tokens("anma yok").is_empty());
    }
}
