//! Web Push gonderimi: RFC 8291 (aes128gcm govde sifreleme) + RFC 8292 (VAPID).
//!
//! Bilincli olarak RustCrypto ile elle: hazir `web-push` kutuphanesi OpenSSL ve
//! libcurl ceker, hedef icin Mac'te capraz derleme (release.sh) bozulurdu.
//! Anahtar `VAPID_PRIVATE` ortam degiskeninde, base64url ham 32 bayt skaler;
//! genel anahtar ondan turetilir. Anahtar yoksa push KAPALI (liste calisir).
//! `cargo run -- vapid-keygen` yeni cift uretir.

use aes_gcm::{aead::{Aead, KeyInit}, Aes128Gcm, Nonce};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD as B64, Engine};
use hkdf::Hkdf;
use p256::{
    ecdh::diffie_hellman,
    ecdsa::{signature::Signer, Signature, SigningKey},
    elliptic_curve::sec1::ToEncodedPoint,
    PublicKey, SecretKey,
};
use rand_core::{OsRng, RngCore};
use sha2::Sha256;

/// Tek kayit: 4096 bayt - baslik(86) - etiket(16) - ayirac(1) altinda kal.
const PAYLOAD_MAX: usize = 3000;
const RECORD_SIZE: u32 = 4096;

pub struct Vapid {
    key: SigningKey,
    public: String,
    sub: String,
}

impl Vapid {
    /// Bos ya da bozuk anahtar -> None (push kapali).
    pub fn new(private_b64: &str, sub: &str) -> Option<Vapid> {
        let raw = B64.decode(private_b64.trim().trim_end_matches('=')).ok()?;
        let secret = SecretKey::from_slice(&raw).ok()?;
        let public = B64.encode(secret.public_key().to_encoded_point(false).as_bytes());
        Some(Vapid { key: SigningKey::from(&secret), public, sub: sub.to_string() })
    }

    /// Tarayicinin `applicationServerKey`i.
    pub fn public_key(&self) -> &str {
        &self.public
    }

    /// `Authorization` basligi: endpoint'in kokeni (aud) imzalar.
    fn authorization(&self, endpoint: &str, now: i64) -> Option<String> {
        let rest = endpoint.strip_prefix("https://")?;
        let origin = format!("https://{}", rest.split('/').next()?);
        let header = B64.encode(br#"{"typ":"JWT","alg":"ES256"}"#);
        let claims = B64.encode(serde_json::json!({ "aud": origin, "exp": now + 12 * 3600, "sub": self.sub })
            .to_string());
        let signing_input = format!("{header}.{claims}");
        let sig: Signature = self.key.sign(signing_input.as_bytes());
        Some(format!("vapid t={signing_input}.{}, k={}", B64.encode(sig.to_bytes()), self.public))
    }
}

/// `(ozel, genel)` base64url cift.
pub fn keygen() -> (String, String) {
    let secret = SecretKey::random(&mut OsRng);
    (B64.encode(secret.to_bytes()), B64.encode(secret.public_key().to_encoded_point(false).as_bytes()))
}

fn derive(
    shared: &[u8], auth: &[u8], ua_pub: &[u8], as_pub: &[u8], salt: &[u8],
) -> Option<([u8; 16], [u8; 12])> {
    let mut info = b"WebPush: info\0".to_vec();
    info.extend_from_slice(ua_pub);
    info.extend_from_slice(as_pub);
    let mut ikm = [0u8; 32];
    Hkdf::<Sha256>::new(Some(auth), shared).expand(&info, &mut ikm).ok()?;
    let prk = Hkdf::<Sha256>::new(Some(salt), &ikm);
    let (mut cek, mut nonce) = ([0u8; 16], [0u8; 12]);
    prk.expand(b"Content-Encoding: aes128gcm\0", &mut cek).ok()?;
    prk.expand(b"Content-Encoding: nonce\0", &mut nonce).ok()?;
    Some((cek, nonce))
}

/// Abonenin `p256dh` ve `auth` anahtarlariyla govdeyi sifreler.
pub fn encrypt(payload: &[u8], p256dh: &str, auth: &str) -> Option<Vec<u8>> {
    if payload.len() > PAYLOAD_MAX {
        return None;
    }
    let ua_bytes = B64.decode(p256dh.trim_end_matches('=')).ok()?;
    let auth = B64.decode(auth.trim_end_matches('=')).ok()?;
    let ua_pub = PublicKey::from_sec1_bytes(&ua_bytes).ok()?;
    let eph = SecretKey::random(&mut OsRng);
    let as_pub = eph.public_key().to_encoded_point(false);
    let shared = diffie_hellman(eph.to_nonzero_scalar(), ua_pub.as_affine());
    let mut salt = [0u8; 16];
    OsRng.fill_bytes(&mut salt);
    let (cek, nonce) = derive(shared.raw_secret_bytes(), &auth, &ua_bytes, as_pub.as_bytes(), &salt)?;
    // Tek kayit: sonuna 0x02 ayiraci.
    let mut plain = payload.to_vec();
    plain.push(0x02);
    let ct = Aes128Gcm::new_from_slice(&cek).ok()?.encrypt(&Nonce::from(nonce), plain.as_ref()).ok()?;
    let mut body = Vec::with_capacity(86 + ct.len());
    body.extend_from_slice(&salt);
    body.extend_from_slice(&RECORD_SIZE.to_be_bytes());
    body.push(as_pub.as_bytes().len() as u8);
    body.extend_from_slice(as_pub.as_bytes());
    body.extend_from_slice(&ct);
    Some(body)
}

#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    Sent,
    /// 404/410: abonelik olu, satir silinmeli.
    Gone,
    Failed,
}

