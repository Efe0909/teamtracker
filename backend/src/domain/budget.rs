//! Maliye > butce (spec/81 §8) ve analiz (§12): donemler, butce satirlari (donem >
//! kategori > etkinlik), plan vs gercek ve ay/donem/etkinlik/kategori kirilimi.
//! Excel ciktilari ayni tablolardir (`xlsx::table`).
//!
//! Gormek "maliye" (finance::need_viewer); yazmak `manage_budgets`.
//!
//! Tanimlar (TRY):
//!   harcanan = onayli faturalarin kalem tutarlari (fatura gunune gore) + defterdeki
//!              kategorili `expense` satirlari (kasadan odenen fatura defterde `purchase`
//!              satiri olarak da vardir: cift sayilmasin diye yalniz `expense` alinir);
//!   taahhut  = onayli ama satin alinmamis kalemlerin kart fiyati (etkinlik gunu, yoksa
//!              gerektigi gune gore).

use std::collections::{BTreeMap, HashMap};

use chrono::{Datelike, Duration, NaiveDate};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::finance::{need, need_viewer, today};
use crate::{
    db::budget as db,
    domain::common,
    error::{AppError, Result},
    finance::cents,
    state::AppState,
    xlsx::{self, Cell},
};

// --- donemler ------------------------------------------------------------------------

#[derive(Serialize)]
pub struct Period {
    id: Uuid,
    name: String,
    /// Ilk gun (dahil).
    from: NaiveDate,
    /// Son gun (dahil).
    to: NaiveDate,
}

impl From<db::PeriodRow> for Period {
    fn from(r: db::PeriodRow) -> Self {
        Self { id: r.id, name: r.name, from: r.from, to: r.to }
    }
}

pub(crate) async fn periods(st: &AppState, me: &crate::models::user::User) -> Result<Vec<Period>> {
    need_viewer(st, me).await?;
    Ok(db::list_periods(&st.pool).await?.into_iter().map(Period::from).collect())
}

#[derive(Deserialize)]
pub struct PeriodIn {
    name: String,
    from: NaiveDate,
    to: NaiveDate,
}

fn check_period(name: &str, from: NaiveDate, to: NaiveDate) -> Result<String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 60 {
        return Err(AppError::BadRequest("invalid_name"));
    }
    if to < from || (to - from).num_days() > 800 {
        return Err(AppError::BadRequest("invalid_period"));
    }
    Ok(name.to_string())
}

async fn period_one(st: &AppState, id: Uuid) -> Result<Period> {
    db::find_period(&st.pool, id).await?.map(Period::from).ok_or(AppError::NotFound)
}

pub(crate) async fn create_period(st: &AppState, me: &crate::models::user::User, b: PeriodIn) -> Result<Period> {
    need(st, me, "manage_budgets").await?;
    let name = check_period(&b.name, b.from, b.to)?;
    let clash = db::has_period_overlap(&st.pool, b.from, b.to, &name).await?;
    if clash {
        return Err(AppError::Conflict("period_overlap"));
    }
    let id = db::insert_period(&st.pool, &name, b.from, b.to).await?;
    period_one(st, id).await
}

pub(crate) async fn patch_period(st: &AppState, me: &crate::models::user::User, id: Uuid, b: PeriodIn) -> Result<Period> {
    need(st, me, "manage_budgets").await?;
    let name = check_period(&b.name, b.from, b.to)?;
    let clash = db::has_other_period_overlap(&st.pool, b.from, b.to, &name, id).await?;
    if clash {
        return Err(AppError::Conflict("period_overlap"));
    }
    let n = db::update_period(&st.pool, id, &name, b.from, b.to).await?;
    if n == 0 {
        return Err(AppError::NotFound);
    }
    period_one(st, id).await
}

pub(crate) async fn delete_period(st: &AppState, me: &crate::models::user::User, id: Uuid) -> Result<serde_json::Value> {
    need(st, me, "manage_budgets").await?;
    let n = db::delete_period(&st.pool, id).await?;
    if n == 0 {
        return Err(AppError::NotFound);
    }
    Ok(serde_json::json!({ "deleted": true }))
}

