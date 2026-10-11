//! Etkinligin LLM yuku: satin alim onerisi, uye maili gibi isler icin modele
//! verilecek JSON. Kisisel ve kurumsal veri ICERMEZ.
//!
//! Iki katman:
//!   1. YAPISAL: yuk, elle secilmis alanlardan kurulan bu structlardir; `EventRow`/`users`
//!      satirlari oldugu gibi serilestirilmez. Kisi (sorumlu, katilimci, sorumlu kisi,
//!      danisman), firma/tedarikci adi, iletisim, kulup adi ve yer adi yukte YOK: yeni
//!      bir sutun eklense bile yuke kendiliginden girmez.
//!   2. TEMIZLEME: metin alanlari `redact` kurallarindan gecer (yonetimden ayarlanir).
//!      Serbest metin (baslik, aciklama, notlar, OTF metinleri) `?free_text=true`
//!      olmadan HIC gitmez.
//!
//! Kulup ve yer `{{KULUP}}`/`{{YER}}` yer tutucusu olarak gider; model cevabindaki
//! yer tutucuyu sunucu doldurur (`llm_restore`).

use axum::extract::Query;
use chrono::Datelike;

// Malzeme onerisi: daraltilmis istek + model cagrisi + sunucu suzgeci (spec/79 §9).
mod materials;
pub(crate) use materials::{material_suggestions, sample_input as material_sample, try_suggest};

use super::*;
use crate::{
    otf::SECTIONS,
    redact::{self, Known, Rules},
};

const WEEKDAYS: [&str; 7] = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];
/// `materials.state` 0..=3'un ekran karsiligi (frontend `MATERIAL_STAGE`).
const STAGES: [&str; 4] = ["Planlanan", "Tedarikçi aranıyor", "Tedarikçi bulundu", "Onaylandı"];
const RESTORE_MAX: usize = 20_000;
/// Uretken yapay zeka ozellikleri kapsami (spec/79 §9): yuk uclari ve oneri bunu arar.
const USE_AI: &str = "use_generative_ai";

#[derive(Deserialize)]
pub struct Params {
    #[serde(default)]
    free_text: bool,
}

/// Metin alanlarini kurallardan geciren yardimci.
struct Scrub<'a> {
    rules: &'a Rules,
    known: Known,
    free_text: bool,
}

impl Scrub<'_> {
    /// Kisa, kisi/firma yazilmamasi beklenen etiket (malzeme adi, kazanim): her zaman gider, temizlenir.
    fn short(&self, s: &str) -> String {
        redact::redact(s.trim(), self.rules, &self.known)
    }

    /// Serbest metin: yalniz `free_text` aciksa, bossa hic.
    fn free(&self, s: Option<&str>) -> Option<String> {
        if !self.free_text {
            return None;
        }
        s.map(str::trim).filter(|s| !s.is_empty()).map(|s| self.short(s))
    }
}

// --- cikti -------------------------------------------------------------------

#[derive(Serialize)]
pub struct Context {
    /// Her zaman yer tutucu.
    club: &'static str,
    /// Serbest metin dahil mi.
    free_text: bool,
    event: EventCtx,
    /// Secilen etkinlik kazanimlari (referans veri).
    outcomes: Vec<OutcomeCtx>,
    otf: Option<OtfCtx>,
    checkpoints: Vec<CheckpointCtx>,
    materials: Vec<MaterialCtx>,
}

#[derive(Serialize)]
struct EventCtx {
    kind: String,
    status: String,
    priority: String,
    date: Option<NaiveDate>,
    weekday: Option<&'static str>,
    start_time: Option<String>,
    attendees: Option<i32>,
    /// Kisi listesi yerine yalniz sayi.
    participant_count: i64,
    team_count: i64,
    /// Yer varsa `{{YER}}`; gercek ad `llm_restore`'da.
    place: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    place_description: Option<String>,
}

#[derive(Serialize, sqlx::FromRow)]
struct OutcomeRow {
    name: String,
    description: Option<String>,
}

#[derive(Serialize)]
struct OutcomeCtx {
    name: String,
    description: Option<String>,
}

