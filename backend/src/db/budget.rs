//! budget veri erisimi: yalniz SQL (ORM yok, KNOW-178). Is kurali domain/ icinde kalir.

use chrono::NaiveDate;
use uuid::Uuid;

/// Kart fiyati: sponsor secili ise 0, secili teklif, yoksa en dusuk (spec/73 `priceOf`).
macro_rules! card_price {
    () => {
        "(case when m.sponsor_chosen then 0
               else coalesce((select p.price from material_providers p where p.id = m.chosen_provider_id),
                             (select min(p.price) from material_providers p where p.material_id = m.id)) end)"
    };
}

#[derive(sqlx::FromRow)]
pub(crate) struct PeriodRow {
    pub id: Uuid,
    pub name: String,
    pub from: NaiveDate,
    pub to: NaiveDate,
}

macro_rules! period_select {
    () => {
        "select id, name, lower(span) as \"from\", (upper(span) - 1) as \"to\" from finance_periods "
    };
}

pub(crate) async fn list_periods(ex: impl sqlx::PgExecutor<'_>) -> Result<Vec<PeriodRow>, sqlx::Error> {
    sqlx::query_as(concat!(period_select!(), "order by lower(span) desc")).fetch_all(ex).await
}

pub(crate) async fn find_period(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<PeriodRow>, sqlx::Error> {
    sqlx::query_as(concat!(period_select!(), "where id = $1"))
        .bind(id).fetch_optional(ex).await
}

pub(crate) async fn has_period_overlap(ex: impl sqlx::PgExecutor<'_>, from: NaiveDate, to: NaiveDate, name: &str) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "select exists(select 1 from finance_periods where span && daterange($1, $2 + 1, '[)') or name = $3)")
        .bind(from).bind(to).bind(name).fetch_one(ex).await
}

pub(crate) async fn insert_period(ex: impl sqlx::PgExecutor<'_>, name: &str, from: NaiveDate, to: NaiveDate) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar(
        "insert into finance_periods (name, span) values ($1, daterange($2, $3 + 1, '[)')) returning id")
        .bind(name).bind(from).bind(to).fetch_one(ex).await
}

pub(crate) async fn has_other_period_overlap(ex: impl sqlx::PgExecutor<'_>, from: NaiveDate, to: NaiveDate, name: &str, id: Uuid) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "select exists(select 1 from finance_periods
                        where id <> $4 and (span && daterange($1, $2 + 1, '[)') or name = $3))")
        .bind(from).bind(to).bind(name).bind(id).fetch_one(ex).await
}

pub(crate) async fn update_period(ex: impl sqlx::PgExecutor<'_>, id: Uuid, name: &str, from: NaiveDate, to: NaiveDate) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query("update finance_periods set name = $2, span = daterange($3, $4 + 1, '[)') where id = $1")
        .bind(id).bind(name).bind(from).bind(to).execute(ex).await?.rows_affected())
}

pub(crate) async fn delete_period(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query("delete from finance_periods where id = $1")
        .bind(id).execute(ex).await?.rows_affected())
}

#[derive(sqlx::FromRow)]
pub(crate) struct LineRow {
    pub category_id: Option<Uuid>,
    pub event_id: Option<Uuid>,
    pub amount: f64,
    pub note: Option<String>,
}

pub(crate) async fn list_lines(ex: impl sqlx::PgExecutor<'_>, period: Uuid) -> Result<Vec<LineRow>, sqlx::Error> {
    sqlx::query_as(
        "select category_id, event_id, amount::float8, note from budget_lines where period_id = $1")
        .bind(period).fetch_all(ex).await
}