// --- butce: plan vs gercek --------------------------------------------------------------

#[derive(Deserialize)]
pub struct BudgetQuery {
    #[serde(default)]
    period: Option<Uuid>,
}

#[derive(Serialize, Default, Clone)]
pub struct BudgetRow {
    /// Bos: kategorisiz kalem/gider.
    category_id: Option<Uuid>,
    /// Bos: kategorinin genel payi ve etkinliksiz harcama.
    event_id: Option<Uuid>,
    event_title: Option<String>,
    planned: f64,
    spent: f64,
    committed: f64,
    note: Option<String>,
}

#[derive(Serialize)]
pub struct BudgetView {
    period: Option<Period>,
    rows: Vec<BudgetRow>,
    can_write: bool,
}

type Key = (Option<Uuid>, Option<Uuid>);

async fn budget_rows(st: &AppState, period: Uuid) -> Result<Vec<BudgetRow>> {
    let mut by: HashMap<Key, BudgetRow> = HashMap::new();
    let lines = db::list_lines(&st.pool, period).await?;
    for db::LineRow { category_id: c, event_id: e, amount, note } in lines {
        let r = by.entry((c, e)).or_default();
        r.category_id = c;
        r.event_id = e;
        r.planned = amount;
        r.note = note;
    }
    let spent = db::list_spent(&st.pool, period).await?;
    for (c, e, v) in spent {
        let r = by.entry((c, e)).or_default();
        r.category_id = c;
        r.event_id = e;
        r.spent = v;
    }
    let committed = db::list_committed(&st.pool, period).await?;
    for (c, e, v) in committed {
        let r = by.entry((c, e)).or_default();
        r.category_id = c;
        r.event_id = e;
        r.committed = v;
    }
    let events: Vec<Uuid> = by.keys().filter_map(|(_, e)| *e).collect();
    let titles = db::list_event_titles(&st.pool, &events).await?;
    let titles: HashMap<Uuid, String> = titles.into_iter().collect();
    let mut rows: Vec<BudgetRow> = by.into_values().collect();
    for r in &mut rows {
        r.event_title = r.event_id.and_then(|e| titles.get(&e).cloned());
    }
    rows.sort_by(|a, b| (a.category_id, a.event_title.is_some(), &a.event_title).cmp(&(b.category_id, b.event_title.is_some(), &b.event_title)));
    Ok(rows)
}

pub(crate) async fn budget(st: &AppState, me: &crate::models::user::User, q: BudgetQuery) -> Result<BudgetView> {
    need_viewer(st, me).await?;
    let can_write = common::has_scope(st, me, "manage_budgets").await?;
    // Donem verilmediyse bugunu iceren, yoksa en yeni donem.
    let id: Option<Uuid> = match q.period {
        Some(p) => Some(p),
        None => db::find_current_period(&st.pool, today()).await?,
    };
    let Some(id) = id else {
        return Ok(BudgetView { period: None, rows: Vec::new(), can_write });
    };
    let period = period_one(st, id).await?;
    Ok(BudgetView { rows: budget_rows(st, id).await?, period: Some(period), can_write })
}

#[derive(Deserialize)]
pub struct LineIn {
    period_id: Uuid,
    category_id: Uuid,
    #[serde(default)]
    event_id: Option<Uuid>,
    /// Bos: satiri siler.
    #[serde(default)]
    amount: Option<f64>,
    #[serde(default)]
    note: Option<String>,
}

