//! `PATCH /api/me/profile` — kisi KENDI profilini yazar (baskasininkini degil).
//!
//! Alanlar: takma ad, telefon, dogum gunu (gun+ay, yil istege bagli), profil
//! fotografi. Yetenek gerekmez; kimlik oturumdan gelir. Telefon zorunlu ama
//! burada reddedilmez: bos kalabilir, `meta.me.profile_complete` on yuzu
//! yonlendirir (ilk giris telefonsuz olusur).
//!
//! Istisna: `PATCH /api/users/{id}/name` (ad, `users.name`) yalniz
//! `edit_user_names` kapsamiyla — kendi ya da baskasinin adi. Kapsam yoksa
//! ad herkes icin salt okunur.

use chrono::Utc;
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::{
    db::profile as db,
    domain::common,
    error::{AppError, Result},
    models::user::User,
    state::AppState,
};

const NICK_MAX: usize = 40;
const PHONE_MAX: usize = 30;
const NAME_MAX: usize = 200;

/// Ad degisikligi. Kapsam kontrolu `active` uzerinden: admin zaten tum
/// kapsamlara sahip (scope.rs), bu yuzden ayrica `is_admin` bakmaya gerek yok.
#[derive(Deserialize)]
pub(crate) struct NameIn {
    name: String,
}

pub(crate) async fn rename(st: &AppState, me: &User, id: Uuid, p: NameIn) -> Result<()> {
    if !common::has_scope(st, me, "edit_user_names").await? {
        return Err(AppError::Denied("name_not_allowed"));
    }
    let name = common::text(Some(p.name), NAME_MAX, "invalid_name")?
        .ok_or(AppError::BadRequest("invalid_name"))?;
    let n = db::set_name(&st.pool, id, &name).await?;
    if n == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// Verilmeyen alan DEGISMEZ, `null` siler.
#[derive(Deserialize)]
pub(crate) struct ProfilePatch {
    #[serde(default, deserialize_with = "crate::domain::common::present")]
    nickname: Option<Option<String>>,
    #[serde(default, deserialize_with = "crate::domain::common::present")]
    phone: Option<Option<String>>,
    /// Gun ve ay BIRLIKTE gelir ya da birlikte `null` olur.
    #[serde(default, deserialize_with = "crate::domain::common::present")]
    birth_day: Option<Option<i16>>,
    #[serde(default, deserialize_with = "crate::domain::common::present")]
    birth_month: Option<Option<i16>>,
    #[serde(default, deserialize_with = "crate::domain::common::present")]
    birth_year: Option<Option<i16>>,
    /// Kendi yukledigi ek; `null` fotografi kaldirir.
    #[serde(default, deserialize_with = "crate::domain::common::present")]
    avatar_id: Option<Option<Uuid>>,
}

/// Telefon: rakam, bosluk, `+ - ( )`; en az 7 rakam.
fn phone_ok(p: &str) -> bool {
    p.chars().all(|c| c.is_ascii_digit() || " +-()".contains(c))
        && p.chars().filter(char::is_ascii_digit).count() >= 7
}

pub(crate) async fn patch(st: &AppState, me: &User, p: ProfilePatch) -> Result<()> {
    let mut tx = st.pool.begin().await?;
    let old = db::find_for_update(&mut *tx, me.id).await?;

    let nickname = match p.nickname {
        Some(v) => common::text(v, NICK_MAX, "invalid_nickname")?,
        None => old.nickname,
    };
    let phone = match p.phone {
        Some(v) => {
            let v = common::text(v, PHONE_MAX, "invalid_phone")?;
            if v.as_deref().is_some_and(|s| !phone_ok(s)) {
                return Err(AppError::BadRequest("invalid_phone"));
            }
            v
        }
        None => old.phone,
    };
    let day = p.birth_day.unwrap_or(old.birth_day);
    let month = p.birth_month.unwrap_or(old.birth_month);
    let year = p.birth_year.unwrap_or(old.birth_year);
    if day.is_some() != month.is_some() || (year.is_some() && month.is_none()) {
        return Err(AppError::BadRequest("invalid_birthday"));
    }
    if let (Some(d), Some(m)) = (day, month) {
        // 29 Subat yilsiz dogum gunu icin gecerli (artik yil varsayilir).
        let y = year.map_or(2000, i32::from);
        if chrono::NaiveDate::from_ymd_opt(y, m as u32, d as u32).is_none() {
            return Err(AppError::BadRequest("invalid_birthday"));
        }
    }
    let avatar = match p.avatar_id {
        Some(Some(a)) => {
            // Yalniz kendi yukledigi, silinmemis, profil sinirindaki gorsel (spec/83 §4.1).
            let ok = db::check_avatar(&mut *tx, a, me.id, crate::media::Purpose::Avatar.max_bytes() as i64).await?;
            if !ok {
                return Err(AppError::BadRequest("invalid_avatar"));
            }
            Some(a)
        }
        Some(None) => None,
        None => old.avatar_id,
    };
    db::update_profile(&mut *tx, me.id, db::ProfileRow {
        nickname, phone, birth_day: day, birth_month: month, birth_year: year, avatar_id: avatar,
    }).await?;
    tx.commit().await?;
    Ok(())
}

/// `GET /api/me/export` — kisinin KENDI verisi, JSON indirme (spec/82 §3.5).
/// Ek dosyalari yok (kimlikleriyle listelenmez bile: mesaj metni yeter).
pub(crate) async fn export(st: &AppState, me: &User) -> Result<serde_json::Value> {
    let profile = db::find_export(&st.pool, me.id).await?;
    let teams = db::list_team_names(&st.pool, me.id).await?;
    let records = db::list_records(&st.pool, me.id).await?;
    let messages = db::list_messages(&st.pool, me.id).await?;
    let body = json!({
        "exported_at": Utc::now(),
        "profile": {
            "email": profile.email, "name": profile.name, "nickname": profile.nickname,
            "phone": profile.phone, "birth_day": profile.birth_day, "birth_month": profile.birth_month,
            "birth_year": profile.birth_year, "notify_level": profile.notify_level,
            "created_at": profile.created_at, "last_login_at": profile.last_login_at,
        },
        "teams": teams,
        "bank_accounts": crate::domain::bank_accounts::list_of(st, me.id).await?,
        "records": records.into_iter().map(|r|
            json!({ "id": r.id, "title": r.title, "description": r.description, "created_at": r.created_at })).collect::<Vec<_>>(),
        "messages": messages.into_iter().map(|(chat_id, body, created_at)|
            json!({ "chat_id": chat_id, "body": body, "created_at": created_at })).collect::<Vec<_>>(),
    });
    Ok(body)
}
