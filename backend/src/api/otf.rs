//! OTF widget'i: etkinlik talep formu (FORM.GN.05) verisi ve .docx'i.
//!
//! Etkinlikten gelen alanlar (ad, tarih, saat, yer, katilimci sayisi) formda
//! TEKRAR TUTULMAZ: dosya uretilirken etkinlikten okunur. Formun kendine ait
//! olanlari `event_otf`, isaretli kutular `event_otf_items`, sorumlular
//! `event_otf_contacts` (telefon kisinin profilinden).
//!
//! Kulubun gonderim kurallari (duyuru): kulup adresinden, Word, dosya adi
//! KULUPADI_25EKIM_OTF.docx, konu "KULUP ADI ETKINLIK TARIHI OTF", etkinlikten
//! en gec 3 IS GUNU once. Dosya adi, konu ve son gun burada uretilir.

use axum::{
    extract::{Path, State},
    http::header,
    response::{IntoResponse, Response},
    Json,
};
use chrono::{Datelike, Duration, Local, NaiveDate, NaiveTime, Weekday};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    api::{common::{self, Body}, events},
    auth::CurrentUser,
    error::{AppError, Result},
    otf,
    state::AppState,
};

const TEXT_MAX: usize = 4000;
const SHORT_MAX: usize = 300;
const MONTHS: [&str; 12] = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const MONTHS_UP: [&str; 12] = ["OCAK", "ŞUBAT", "MART", "NİSAN", "MAYIS", "HAZİRAN", "TEMMUZ", "AĞUSTOS", "EYLÜL", "EKİM", "KASIM", "ARALIK"];
const WEEKDAYS: [&str; 7] = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];
/// Kulup duyurusu: OTF etkinlikten en gec bu kadar IS GUNU once iletilir.
const DEADLINE_WORKDAYS: u32 = 3;

#[derive(Serialize, Deserialize, sqlx::FromRow, Default)]
pub struct Fields {
    #[serde(default)]
    purpose: Option<String>,
    /// "HH:MM"
    #[serde(default)]
    end_time: Option<String>,
    #[serde(default)]
    advisor: Option<String>,
    #[serde(default)]
    age_group: Option<String>,
    #[serde(default)]
    outcomes: Option<String>,
    #[serde(default)]
    layout_notes: Option<String>,
    #[serde(default)]
    av_notes: Option<String>,
    #[serde(default)]
    tech_notes: Option<String>,
    #[serde(default)]
    host_notes: Option<String>,
    #[serde(default)]
    care_notes: Option<String>,
    #[serde(default)]
    other_notes: Option<String>,
}

#[derive(Serialize, Deserialize, sqlx::FromRow)]
pub struct Item {
    item: String,
    #[serde(default)]
    quantity: Option<i32>,
}

#[derive(Serialize)]
pub struct CatalogSection {
    key: &'static str,
    label: &'static str,
    items: Vec<CatalogItem>,
}

#[derive(Serialize)]
pub struct CatalogItem {
    key: &'static str,
    label: &'static str,
}

#[derive(Serialize)]
pub struct View {
    #[serde(flatten)]
    fields: Fields,
    items: Vec<Item>,
    contacts: Vec<Uuid>,
    /// Kutu katalogu: ekran bolum ve etiketleri buradan cizer (tek kaynak Rust).
    catalog: Vec<CatalogSection>,
    club_name: String,
    file_name: String,
    subject: String,
    /// Etkinlikten 3 is gunu once; tarihsiz etkinlikte null.
    deadline: Option<NaiveDate>,
    /// Bugun son gunu gecti mi.
    late: bool,
}

#[derive(sqlx::FromRow)]
struct EventInfo {
    title: String,
    date: Option<NaiveDate>,
    start_time: Option<String>,
    place: Option<String>,
    attendees: Option<i32>,
}

