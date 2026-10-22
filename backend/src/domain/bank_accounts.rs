//! Hesap numaralarim (spec/82 §4): kisi KENDI hesaplarini yazar ve okur.
//!
//! Tam IBAN yalniz sahibine doner; baskasinin hesabi hicbir liste ucunda yok
//! (Maliye yalniz fatura ayrintisinda, spec/81 §11). Silme yumusak: IBAN
//! bosalir, son dort hane kalir (fatura bagi `restrict`). Her yazma guncel
//! listeyi doner: ekran tek cevapla tazelenir.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    db::bank_accounts as db,
    domain::common,
    error::{AppError, Result},
    state::AppState,
};

const MAX_ACCOUNTS: i64 = 5;
const LABEL_MAX: usize = 60;
const HOLDER_MAX: usize = 200;

#[derive(Serialize)]
pub(crate) struct BankAccount {
    id: Uuid,
    label: String,
    holder_name: String,
    iban: Option<String>,
    iban_last4: String,
    is_default: bool,
    created_at: DateTime<Utc>,
}

impl From<db::BankAccountRow> for BankAccount {
    fn from(r: db::BankAccountRow) -> Self {
        Self { id: r.id, label: r.label, holder_name: r.holder_name, iban: r.iban,
            iban_last4: r.iban_last4, is_default: r.is_default, created_at: r.created_at }
    }
}

/// IBAN: bosluk atilir, buyuk harfe; ulke kodu + 2 kontrol hanesi + 11..30
/// alfasayisal, TR'de toplam 26, mod-97 = 1 (ISO 13616). Gecersizse None.
pub(crate) fn iban(raw: &str) -> Option<String> {
    let s: String = raw.chars().filter(|c| !c.is_whitespace()).collect::<String>().to_ascii_uppercase();
    let b = s.as_bytes();
    if !(15..=34).contains(&b.len()) || !b.iter().all(u8::is_ascii_alphanumeric) {
        return None;
    }
    if !b[..2].iter().all(u8::is_ascii_alphabetic) || !b[2..4].iter().all(u8::is_ascii_digit) {
        return None;
    }
    if &s[..2] == "TR" && b.len() != 26 {
        return None;
    }
    (mod97(&format!("{}{}", &s[4..], &s[..4])) == 1).then_some(s)
}

/// Harf = 10..35, rakam kendisi; kalan basamak basamak (taşma yok).
fn mod97(s: &str) -> u32 {
    s.chars().fold(0u32, |r, c| {
        let v = c.to_digit(36).unwrap_or(0);
        if v >= 10 { (r * 100 + v) % 97 } else { (r * 10 + v) % 97 }
    })
}

pub(crate) async fn list_of(st: &AppState, user: Uuid) -> Result<Vec<BankAccount>> {
    Ok(db::list_accounts(&st.pool, user).await?.into_iter().map(BankAccount::from).collect())
}

pub(crate) async fn list(st: &AppState, user: Uuid) -> Result<Vec<BankAccount>> {
    list_of(st, user).await
}

#[derive(Deserialize)]
pub(crate) struct NewAccount {
    label: String,
    holder_name: String,
    iban: String,
}

pub(crate) async fn create(st: &AppState, me: Uuid, b: NewAccount) -> Result<Vec<BankAccount>> {
    let label = common::text(Some(b.label), LABEL_MAX, "invalid_account_label")?.ok_or(AppError::BadRequest("invalid_account_label"))?;
    let holder = common::text(Some(b.holder_name), HOLDER_MAX, "invalid_holder")?
        .ok_or(AppError::BadRequest("invalid_holder"))?;
    let iban = iban(&b.iban).ok_or(AppError::BadRequest("invalid_iban"))?;
    let mut tx = st.pool.begin().await?;
    // Sayim ve ilk-hesap-varsayilan karari ayni kilit altinda.
    db::lock_user(&mut *tx, me).await?;
    let n = db::count_accounts(&mut *tx, me).await?;
    if n >= MAX_ACCOUNTS {
        return Err(AppError::BadRequest("too_many_accounts"));
    }
    db::insert_account(&mut *tx, me, &label, &holder, &iban, n == 0).await?;
    tx.commit().await?;
    list_of(st, me).await
}

