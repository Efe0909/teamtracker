//! Kart bloklari (R4-F01, F02, F12): kayit govdesine yapisan yeniden
//! kullanilabilir kutular — medya, toplanti plani, havuz karti.
//!
//! Tur listesi KODDA (Python `cards.CARD_TYPES`), veri `cards.data` jsonb'de.
//! `card_type`'ta CHECK yok: taninmayan tur ekranda BOZUK cizilir (KNOW-280),
//! verisi gitmez, silinebilir. Alanlar BEYAZ LISTE: istemci ne gonderirse
//! gondersin jsonb'ye tanimsiz anahtar girmez.
//!
//! Katilim `data.signups` icinde (KNOW-281), yazim TEK `jsonb_set` ifadesi —
//! okuyup-degistirip-yazmak iki eszamanli cevaptan birini kaybederdi. Katilim
//! kaydi DUZENLEMEK degildir: oturumu olan herkes kendi adina cevap verir.

use std::collections::HashMap;

use axum::{
    extract::{Path, State},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use uuid::Uuid;

use crate::{
    api::{
        attachments::{self as att, AttachView},
        common::{self, Body},
        records::{self, Detail},
    },
    auth::CurrentUser,
    error::{AppError, Result},
    models::{enums::SignupAnswer, record::Record, user::User},
    state::AppState,
};

struct CardType {
    key: &'static str,
    fields: &'static [&'static str],
    /// Bu turde anlamli katilim cevaplari; bos = katilim yok.
    answers: &'static [SignupAnswer],
    media: bool,
}

/// Etiket, ipucu ve alan etiketleri on yuzde (`lib/cards.ts`); burada
/// davranis: hangi alan kabul edilir, hangi cevap anlamli.
const TYPES: [CardType; 3] = [
    CardType { key: "media", fields: &["description"], answers: &[], media: true },
    CardType {
        key: "meeting",
        fields: &["when", "place", "link", "agenda"],
        answers: &[SignupAnswer::Yes, SignupAnswer::Maybe, SignupAnswer::No],
        media: false,
    },
    // Havuzda "belki" yok: is ya alinir ya alinmaz.
    CardType { key: "pool", fields: &["need", "detail"], answers: &[SignupAnswer::Yes], media: false },
];

fn kind(t: &str) -> Option<&'static CardType> {
    TYPES.iter().find(|c| c.key == t)
}

const FIELD_MAX: usize = 4000;

/// Beyaz liste + dogrulama. `when` "2026-09-20T14:30" (datetime-local),
/// `link` yalniz http(s) — `javascript:` bir baglanti olarak cizilmesin.
fn clean(t: &CardType, title: Option<String>, data: &Map<String, Value>) -> Result<Value> {
    let mut out = Map::new();
    if let Some(title) = common::text(title, 200, "invalid_title")? {
        out.insert("title".into(), json!(title));
    }
    for f in t.fields {
        let raw = data.get(*f).and_then(Value::as_str).map(str::to_string);
        let Some(v) = common::text(raw, FIELD_MAX, "invalid_body")? else { continue };
        match *f {
            "when" if chrono::NaiveDateTime::parse_from_str(&v, "%Y-%m-%dT%H:%M").is_err() => {
                return Err(AppError::BadRequest("invalid_when"));
            }
            "link" if !(v.starts_with("https://") || v.starts_with("http://")) => {
                return Err(AppError::BadRequest("invalid_link"));
            }
            _ => {}
        }
        out.insert((*f).into(), json!(v));
    }
    Ok(Value::Object(out))
}

// --- okuma -----------------------------------------------------------------

#[derive(Serialize)]
pub struct Signup {
    user_id: Uuid,
    answer: String,
    note: Option<String>,
    at: Option<String>,
}

#[derive(Serialize)]
pub struct CardView {
    id: Uuid,
    card_type: String,
    /// Kodda tanimli tur mu. Degilse ekran BOZUK cizer (KNOW-280).
    known: bool,
    /// `title` + turun alanlari; katilim ayrica.
    data: Value,
    signups: Vec<Signup>,
    /// Yalniz medya kartinda; silinmis ek kartta gosterilmez.
    attachments: Vec<AttachView>,
}

