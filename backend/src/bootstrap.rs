//! Ilk yonetici (R3-F07, KNOW-320): panel de bir yoneticiye muhtac, ilki
//! buradan gelir. Liste `~/nix`'te agenix sirri; `deploy/module.nix` onu
//! systemd kimligi olarak verir, yolu `EKIPTAKIP_BOOTSTRAP_ADMINS_FILE`.

use sqlx::PgPool;

use crate::models::user::COLORS;

/// Satir basina bir e-posta; bos satir ve `#` yorum atlanir.
fn emails(text: &str) -> Vec<String> {
    text.lines()
        .map(|l| l.trim().to_lowercase())
        .filter(|l| !l.is_empty() && !l.starts_with('#') && l.contains('@'))
        .collect()
}

/// Dosyadaki her e-posta AKTIF ADMIN olur; her acilista kosar, idempotent.
/// Listeden cikarmak geri ALMAZ — geri alma panelden. Dosya okunamazsa
/// acilis durmaz: panel ayaktaysa bu yol yalniz kurtarma.
pub async fn admins(p: &PgPool, path: &str) {
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) => {
            tracing::warn!("ilk yonetici dosyasi okunamadi ({path}): {e}");
            return;
        }
    };
    for email in emails(&text) {
        // Yalniz DEGISEN satir olay yazar: her acilista ayni olay birikmesin.
        let res = sqlx::query(
            "with u as (
               insert into users (email, name, color, is_admin, is_active)
               values ($1, split_part($1, '@', 1),
                       ($2::text[])[1 + ((select count(*) from users) % 6)::int], true, true)
               on conflict (lower(email)) do update set is_admin = true, is_active = true
                 where not (users.is_admin and users.is_active)
               returning email)
             insert into security_events (event_type, email, detail)
             select 'admin_granted', email, 'bootstrap' from u")
            .bind(&email).bind(COLORS.to_vec()).execute(p).await;
        match res {
            Ok(r) if r.rows_affected() > 0 => tracing::info!("ilk yonetici: {email}"),
            Ok(_) => {}
            Err(e) => tracing::error!("ilk yonetici yazilamadi ({email}): {e}"),
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn satirlar() {
        let got = super::emails("# yoneticiler\n\n  Efe@X.com \nbozuk-satir\n#yorum@x.com\nb@y.org");
        assert_eq!(got, ["efe@x.com", "b@y.org"]);
    }
}