#[derive(Deserialize)]
pub(crate) struct AccountPatch {
    #[serde(default)]
    label: Option<String>,
    #[serde(default)]
    holder_name: Option<String>,
    /// Yalniz `true`: varsayilan yapar. Varsayilansiz kalmak yok.
    #[serde(default)]
    is_default: Option<bool>,
}

/// Kendi, silinmemis hesabi; degilse 404 (baskasinin hesabinin varligi sizmaz).
async fn own(tx: &mut sqlx::PgConnection, me: Uuid, id: Uuid) -> Result<bool> {
    db::find_owned_default(tx, me, id).await?.ok_or(AppError::NotFound)
}

pub(crate) async fn patch(st: &AppState, me: Uuid, id: Uuid, p: AccountPatch) -> Result<Vec<BankAccount>> {
    let mut tx = st.pool.begin().await?;
    own(&mut tx, me, id).await?;
    if let Some(l) = p.label {
        let l = common::text(Some(l), LABEL_MAX, "invalid_account_label")?.ok_or(AppError::BadRequest("invalid_account_label"))?;
        db::set_label(&mut *tx, id, &l).await?;
    }
    if let Some(h) = p.holder_name {
        let h = common::text(Some(h), HOLDER_MAX, "invalid_holder")?.ok_or(AppError::BadRequest("invalid_holder"))?;
        db::set_holder(&mut *tx, id, &h).await?;
    }
    match p.is_default {
        Some(true) => {
            db::clear_defaults(&mut *tx, me).await?;
            db::set_default(&mut *tx, id).await?;
        }
        Some(false) => return Err(AppError::BadRequest("invalid_default")),
        None => {}
    }
    tx.commit().await?;
    list_of(st, me).await
}

/// Yumusak silme: IBAN gider, son dort hane kalir. Varsayilan silinirse en yeni
/// hesap varsayilan olur.
pub(crate) async fn delete(st: &AppState, me: Uuid, id: Uuid) -> Result<Vec<BankAccount>> {
    let mut tx = st.pool.begin().await?;
    let was_default = own(&mut tx, me, id).await?;
    db::delete_account(&mut *tx, id).await?;
    if was_default {
        db::set_latest_default(&mut *tx, me).await?;
    }
    tx.commit().await?;
    list_of(st, me).await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Uydurma BBAN'a gecerli kontrol hanesi koyar (gercek hesap degil).
    fn make(cc: &str, bban: &str) -> String {
        let check = 98 - mod97(&format!("{bban}{cc}00"));
        format!("{cc}{check:02}{bban}")
    }

    #[test]
    fn iban_dogrulama() {
        let tr = make("TR", "0001000000000000000000");
        assert_eq!(tr.len(), 26);
        assert_eq!(iban(&tr).as_deref(), Some(tr.as_str()));
        // Bosluk ve kucuk harf normalize edilir.
        let spaced = tr.to_lowercase().chars().enumerate()
            .flat_map(|(i, c)| if i > 0 && i % 4 == 0 { vec![' ', c] } else { vec![c] }).collect::<String>();
        assert_eq!(iban(&spaced).as_deref(), Some(tr.as_str()));
        // Tek hane degisirse saglama tutmaz.
        let mut bad = tr.clone().into_bytes();
        bad[10] = if bad[10] == b'1' { b'2' } else { b'1' };
        assert_eq!(iban(&String::from_utf8_lossy(&bad)), None);
        // TR 26 hane olmali; baska ulke kendi uzunlugunda gecer.
        assert_eq!(iban(&make("TR", "000100000000000000000")), None);
        assert!(iban(&make("DE", "370400440532013000")).is_some());
        assert_eq!(iban("TR12 ABC"), None);
        assert_eq!(iban("1234567890123456"), None);
    }
}
