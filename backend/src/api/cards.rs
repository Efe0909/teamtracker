//! Kart bloklari (R4-F01, F02, F12): kayit govdesine yapisan yeniden
//! kullanilabilir kutular — medya, toplanti plani, havuz karti.
//!
//! Tur listesi KODDA (Python `cards.CARD_TYPES`), veri `cards.data` jsonb'de.
//! `card_type`'ta CHECK yok: taninmayan tur ekranda BOZUK cizilir (KNOW-280),
//! verisi gitmez, silinebilir. Alanlar BEYAZ LISTE: istemci ne gonderirse
//! gondersin jsonb'ye tanimsiz anahtar girmez.
//!
//! Oylama (`poll`): baslik soru, `data.options` secenekler (istege bagli foto),
//! `data.allow_other` serbest cevap, `data.closes_at` bitis; oylar `data.votes`
//! icinde, katilimla ayni tek-ifade kalibi.
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
    poll: bool,
}

/// Etiket, ipucu ve alan etiketleri on yuzde (`lib/cards.ts`); burada
/// davranis: hangi alan kabul edilir, hangi cevap anlamli.
const TYPES: [CardType; 4] = [
    CardType { key: "media", fields: &["description"], answers: &[], media: true, poll: false },
    CardType {
        key: "meeting",
        fields: &["when", "place", "link", "agenda"],
        answers: &[SignupAnswer::Yes, SignupAnswer::Maybe, SignupAnswer::No],
        media: false,
        poll: false,
    },
    // Havuzda "belki" yok: is ya alinir ya alinmaz.
    CardType { key: "pool", fields: &["need", "detail"], answers: &[SignupAnswer::Yes], media: false, poll: false },
    CardType { key: "poll", fields: &[], answers: &[], media: false, poll: true },
];

const OPTIONS_MAX: usize = 10;
const OPTION_MAX: usize = 100;
/// Bitis zamani duvar saati girer (datetime-local); Turkiye UTC+3 sabit.
const LOCAL_OFFSET_SECS: i64 = 3 * 3600;

/// Oylama ayarlari: secenekler (+ foto kimligi), `allow_other`, `closes_at`.
fn clean_poll(data: &Map<String, Value>, out: &mut Map<String, Value>) -> Result<()> {
    let raw = data.get("options").and_then(Value::as_array).cloned().unwrap_or_default();
    let mut options = Vec::new();
    for o in &raw {
        let (label, photo) = match o {
            Value::String(s) => (Some(s.clone()), None),
            Value::Object(m) => (
                m.get("label").and_then(Value::as_str).map(str::to_string),
                m.get("attachment_id").and_then(Value::as_str).map(str::to_string),
            ),
            _ => return Err(AppError::BadRequest("invalid_options")),
        };
        let Some(label) = common::text(label, OPTION_MAX, "invalid_options")? else {
            return Err(AppError::BadRequest("invalid_options"));
        };
        let mut e = Map::new();
        e.insert("label".into(), json!(label));
        if let Some(a) = photo {
            let id: Uuid = a.parse().map_err(|_| AppError::BadRequest("invalid_options"))?;
            e.insert("attachment_id".into(), json!(id));
        }
        options.push(Value::Object(e));
    }
    if options.len() > OPTIONS_MAX {
        return Err(AppError::BadRequest("invalid_options"));
    }
    out.insert("options".into(), Value::Array(options));
    if data.get("allow_other").and_then(Value::as_bool) == Some(true) {
        out.insert("allow_other".into(), json!(true));
    }
    if let Some(c) = data.get("closes_at").and_then(Value::as_str).filter(|s| !s.is_empty()) {
        if chrono::NaiveDateTime::parse_from_str(c, "%Y-%m-%dT%H:%M").is_err() {
            return Err(AppError::BadRequest("invalid_when"));
        }
        out.insert("closes_at".into(), json!(c));
    }
    Ok(())
}