/// Kaydin kartlari: TEK kart sorgusu, TEK ek sorgusu (N+1 yok).
pub async fn of_record(st: &AppState, me: &User, rec: &Record) -> Result<Vec<CardView>> {
    let rows: Vec<(Uuid, String, Value)> = sqlx::query_as(
        "select id, card_type, data from cards where record_id = $1 order by sort_order, created_at")
        .bind(rec.id).fetch_all(&st.pool).await?;
    if rows.is_empty() {
        return Ok(Vec::new());
    }
    let ids: Vec<Uuid> = rows.iter().map(|r| r.0).collect();
    let links: Vec<(Uuid, Uuid)> = sqlx::query_as(
        "select card_id, attachment_id from card_attachments where card_id = any($1)
          order by sort_order")
        .bind(&ids).fetch_all(&st.pool).await?;
    let mut media: HashMap<Uuid, Vec<AttachView>> = HashMap::new();
    if !links.is_empty() {
        let tag = att::can_tag(st, me, Some(rec), None).await?;
        let aids: Vec<Uuid> = links.iter().map(|l| l.1).collect();
        let mut views = att::views(&st.pool, me, &aids, tag).await?;
        for (card, a) in links {
            if let Some(v) = views.remove(&a).filter(|v| !v.deleted) {
                media.entry(card).or_default().push(v);
            }
        }
    }
    Ok(rows.into_iter().map(|(id, card_type, mut data)| {
        let signups = data.as_object_mut().and_then(|o| o.remove("signups"));
        let mut signups: Vec<Signup> = signups.and_then(|s| s.as_object().cloned()).unwrap_or_default()
            .into_iter().filter_map(|(uid, v)| Some(Signup {
                user_id: uid.parse().ok()?,
                answer: v.get("answer")?.as_str()?.to_string(),
                note: v.get("note").and_then(Value::as_str).map(str::to_string),
                at: v.get("at").and_then(Value::as_str).map(str::to_string),
            })).collect();
        signups.sort_by(|a, b| a.at.cmp(&b.at));
        CardView {
            known: kind(&card_type).is_some(),
            attachments: media.remove(&id).unwrap_or_default(),
            id, card_type, data, signups,
        }
    }).collect())
}

// --- yazma -----------------------------------------------------------------

#[derive(Deserialize)]
pub struct CardIn {
    #[serde(default)]
    card_type: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    data: Map<String, Value>,
}

/// Kayit acilirken de cagrilir (R4-F12, kart secici): ayni islem icinde.
pub async fn insert(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>, record: Uuid, me: Uuid, card_type: &str,
    title: Option<String>, data: &Map<String, Value>,
) -> Result<()> {
    let t = kind(card_type).ok_or(AppError::BadRequest("invalid_card_type"))?;
    let data = clean(t, title, data)?;
    sqlx::query(
        "insert into cards (record_id, card_type, data, created_by, sort_order)
         values ($1, $2, $3, $4,
                 coalesce((select max(sort_order) from cards where record_id = $1), -1) + 1)")
        .bind(record).bind(t.key).bind(data).bind(me).execute(&mut **tx).await?;
    Ok(())
}

pub async fn create(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
    Body(b): Body<CardIn>,
) -> Result<Json<Detail>> {
    let rec = records::load(&st.pool, common::id(&raw)?).await?;
    records::require_edit(&st, &me, &rec).await?;
    let card_type = b.card_type.ok_or(AppError::BadRequest("invalid_card_type"))?;
    let mut tx = st.pool.begin().await?;
    insert(&mut tx, rec.id, me.id, &card_type, b.title, &b.data).await?;
    records::touch(&mut tx, rec.id).await?;
    tx.commit().await?;
    Ok(Json(records::detail_of(&st, &me, rec).await?))
}

/// Kart + kaydi. Taninmayan turde `None` tur doner (yalniz silinebilir).
async fn load(st: &AppState, raw: &str) -> Result<(Uuid, Option<&'static CardType>, Record)> {
    let (id, record, card_type): (Uuid, Uuid, String) =
        sqlx::query_as("select id, record_id, card_type from cards where id = $1")
            .bind(common::id(raw)?).fetch_optional(&st.pool).await?.ok_or(AppError::NotFound)?;
    Ok((id, kind(&card_type), records::load(&st.pool, record).await?))
}

/// Duzenlenebilir alanlarin TAMAMI yenilenir, katilim DOKUNULMADAN tasinir —
/// tek ifade, eszamanli bir cevap kaybolmaz.
pub async fn patch(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
    Body(b): Body<CardIn>,
) -> Result<Json<Detail>> {
    let (id, t, rec) = load(&st, &raw).await?;
    records::require_edit(&st, &me, &rec).await?;
    let data = clean(t.ok_or(AppError::BadRequest("invalid_card_type"))?, b.title, &b.data)?;
    let mut tx = st.pool.begin().await?;
    sqlx::query(
        "update cards set data = (case when data ? 'signups'
                                       then jsonb_build_object('signups', data->'signups')
                                       else '{}'::jsonb end) || $2
          where id = $1")
        .bind(id).bind(data).execute(&mut *tx).await?;
    records::touch(&mut tx, rec.id).await?;
    tx.commit().await?;
    Ok(Json(records::detail_of(&st, &me, rec).await?))
}

/// Kart gider; ekleri bagsiz kalir ve supurulur (media::sweep) — Python'da
/// yetim kalip elle temizlik bekliyordu.
pub async fn delete(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
) -> Result<Json<Detail>> {
    let (id, _, rec) = load(&st, &raw).await?;
    records::require_edit(&st, &me, &rec).await?;
    let mut tx = st.pool.begin().await?;
    sqlx::query("delete from cards where id = $1").bind(id).execute(&mut *tx).await?;
    records::touch(&mut tx, rec.id).await?;
    tx.commit().await?;
    Ok(Json(records::detail_of(&st, &me, rec).await?))
}

#[derive(Deserialize)]
pub struct SignupIn {
    /// null = geri cekil.
    answer: Option<SignupAnswer>,
    #[serde(default)]
    note: Option<String>,
}

pub async fn signup(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
    Body(b): Body<SignupIn>,
) -> Result<Json<Detail>> {
    let (id, t, rec) = load(&st, &raw).await?;
    let t = t.ok_or(AppError::BadRequest("invalid_card_type"))?;
    let key = me.id.to_string();
    match b.answer {
        None => {
            sqlx::query("update cards set data = data #- array['signups', $2] where id = $1")
                .bind(id).bind(&key).execute(&st.pool).await?;
        }
        Some(a) if t.answers.contains(&a) => {
            let note = common::text(b.note, 200, "invalid_body")?;
            let entry = json!({ "answer": a, "note": note, "at": chrono::Utc::now().to_rfc3339() });
            sqlx::query(
                "update cards set data = jsonb_set(
                   case when data ? 'signups' then data else data || '{\"signups\": {}}' end,
                   array['signups', $2], $3, true)
                  where id = $1")
                .bind(id).bind(&key).bind(entry).execute(&st.pool).await?;
        }
        // Havuza "belki" yazilamaz: o turde boyle bir cevap yok.
        Some(_) => return Err(AppError::BadRequest("invalid_answer")),
    }
    Ok(Json(records::detail_of(&st, &me, rec).await?))
}

#[derive(Deserialize)]
pub struct AttachIn {
    attachment_ids: Vec<Uuid>,
}

/// Medya kartina gorsel: once `POST /api/attachments`, sonra buraya bag.
pub async fn attach(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
    Body(b): Body<AttachIn>,
) -> Result<Json<Detail>> {
    let (id, t, rec) = load(&st, &raw).await?;
    records::require_edit(&st, &me, &rec).await?;
    if !t.is_some_and(|t| t.media) {
        return Err(AppError::BadRequest("invalid_card_type"));
    }
    let mut ids = b.attachment_ids;
    att::claimable(&st.pool, me.id, &mut ids).await?;
    let mut tx = st.pool.begin().await?;
    sqlx::query(
        "insert into card_attachments (card_id, attachment_id, sort_order)
         select $1, a, coalesce((select max(sort_order) from card_attachments where card_id = $1), -1) + n
           from unnest($2::uuid[]) with ordinality as x(a, n)")
        .bind(id).bind(&ids).execute(&mut *tx).await?;
    records::touch(&mut tx, rec.id).await?;
    tx.commit().await?;
    Ok(Json(records::detail_of(&st, &me, rec).await?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn beyaz_liste_ve_dogrulama() {
        let obj = |v: Value| v.as_object().cloned().unwrap_or_default();
        let meeting = kind("meeting");
        assert!(meeting.is_some());
        if let Some(m) = meeting {
            let data = obj(json!({ "when": "2026-10-01T18:30", "link": "https://meet.x/a", "evil": "x" }));
            assert_eq!(clean(m, Some("Planlama".into()), &data).ok(),
                Some(json!({ "title": "Planlama", "when": "2026-10-01T18:30", "link": "https://meet.x/a" })));
            assert!(clean(m, None, &obj(json!({ "link": "javascript:alert(1)" }))).is_err());
        }
        assert!(kind("survey").is_none(), "taninmayan tur BOZUK cizilir, eklenemez");
    }
}