async fn event_info(pool: &PgPool, id: Uuid) -> Result<EventInfo> {
    sqlx::query_as(
        "select title, date, to_char(start_time, 'HH24:MI') as start_time, place, attendees
           from events where id = $1")
        .bind(id).fetch_optional(pool).await?.ok_or(AppError::NotFound)
}

async fn load_fields(pool: &PgPool, id: Uuid) -> Result<Fields> {
    Ok(sqlx::query_as(
        "select purpose, to_char(end_time, 'HH24:MI') as end_time, advisor, age_group, outcomes,
                layout_notes, av_notes, tech_notes, host_notes, care_notes, other_notes
           from event_otf where event_id = $1")
        .bind(id).fetch_optional(pool).await?.unwrap_or_default())
}

async fn load_items(pool: &PgPool, id: Uuid) -> Result<Vec<Item>> {
    Ok(sqlx::query_as("select item, quantity from event_otf_items where event_id = $1")
        .bind(id).fetch_all(pool).await?)
}

async fn load_contacts(pool: &PgPool, id: Uuid) -> Result<Vec<Uuid>> {
    Ok(sqlx::query_scalar("select user_id from event_otf_contacts where event_id = $1 order by position")
        .bind(id).fetch_all(pool).await?)
}

/// Etkinlikten N is gunu once (hafta sonlari sayilmaz; resmi tatil bilinmiyor).
fn deadline(date: NaiveDate) -> NaiveDate {
    let mut d = date;
    let mut n = 0;
    while n < DEADLINE_WORKDAYS {
        d -= Duration::days(1);
        if !matches!(d.weekday(), Weekday::Sat | Weekday::Sun) {
            n += 1;
        }
    }
    d
}

fn month(d: NaiveDate) -> usize {
    d.month0() as usize
}

/// KULUPADI_25EKIM_OTF.docx
fn file_name(code: &str, date: Option<NaiveDate>) -> String {
    match date {
        Some(d) => format!("{code}_{}{}_OTF.docx", d.day(), MONTHS_UP[month(d)]),
        None => format!("{code}_TARIHSIZ_OTF.docx"),
    }
}

fn view(st: &AppState, ev: &EventInfo, fields: Fields, items: Vec<Item>, contacts: Vec<Uuid>) -> View {
    let cfg = &st.cfg;
    let deadline = ev.date.map(deadline);
    View {
        fields, items, contacts,
        catalog: otf::SECTIONS.iter().map(|s| CatalogSection {
            key: s.key, label: s.label,
            items: s.items.iter().map(|(key, label)| CatalogItem { key, label }).collect(),
        }).collect(),
        club_name: cfg.club_name.clone(),
        file_name: file_name(&cfg.club_code, ev.date),
        subject: match ev.date {
            Some(d) => format!("{} {} {} OTF", cfg.club_name, d.day(), MONTHS_UP[month(d)]),
            None => format!("{} OTF", cfg.club_name),
        },
        late: deadline.is_some_and(|d| Local::now().date_naive() > d),
        deadline,
    }
}

pub async fn get(
    State(st): State<AppState>, CurrentUser(_me): CurrentUser, Path(raw): Path<String>,
) -> Result<Json<View>> {
    let id = common::id(&raw)?;
    let ev = event_info(&st.pool, id).await?;
    let v = view(&st, &ev, load_fields(&st.pool, id).await?, load_items(&st.pool, id).await?,
        load_contacts(&st.pool, id).await?);
    Ok(Json(v))
}

#[derive(Deserialize)]
pub struct Input {
    #[serde(flatten)]
    fields: Fields,
    #[serde(default)]
    items: Vec<Item>,
    #[serde(default)]
    contacts: Vec<Uuid>,
}

fn clean(v: Option<String>, max: usize, code: &'static str) -> Result<Option<String>> {
    common::text(v, max, code)
}

/// Formun tamami tek istekte (form gibi kaydedilir). Etkinligi duzenleyebilen yazar.
pub async fn put(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
    Body(b): Body<Input>,
) -> Result<Json<View>> {
    let id = common::id(&raw)?;
    events::editable(&st, &me, id).await?;
    let f = b.fields;
    let end_time = f.end_time.as_deref().filter(|s| !s.is_empty())
        .map(|s| NaiveTime::parse_from_str(s, "%H:%M")).transpose()
        .map_err(|_| AppError::BadRequest("invalid_time"))?;
    let text = |v: Option<String>| clean(v, TEXT_MAX, "invalid_description");
    let short = |v: Option<String>| clean(v, SHORT_MAX, "invalid_description");
    for it in &b.items {
        if otf::section_of(&it.item).is_none() {
            return Err(AppError::BadRequest("invalid_otf_item"));
        }
        if it.quantity.is_some_and(|q| !(1..=10_000).contains(&q)) {
            return Err(AppError::BadRequest("invalid_quantity"));
        }
    }
    if b.contacts.len() > 3 {
        return Err(AppError::BadRequest("too_many_contacts"));
    }
    for c in &b.contacts {
        crate::api::records::check_user(&st.pool, Some(*c)).await?;
    }

    let mut tx = st.pool.begin().await?;
    sqlx::query(
        "insert into event_otf (event_id, purpose, end_time, advisor, age_group, outcomes,
                                layout_notes, av_notes, tech_notes, host_notes, care_notes, other_notes)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         on conflict (event_id) do update set
           purpose = excluded.purpose, end_time = excluded.end_time, advisor = excluded.advisor,
           age_group = excluded.age_group, outcomes = excluded.outcomes,
           layout_notes = excluded.layout_notes, av_notes = excluded.av_notes,
           tech_notes = excluded.tech_notes, host_notes = excluded.host_notes,
           care_notes = excluded.care_notes, other_notes = excluded.other_notes, updated_at = now()")
        .bind(id).bind(text(f.purpose)?).bind(end_time).bind(short(f.advisor)?).bind(short(f.age_group)?)
        .bind(text(f.outcomes)?).bind(text(f.layout_notes)?).bind(text(f.av_notes)?)
        .bind(text(f.tech_notes)?).bind(text(f.host_notes)?).bind(text(f.care_notes)?)
        .bind(text(f.other_notes)?)
        .execute(&mut *tx).await?;
    sqlx::query("delete from event_otf_items where event_id = $1").bind(id).execute(&mut *tx).await?;
    for it in &b.items {
        sqlx::query("insert into event_otf_items (event_id, item, quantity) values ($1, $2, $3)
                     on conflict do nothing")
            .bind(id).bind(&it.item).bind(it.quantity).execute(&mut *tx).await?;
    }
    sqlx::query("delete from event_otf_contacts where event_id = $1").bind(id).execute(&mut *tx).await?;
    for (i, c) in b.contacts.iter().enumerate() {
        sqlx::query("insert into event_otf_contacts (event_id, user_id, position) values ($1, $2, $3)
                     on conflict do nothing")
            .bind(id).bind(c).bind(i as i16).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    get(State(st), CurrentUser(me), Path(raw)).await
}

#[derive(sqlx::FromRow)]
struct Contact {
    name: String,
    phone: Option<String>,
}

/// Doldurulmus .docx. Okuma herkese acik (etkinlik gibi).
pub async fn docx(
    State(st): State<AppState>, CurrentUser(_me): CurrentUser, Path(raw): Path<String>,
) -> Result<Response> {
    let id = common::id(&raw)?;
    let ev = event_info(&st.pool, id).await?;
    let f = load_fields(&st.pool, id).await?;
    let items = load_items(&st.pool, id).await?;
    let contacts: Vec<Contact> = sqlx::query_as(
        "select u.name, u.phone from event_otf_contacts c join users u on u.id = c.user_id
          where c.event_id = $1 order by c.position")
        .bind(id).fetch_all(&st.pool).await?;

    let mut text: Vec<(&str, String)> = vec![
        ("club", st.cfg.club_name.clone()),
        ("name_purpose", [Some(ev.title.clone()), f.purpose.clone()].into_iter().flatten()
            .collect::<Vec<_>>().join("\n")),
        ("date", ev.date.map(|d| format!("{} {} {} {}", d.day(), MONTHS[month(d)], d.year(),
            WEEKDAYS[d.weekday().num_days_from_monday() as usize])).unwrap_or_default()),
        ("time", match (&ev.start_time, &f.end_time) {
            (Some(s), Some(e)) => format!("{s} – {e}"),
            (Some(s), None) => s.clone(),
            (None, Some(e)) => format!("– {e}"),
            (None, None) => String::new(),
        }),
        ("place", ev.place.clone().unwrap_or_default()),
        ("advisor", f.advisor.clone().unwrap_or_default()),
        ("attendees", ev.attendees.map(|n| n.to_string()).unwrap_or_default()),
        ("age_group", f.age_group.clone().unwrap_or_default()),
        ("outcomes", f.outcomes.clone().unwrap_or_default()),
    ];
    // Bolum aciklamasi: once adetli kalemler, sonra serbest not. Bicim universitenin
    // gonderim kuralindan: ekipmanin yanina "+" ve adet ("Projeksiyon+2"; gercek
    // formlarda "SANDALYE+60").
    let notes = [&f.layout_notes, &f.av_notes, &f.tech_notes, &f.host_notes, &f.care_notes, &f.other_notes];
    for (s, note) in otf::SECTIONS.iter().zip(notes) {
        let mut lines: Vec<String> = s.items.iter()
            .filter_map(|(k, label)| items.iter().find(|i| i.item == *k)
                .and_then(|i| i.quantity).map(|q| format!("{label}+{q}")))
            .collect();
        lines.extend(note.clone());
        text.push((s.notes, lines.join("\n")));
    }
    let keys = [("contact1_name", "contact1_phone"), ("contact2_name", "contact2_phone"), ("contact3_name", "contact3_phone")];
    for (c, (n, p)) in contacts.iter().zip(keys) {
        text.push((n, c.name.clone()));
        text.push((p, c.phone.clone().unwrap_or_default()));
    }
    let checked: Vec<&str> = items.iter().map(|i| i.item.as_str()).collect();
    let bytes = otf::render(&text, &checked).map_err(|e| {
        tracing::error!("otf render: {e}");
        AppError::Conflict("otf_template")
    })?;

    let name = file_name(&st.cfg.club_code, ev.date);
    // filename*'i tanimayan istemci icin ASCII: Turkce harf en yakin harfe.
    let ascii: String = name.chars().map(|c| match c {
        'Ç' => 'C', 'Ğ' => 'G', 'İ' => 'I', 'Ö' => 'O', 'Ş' => 'S', 'Ü' => 'U',
        'ç' => 'c', 'ğ' => 'g', 'ı' => 'i', 'ö' => 'o', 'ş' => 's', 'ü' => 'u',
        c if c.is_ascii_alphanumeric() || "._-".contains(c) => c,
        _ => '_',
    }).collect();
    let encoded: String = name.bytes().map(|b| if b.is_ascii_alphanumeric() || b"._-".contains(&b) {
        (b as char).to_string()
    } else {
        format!("%{b:02X}")
    }).collect();
    Ok((
        [
            (header::CONTENT_TYPE, "application/vnd.openxmlformats-officedocument.wordprocessingml.document".to_string()),
            (header::CACHE_CONTROL, "no-store".into()),
            (header::CONTENT_DISPOSITION, format!("attachment; filename=\"{ascii}\"; filename*=UTF-8''{encoded}")),
        ],
        bytes,
    ).into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deadline_skips_weekends() {
        let d = |y, m, d| NaiveDate::from_ymd_opt(y, m, d).unwrap_or_default();
        // Pazartesi etkinligi -> onceki Carsamba (Cuma, Persembe, Carsamba)
        assert_eq!(deadline(d(2026, 10, 26)), d(2026, 10, 21));
        // Cuma etkinligi -> Salı
        assert_eq!(deadline(d(2026, 10, 23)), d(2026, 10, 20));
    }

    #[test]
    fn file_name_matches_club_rule() {
        let d = NaiveDate::from_ymd_opt(2026, 10, 25);
        assert_eq!(file_name("OZUKULUBU", d), "OZUKULUBU_25EKİM_OTF.docx");
    }
}
