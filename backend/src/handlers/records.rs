//! Kayit yazma. updated_at`i ELLE surme — tetikleyici var (TASK-282).
//! unit_id yazarken UNIT_TYPES kontrolu SART: dropdown`i suzmek istemciyi
//! duzeltir, ucu degil.

use axum::{
    extract::{Path, State},
    response::{Html, IntoResponse, Response},
    Form,
};
use minijinja::context;
use std::collections::HashMap;
use uuid::Uuid;

use crate::{
    auth::CurrentUser,
    models::user::User,
    error::{AppError, Result},
    models::record::{Record, PRIORITIES, STATUSES},
    render,
    state::AppState,
};

/// Degistirilebilir alanlar ve (varsa) gecerli degerleri.
///
/// BEYAZ LISTE: sutun adi kullanici girdisinden gelemez (KNOW-104). Listede
/// olmayan alan sessizce degil ACIKCA reddedilir — yazma niyeti vardi.
fn is_editable_field(field: &str) -> bool {
    matches!(field, "status" | "priority" | "owner_id" | "due_date" | "team_id" | "pillar_id")
}

/// Kaydi getir ve DEGISTIRME yetkisini kontrol et.
///
/// 403 yalniz DEGISTIREN uclarda (KNOW-47): gorulme genel, degistirme
/// kapsamli. Bu yuzden okuma yollari bunu cagirmiyor.
pub async fn editable(st: &AppState, u: &User, id: Uuid) -> Result<Record> {
    let rec = Record::fetch(&st.pool, id).await?
        .ok_or_else(|| AppError::NotFound("kayıt yok".into()))?;
    let allowed = crate::db::scope::can_edit_record(&st.pool, u, &rec, &st.tree).await?;
    if !allowed {
        return Err(AppError::Forbidden("bu kayıtta yetkin yok".into()));
    }
    Ok(rec)
}

fn label_of(field: &str, value: &str) -> String {
    let table = match field {
        "status" => STATUSES,
        "priority" => PRIORITIES,
        _ => return value.to_string(),
    };
    table.iter().find(|(k, _)| *k == value).map(|(_, v)| v.to_string())
        .unwrap_or_else(|| value.to_string())
}

pub async fn create() -> Response {
    todo!("records::create")
}


/// Alan degisimi. Akisa ZAMAN DAMGALI bir bildirim birakir — degisiklik
/// sessizce olmaz (KNOW-266: dialog zaten bilissel maliyet ekliyor, iz de
/// kalmali).
///
/// Yanit IKI parca birden: alan seridi ve akis (`hx-swap-oob`). Tek istekte
/// ikisi de tazelensin diye — yoksa bildirim ancak sayfa yenilenince gorunur.
pub async fn change_field(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    Path(id): Path<Uuid>,
    Form(form): Form<HashMap<String, String>>,
) -> Result<Response> {
    let rec = editable(&st, &u, id).await?;

    let (field, value) = form.iter().find(|(k, _)| is_editable_field(k))
        .ok_or_else(|| AppError::BadRequest("düzenlenebilir alan yok".into()))?;
    let value = value.trim();

    let before = match field.as_str() {
        "status" => rec.status.clone(),
        "priority" => rec.priority.clone(),
        "owner_id" => rec.owner_id.map(|i| i.to_string()).unwrap_or_default(),
        "team_id" => rec.team_id.map(|i| i.to_string()).unwrap_or_default(),
        "pillar_id" => rec.pillar_id.map(|i| i.to_string()).unwrap_or_default(),
        _ => rec.due_date.map(|d| d.to_string()).unwrap_or_default(),
    };

    // ACIK EYLEMI VARKEN kayit KAPANAMAZ (spec/20 §3a). 400: istek bicimsel
    // olarak dogru ama su anda yapilamaz — 403 degil, yetki sorunu degil.
    if field == "status" && value == "closed" {
        let open = crate::handlers::actions::open_count(&st, id).await?;
        if open > 0 {
            return Err(AppError::BadRequest(
                format!("{open} açık eylem var; önce onları kapat")));
        }
    }

    // Sutun adi SABIT dallardan geliyor, girdi yalniz DEGER olarak baglaniyor.
    // sqlx zaten dinamik sorgu dizgisini reddediyor; bu dallanma o kurali
    // okunur kiliyor.
    match field.as_str() {
        "status" => { sqlx::query("update records set status = $1 where id = $2")
            .bind(value).bind(id).execute(&st.pool).await?; }
        "priority" => { sqlx::query("update records set priority = $1 where id = $2")
            .bind(value).bind(id).execute(&st.pool).await?; }
        "owner_id" => { sqlx::query("update records set owner_id = $1 where id = $2")
            .bind(value.parse::<Uuid>().ok()).bind(id).execute(&st.pool).await?; }
        "team_id" => { sqlx::query("update records set team_id = $1 where id = $2")
            .bind(value.parse::<Uuid>().ok()).bind(id).execute(&st.pool).await?; }
        "pillar_id" => { sqlx::query("update records set pillar_id = $1 where id = $2")
            .bind(value.parse::<Uuid>().ok()).bind(id).execute(&st.pool).await?; }
        _ => { sqlx::query("update records set due_date = $1 where id = $2")
            .bind(value.parse::<chrono::NaiveDate>().ok()).bind(id).execute(&st.pool).await?; }
    }
    // updated_at ELLE surulmuyor — tetikleyici yapiyor (TASK-282).

    let people = render::all_users(&st).await?;
    let name_of = |v: &str| people.iter().find(|p| p.id.to_string() == v)
        .map(|p| p.name.clone());
    let pretty = |v: &str| match field.as_str() {
        "owner_id" => name_of(v).unwrap_or_else(|| "—".into()),
        _ if v.is_empty() => "—".into(),
        _ => label_of(field, v),
    };

    sqlx::query(
        "insert into activity (chat_id, actor_id, verb, subject_label, detail)
         values ($1, $2, $3, $4, $5)")
        .bind(rec.chat_id).bind(u.id).bind("field_changed")
        .bind(&rec.title)
        .bind(format!("{} → {}", pretty(&before), pretty(value)))
        .execute(&st.pool).await?;

    // Alan seridi + akis, tek yanitta. `oob_feed` sablona akisin
    // hx-swap-oob ile gelecegini soyluyor.
    let ctx = crate::handlers::dashboard::record_ctx(&st, &u, id).await?;
    // Bayraklar ONCE: minijinja `..a, ..b` birlestirmesinde ILK kaynak
    // kazaniyor ve `record_ctx` icinde ikisi de `false`.
    //   card_fields.html -> oob_feed   (akisin ayrica gelecegini bilir)
    //   feed.html        -> oob        (kendi hx-swap-oob'unu yazar)
    let flags = context! { oob => true, oob_feed => true };
    let tpl = st.tpl.get_template("dashboard/fragments/card_fields.html")?;
    let fields = tpl.render(context! { ..flags.clone(), ..ctx.clone() })?;
    let feed_tpl = st.tpl.get_template("shared/feed.html")?;
    let feed = feed_tpl.render(context! { ..flags, ..ctx })?;

    Ok(Html(format!("{fields}\n{feed}")).into_response())
}