/// Tek satir yaz/sil; cevap donemin guncel gorunumu.
pub(crate) async fn put_line(st: &AppState, me: &crate::models::user::User, b: LineIn) -> Result<BudgetView> {
    need(st, me, "manage_budgets").await?;
    let cat = crate::db::nodes::category_exists(&st.pool, b.category_id).await?;
    if !cat {
        return Err(AppError::BadRequest("invalid_category"));
    }
    let exists = db::has_period(&st.pool, b.period_id).await?;
    if !exists {
        return Err(AppError::NotFound);
    }
    if let Some(e) = b.event_id {
        let ok = crate::db::events::event_exists(&st.pool, e).await?;
        if !ok {
            return Err(AppError::BadRequest("invalid_event"));
        }
    }
    match b.amount {
        None => {
            db::delete_line(&st.pool, b.period_id, b.category_id, b.event_id).await?;
        }
        Some(v) => {
            // 0 gecerli (bilerek sifir pay); digerleri kurus kuralina uyar.
            let c = if v.abs() < 0.005 { 0 } else { cents(v).ok_or(AppError::BadRequest("invalid_amount"))? };
            let note = common::text(b.note, 500, "invalid_note")?;
            db::upsert_line(&st.pool, b.period_id, b.category_id, b.event_id, c, note.as_deref()).await?;
        }
    }
    let period = period_one(st, b.period_id).await?;
    Ok(BudgetView { rows: budget_rows(st, b.period_id).await?, period: Some(period), can_write: true })
}

// --- analiz --------------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct AnalysisQuery {
    #[serde(default)]
    group: Option<String>,
    #[serde(default)]
    from: Option<NaiveDate>,
    #[serde(default)]
    to: Option<NaiveDate>,
}

#[derive(Serialize, Default)]
pub struct AnalysisRow {
    label: String,
    /// SEB fonlu harcama ve kasa (genel) harcamasi AYRI; toplam ikisinin toplami.
    spent_seb: f64,
    spent_general: f64,
    committed: f64,
    /// SEB'ye talep edilen (gonderilmis ya da sonrasi dosyadaki SEB kalemleri).
    claimed: f64,
    /// Dosyasi odenmis SEB kalemleri (nominal; gercek yatan tutar farkli olabilir).
    received: f64,
    /// Donem/etkinlik/kategori icin planlanan.
    budget: f64,
    /// Kasaya giren gelir satirlari (etkinlik geliri, sponsor).
    income: f64,
}

#[derive(Serialize)]
pub struct Analysis {
    group: String,
    from: NaiveDate,
    to: NaiveDate,
    rows: Vec<AnalysisRow>,
}

const GROUPS: [&str; 4] = ["month", "period", "event", "category"];

async fn analysis_rows(st: &AppState, group: &str, from: NaiveDate, to: NaiveDate) -> Result<Vec<AnalysisRow>> {
    let mut by: BTreeMap<String, AnalysisRow> = BTreeMap::new();
    // Harcanan / talep / yatan: onayli fatura kalemleri, fatura gunune gore.
    let spent = db::list_analysis_spent(&st.pool, group, from, to).await?;
    for db::AnalysisSpentRow { label, seb, general, claimed, received } in spent {
        let r = by.entry(label.clone()).or_default();
        r.label = label;
        r.spent_seb = seb;
        r.spent_general = general;
        r.claimed = claimed;
        r.received = received;
    }
    // Kasadan kategorili gider (defterde `expense`): kasa harcamasi sayilir.
    let ledger_out = db::list_analysis_expenses(&st.pool, group, from, to).await?;
    for (label, v) in ledger_out {
        let r = by.entry(label.clone()).or_default();
        r.label = label;
        r.spent_general += v;
    }
    let income = db::list_analysis_income(&st.pool, group, from, to).await?;
    for (label, v) in income {
        let r = by.entry(label.clone()).or_default();
        r.label = label;
        r.income = v;
    }
    // Taahhut: onayli ama alinmamis kalemler, etkinlik gunu (yoksa gerektigi gun).
    let committed = db::list_analysis_committed(&st.pool, group, from, to).await?;
    for (label, v) in committed {
        let r = by.entry(label.clone()).or_default();
        r.label = label;
        r.committed = v;
    }
    // Planlanan: donemi aralikla kesisen butce satirlari; ay kirilimi yok.
    if group != "month" {
        let planned = db::list_analysis_planned(&st.pool, group, from, to).await?;
        for (label, v) in planned {
            let r = by.entry(label.clone()).or_default();
            r.label = label;
            r.budget = v;
        }
    }
    let mut rows: Vec<AnalysisRow> = by.into_values().collect();
    if group != "month" {
        rows.sort_by(|a, b| (b.spent_seb + b.spent_general).total_cmp(&(a.spent_seb + a.spent_general)));
    }
    Ok(rows)
}