#[derive(Serialize)]
struct OtfCtx {
    end_time: Option<String>,
    /// Isaretli hizmet kutulari (sabit katalog) ve adetleri.
    items: Vec<ItemCtx>,
    #[serde(skip_serializing_if = "Option::is_none")]
    age_group: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    purpose: Option<String>,
    /// Listede olmayan serbest kazanim metni.
    #[serde(skip_serializing_if = "Option::is_none")]
    free_outcomes: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    notes: Vec<NoteCtx>,
}

#[derive(Serialize)]
struct ItemCtx {
    key: &'static str,
    label: &'static str,
    quantity: Option<i32>,
}

#[derive(Serialize)]
struct NoteCtx {
    section: &'static str,
    text: String,
}

#[derive(Serialize)]
struct CheckpointCtx {
    /// Sablondan gelen adimlarin etiketi her zaman; elle eklenenin yalniz serbest metinle.
    label: Option<String>,
    custom: bool,
    date: Option<NaiveDate>,
    done: bool,
}

#[derive(Serialize)]
struct MaterialCtx {
    name: String,
    #[serde(rename = "type")]
    kind: MaterialType,
    priority: Priority,
    stage: &'static str,
    qty: i32,
    /// Zaten elimizde.
    owned: bool,
    delivered: bool,
    purchased: bool,
    budget: Option<f64>,
    /// 0 $, 1 $$, 2 $$$ (butceye gore).
    overage_level: Option<u8>,
    sponsor: SponsorCtx,
    /// Firma/iletisim yok; yalniz fiyat ve tarih.
    offers: Vec<OfferCtx>,
    #[serde(skip_serializing_if = "Option::is_none")]
    notes: Option<String>,
}

#[derive(Serialize)]
struct SponsorCtx {
    requested: bool,
    chosen: bool,
    qty: Option<i32>,
    date: Option<NaiveDate>,
}

#[derive(Serialize)]
struct OfferCtx {
    label: String,
    price: Option<f64>,
    unit_price: Option<f64>,
    arrival_date: Option<NaiveDate>,
    chosen: bool,
    overage_level: Option<u8>,
}

// --- sorgular ----------------------------------------------------------------

#[derive(sqlx::FromRow)]
struct Head {
    title: String,
    kind: String,
    status: String,
    priority: String,
    date: Option<NaiveDate>,
    start_time: Option<String>,
    attendees: Option<i32>,
    description: Option<String>,
    has_place: bool,
    place_description: Option<String>,
    participant_count: i64,
    team_count: i64,
}

#[derive(sqlx::FromRow)]
struct OtfRow {
    end_time: Option<String>,
    age_group: Option<String>,
    purpose: Option<String>,
    outcomes: Option<String>,
    layout_notes: Option<String>,
    av_notes: Option<String>,
    tech_notes: Option<String>,
    host_notes: Option<String>,
    care_notes: Option<String>,
    other_notes: Option<String>,
}

impl OtfRow {
    /// `SECTIONS[..].notes` sutun adiyla.
    fn note(&self, column: &str) -> Option<&str> {
        match column {
            "layout_notes" => &self.layout_notes,
            "av_notes" => &self.av_notes,
            "tech_notes" => &self.tech_notes,
            "host_notes" => &self.host_notes,
            "care_notes" => &self.care_notes,
            "other_notes" => &self.other_notes,
            _ => &None,
        }
        .as_deref()
    }
}

#[derive(sqlx::FromRow)]
struct CheckpointRow {
    label: String,
    date: Option<NaiveDate>,
    done: bool,
    /// Sablondan geldi (`offset_days` dolu); elle eklenenin tarihi mutlak.
    templated: bool,
}

/// Metinde aranacak adlar: kisiler ve kurumlar (takim, tedarikci, kulup).
pub(crate) async fn known_names(st: &AppState) -> Result<Known> {
    let people: Vec<String> = sqlx::query_scalar("select name from users").fetch_all(&st.pool).await?;
    let mut orgs: Vec<String> = sqlx::query_scalar(
        "select name from teams union select name from material_providers where name is not null")
        .fetch_all(&st.pool).await?;
    orgs.push(st.cfg.club_name.clone());
    orgs.push(st.cfg.club_code.clone());
    Ok(Known::default().people(people.iter().map(String::as_str)).orgs(orgs.iter().map(String::as_str)))
}

