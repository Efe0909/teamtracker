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

/// Akis bildiriminde gorunen alan adi: "önceliği Orta → Düşük".
fn field_label(field: &str) -> &'static str {
    match field {
        "status" => "durumu",
        "priority" => "önceliği",
        "owner_id" => "sorumlusu",
        "team_id" => "takımı",
        "pillar_id" => "pillar'ı",
        _ => "son tarihi",
    }
}

/// Bos dizgi = ALANI BOSALT. Bozuk metin = HATA.
///
/// `parse().ok()` kullanmak ikisini birlestirirdi ve "abc" yazan kullanici
/// alaninin SESSIZCE bosaldigini gorurdu — yazma niyeti vardi, yok sayilmasi
/// veri kaybi olur.
fn opt_uuid(value: &str) -> Result<Option<Uuid>> {
    if value.is_empty() {
        return Ok(None);
    }
    value.parse().map(Some)
        .map_err(|_| AppError::BadRequest("geçersiz kimlik".into()))
}

fn opt_date(value: &str) -> Result<Option<chrono::NaiveDate>> {
    if value.is_empty() {
        return Ok(None);
    }
    value.parse().map(Some)
        .map_err(|_| AppError::BadRequest("geçersiz tarih".into()))
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

#[derive(serde::Deserialize)]
pub struct NewRecord {
    title: String,
    unit_id: String,
    #[serde(default)]
    kind: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    priority: String,
}

/// Yeni kayit.
///
/// `chat_id` NOT NULL: sohbet kayitla AYNI islemde dogar. Islem sart —
/// yarida kalirsa sahipsiz bir `chats` satiri kalirdi.
pub async fn create(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    Form(f): Form<NewRecord>,
) -> Result<Response> {
    let title = f.title.trim();
    if title.is_empty() {
        return Err(AppError::BadRequest("başlıksız kayıt".into()));
    }
    // Gecersiz dugum kimligi 400: istek bozuk. Kapsam disi dugum 403: istek
    // dogru ama yetki yok. Ikisi AYRI cevap.
    let unit: Uuid = f.unit_id.trim().parse()
        .map_err(|_| AppError::BadRequest("geçersiz düğüm".into()))?;

    {
        let tree = st.tree.read().expect("agac kilidi");
        let node = tree.get(unit)
            .ok_or_else(|| AppError::BadRequest("düğüm yok".into()))?;
        // Kayit TAKIM ya da PILLAR dugumune baglanmaz (spec §10): onlarin
        // kendi alanlari var (team_id, pillar_id).
        if !node.node_type.is_unit() {
            return Err(AppError::BadRequest("bu düğüm tipine kayıt açılamaz".into()));
        }
    }
    if !crate::db::scope::can_create_in(&st.pool, &u, unit, &st.tree).await? {
        return Err(AppError::Forbidden("bu dalda kayıt açma yetkin yok".into()));
    }

    let kind = if f.kind.trim() == "task" { "task" } else { "issue" };
    let priority = match f.priority.trim() {
        p @ ("critical" | "high" | "low") => p,
        _ => "medium",
    };

    let mut tx = st.pool.begin().await?;
    let chat: Uuid = sqlx::query_scalar("insert into chats default values returning id")
        .fetch_one(&mut *tx).await?;
    let id: Uuid = sqlx::query_scalar(
        "insert into records (unit_id, chat_id, kind, title, description, priority, created_by)
         values ($1, $2, $3, $4, nullif($5, \'\'), $6, $7) returning id")
        .bind(unit).bind(chat).bind(kind).bind(title)
        .bind(f.description.trim()).bind(priority).bind(u.id)
        .fetch_one(&mut *tx).await?;
    // Acan kisi kendiliginden katilimci: kendi actigi kaydin akisini gormeli.
    sqlx::query("insert into record_participants (record_id, user_id) values ($1, $2)")
        .bind(id).bind(u.id).execute(&mut *tx).await?;
    tx.commit().await?;

    Ok(axum::response::Redirect::to(&format!("/tasks/{id}")).into_response())
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
            .bind(opt_uuid(value)?).bind(id).execute(&st.pool).await?; }
        "team_id" => { sqlx::query("update records set team_id = $1 where id = $2")
            .bind(opt_uuid(value)?).bind(id).execute(&st.pool).await?; }
        "pillar_id" => {
            // Pillar ALANINA yalniz pillar TIPLI dugum yazilabilir. Tanim
            // agacta (node_type='pillar'), tek kaynak — FK tek basina bunu
            // tutmuyor, cunku FK butun nodes'u kabul ediyor.
            let pid = opt_uuid(value)?;
            if let Some(p) = pid {
                let is_pillar = {
                    let tree = st.tree.read().expect("agac kilidi");
                    tree.get(p).map(|n| n.node_type == crate::models::enums::NodeType::Pillar)
                };
                if is_pillar != Some(true) {
                    return Err(AppError::BadRequest("pillar olmayan düğüm seçilemez".into()));
                }
            }
            sqlx::query("update records set pillar_id = $1 where id = $2")
                .bind(pid).bind(id).execute(&st.pool).await?;
        }
        _ => { sqlx::query("update records set due_date = $1 where id = $2")
            .bind(opt_date(value)?).bind(id).execute(&st.pool).await?; }
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
        .bind(format!("{} {} → {}", field_label(field), pretty(&before), pretty(value)))
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