pub struct Target<'a> {
    pub endpoint: &'a str,
    pub p256dh: &'a str,
    pub auth: &'a str,
}

fn client() -> &'static reqwest::Client {
    static C: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    C.get_or_init(|| {
        reqwest::Client::builder().timeout(std::time::Duration::from_secs(10))
            .build().unwrap_or_default()
    })
}

pub async fn send(vapid: &Vapid, t: &Target<'_>, payload: &[u8]) -> Outcome {
    let (Some(body), Some(authz)) =
        (encrypt(payload, t.p256dh, t.auth), vapid.authorization(t.endpoint, chrono::Utc::now().timestamp()))
    else {
        return Outcome::Failed;
    };
    let res = client().post(t.endpoint)
        .header("Authorization", authz)
        .header("Content-Encoding", "aes128gcm")
        .header("Content-Type", "application/octet-stream")
        .header("TTL", "86400")
        .body(body)
        .send().await;
    match res {
        Ok(r) if r.status().is_success() => Outcome::Sent,
        Ok(r) if matches!(r.status().as_u16(), 404 | 410) => Outcome::Gone,
        Ok(r) => {
            tracing::warn!(status = %r.status(), "push reddedildi");
            Outcome::Failed
        }
        Err(e) => {
            tracing::warn!("push gonderilemedi: {e}");
            Outcome::Failed
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Abone tarafi: RFC 8291 §3.4 — sifre cozme.
    fn decrypt(body: &[u8], ua: &SecretKey, auth: &[u8]) -> Option<Vec<u8>> {
        let (salt, rest) = body.split_at(16);
        let idlen = *rest.get(4)? as usize;
        let as_pub = rest.get(5..5 + idlen)?;
        let ct = rest.get(5 + idlen..)?;
        let as_key = PublicKey::from_sec1_bytes(as_pub).ok()?;
        let ua_pub = ua.public_key().to_encoded_point(false);
        let shared = diffie_hellman(ua.to_nonzero_scalar(), as_key.as_affine());
        let (cek, nonce) = derive(shared.raw_secret_bytes(), auth, ua_pub.as_bytes(), as_pub, salt)?;
        let mut plain = Aes128Gcm::new_from_slice(&cek).ok()?.decrypt(&Nonce::from(nonce), ct).ok()?;
        (plain.pop() == Some(0x02)).then_some(plain)
    }

    #[test]
    fn sifrele_coz_gidis_donus() {
        let ua = SecretKey::random(&mut OsRng);
        let mut auth = [0u8; 16];
        OsRng.fill_bytes(&mut auth);
        let p256dh = B64.encode(ua.public_key().to_encoded_point(false).as_bytes());
        let body = encrypt("Merhaba ğüşiöç".as_bytes(), &p256dh, &B64.encode(auth)).expect("sifrelenir");
        assert_eq!(&body[16..20], &4096u32.to_be_bytes());
        assert_eq!(body[20], 65);
        assert_eq!(decrypt(&body, &ua, &auth).as_deref(), Some("Merhaba ğüşiöç".as_bytes()));
        // Bozuk anahtar / buyuk govde sifrelenmez.
        assert!(encrypt(b"x", "!!", &B64.encode(auth)).is_none());
        assert!(encrypt(&[0u8; 3001], &p256dh, &B64.encode(auth)).is_none());
    }

    #[test]
    fn vapid_anahtar_ve_imza() {
        let (private, public) = keygen();
        let v = Vapid::new(&private, "mailto:a@b.c").expect("anahtar");
        assert_eq!(v.public_key(), public);
        let h = v.authorization("https://fcm.googleapis.com/fcm/send/abc", 1_000).expect("imza");
        assert!(h.starts_with("vapid t=") && h.ends_with(&format!("k={public}")));
        let jwt = h.trim_start_matches("vapid t=").split(',').next().unwrap_or("");
        let parts: Vec<&str> = jwt.split('.').collect();
        assert_eq!(parts.len(), 3);
        let claims = B64.decode(parts[1]).unwrap_or_default();
        assert!(String::from_utf8_lossy(&claims).contains("https://fcm.googleapis.com"));
        assert_eq!(B64.decode(parts[2]).map(|s| s.len()).ok(), Some(64));
        assert!(Vapid::new("", "x").is_none());
        assert!(v.authorization("http://insecure", 0).is_none());
    }
}
