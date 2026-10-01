//! Bildirim KANALI protokolu: tek mesaj bicimi, kanaldan bagimsiz sonuc.
//!
//! Karar `push::decide` (kime, ne zaman); burasi TESLIMAT: bir `Message`i bir
//! `Address`e goturur ve ne oldugunu `Outcome` ile soyler. Yeni kanal = enum'a
//! bir kol + `Address`e bir kol (dyn yok, async trait'e gerek yok).
//!
//!   Push  — web push (webpush.rs), adres = abonelik
//!   Email — Resend (mail.rs), adres = e-posta
//!
//! Uygulama ici liste kanal degil: `chat_feed`'den turetilir (notify.rs).

use std::sync::Arc;

use crate::{mail, webpush};

/// Kanaldan bagimsiz bildirim. Icerik kisa tutulur: push kilit ekraninda gorunur.
pub struct Message {
    pub title: String,
    pub body: String,
    /// Uygulama ici yol ("/record/..."); kanal gerekirse mutlak adrese cevirir.
    pub url: String,
    /// Ayni etiketliler birbirini gunceller (push) / ayni konu (posta).
    pub tag: String,
}

/// Teslimat sonucu — her kanal ayni dort durumu kullanir.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Outcome {
    Sent,
    /// Adres olu (push 404/410): kaydi sil, tekrar deneme.
    Gone,
    /// Gecici hata (ag, 5xx, 429): sonra yeniden dene.
    Retry,
    /// Kalici red (4xx): yeniden deneme, hatayi kaydet.
    Rejected,
}

pub enum Address<'a> {
    Push { endpoint: &'a str, p256dh: &'a str, auth: &'a str },
    /// Bildirim e-postasi baglanana kadar yalniz protokol: davet kuyruktan gider (mail.rs).
    #[allow(dead_code)]
    Email(&'a str),
}

pub enum Channel {
    Push(Arc<webpush::Vapid>),
    #[allow(dead_code)]
    Email(Arc<mail::Resend>),
}

impl Channel {
    pub async fn deliver(&self, to: &Address<'_>, m: &Message) -> Outcome {
        match (self, to) {
            (Channel::Push(v), Address::Push { endpoint, p256dh, auth }) => {
                let payload = serde_json::json!({
                    "title": m.title, "body": m.body, "url": m.url, "tag": m.tag,
                }).to_string();
                webpush::send(v, &webpush::Target { endpoint, p256dh, auth }, payload.as_bytes()).await
            }
            (Channel::Email(r), Address::Email(addr)) => r.send(&mail::from_message(addr, m, &r.app_url)).await,
            // Kanal ile adres uyusmuyor: programlama hatasi, tekrar denemenin anlami yok.
            _ => Outcome::Rejected,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn uyusmayan_kanal_adres_reddedilir() {
        let (private, _) = webpush::keygen();
        let Some(v) = webpush::Vapid::new(&private, "mailto:a@b.c") else { return };
        let m = Message { title: "t".into(), body: "b".into(), url: "/".into(), tag: "x".into() };
        assert_eq!(Channel::Push(Arc::new(v)).deliver(&Address::Email("a@b.c"), &m).await, Outcome::Rejected);
    }
}
