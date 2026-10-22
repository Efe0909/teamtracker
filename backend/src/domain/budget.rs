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
    domain::common,
    error::{AppError, Result},
    finance::cents,
    state::AppState,
    xlsx::{self, Cell},
};

/// Kart fiyati: sponsor secili ise 0, secili teklif, yoksa en dusuk (spec/73 `priceOf`).
macro_rules! card_price {
    () => {
        "(case when m.sponsor_chosen then 0
               else coalesce((select p.price from material_providers p where p.id = m.chosen_provider_id),
                             (select min(p.price) from material_providers p where p.material_id = m.id)) end)"
    };
}

// --- donemler ------------------------------------------------------------------------

#[derive(Serialize, sqlx::FromRow)]
pub struct Period {
    id: Uuid,
    name: String,
    /// Ilk gun (dahil).
    from: NaiveDate,
    /// Son gun (dahil).
    to: NaiveDate,
}

macro_rules! period_select {
    () => {
        "select id, name, lower(span) as \"from\", (upper(span) - 1) as \"to\" from finance_periods "
    };
}

pub(crate) async fn periods(st: &AppState, me: &crate::models::user::User) -> Result<Vec<Period>> {
    need_viewer(st, me).await?;
    Ok(sqlx::query_as(concat!(period_select!(), "order by lower(span) desc")).fetch_all(&st.pool).await?)
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
    sqlx::query_as(concat!(period_select!(), "where id = $1"))
        .bind(id).fetch_optional(&st.pool).await?.ok_or(AppError::NotFound)
}

pub(crate) async fn create_period(st: &AppState, me: &crate::models::user::User, b: PeriodIn) -> Result<Period> {
    need(st, me, "manage_budgets").await?;
    let name = check_period(&b.name, b.from, b.to)?;
    let clash: bool = sqlx::query_scalar(
        "select exists(select 1 from finance_periods where span && daterange($1, $2 + 1, '[)') or name = $3)")
        .bind(b.from).bind(b.to).bind(&name).fetch_one(&st.pool).await?;
    if clash {
        return Err(AppError::Conflict("period_overlap"));
    }
    let id: Uuid = sqlx::query_scalar(
        "insert into finance_periods (name, span) values ($1, daterange($2, $3 + 1, '[)')) returning id")
        .bind(&name).bind(b.from).bind(b.to).fetch_one(&st.pool).await?;
    period_one(st, id).await
}

pub(crate) async fn patch_period(st: &AppState, me: &crate::models::user::User, id: Uuid, b: PeriodIn) -> Result<Period> {
    need(st, me, "manage_budgets").await?;
    let name = check_period(&b.name, b.from, b.to)?;
    let clash: bool = sqlx::query_scalar(
        "select exists(select 1 from finance_periods
                        where id <> $4 and (span && daterange($1, $2 + 1, '[)') or name = $3))")
        .bind(b.from).bind(b.to).bind(&name).bind(id).fetch_one(&st.pool).await?;
    if clash {
        return Err(AppError::Conflict("period_overlap"));
    }
    let n = sqlx::query("update finance_periods set name = $2, span = daterange($3, $4 + 1, '[)') where id = $1")
        .bind(id).bind(&name).bind(b.from).bind(b.to).execute(&st.pool).await?.rows_affected();
    if n == 0 {
        return Err(AppError::NotFound);
    }
    period_one(st, id).await
}