fn analysis_range(q: &AnalysisQuery) -> (String, NaiveDate, NaiveDate) {
    let group = q.group.as_deref().filter(|g| GROUPS.contains(g)).unwrap_or("month").to_string();
    let day = today();
    // Varsayilan: son 12 ay (bu ayin sonuna kadar).
    let to = q.to.unwrap_or(day);
    let from = q.from.unwrap_or_else(|| {
        NaiveDate::from_ymd_opt(day.year() - 1, day.month(), 1).unwrap_or(day - Duration::days(365))
    });
    (group, from.min(to), to)
}

pub(crate) async fn analysis(st: &AppState, me: &crate::models::user::User, q: AnalysisQuery) -> Result<Analysis> {
    need_viewer(st, me).await?;
    let (group, from, to) = analysis_range(&q);
    let rows = analysis_rows(st, &group, from, to).await?;
    Ok(Analysis { group, from, to, rows })
}

fn xlsx_fail(e: String) -> AppError {
    tracing::error!("maliye xlsx: {e}");
    AppError::Conflict("xlsx_failed")
}

/// `GET /api/finance/analysis.xlsx`: ekrandaki tablo.
pub(crate) async fn analysis_xlsx(st: &AppState, me: &crate::models::user::User, q: AnalysisQuery) -> Result<(Vec<u8>, String)> {
    need_viewer(st, me).await?;
    let (group, from, to) = analysis_range(&q);
    let rows = analysis_rows(st, &group, from, to).await?;
    let head = ["Ad", "SEB harcanan", "Kasa harcanan", "Toplam harcanan", "Taahhüt", "SEB'e talep edilen", "SEB'den yatan", "Bütçe", "Kasa geliri"];
    let data: Vec<Vec<Cell>> = rows.iter().map(|r| vec![
        r.label.clone().into(), r.spent_seb.into(), r.spent_general.into(), (r.spent_seb + r.spent_general).into(),
        r.committed.into(), r.claimed.into(), r.received.into(), r.budget.into(), r.income.into(),
    ]).collect();
    let bytes = xlsx::table("Analiz", &head, &data).map_err(xlsx_fail)?;
    Ok((bytes, format!("analiz-{group}-{from}-{to}.xlsx")))
}

/// `GET /api/finance/budget.xlsx?period=`: donem x kategori x etkinlik (SEB'e beyan icin).
pub(crate) async fn budget_xlsx(st: &AppState, me: &crate::models::user::User, q: BudgetQuery) -> Result<(Vec<u8>, String)> {
    need_viewer(st, me).await?;
    let id: Uuid = match q.period {
        Some(p) => p,
        None => db::find_export_period(&st.pool, today()).await?.ok_or(AppError::NotFound)?,
    };
    let period = period_one(st, id).await?;
    let rows = budget_rows(st, id).await?;
    let cats = db::list_categories(&st.pool).await?;
    let cat = |c: Option<Uuid>| c.and_then(|c| cats.iter().find(|x| x.0 == c));
    let head = ["Dönem", "Kaynak", "Kategori", "Etkinlik", "Planlanan", "Harcanan", "Taahhüt", "Not"];
    let data: Vec<Vec<Cell>> = rows.iter().map(|r| {
        let c = cat(r.category_id);
        vec![
            period.name.clone().into(),
            match c.and_then(|c| c.2.as_deref()) { Some("seb") => "SEB", Some("general") => "Kulüp kasası", _ => "" }.into(),
            c.map(|c| c.1.clone()).unwrap_or_else(|| "Kategorisiz".into()).into(),
            r.event_title.clone().unwrap_or_default().into(),
            r.planned.into(), r.spent.into(), r.committed.into(),
            r.note.clone().unwrap_or_default().into(),
        ]
    }).collect();
    let bytes = xlsx::table("Bütçe", &head, &data).map_err(xlsx_fail)?;
    Ok((bytes, format!("butce-{}.xlsx", period.from)))
}