pub(crate) async fn list_spent(ex: impl sqlx::PgExecutor<'_>, period: Uuid) -> Result<Vec<(Option<Uuid>, Option<Uuid>, f64)>, sqlx::Error> {
    sqlx::query_as(
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
        .bind(period).fetch_all(ex).await
}

pub(crate) async fn list_committed(ex: impl sqlx::PgExecutor<'_>, period: Uuid) -> Result<Vec<(Option<Uuid>, Option<Uuid>, f64)>, sqlx::Error> {
    sqlx::query_as(concat!(
        "with sp as (select lower(span) as lo, upper(span) as hi from finance_periods where id = $1)
         select m.category_id, em.event_id, sum(", card_price!(), ")::float8
           from materials m
           left join event_materials em on em.material_id = m.id
           left join events e on e.id = em.event_id, sp
          where m.state = 3 and not m.owned and not m.purchased
            and coalesce(e.date, m.needed_by) >= sp.lo and coalesce(e.date, m.needed_by) < sp.hi
          group by 1, 2"))
        .bind(period).fetch_all(ex).await
}

pub(crate) async fn list_event_titles(ex: impl sqlx::PgExecutor<'_>, events: &[Uuid]) -> Result<Vec<(Uuid, String)>, sqlx::Error> {
    sqlx::query_as("select id, title from events where id = any($1)")
        .bind(events).fetch_all(ex).await
}

pub(crate) async fn find_current_period(ex: impl sqlx::PgExecutor<'_>, day: NaiveDate) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar("select id from finance_periods order by (span @> $1::date) desc, lower(span) desc limit 1")
        .bind(day).fetch_optional(ex).await
}

pub(crate) async fn find_export_period(ex: impl sqlx::PgExecutor<'_>, day: NaiveDate) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar("select id from finance_periods order by (span @> $1::date) desc, lower(span) desc limit 1")
        .bind(day).fetch_optional(ex).await
}

pub(crate) async fn has_category(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("select exists(select 1 from nodes where id = $1 and node_type = 'category')")
        .bind(id).fetch_one(ex).await
}

pub(crate) async fn has_period(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("select exists(select 1 from finance_periods where id = $1)")
        .bind(id).fetch_one(ex).await
}

pub(crate) async fn has_event(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("select exists(select 1 from events where id = $1)")
        .bind(id).fetch_one(ex).await
}

pub(crate) async fn delete_line(ex: impl sqlx::PgExecutor<'_>, period: Uuid, category: Uuid, event: Option<Uuid>) -> Result<(), sqlx::Error> {
    sqlx::query("delete from budget_lines where period_id = $1 and category_id = $2 and event_id is not distinct from $3")
        .bind(period).bind(category).bind(event).execute(ex).await?;
    Ok(())
}

pub(crate) async fn upsert_line(ex: impl sqlx::PgExecutor<'_>, period: Uuid, category: Uuid, event: Option<Uuid>, amount: i64, note: Option<&str>) -> Result<(), sqlx::Error> {
    sqlx::query(
                "insert into budget_lines (period_id, category_id, event_id, amount, note)
                 values ($1, $2, $3, $4::bigint::numeric / 100, $5)
                 on conflict (period_id, category_id, event_id) do update set amount = excluded.amount, note = excluded.note")
        .bind(period).bind(category).bind(event).bind(amount).bind(note).execute(ex).await?;
    Ok(())
}

/// Toplam sutunlarinin adlari ayni oldugundan sirali cozumleme korunur.
#[derive(sqlx::FromRow)]
pub(crate) struct AnalysisSpentRow {
    pub label: String,
    pub seb: f64,
    pub general: f64,
    pub claimed: f64,
    pub received: f64,
}

/// Etiket ifadesi: `d` = tarih, `e` = etkinlik basligi, `c` = kategori adi, `p` = donem adi.
macro_rules! label {
    ($g:literal, $d:literal) => {
        concat!("(case ", $g, " when 'month' then to_char(", $d, ", 'YYYY-MM')
                              when 'period' then coalesce(p.name, 'Dönem dışı')
                              when 'event' then coalesce(e.title, 'Etkinliksiz')
                              else coalesce(c.name, 'Kategorisiz') end)")
    };
}

pub(crate) async fn list_analysis_spent(ex: impl sqlx::PgExecutor<'_>, group: &str, from: NaiveDate, to: NaiveDate) -> Result<Vec<AnalysisSpentRow>, sqlx::Error> {
    let rows: Vec<(String, f64, f64, f64, f64)> = sqlx::query_as(concat!(
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
        .bind(from).bind(to).bind(group).fetch_all(ex).await?;
    Ok(rows.into_iter().map(|(label, seb, general, claimed, received)| AnalysisSpentRow { label, seb, general, claimed, received }).collect())
}

pub(crate) async fn list_analysis_expenses(ex: impl sqlx::PgExecutor<'_>, group: &str, from: NaiveDate, to: NaiveDate) -> Result<Vec<(String, f64)>, sqlx::Error> {
    sqlx::query_as(concat!(
        "select ", label!("$3", "l.occurred_on"), " as label, (-sum(l.amount))::float8
           from ledger_entries l
           left join nodes c on c.id = l.category_id
           left join events e on e.id = l.event_id
           left join finance_periods p on p.span @> l.occurred_on
          where l.kind = 'expense' and l.occurred_on >= $1 and l.occurred_on <= $2
          group by 1"))
        .bind(from).bind(to).bind(group).fetch_all(ex).await
}

pub(crate) async fn list_analysis_income(ex: impl sqlx::PgExecutor<'_>, group: &str, from: NaiveDate, to: NaiveDate) -> Result<Vec<(String, f64)>, sqlx::Error> {
    sqlx::query_as(concat!(
        "select ", label!("$3", "l.occurred_on"), " as label, sum(l.amount)::float8
           from ledger_entries l
           left join nodes c on c.id = l.category_id
           left join events e on e.id = l.event_id
           left join finance_periods p on p.span @> l.occurred_on
          where l.kind = 'income' and l.occurred_on >= $1 and l.occurred_on <= $2
          group by 1"))
        .bind(from).bind(to).bind(group).fetch_all(ex).await
}

pub(crate) async fn list_analysis_committed(ex: impl sqlx::PgExecutor<'_>, group: &str, from: NaiveDate, to: NaiveDate) -> Result<Vec<(String, f64)>, sqlx::Error> {
    sqlx::query_as(concat!(
        "select ", label!("$3", "coalesce(e.date, m.needed_by)"), " as label, sum(", card_price!(), ")::float8
           from materials m
           left join nodes c on c.id = m.category_id
           left join event_materials em on em.material_id = m.id
           left join events e on e.id = em.event_id
           left join finance_periods p on p.span @> coalesce(e.date, m.needed_by)
          where m.state = 3 and not m.owned and not m.purchased
            and coalesce(e.date, m.needed_by) >= $1 and coalesce(e.date, m.needed_by) <= $2
          group by 1"))
        .bind(from).bind(to).bind(group).fetch_all(ex).await
}

pub(crate) async fn list_analysis_planned(ex: impl sqlx::PgExecutor<'_>, group: &str, from: NaiveDate, to: NaiveDate) -> Result<Vec<(String, f64)>, sqlx::Error> {
    sqlx::query_as(
            "select (case $3 when 'period' then p.name when 'event' then coalesce(e.title, 'Etkinliksiz')
                             else coalesce(c.name, 'Kategorisiz') end) as label, sum(b.amount)::float8
               from budget_lines b join finance_periods p on p.id = b.period_id
               left join nodes c on c.id = b.category_id
               left join events e on e.id = b.event_id
              where p.span && daterange($1, $2 + 1, '[)')
              group by 1")
        .bind(from).bind(to).bind(group).fetch_all(ex).await
}

pub(crate) async fn list_categories(ex: impl sqlx::PgExecutor<'_>) -> Result<Vec<(Uuid, String, Option<String>)>, sqlx::Error> {
    sqlx::query_as(
        "select id, name, attrs->>'ledger' from nodes where node_type = 'category'")
        .fetch_all(ex).await
}
