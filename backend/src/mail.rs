//! Giden posta: sablonlar + kuyruk. Gonderici YOK (karar: simdilik yalniz
//! kuyruk/gunluk) — `mail_outbox` satirlari `sent_at` bos bekler, gonderici
//! baglandiginda tuketilir. Sablonlar saf fonksiyon: ag yok, test edilebilir.

use std::{sync::Arc, time::Duration};

use sqlx::{PgExecutor, PgPool};

use crate::{channel::{Message, Outcome}, config::Config};

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

/// Kanal mesajini posta yap (bildirimi mail kanalindan gondermek icin).
pub fn from_message(to: &str, m: &Message, app_url: &str) -> Mail {
    let link = format!("{}{}", app_url.trim_end_matches('/'), m.url);
    Mail {
        to: to.to_string(),
        subject: m.title.clone(),
        html: format!(
            r#"<p style="font-family:system-ui,sans-serif;line-height:1.55"><b>{}</b><br>{}<br><a href="{}">Aç</a></p>"#,
            esc(&m.title), esc(&m.body), esc(&link)),
        text: format!("{}\n{}\n{}\n", m.title, m.body, link),
    }
}

// --- Resend ----------------------------------------------------------------

/// Resend HTTP API istemcisi. Anahtar `RESEND_API_KEY`, gonderen `MAIL_FROM`
/// (alan adi Resend'de dogrulanmis olmali: DKIM/SPF).
pub struct Resend {
    client: reqwest::Client,
    key: String,
    from: String,
    url: String,
    /// Posta icindeki mutlak baglantilar icin (bildirim kanali).
    pub app_url: String,
}

impl Resend {
    /// Anahtar yoksa None: posta kuyrukta bekler, gonderici calismaz.
    pub fn new(cfg: &Config) -> Option<Resend> {
        if cfg.mail_api_key.is_empty() {
            return None;
        }
        Some(Resend {
            client: reqwest::Client::builder().timeout(Duration::from_secs(15)).build().unwrap_or_default(),
            key: cfg.mail_api_key.clone(),
            from: cfg.mail_from.clone(),
            url: cfg.mail_api_url.clone(),
            app_url: cfg.app_url(),
        })
    }

    /// Sonuc + gunluk/`mail_outbox.error` icin aciklama.
    async fn post(&self, m: &Mail) -> (Outcome, String) {
        let body = serde_json::json!({
            "from": self.from, "to": [m.to], "subject": m.subject, "html": m.html, "text": m.text,
        });
        match self.client.post(&self.url).bearer_auth(&self.key).json(&body).send().await {
            Ok(r) if r.status().is_success() => (Outcome::Sent, String::new()),
            Ok(r) => {
                let status = r.status();
                let detail = r.text().await.unwrap_or_default();
                let note = format!("HTTP {}: {}", status.as_u16(), detail.chars().take(300).collect::<String>());
                // 429 ve 5xx gecici; geri kalan 4xx (alan adi dogrulanmamis, gecersiz adres...) kalici.
                let outcome = if status.as_u16() == 429 || status.is_server_error() { Outcome::Retry } else { Outcome::Rejected };
                (outcome, note)
            }
            Err(e) => (Outcome::Retry, format!("ag hatasi: {e}")),
        }
    }

    pub async fn send(&self, m: &Mail) -> Outcome {
        let (outcome, note) = self.post(m).await;
        if outcome != Outcome::Sent {
            tracing::warn!(to = %m.to, "posta gonderilemedi: {note}");
        }
        outcome
    }
}

const MAX_ATTEMPTS: i32 = 5;

/// Kuyruk tuketici: 15 sn'de bir bekleyenleri gonderir. Gecici hatada
/// (deneme^2 dakika) sonra tekrar, kalici hatada vazgecer (`error` dolu).
pub async fn run_outbox(pool: PgPool, resend: Arc<Resend>) {
    let mut every = tokio::time::interval(Duration::from_secs(15));
    loop {
        every.tick().await;
        if let Err(e) = drain(&pool, &resend).await {
            tracing::warn!("posta kuyrugu: {e}");
        }
    }
}

#[derive(sqlx::FromRow)]
struct Pending {
    id: uuid::Uuid,
    to_email: String,
    subject: String,
    body_html: String,
    body_text: String,
    attempts: i32,
}

async fn drain(pool: &PgPool, resend: &Resend) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    let rows: Vec<Pending> = sqlx::query_as(
        "select id, to_email, subject, body_html, body_text, attempts from mail_outbox
          where sent_at is null and attempts < $1 and next_try_at <= now()
          order by created_at limit 10 for update skip locked")
        .bind(MAX_ATTEMPTS).fetch_all(&mut *tx).await?;
    for r in rows {
        let mail = Mail { to: r.to_email, subject: r.subject, html: r.body_html, text: r.body_text };
        let (outcome, note) = resend.post(&mail).await;
        match outcome {
            Outcome::Sent => {
                sqlx::query("update mail_outbox set sent_at = now(), error = null, attempts = attempts + 1 where id = $1")
                    .bind(r.id).execute(&mut *tx).await?;
                tracing::info!(to = %mail.to, "posta gonderildi");
            }
            Outcome::Retry | Outcome::Gone => {
                let n = r.attempts + 1;
                sqlx::query(
                    "update mail_outbox set attempts = $2, error = $3,
                            next_try_at = now() + make_interval(mins => $4) where id = $1")
                    .bind(r.id).bind(n).bind(&note).bind(n * n).execute(&mut *tx).await?;
                tracing::warn!(to = %mail.to, "posta gecici hata ({n}/{MAX_ATTEMPTS}): {note}");
            }
            Outcome::Rejected => {
                sqlx::query("update mail_outbox set attempts = $2, error = $3 where id = $1")
                    .bind(r.id).bind(MAX_ATTEMPTS).bind(&note).execute(&mut *tx).await?;
                tracing::warn!(to = %mail.to, "posta reddedildi: {note}");
            }
        }
    }
    tx.commit().await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kanal_mesaji_postaya_cevrilir() {
        let m = Message { title: "Maliye <acil>".into(), body: "Ali yeni mesaj yazdı".into(), url: "/record/1".into(), tag: "c".into() };
        let mail = from_message("a@x.com", &m, "https://app.x.com/");
        assert_eq!(mail.subject, "Maliye <acil>");
        assert!(mail.html.contains("&lt;acil&gt;") && mail.html.contains("https://app.x.com/record/1"));
        assert!(mail.text.contains("https://app.x.com/record/1"));
    }

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