fn offer_label(i: usize) -> String {
    format!("Teklif {}", char::from(b'A' + (i % 26) as u8))
}

fn material_ctx(s: &Scrub, m: Material) -> MaterialCtx {
    let qty = f64::from(m.qty.max(1));
    let offers = m.providers.iter().enumerate().map(|(i, p)| OfferCtx {
        label: offer_label(i),
        price: p.price,
        unit_price: p.price.map(|v| (v / qty * 100.0).round() / 100.0),
        arrival_date: p.arrival_date,
        chosen: m.chosen_provider_id == Some(p.id),
        overage_level: p.overage_level,
    }).collect();
    MaterialCtx {
        name: s.short(&m.name),
        kind: m.kind,
        priority: m.priority,
        stage: STAGES[usize::try_from(m.state).unwrap_or(0).min(STAGES.len() - 1)],
        qty: m.qty,
        owned: m.owned,
        delivered: m.delivered,
        purchased: m.purchased,
        budget: m.budget,
        overage_level: m.overage_level,
        sponsor: SponsorCtx { requested: m.has_sponsor, chosen: m.sponsor_chosen, qty: m.sponsor_qty, date: m.sponsor_date },
        offers,
        notes: s.free(m.notes.as_deref()),
    }
}

async fn otf_ctx(st: &AppState, s: &Scrub<'_>, id: Uuid) -> Result<Option<OtfCtx>> {
    let row: Option<OtfRow> = sqlx::query_as(
        "select to_char(end_time, 'HH24:MI') as end_time, age_group, purpose, outcomes,
                layout_notes, av_notes, tech_notes, host_notes, care_notes, other_notes
           from event_otf where event_id = $1")
        .bind(id).fetch_optional(&st.pool).await?;
    let picked: Vec<(String, Option<i32>)> = sqlx::query_as(
        "select item, quantity from event_otf_items where event_id = $1 order by item")
        .bind(id).fetch_all(&st.pool).await?;
    let items: Vec<ItemCtx> = picked.iter().filter_map(|(item, quantity)| {
        SECTIONS.iter().flat_map(|sec| sec.items.iter())
            .find(|(key, _)| key == item)
            .map(|(key, label)| ItemCtx { key, label, quantity: *quantity })
    }).collect();
    if row.is_none() && items.is_empty() {
        return Ok(None);
    }
    let row = row.unwrap_or(OtfRow {
        end_time: None, age_group: None, purpose: None, outcomes: None, layout_notes: None,
        av_notes: None, tech_notes: None, host_notes: None, care_notes: None, other_notes: None,
    });
    let notes = SECTIONS.iter().filter_map(|sec| {
        s.free(row.note(sec.notes)).map(|text| NoteCtx { section: sec.label, text })
    }).collect();
    Ok(Some(OtfCtx {
        end_time: row.end_time.clone(),
        items,
        age_group: s.free(row.age_group.as_deref()),
        purpose: s.free(row.purpose.as_deref()),
        free_outcomes: s.free(row.outcomes.as_deref()),
        notes,
    }))
}

// --- uclar -------------------------------------------------------------------

pub(crate) async fn llm_context(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Query(q): Query<Params>,
) -> Result<Json<Context>> {
    let id = common::id(&raw)?;
    Ok(Json(build_context(&st, &me, id, q.free_text).await?))
}

/// Uc ile dahili cagiranlarin (modele istek kuran islevler) ortak yolu: ayni kapsam ve
/// gorunurluk denetimi, ayni `free_text_allowed` kapisi, ayni temizleme.
async fn build_context(st: &AppState, me: &User, id: Uuid, free_text: bool) -> Result<Context> {
    require_scope(st, me, USE_AI).await?;
    require_visible(st, me, id).await?;
    let cfg = crate::api::llm::load(&st.pool).await?;
    if free_text && !cfg.free_text_allowed {
        return Err(AppError::BadRequest("free_text_disabled"));
    }
    let s = Scrub { rules: &cfg.rules, known: known_names(st).await?, free_text };

    let head: Head = sqlx::query_as(
        "select e.title, k.name as kind, e.status, e.priority, e.date,
                to_char(e.start_time, 'HH24:MI') as start_time, e.attendees, e.description,
                coalesce(l.name, nullif(trim(e.place), '')) is not null as has_place,
                l.description as place_description,
                (select count(*) from event_participants p where p.event_id = e.id) as participant_count,
                (select count(*) from event_teams t where t.event_id = e.id) as team_count
           from events e join nodes k on k.id = e.kind_id left join nodes l on l.id = e.location_id
          where e.id = $1")
        .bind(id).fetch_optional(&st.pool).await?.ok_or(AppError::NotFound)?;

    let outcome_rows: Vec<OutcomeRow> = sqlx::query_as(
        "select n.name, n.description from event_otf_outcomes o join nodes n on n.id = o.outcome_id
          where o.event_id = $1 order by n.name")
        .bind(id).fetch_all(&st.pool).await?;
    let outcomes = outcome_rows.into_iter().map(|o| OutcomeCtx {
        name: s.short(&o.name),
        description: o.description.as_deref().map(str::trim).filter(|d| !d.is_empty()).map(|d| s.short(d)),
    }).collect();

    let checkpoint_rows: Vec<CheckpointRow> = sqlx::query_as(
        "select c.label, coalesce(c.due_date, e.date + c.offset_days::int) as date,
                c.done_at is not null as done, c.offset_days is not null as templated
           from event_checkpoints c join events e on e.id = c.event_id
          where c.event_id = $1 order by c.position")
        .bind(id).fetch_all(&st.pool).await?;
    let checkpoints = checkpoint_rows.into_iter().map(|c| CheckpointCtx {
        label: if c.templated { Some(c.label) } else { s.free(Some(&c.label)) },
        custom: !c.templated,
        date: c.date,
        done: c.done,
    }).collect();

    let mut materials: Vec<Material> = sqlx::query_as(concat!(
        "select ", material_cols!(), " from materials m
           join event_materials em on em.material_id = m.id
          where em.event_id = $1 order by m.created_at, m.id"))
        .bind(id).fetch_all(&st.pool).await?;
    attach_providers(&st.pool, &mut materials).await?;
    fill_levels(&st.pool, &mut materials).await?;

    Ok(Context {
        club: redact::CLUB,
        free_text,
        event: EventCtx {
            kind: head.kind,
            status: head.status,
            priority: head.priority,
            date: head.date,
            weekday: head.date.map(|d| WEEKDAYS[d.weekday().num_days_from_monday() as usize]),
            start_time: head.start_time,
            attendees: head.attendees,
            participant_count: head.participant_count,
            team_count: head.team_count,
            place: head.has_place.then_some(redact::PLACE),
            title: s.free(Some(&head.title)),
            description: s.free(head.description.as_deref()),
            place_description: s.free(head.place_description.as_deref()),
        },
        outcomes,
        otf: otf_ctx(st, &s, id).await?,
        checkpoints,
        materials: materials.into_iter().map(|m| material_ctx(&s, m)).collect(),
    })
}

#[derive(Deserialize)]
pub struct RestoreIn {
    text: String,
}

#[derive(Serialize)]
pub struct RestoreOut {
    text: String,
}

/// Model cevabindaki `{{KULUP}}`/`{{YER}}` gercek degerle doldurulur. Gercek deger
/// yalniz burada okunur, modele hic gitmez.
pub(crate) async fn llm_restore(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<RestoreIn>,
) -> Result<Json<RestoreOut>> {
    let id = common::id(&raw)?;
    require_scope(&st, &me, USE_AI).await?;
    require_visible(&st, &me, id).await?;
    if b.text.chars().count() > RESTORE_MAX {
        return Err(AppError::BadRequest("invalid_body"));
    }
    let place: Option<String> = sqlx::query_scalar(
        "select coalesce(l.name, nullif(trim(e.place), '')) from events e
           left join nodes l on l.id = e.location_id where e.id = $1")
        .bind(id).fetch_one(&st.pool).await?;
    Ok(Json(RestoreOut { text: redact::restore(&b.text, &st.cfg.club_name, place.as_deref().unwrap_or("")) }))
}
