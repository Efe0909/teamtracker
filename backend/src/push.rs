//! Bildirim karari. TEK KAPI: `decide` hem uygulama ici listeyi hem push'u
//! belirler; kademe etiketleri on yuzde (`lib/labels.ts` NOTIFY).

use crate::models::enums::NotifyLevel;

/// Bir olayin bir kisiye NE yapacagi. Uygulama ici liste ile push ayri karar:
/// sessiz saat yalniz push'u susturur, listeye yine dusulur.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub struct Decision {
    pub in_app: bool,
    pub push: bool,
}

/// Sessiz saat araligi icinde mi? `start == end` kapali sayilir; gece yarisini
/// asan aralik (22 → 7) desteklenir.
pub fn quiet_now(quiet: Option<(i16, i16)>, hour: i16) -> bool {
    match quiet {
        Some((s, e)) if s != e => if s < e { (s..e).contains(&hour) } else { hour >= s || hour < e },
        _ => false,
    }
}

/// TEK KAPI. Etkin kademe: sohbete ozel secim varsa o, yoksa kisinin varsayilani.
/// `mentioned`: mesaj bu kisiyi (@ad, @all, @here, @team) aniyor mu. Olay bir
/// mesaj degilse (etkinlik) anma yoktur; "yalniz anmalar" kipinde dusurulur.
pub fn decide(
    default: NotifyLevel, chat: Option<NotifyLevel>, mentioned: bool,
    quiet: Option<(i16, i16)>, hour: i16,
) -> Decision {
    let level = chat.unwrap_or(default);
    let wanted = match level {
        NotifyLevel::All => true,
        NotifyLevel::Mentions => mentioned,
        NotifyLevel::None => false,
    };
    Decision { in_app: wanted, push: wanted && !quiet_now(quiet, hour) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sohbet_secimi_varsayilani_ezer() {
        // Varsayilan "hepsi", ama bu sohbet susturulmus.
        assert_eq!(decide(NotifyLevel::All, Some(NotifyLevel::None), true, None, 12),
            Decision { in_app: false, push: false });
        // Varsayilan "hicbiri", bu sohbet "hepsi".
        assert_eq!(decide(NotifyLevel::None, Some(NotifyLevel::All), false, None, 12),
            Decision { in_app: true, push: true });
        // Ozel secim yoksa varsayilan: yalniz anmalar.
        assert!(!decide(NotifyLevel::Mentions, None, false, None, 12).in_app);
        assert!(decide(NotifyLevel::Mentions, None, true, None, 12).in_app);
    }

    #[test]
    fn sessiz_saat_yalniz_push_i_susturur() {
        let d = decide(NotifyLevel::All, None, false, Some((22, 7)), 23);
        assert_eq!(d, Decision { in_app: true, push: false });
        assert!(decide(NotifyLevel::All, None, false, Some((22, 7)), 8).push);
        assert!(quiet_now(Some((9, 17)), 9) && !quiet_now(Some((9, 17)), 17));
        assert!(!quiet_now(Some((5, 5)), 5) && !quiet_now(None, 5));
    }
}
