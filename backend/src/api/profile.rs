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

use axum::{extract::{Path, State}, http::StatusCode};
use serde::Deserialize;
use uuid::Uuid;

use crate::{
    api::common::{self, Body},
    auth::CurrentUser,
    error::{AppError, Result},
    state::AppState,
};

const NICK_MAX: usize = 40;
const PHONE_MAX: usize = 30;
const NAME_MAX: usize = 200;

/// Ad degisikligi. Kapsam kontrolu `active` uzerinden: admin zaten tum
/// kapsamlara sahip (scope.rs), bu yuzden ayrica `is_admin` bakmaya gerek yok.
#[derive(Deserialize)]
pub struct NameIn {
    name: String,
}

pub async fn rename(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(p): Body<NameIn>,
) -> Result<StatusCode> {
    if !common::has_scope(&st, &me, "edit_user_names").await? {
        return Err(AppError::Denied("name_not_allowed"));
    }
    let id = common::id(&raw)?;
    let name = common::text(Some(p.name), NAME_MAX, "invalid_name")?
        .ok_or(AppError::BadRequest("invalid_name"))?;
    let n = sqlx::query("update users set name = $2 where id = $1")
        .bind(id).bind(&name).execute(&st.pool).await?.rows_affected();
    if n == 0 {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

/// Verilmeyen alan DEGISMEZ, `null` siler.
#[derive(Deserialize)]
pub struct ProfilePatch {
    #[serde(default, deserialize_with = "common::present")]
    nickname: Option<Option<String>>,
    #[serde(default, deserialize_with = "common::present")]
    phone: Option<Option<String>>,
    /// Gun ve ay BIRLIKTE gelir ya da birlikte `null` olur.
    #[serde(default, deserialize_with = "common::present")]
    birth_day: Option<Option<i16>>,
    #[serde(default, deserialize_with = "common::present")]
    birth_month: Option<Option<i16>>,
    #[serde(default, deserialize_with = "common::present")]
    birth_year: Option<Option<i16>>,
    /// Kendi yukledigi ek; `null` fotografi kaldirir.
    #[serde(default, deserialize_with = "common::present")]
    avatar_id: Option<Option<Uuid>>,
}

/// Telefon: rakam, bosluk, `+ - ( )`; en az 7 rakam.
fn phone_ok(p: &str) -> bool {
    p.chars().all(|c| c.is_ascii_digit() || " +-()".contains(c))
        && p.chars().filter(char::is_ascii_digit).count() >= 7
}

pub async fn patch(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(p): Body<ProfilePatch>,
) -> Result<StatusCode> {
    let mut tx = st.pool.begin().await?;
    #[derive(sqlx::FromRow)]
    struct Row {
        nickname: Option<String>,
        phone: Option<String>,
        birth_day: Option<i16>,
        birth_month: Option<i16>,
        birth_year: Option<i16>,
        avatar_id: Option<Uuid>,
    }
    let old: Row = sqlx::query_as(
        "select nickname, phone, birth_day, birth_month, birth_year, avatar_id
           from users where id = $1 for update")
        .bind(me.id).fetch_one(&mut *tx).await?;

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
            // Yalniz kendi yukledigi, silinmemis ek.
            let ok: bool = sqlx::query_scalar(
                "select exists(select 1 from attachments
                                where id = $1 and uploader_id = $2 and deleted_at is null)")
                .bind(a).bind(me.id).fetch_one(&mut *tx).await?;
            if !ok {
                return Err(AppError::BadRequest("invalid_avatar"));
            }
            Some(a)
        }
        Some(None) => None,
        None => old.avatar_id,
    };
    sqlx::query(
        "update users set nickname = $2, phone = $3, birth_day = $4, birth_month = $5,
                          birth_year = $6, avatar_id = $7 where id = $1")
        .bind(me.id).bind(nickname).bind(phone).bind(day).bind(month).bind(year).bind(avatar)
        .execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}
