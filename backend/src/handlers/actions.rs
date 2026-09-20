//! `routes/actions.rs` karsiligi — istek govdesi, yetki, YAZMA yolu.

use axum::{
    extract::{Path, State},
    response::{Html, IntoResponse, Response},
    Form,
};
use minijinja::context;
use serde::Deserialize;
use std::collections::HashMap;
use uuid::Uuid;

use crate::{
    auth::CurrentUser,
    error::{AppError, Result},
    handlers::records::editable,
    models::{action::Action, record::Record},
    render,
    state::AppState,
};

#[derive(Deserialize)]
pub struct NewAction {
    title: String,
    #[serde(default)]
    owner_id: String,
    #[serde(default)]
    due_date: String,
}

/// Eylem seridini yeniden ciz. Ekleme ve durum degisimi AYNI parcayi
/// donduruyor — htmx yerine koyuyor, sayfa yenilenmiyor.
async fn strip(st: &AppState, u: &crate::models::user::User, record_id: Uuid) -> Result<Response> {
    let people = render::all_users(st).await?;
    let actions = Action::of_record(&st.pool, record_id, &people).await?;
    let tpl = st.tpl.get_template("shared/actions.html")?;
    Ok(Html(tpl.render(context! {
        actions => actions,
        action_status => crate::models::action::ACTION_STATUS.iter().copied()
            .collect::<std::collections::BTreeMap<_, _>>(),
        item => context! { id => record_id },
        can_edit => true,
        // Son tarih AYRI kapsam ister (edit_deadline): kural hem kayit
        // alanina hem eyleme AYNI sekilde uygulaniyor.
        can_edit_deadline => u.is_admin,
        user_options => people.iter()
            .map(|p| (p.id.to_string(), p.name.clone()))
            .collect::<Vec<_>>(),
        user => u,
        csrf_token => "",
    })?).into_response())
}

/// Kayda eylem ekle. Eylem uclari da KART YETKISINDEN geciyor — ayri bir
/// kapi yok.
pub async fn create(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    Path(id): Path<Uuid>,
    Form(f): Form<NewAction>,
) -> Result<Response> {
    let rec = editable(&st, &u, id).await?;
    let title = f.title.trim();
    if title.is_empty() {
        return Err(AppError::BadRequest("başlıksız eylem".into()));
    }
    sqlx::query(
        "insert into actions (record_id, title, owner_id, created_by, due_date)
         values ($1, $2, $3, $4, $5)")
        .bind(id).bind(title)
        .bind(f.owner_id.trim().parse::<Uuid>().ok())
        .bind(u.id)
        .bind(f.due_date.trim().parse::<chrono::NaiveDate>().ok())
        .execute(&st.pool).await?;

    note(&st, &rec, u.id, &format!("eylem eklendi: {title}")).await?;
    strip(&st, &u, id).await
}

pub async fn update(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    Path(action_id): Path<Uuid>,
    Form(form): Form<HashMap<String, String>>,
) -> Result<Response> {
    let (record_id, title): (Uuid, String) = sqlx::query_as(
        "select record_id, title from actions where id = $1")
        .bind(action_id).fetch_optional(&st.pool).await?
        .ok_or_else(|| AppError::NotFound("eylem yok".into()))?;

    // Yetki EYLEMIN kendisinde degil KAYDINDA: eylem kaydin parcasi.
    let rec = editable(&st, &u, record_id).await?;

    if let Some(status) = form.get("status") {
        let ok = ["open", "in_progress", "closed", "cancelled"].contains(&status.as_str());
        if !ok {
            return Err(AppError::BadRequest("geçersiz durum".into()));
        }
        let done = matches!(status.as_str(), "closed" | "cancelled");
        sqlx::query(
            "update actions set status = $1,
                    resolved_by = case when $2 then $3 else null end,
                    resolved_at = case when $2 then now() else null end
              where id = $4")
            .bind(status).bind(done).bind(u.id).bind(action_id)
            .execute(&st.pool).await?;
        if done {
            note(&st, &rec, u.id, &format!("eylem kapandı: {title}")).await?;
        }
    }
    if let Some(owner) = form.get("owner_id") {
        sqlx::query("update actions set owner_id = $1 where id = $2")
            .bind(owner.trim().parse::<Uuid>().ok()).bind(action_id)
            .execute(&st.pool).await?;
    }
    if let Some(due) = form.get("due_date") {
        sqlx::query("update actions set due_date = $1 where id = $2")
            .bind(due.trim().parse::<chrono::NaiveDate>().ok()).bind(action_id)
            .execute(&st.pool).await?;
    }
    strip(&st, &u, record_id).await
}

/// Kaydin akisina sistem bildirimi.
async fn note(st: &AppState, rec: &Record, actor: Uuid, text: &str) -> Result<()> {
    sqlx::query(
        "insert into activity (chat_id, actor_id, verb, subject_label, detail)
         values ($1, $2, 'action', $3, $4)")
        .bind(rec.chat_id).bind(actor).bind(&rec.title).bind(text)
        .execute(&st.pool).await?;
    Ok(())
}

/// ACIK EYLEMI VARKEN kayit kapanamaz (spec/20 §3a). Eylem ayri bir akis
/// degil, kaydin kapanma sartinin parcasi.
pub async fn open_count(st: &AppState, record_id: Uuid) -> Result<i64> {
    Ok(sqlx::query_scalar::<_, i64>(
        "select count(*) from actions
          where record_id = $1 and status in ('open','in_progress')")
        .bind(record_id).fetch_one(&st.pool).await?)
}
