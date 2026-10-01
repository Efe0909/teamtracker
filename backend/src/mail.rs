//! Giden posta: sablonlar + kuyruk. Gonderici YOK (karar: simdilik yalniz
//! kuyruk/gunluk) — `mail_outbox` satirlari `sent_at` bos bekler, gonderici
//! baglandiginda tuketilir. Sablonlar saf fonksiyon: ag yok, test edilebilir.

use sqlx::PgExecutor;

pub struct Mail {
    pub to: String,
    pub subject: String,
    pub html: String,
    pub text: String,
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// Davet: kisiye eklendigini, telefona nasil kurulacagini ve bildirimi nasil
/// acacagini anlatir. Duz metin karsiligi da var (HTML gostermeyen istemci).
pub fn invite(name: &str, email: &str, app_url: &str, dashboard_url: &str) -> Mail {
    let n = esc(name);
    let html = format!(
        r#"<!doctype html><html lang="tr"><body style="margin:0;background:#f7f7f8;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#18181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e6e6ea;border-radius:12px">
<tr><td style="padding:28px 28px 8px"><h1 style="margin:0;font-size:20px">EkipTakip'e hoş geldin, {n}</h1>
<p style="margin:12px 0 0;line-height:1.55">Ekibin seni ekledi. Google hesabınla (<b>{email}</b>) giriş yapman yeterli; şifre yok.</p></td></tr>
<tr><td style="padding:16px 28px"><a href="{app}" style="display:inline-block;background:#6e56cf;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Telefonda aç</a>
<a href="{dash}" style="display:inline-block;margin-left:8px;color:#5b46c2;text-decoration:none;padding:12px 8px">Bilgisayarda aç</a></td></tr>
<tr><td style="padding:8px 28px 4px"><h2 style="margin:0;font-size:16px">1 · Ana ekrana ekle</h2>
<p style="margin:8px 0 0;line-height:1.55"><b>iPhone (Safari):</b> alttaki <i>Paylaş</i> düğmesi → <i>Ana Ekrana Ekle</i>.<br>
<b>Android (Chrome):</b> sağ üst ⋮ menüsü → <i>Ana ekrana ekle</i> ya da <i>Uygulamayı yükle</i>.</p></td></tr>
<tr><td style="padding:12px 28px 4px"><h2 style="margin:0;font-size:16px">2 · Bildirimleri aç</h2>
<p style="margin:8px 0 0;line-height:1.55">Uygulamayı <b>ana ekrandaki simgesinden</b> aç (tarayıcıdan değil) ve bildirim izni sorulduğunda <i>İzin ver</i>'i seç.
iPhone'da bildirim yalnız ana ekrana eklenmiş uygulamada çalışır.
Hangi sohbetten ne kadar bildirim alacağını uygulamada <i>Bildirimler</i> ayarından ve her sohbetin zil simgesinden seçersin.</p></td></tr>
<tr><td style="padding:12px 28px 28px"><h2 style="margin:0;font-size:16px">3 · Profilini tamamla</h2>
<p style="margin:8px 0 0;line-height:1.55">İlk girişte telefon numaranı istenir; fotoğraf, takma ad ve doğum gününü de ekleyebilirsin.</p></td></tr>
</table></td></tr></table></body></html>"#,
        n = n, email = esc(email), app = esc(app_url), dash = esc(dashboard_url),
    );
    let text = format!(
        "EkipTakip'e hoş geldin, {name}\n\n\
         Ekibin seni ekledi. Google hesabınla ({email}) giriş yap; şifre yok.\n\n\
         Telefonda: {app_url}\nBilgisayarda: {dashboard_url}\n\n\
         1) Ana ekrana ekle — iPhone (Safari): Paylaş → Ana Ekrana Ekle. \
         Android (Chrome): ⋮ → Ana ekrana ekle / Uygulamayı yükle.\n\
         2) Bildirimleri aç — uygulamayı ana ekrandaki simgesinden aç, izin sorulunca İzin ver.\n\
         3) Profilini tamamla — ilk girişte telefon numaran istenir.\n"
    );
    Mail { to: email.to_string(), subject: "EkipTakip'e davetlisin".into(), html, text }
}

/// Kuyruga yaz ve gunluge dus. Gonderim hatasi diye bir sey yok: ag yok.
pub async fn enqueue<'e>(db: impl PgExecutor<'e>, kind: &str, m: &Mail) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into mail_outbox (kind, to_email, subject, body_html, body_text)
         values ($1, $2, $3, $4, $5)")
        .bind(kind).bind(&m.to).bind(&m.subject).bind(&m.html).bind(&m.text)
        .execute(db).await?;
    tracing::info!(kind, to = %m.to, subject = %m.subject, "posta kuyruga yazildi");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn davet_adi_kacirir_ve_baglantilari_tasir() {
        let m = invite("<b>Ali</b>", "ali@x.com", "https://app.x.com", "https://dashboard.x.com");
        assert!(!m.html.contains("<b>Ali</b>"));
        assert!(m.html.contains("&lt;b&gt;Ali&lt;/b&gt;"));
        for s in ["https://app.x.com", "https://dashboard.x.com", "Ana Ekrana Ekle", "ali@x.com"] {
            assert!(m.html.contains(s) && (s == "Ana Ekrana Ekle" || m.text.contains(s)), "{s}");
        }
        assert_eq!(m.to, "ali@x.com");
    }
}
