//! Web push. TEK KAPI: bildirim karari burada, `users.notify_level` burada
//! okunur. Kademeler gonderim aninda uygulanir — abonelik durur, gonderim
//! durur.

/// Ekranda gorunen kademe etiketleri. Anahtar Ingilizce, etiket Turkce.
pub const NOTIFY_LEVELS: &[(&str, &str)] = &[
    ("all", "Her hareket — kartlarımdaki her şey"),
    ("mentions", "Yalnızca anıldığımda (@adım, @all, @here, @team)"),
    ("none", "Hiçbiri — bildirim gönderme"),
];