/// Bitis gectiyse true.
fn poll_closed(closes_at: Option<&str>) -> bool {
    closes_at
        .and_then(|c| chrono::NaiveDateTime::parse_from_str(c, "%Y-%m-%dT%H:%M").ok())
        .is_some_and(|c| c.and_utc().timestamp() - LOCAL_OFFSET_SECS <= chrono::Utc::now().timestamp())
}

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
    if t.poll {
        clean_poll(data, &mut out)?;
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
pub struct Vote {
    user_id: Uuid,
    /// Secenek sirasi; serbest cevapta None.
    option: Option<usize>,
    /// Serbest cevap metni ("diger").
    text: Option<String>,
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
    /// Yalniz oylamada; `data`dan ayri cunku metin degil.
    options: Vec<Value>,
    allow_other: bool,
    closes_at: Option<String>,
    closed: bool,
    votes: Vec<Vote>,
    /// Yalniz medya kartinda; silinmis ek kartta gosterilmez.
    attachments: Vec<AttachView>,
}

impl CardView {
    pub fn id(&self) -> Uuid {
        self.id
    }
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
        let votes = data.as_object_mut().and_then(|o| o.remove("votes"));
        let options = data.as_object_mut().and_then(|o| o.remove("options"))
            .and_then(|v| v.as_array().cloned()).unwrap_or_default();
        let allow_other = data.as_object_mut().and_then(|o| o.remove("allow_other"))
            .and_then(|v| v.as_bool()).unwrap_or(false);
        let closes_at = data.as_object_mut().and_then(|o| o.remove("closes_at"))
            .and_then(|v| v.as_str().map(str::to_string));
        let mut votes: Vec<Vote> = votes.and_then(|s| s.as_object().cloned()).unwrap_or_default()
            .into_iter().filter_map(|(uid, v)| Some(Vote {
                user_id: uid.parse().ok()?,
                option: v.get("option").and_then(Value::as_u64).map(|n| n as usize),
                text: v.get("text").and_then(Value::as_str).map(str::to_string),
                at: v.get("at").and_then(Value::as_str).map(str::to_string),
            })).collect();
        votes.sort_by(|a, b| a.at.cmp(&b.at));
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
            closed: poll_closed(closes_at.as_deref()),
            id, card_type, data, signups, options, allow_other, closes_at, votes,
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
    let card: Uuid = sqlx::query_scalar(
        "insert into cards (record_id, card_type, data, created_by, sort_order)
         values ($1, $2, $3, $4,
                 coalesce((select max(sort_order) from cards where record_id = $1), -1) + 1)
         returning id")
        .bind(record).bind(t.key).bind(&data).bind(me).fetch_one(&mut **tx).await?;
    link_option_photos(tx, card, me, &data).await?;
    Ok(())
}

/// Secenek fotograflari kartin eki sayilir: supurme (media::sweep) onlari
/// yetim saymasin. Yalniz kendi yukledigin ya da bu karta zaten bagli ek.
async fn link_option_photos(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>, card: Uuid, me: Uuid, data: &Value,
) -> Result<()> {
    let ids: Vec<Uuid> = data.get("options").and_then(Value::as_array).into_iter().flatten()
        .filter_map(|o| o.get("attachment_id")?.as_str()?.parse().ok()).collect();
    if ids.is_empty() {
        return Ok(());
    }
    let n: i64 = sqlx::query_scalar(
        "select count(distinct a.id) from attachments a
          where a.id = any($1) and a.deleted_at is null
            and (a.uploader_id = $2
                 or exists (select 1 from card_attachments x where x.card_id = $3 and x.attachment_id = a.id))")
        .bind(&ids).bind(me).bind(card).fetch_one(&mut **tx).await?;
    let mut uniq = ids.clone();
    uniq.sort();
    uniq.dedup();
    if n as usize != uniq.len() {
        return Err(AppError::BadRequest("invalid_attachment"));
    }
    sqlx::query(
        "insert into card_attachments (card_id, attachment_id, sort_order)
         select $1, a, coalesce((select max(sort_order) from card_attachments where card_id = $1), -1) + n
           from unnest($2::uuid[]) with ordinality as x(a, n)
         on conflict do nothing")
        .bind(card).bind(&uniq).execute(&mut **tx).await?;
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
        "update cards set data = jsonb_strip_nulls(
                 jsonb_build_object('signups', data->'signups', 'votes', data->'votes')) || $2
          where id = $1")
        .bind(id).bind(&data).execute(&mut *tx).await?;
    link_option_photos(&mut tx, id, me.id, &data).await?;
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
pub struct VoteIn {
    /// Secenek sirasi; `option` ve `other` ikisi de yoksa oy geri cekilir.
    #[serde(default)]
    option: Option<usize>,
    #[serde(default)]
    other: Option<String>,
}

/// Oturumu olan herkes kendi adina oy verir (katilim gibi duzenleme degil).
pub async fn vote(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
    Body(b): Body<VoteIn>,
) -> Result<Json<Detail>> {
    let (id, t, rec) = load(&st, &raw).await?;
    if !t.is_some_and(|t| t.poll) {
        return Err(AppError::BadRequest("invalid_card_type"));
    }
    let data: Value = sqlx::query_scalar("select data from cards where id = $1")
        .bind(id).fetch_one(&st.pool).await?;
    let key = me.id.to_string();
    let other = common::text(b.other, 200, "invalid_body")?;
    if b.option.is_none() && other.is_none() {
        sqlx::query("update cards set data = data #- array['votes', $2] where id = $1")
            .bind(id).bind(&key).execute(&st.pool).await?;
        return Ok(Json(records::detail_of(&st, &me, rec).await?));
    }
    if poll_closed(data.get("closes_at").and_then(Value::as_str)) {
        return Err(AppError::Conflict("poll_closed"));
    }
    let n = data.get("options").and_then(Value::as_array).map_or(0, Vec::len);
    let allow_other = data.get("allow_other").and_then(Value::as_bool) == Some(true);
    let entry = match (b.option, other) {
        (Some(i), None) if i < n => json!({ "option": i, "at": chrono::Utc::now().to_rfc3339() }),
        (None, Some(text)) if allow_other => json!({ "text": text, "at": chrono::Utc::now().to_rfc3339() }),
        _ => return Err(AppError::BadRequest("invalid_vote")),
    };
    sqlx::query(
        "update cards set data = jsonb_set(
           case when data ? 'votes' then data else data || '{\"votes\": {}}' end,
           array['votes', $2], $3, true)
          where id = $1")
        .bind(id).bind(&key).bind(entry).execute(&st.pool).await?;
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
        let poll = kind("poll").map(|p| clean(p, Some("Yemek?".into()), &obj(json!({
            "options": ["Pide", { "label": "Lahmacun" }], "allow_other": true, "closes_at": "2026-10-02T18:00", "evil": 1,
        }))));
        assert_eq!(poll.and_then(Result::ok), Some(json!({
            "title": "Yemek?", "allow_other": true, "closes_at": "2026-10-02T18:00",
            "options": [{ "label": "Pide" }, { "label": "Lahmacun" }],
        })));
        assert!(kind("poll").is_some_and(|p| clean(p, None, &obj(json!({ "options": [""] }))).is_err()));
        assert!(poll_closed(Some("2000-01-01T00:00")) && !poll_closed(Some("2999-01-01T00:00")) && !poll_closed(None));
        assert!(kind("survey").is_none(), "taninmayan tur BOZUK cizilir, eklenemez");
    }
}