pub(crate) async fn delete_period(st: &AppState, me: &crate::models::user::User, id: Uuid) -> Result<serde_json::Value> {
    need(st, me, "manage_budgets").await?;
    let n = sqlx::query("delete from finance_periods where id = $1")
        .bind(id).execute(&st.pool).await?.rows_affected();
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
    type Line = (Option<Uuid>, Option<Uuid>, f64, Option<String>);
    let lines: Vec<Line> = sqlx::query_as(
        "select category_id, event_id, amount::float8, note from budget_lines where period_id = $1")
        .bind(period).fetch_all(&st.pool).await?;
    for (c, e, amount, note) in lines {
        let r = by.entry((c, e)).or_default();
        r.category_id = c;
        r.event_id = e;
        r.planned = amount;
        r.note = note;
    }
    let spent: Vec<(Option<Uuid>, Option<Uuid>, f64)> = sqlx::query_as(
        "with sp as (select lower(span) as lo, upper(span) as hi from finance_periods where id = $1)
         select category_id, event_id, sum(amt)::float8 from (
           select m.category_id, em.event_id, round(ii.amount * coalesce(i.fx_rate, 1), 2) as amt
             from invoice_items ii join invoices i on i.id = ii.invoice_id and i.status = 'approved'
             join materials m on m.id = ii.material_id
             left join event_materials em on em.material_id = m.id, sp
            where i.purchased_on >= sp.lo and i.purchased_on < sp.hi
           union all
           select l.category_id, l.event_id, -l.amount
             from ledger_entries l, sp
            where l.kind = 'expense' and l.occurred_on >= sp.lo and l.occurred_on < sp.hi) t
          group by 1, 2")
        .bind(period).fetch_all(&st.pool).await?;
    for (c, e, v) in spent {
        let r = by.entry((c, e)).or_default();
        r.category_id = c;
        r.event_id = e;
        r.spent = v;
    }
    let committed: Vec<(Option<Uuid>, Option<Uuid>, f64)> = sqlx::query_as(concat!(
        "with sp as (select lower(span) as lo, upper(span) as hi from finance_periods where id = $1)
         select m.category_id, em.event_id, sum(", card_price!(), ")::float8
           from materials m
           left join event_materials em on em.material_id = m.id
           left join events e on e.id = em.event_id, sp
          where m.state = 3 and not m.owned and not m.purchased
            and coalesce(e.date, m.needed_by) >= sp.lo and coalesce(e.date, m.needed_by) < sp.hi
          group by 1, 2"))
        .bind(period).fetch_all(&st.pool).await?;
    for (c, e, v) in committed {
        let r = by.entry((c, e)).or_default();
        r.category_id = c;
        r.event_id = e;
        r.committed = v;
    }
    let events: Vec<Uuid> = by.keys().filter_map(|(_, e)| *e).collect();
    let titles: Vec<(Uuid, String)> = sqlx::query_as("select id, title from events where id = any($1)")
        .bind(&events).fetch_all(&st.pool).await?;
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
        None => sqlx::query_scalar(
            "select id from finance_periods order by (span @> $1::date) desc, lower(span) desc limit 1")
            .bind(today()).fetch_optional(&st.pool).await?,
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
    let cat: bool = sqlx::query_scalar("select exists(select 1 from nodes where id = $1 and node_type = 'category')")
        .bind(b.category_id).fetch_one(&st.pool).await?;
    if !cat {
        return Err(AppError::BadRequest("invalid_category"));
    }
    let exists: bool = sqlx::query_scalar("select exists(select 1 from finance_periods where id = $1)")
        .bind(b.period_id).fetch_one(&st.pool).await?;
    if !exists {
        return Err(AppError::NotFound);
    }
    if let Some(e) = b.event_id {
        let ok: bool = sqlx::query_scalar("select exists(select 1 from events where id = $1)")
            .bind(e).fetch_one(&st.pool).await?;
        if !ok {
            return Err(AppError::BadRequest("invalid_event"));
        }
    }
    match b.amount {
        None => {
            sqlx::query("delete from budget_lines where period_id = $1 and category_id = $2 and event_id is not distinct from $3")
                .bind(b.period_id).bind(b.category_id).bind(b.event_id).execute(&st.pool).await?;
        }
        Some(v) => {
            // 0 gecerli (bilerek sifir pay); digerleri kurus kuralina uyar.
            let c = if v.abs() < 0.005 { 0 } else { cents(v).ok_or(AppError::BadRequest("invalid_amount"))? };
            let note = common::text(b.note, 500, "invalid_note")?;
            sqlx::query(
                "insert into budget_lines (period_id, category_id, event_id, amount, note)
                 values ($1, $2, $3, $4::bigint::numeric / 100, $5)
                 on conflict (period_id, category_id, event_id) do update set amount = excluded.amount, note = excluded.note")
                .bind(b.period_id).bind(b.category_id).bind(b.event_id).bind(c).bind(note)
                .execute(&st.pool).await?;
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

/// Etiket ifadesi: `d` = tarih, `e` = etkinlik basligi, `c` = kategori adi, `p` = donem adi.
macro_rules! label {
    ($g:literal, $d:literal) => {
        concat!("(case ", $g, " when 'month' then to_char(", $d, ", 'YYYY-MM')
                              when 'period' then coalesce(p.name, 'Dönem dışı')
                              when 'event' then coalesce(e.title, 'Etkinliksiz')
                              else coalesce(c.name, 'Kategorisiz') end)")
    };
}

async fn analysis_rows(st: &AppState, group: &str, from: NaiveDate, to: NaiveDate) -> Result<Vec<AnalysisRow>> {
    let mut by: BTreeMap<String, AnalysisRow> = BTreeMap::new();
    // Harcanan / talep / yatan: onayli fatura kalemleri, fatura gunune gore.
    let spent: Vec<(String, f64, f64, f64, f64)> = sqlx::query_as(concat!(
        "select ", label!("$3", "i.purchased_on"), " as label,
                coalesce(sum(round(ii.amount * coalesce(i.fx_rate, 1), 2)) filter (where ii.funding = 'seb'), 0)::float8,
                coalesce(sum(round(ii.amount * coalesce(i.fx_rate, 1), 2)) filter (where ii.funding = 'general'), 0)::float8,
                coalesce(sum(round(ii.amount * coalesce(i.fx_rate, 1), 2))
                         filter (where ii.funding = 'seb' and k.status in ('sent','office_approved','paid')), 0)::float8,
                coalesce(sum(round(ii.amount * coalesce(i.fx_rate, 1), 2))
                         filter (where ii.funding = 'seb' and k.status = 'paid'), 0)::float8
           from invoice_items ii join invoices i on i.id = ii.invoice_id and i.status = 'approved'
           join materials m on m.id = ii.material_id
           left join nodes c on c.id = m.category_id
           left join event_materials em on em.material_id = m.id
           left join events e on e.id = em.event_id
           left join finance_periods p on p.span @> i.purchased_on
           left join reimbursement_claims k on k.id = i.claim_id
          where i.purchased_on >= $1 and i.purchased_on <= $2
          group by 1"))
        .bind(from).bind(to).bind(group).fetch_all(&st.pool).await?;
    for (label, seb, general, claimed, received) in spent {
        let r = by.entry(label.clone()).or_default();
        r.label = label;
        r.spent_seb = seb;
        r.spent_general = general;
        r.claimed = claimed;
        r.received = received;
    }
    // Kasadan kategorili gider (defterde `expense`): kasa harcamasi sayilir.
    let ledger_out: Vec<(String, f64)> = sqlx::query_as(concat!(
        "select ", label!("$3", "l.occurred_on"), " as label, (-sum(l.amount))::float8
           from ledger_entries l
           left join nodes c on c.id = l.category_id
           left join events e on e.id = l.event_id
           left join finance_periods p on p.span @> l.occurred_on
          where l.kind = 'expense' and l.occurred_on >= $1 and l.occurred_on <= $2
          group by 1"))
        .bind(from).bind(to).bind(group).fetch_all(&st.pool).await?;
    for (label, v) in ledger_out {
        let r = by.entry(label.clone()).or_default();
        r.label = label;
        r.spent_general += v;
    }
    let income: Vec<(String, f64)> = sqlx::query_as(concat!(
        "select ", label!("$3", "l.occurred_on"), " as label, sum(l.amount)::float8
           from ledger_entries l
           left join nodes c on c.id = l.category_id
           left join events e on e.id = l.event_id
           left join finance_periods p on p.span @> l.occurred_on
          where l.kind = 'income' and l.occurred_on >= $1 and l.occurred_on <= $2
          group by 1"))
        .bind(from).bind(to).bind(group).fetch_all(&st.pool).await?;
    for (label, v) in income {
        let r = by.entry(label.clone()).or_default();
        r.label = label;
        r.income = v;
    }
    // Taahhut: onayli ama alinmamis kalemler, etkinlik gunu (yoksa gerektigi gun).
    let committed: Vec<(String, f64)> = sqlx::query_as(concat!(
        "select ", label!("$3", "coalesce(e.date, m.needed_by)"), " as label, sum(", card_price!(), ")::float8
           from materials m
           left join nodes c on c.id = m.category_id
           left join event_materials em on em.material_id = m.id
           left join events e on e.id = em.event_id
           left join finance_periods p on p.span @> coalesce(e.date, m.needed_by)
          where m.state = 3 and not m.owned and not m.purchased
            and coalesce(e.date, m.needed_by) >= $1 and coalesce(e.date, m.needed_by) <= $2
          group by 1"))
        .bind(from).bind(to).bind(group).fetch_all(&st.pool).await?;
    for (label, v) in committed {
        let r = by.entry(label.clone()).or_default();
        r.label = label;
        r.committed = v;
    }
    // Planlanan: donemi aralikla kesisen butce satirlari; ay kirilimi yok.
    if group != "month" {
        let planned: Vec<(String, f64)> = sqlx::query_as(
            "select (case $3 when 'period' then p.name when 'event' then coalesce(e.title, 'Etkinliksiz')
                             else coalesce(c.name, 'Kategorisiz') end) as label, sum(b.amount)::float8
               from budget_lines b join finance_periods p on p.id = b.period_id
               left join nodes c on c.id = b.category_id
               left join events e on e.id = b.event_id
              where p.span && daterange($1, $2 + 1, '[)')
              group by 1")
            .bind(from).bind(to).bind(group).fetch_all(&st.pool).await?;
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
        None => sqlx::query_scalar("select id from finance_periods order by (span @> $1::date) desc, lower(span) desc limit 1")
            .bind(today()).fetch_optional(&st.pool).await?.ok_or(AppError::NotFound)?,
    };
    let period = period_one(st, id).await?;
    let rows = budget_rows(st, id).await?;
    let cats: Vec<(Uuid, String, Option<String>)> = sqlx::query_as(
        "select id, name, attrs->>'ledger' from nodes where node_type = 'category'")
        .fetch_all(&st.pool).await?;
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
