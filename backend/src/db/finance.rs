//! finance veri erisimi: yalniz SQL (ORM yok, KNOW-178). Is kurali domain/ icinde kalir.

use chrono::{DateTime, NaiveDate, Utc};
use uuid::Uuid;

pub(crate) async fn insert_ledger_check(ex: impl sqlx::PgExecutor<'_>, checked_on: NaiveDate, balance: i64, by: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("insert into ledger_checks (checked_on, bank_balance, created_by) values ($1, $2::bigint::numeric / 100, $3)")
        .bind(checked_on).bind(balance).bind(by).execute(ex).await?;
    Ok(())
}

pub(crate) async fn find_user_name(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("select name from users where id = $1")
        .bind(id).fetch_optional(ex).await
}

pub(crate) async fn insert_member_payout(ex: impl sqlx::PgExecutor<'_>, on: NaiveDate, amount: i64, description: &str, user: Uuid, by: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into ledger_entries (occurred_on, amount, kind, description, payee_user_id, created_by)
         values ($1, -($2::bigint::numeric / 100), 'member_payout', $3, $4, $5)")
        .bind(on).bind(amount).bind(description).bind(user).bind(by).execute(ex).await?;
    Ok(())
}

pub(crate) async fn read_cash_balance(ex: impl sqlx::PgExecutor<'_>) -> Result<f64, sqlx::Error> {
    sqlx::query_scalar("select coalesce(sum(amount), 0)::float8 from ledger_entries").fetch_one(ex).await
}

pub(crate) async fn find_summary_check(ex: impl sqlx::PgExecutor<'_>) -> Result<Option<(NaiveDate, f64, f64)>, sqlx::Error> {
    sqlx::query_as(
        "select c.checked_on, c.bank_balance::float8,
                (coalesce((select sum(amount) from ledger_entries where occurred_on <= c.checked_on), 0) - c.bank_balance)::float8
           from ledger_checks c order by c.checked_on desc, c.created_at desc limit 1")
        .fetch_optional(ex).await
}

pub(crate) async fn read_seb_receivable(ex: impl sqlx::PgExecutor<'_>) -> Result<(f64, i64), sqlx::Error> {
    sqlx::query_as(
        "select coalesce(sum(round(ii.amount * coalesce(i.fx_rate, 1), 2)), 0)::float8,
                count(distinct i.id) filter (where i.claim_id is null)
           from invoices i join invoice_items ii on ii.invoice_id = i.id
           left join reimbursement_claims c on c.id = i.claim_id
          where i.status = 'approved' and ii.funding = 'seb' and (c.id is null or c.status <> 'paid')")
        .fetch_one(ex).await
}

pub(crate) async fn count_waiting_claims(ex: impl sqlx::PgExecutor<'_>) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(
        "select count(*) from reimbursement_claims where status in ('sent','office_approved')").fetch_one(ex).await
}

#[derive(sqlx::FromRow)]
pub(crate) struct MemberDebtRow {
    pub user_id: Uuid,
    pub total: f64,
    pub payable: f64,
    pub paid: f64,
}

pub(crate) async fn list_member_debts(ex: impl sqlx::PgExecutor<'_>) -> Result<Vec<MemberDebtRow>, sqlx::Error> {
    let rows: Vec<(Uuid, f64, f64, f64)> = sqlx::query_as(
        "with owed as (
           select i.submitted_by as u,
                  sum(round(ii.amount * coalesce(i.fx_rate, 1), 2)) as total,
                  sum(round(ii.amount * coalesce(i.fx_rate, 1), 2))
                    filter (where ii.funding = 'general' or c.status = 'paid') as payable
             from invoices i join invoice_items ii on ii.invoice_id = i.id
             left join reimbursement_claims c on c.id = i.claim_id
            where i.status = 'approved' and i.paid_by = 'member'
            group by 1),
         paid as (
           select payee_user_id as u, -sum(amount) as paid from ledger_entries
            where kind = 'member_payout' group by 1)
         select o.u, o.total::float8, coalesce(o.payable, 0)::float8, coalesce(p.paid, 0)::float8
           from owed o left join paid p on p.u = o.u
          where o.total > coalesce(p.paid, 0)
          order by o.total - coalesce(p.paid, 0) desc")
        .fetch_all(ex).await?;
    Ok(rows.into_iter().map(|(user_id, total, payable, paid)| MemberDebtRow { user_id, total, payable, paid }).collect())
}

pub(crate) async fn read_pending_invoices(ex: impl sqlx::PgExecutor<'_>) -> Result<(i64, Option<DateTime<Utc>>), sqlx::Error> {
    sqlx::query_as(
        "select count(*), min(created_at) from invoices where status = 'pending'").fetch_one(ex).await
}

#[derive(sqlx::FromRow)]
pub(crate) struct DueRow {
    pub id: Uuid,
    pub name: String,
    pub due: Option<NaiveDate>,
    pub price: Option<f64>,
    pub title: Option<String>,
}

pub(crate) async fn list_due_materials(ex: impl sqlx::PgExecutor<'_>, horizon: NaiveDate) -> Result<Vec<DueRow>, sqlx::Error> {
    sqlx::query_as(
        "select m.id, m.name, coalesce(m.needed_by, e.date) as due,
                (case when m.sponsor_chosen then 0
                      else coalesce((select pr.price from material_providers pr where pr.id = m.chosen_provider_id),
                                    (select min(pr.price) from material_providers pr where pr.material_id = m.id)) end)::float8 as price,
                e.title
           from materials m
           left join event_materials em on em.material_id = m.id
           left join events e on e.id = em.event_id
          where m.state = 3 and not m.owned and not m.purchased
            and coalesce(m.needed_by, e.date) is not null and coalesce(m.needed_by, e.date) <= $1
          order by 3 limit 50")
        .bind(horizon).fetch_all(ex).await
}

#[derive(sqlx::FromRow)]
pub(crate) struct DueRecurringRow {
    pub id: Uuid,
    pub name: String,
    pub next_on: NaiveDate,
    pub amount: f64,
    pub currency: String,
}

pub(crate) async fn list_due_recurring(ex: impl sqlx::PgExecutor<'_>, horizon: NaiveDate) -> Result<Vec<DueRecurringRow>, sqlx::Error> {
    sqlx::query_as(
        "select id, name, next_on, amount::float8, currency::text from recurring_expenses
          where is_active and next_on <= $1 order by next_on")
        .bind(horizon).fetch_all(ex).await
}

pub(crate) async fn find_fx_rate(ex: impl sqlx::PgExecutor<'_>, day: NaiveDate, currency: &str) -> Result<Option<f64>, sqlx::Error> {
    sqlx::query_scalar("select rate::float8 from fx_rates where day = $1 and currency = $2")
        .bind(day).bind(currency).fetch_optional(ex).await
}

pub(crate) async fn insert_fx_rate(ex: impl sqlx::PgExecutor<'_>, day: NaiveDate, currency: &str, rate: i64) -> Result<(), sqlx::Error> {
    sqlx::query("insert into fx_rates (day, currency, rate) values ($1, $2, $3::bigint::numeric / 1000000)
                         on conflict do nothing")
        .bind(day).bind(currency).bind(rate).execute(ex).await?;
    Ok(())
}

pub(crate) async fn count_claim_invoices(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("select count(*) from invoices where claim_id = $1").bind(id).fetch_one(ex).await
}

pub(crate) async fn insert_refund_entry(ex: impl sqlx::PgExecutor<'_>, on: NaiveDate, received: i64, description: &str, by: Uuid) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar(
                    "insert into ledger_entries (occurred_on, amount, kind, description, created_by)
                     values ($1, $2::bigint::numeric / 100, 'seb_refund', left($3, 300), $4) returning id")
        .bind(on).bind(received).bind(description).bind(by).fetch_one(ex).await
}

pub(crate) async fn set_claim_paid(ex: impl sqlx::PgExecutor<'_>, id: Uuid, received: i64, entry: Option<Uuid>) -> Result<(), sqlx::Error> {
    sqlx::query(
                "update reimbursement_claims set status = 'paid', paid_at = now(),
                        received_amount = $2::bigint::numeric / 100, ledger_entry_id = $3 where id = $1")
        .bind(id).bind(received).bind(entry).execute(ex).await?;
    Ok(())
}

pub(crate) async fn set_claim_status(ex: impl sqlx::PgExecutor<'_>, id: Uuid, status: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
                "update reimbursement_claims set status = $2,
                        sent_at = case when $2 = 'sent' then now() when $2 = 'draft' then null else sent_at end,
                        approved_at = case when $2 = 'office_approved' then now() when $2 in ('draft','sent') then null else approved_at end
                  where id = $1")
        .bind(id).bind(status).execute(ex).await?;
    Ok(())
}

#[derive(sqlx::FromRow)]
pub(crate) struct LedgerRow {
    pub id: Uuid,
    pub occurred_on: NaiveDate,
    pub amount: f64,
    pub kind: String,
    pub description: String,
    pub category_id: Option<Uuid>,
    pub event_id: Option<Uuid>,
    pub invoice_id: Option<Uuid>,
    pub payee_user_id: Option<Uuid>,
    pub reverses_id: Option<Uuid>,
    pub reversed: bool,
    pub balance: f64,
    pub created_by: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}

pub(crate) async fn list_ledger_entries(ex: impl sqlx::PgExecutor<'_>) -> Result<Vec<LedgerRow>, sqlx::Error> {
    sqlx::query_as(
        "select * from (
           select e.id, e.occurred_on, e.amount::float8 as amount, e.kind, e.description, e.category_id, e.event_id,
                  e.invoice_id, e.payee_user_id, e.reverses_id,
                  exists(select 1 from ledger_entries r where r.reverses_id = e.id) as reversed,
                  (sum(e.amount) over (order by e.occurred_on, e.created_at, e.id rows unbounded preceding))::float8 as balance,
                  e.created_by, e.created_at
             from ledger_entries e) t
          order by occurred_on desc, created_at desc, id desc limit 500")
        .fetch_all(ex).await
}

pub(crate) async fn read_ledger_totals(ex: impl sqlx::PgExecutor<'_>, day: NaiveDate) -> Result<(f64, f64, f64), sqlx::Error> {
    sqlx::query_as(
        "select coalesce(sum(amount), 0)::float8,
                coalesce(sum(amount) filter (where amount > 0 and date_trunc('month', occurred_on) = date_trunc('month', $1::date)), 0)::float8,
                coalesce(sum(amount) filter (where amount < 0 and date_trunc('month', occurred_on) = date_trunc('month', $1::date)), 0)::float8
           from ledger_entries")
        .bind(day).fetch_one(ex).await
}

pub(crate) async fn find_ledger_check(ex: impl sqlx::PgExecutor<'_>) -> Result<Option<(NaiveDate, f64, f64)>, sqlx::Error> {
    sqlx::query_as(
        "select c.checked_on, c.bank_balance::float8,
                (coalesce((select sum(amount) from ledger_entries where occurred_on <= c.checked_on), 0) - c.bank_balance)::float8
           from ledger_checks c order by c.checked_on desc, c.created_at desc limit 1")
        .fetch_optional(ex).await
}

pub(crate) async fn has_category(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("select exists(select 1 from nodes where id = $1 and node_type = 'category')")
        .bind(id).fetch_one(ex).await
}

pub(crate) async fn has_opening_entry(ex: impl sqlx::PgExecutor<'_>) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("select exists(select 1 from ledger_entries where kind = 'opening')")
        .fetch_one(ex).await
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn insert_ledger_entry(ex: impl sqlx::PgExecutor<'_>, occurred_on: NaiveDate, amount: i64, kind: &str, description: &str, category: Option<Uuid>, event: Option<Uuid>, by: Uuid) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar(
        "insert into ledger_entries (occurred_on, amount, kind, description, category_id, event_id, created_by)
         values ($1, $2::bigint::numeric / 100, $3, $4, $5, $6, $7) returning id")
        .bind(occurred_on).bind(amount).bind(kind).bind(description).bind(category).bind(event).bind(by)
        .fetch_one(ex).await
}

pub(crate) async fn insert_ledger_attachments(ex: impl sqlx::PgExecutor<'_>, id: Uuid, attachments: &[Uuid]) -> Result<(), sqlx::Error> {
    sqlx::query("insert into ledger_attachments (entry_id, attachment_id) select $1, unnest($2::uuid[])")
        .bind(id).bind(attachments).execute(ex).await?;
    Ok(())
}

pub(crate) async fn lock_entry_reversal(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<(String, String, bool)>, sqlx::Error> {
    sqlx::query_as(
        "select kind, description, exists(select 1 from ledger_entries r where r.reverses_id = e.id)
           from ledger_entries e where e.id = $1 for update")
        .bind(id).fetch_optional(ex).await
}

pub(crate) async fn insert_entry_reversal(ex: impl sqlx::PgExecutor<'_>, id: Uuid, day: NaiveDate, description: &str, by: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into ledger_entries (occurred_on, amount, kind, description, reverses_id, created_by)
         select $2, -amount, 'reversal', left($3, 300), id, $4 from ledger_entries where id = $1")
        .bind(id).bind(day).bind(description).bind(by).execute(ex).await?;
    Ok(())
}

#[derive(sqlx::FromRow)]
pub(crate) struct PurchasableRow {
    pub id: Uuid,
    pub name: String,
    pub qty: i32,
    pub price: Option<f64>,
    pub category_id: Option<Uuid>,
    pub purchased: bool,
    pub event_id: Option<Uuid>,
    pub event_title: Option<String>,
    pub event_date: Option<NaiveDate>,
}

pub(crate) async fn list_purchasable(ex: impl sqlx::PgExecutor<'_>) -> Result<Vec<PurchasableRow>, sqlx::Error> {
    sqlx::query_as(
        "select m.id, m.name, m.qty,
                (case when m.sponsor_chosen then 0
                      else coalesce((select p.price from material_providers p where p.id = m.chosen_provider_id),
                                    (select min(p.price) from material_providers p where p.material_id = m.id)) end)::float8 as price,
                m.category_id, m.purchased, e.id as event_id, e.title as event_title, e.date as event_date
           from materials m
           left join event_materials em on em.material_id = m.id
           left join events e on e.id = em.event_id
          where m.state = 3 and not m.owned
            and (e.id is null or e.date is null or e.date >= current_date - 365)
            and (e.id is not null or m.created_at >= now() - interval '1 year')
          order by e.date desc nulls first, e.title, m.name")
        .fetch_all(ex).await
}

#[derive(sqlx::FromRow)]
pub(crate) struct ClaimRow {
    pub id: Uuid,
    pub kind: String,
    pub month: Option<NaiveDate>,
    pub event_id: Option<Uuid>,
    pub event_title: Option<String>,
    pub status: String,
    pub sent_at: Option<DateTime<Utc>>,
    pub approved_at: Option<DateTime<Utc>>,
    pub paid_at: Option<DateTime<Utc>>,
    pub received_amount: Option<f64>,
    pub invoice_count: i64,
    pub seb_total: f64,
    pub people: i64,
}

/// Dosya satiri; `concat!` ile statik sorguya eklenir (liste ve ayrinti ayni).
macro_rules! claim_select {
    () => {
        "select c.id, c.kind, c.month, c.event_id, e.title as event_title, c.status, c.sent_at, c.approved_at,
                c.paid_at, c.received_amount::float8 as received_amount,
                (select count(*) from invoices i where i.claim_id = c.id) as invoice_count,
                coalesce((select sum(round(ii.amount * coalesce(i.fx_rate, 1), 2)) from invoices i
                           join invoice_items ii on ii.invoice_id = i.id
                          where i.claim_id = c.id and ii.funding = 'seb'), 0)::float8 as seb_total,
                (select count(distinct i.submitted_by) from invoices i where i.claim_id = c.id and i.paid_by = 'member') as people
           from reimbursement_claims c left join events e on e.id = c.event_id "
    };
}

pub(crate) async fn list_claims(ex: impl sqlx::PgExecutor<'_>) -> Result<Vec<ClaimRow>, sqlx::Error> {
    sqlx::query_as(concat!(claim_select!(),
        "order by (c.status = 'paid'), coalesce(c.month, c.created_at::date) desc"))
        .fetch_all(ex).await
}

#[derive(sqlx::FromRow)]
pub(crate) struct ClaimSlotRow {
    pub kind: String,
    pub month: Option<NaiveDate>,
    pub event_id: Option<Uuid>,
    pub event_title: Option<String>,
    pub event_date: Option<NaiveDate>,
    pub claim_id: Option<Uuid>,
    pub status: Option<String>,
    pub invoice_count: i64,
    pub seb_total: f64,
}

pub(crate) async fn list_claim_slots(ex: impl sqlx::PgExecutor<'_>) -> Result<Vec<ClaimSlotRow>, sqlx::Error> {
    sqlx::query_as(
        "select * from (
           select 'monthly'::text as kind, coalesce(c.month, m.month) as month, null::uuid as event_id,
                  null::text as event_title, null::date as event_date, c.id as claim_id, c.status,
                  (case when c.id is not null then (select count(*) from invoices i where i.claim_id = c.id)
                        else coalesce(m.n, 0) end)::bigint as invoice_count,
                  (case when c.id is not null then
                          coalesce((select sum(round(ii.amount * coalesce(i.fx_rate, 1), 2)) from invoices i
                                      join invoice_items ii on ii.invoice_id = i.id
                                     where i.claim_id = c.id and ii.funding = 'seb'), 0)
                        else coalesce(m.seb, 0) end)::float8 as seb_total
             from (select date_trunc('month', i.purchased_on)::date as month, count(distinct i.id) as n,
                          sum(round(ii.amount * coalesce(i.fx_rate, 1), 2)) as seb
                     from invoices i join invoice_items ii on ii.invoice_id = i.id
                    where i.status = 'approved' and ii.funding = 'seb' and i.claim_id is null
                    group by 1) m
             full join (select * from reimbursement_claims where kind = 'monthly') c on c.month = m.month
           union all
           select 'event', null, e.id, e.title, e.date, c.id, c.status,
                  (case when c.id is not null then (select count(*) from invoices i where i.claim_id = c.id)
                        else coalesce(x.n, 0) end)::bigint,
                  (case when c.id is not null then
                          coalesce((select sum(round(ii.amount * coalesce(i.fx_rate, 1), 2)) from invoices i
                                      join invoice_items ii on ii.invoice_id = i.id
                                     where i.claim_id = c.id and ii.funding = 'seb'), 0)
                        else coalesce(x.seb, 0) end)::float8
             from (select em.event_id, count(distinct i.id) as n, sum(round(ii.amount * coalesce(i.fx_rate, 1), 2)) as seb
                     from invoice_items ii join invoices i on i.id = ii.invoice_id
                     join event_materials em on em.material_id = ii.material_id
                    where i.status = 'approved' and ii.funding = 'seb'
                      and (i.claim_id is null or exists (select 1 from reimbursement_claims k
                                                          where k.id = i.claim_id and k.kind = 'monthly' and k.status = 'draft'))
                    group by 1) x
             full join (select * from reimbursement_claims where kind = 'event') c on c.event_id = x.event_id
             join events e on e.id = coalesce(c.event_id, x.event_id)
         ) t
          order by (status = 'paid') nulls first, coalesce(month, event_date) desc nulls last")
        .fetch_all(ex).await
}

pub(crate) async fn insert_monthly_claim(ex: impl sqlx::PgExecutor<'_>, month: NaiveDate, by: Uuid) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar(
            "insert into reimbursement_claims (kind, month, created_by) values ('monthly', date_trunc('month', $1::date)::date, $2)
             on conflict (month) where kind = 'monthly' do nothing returning id")
        .bind(month).bind(by).fetch_optional(ex).await
}

pub(crate) async fn has_event(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("select exists(select 1 from events where id = $1)")
        .bind(id).fetch_one(ex).await
}

pub(crate) async fn insert_event_claim(ex: impl sqlx::PgExecutor<'_>, event: Uuid, by: Uuid) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar(
                "insert into reimbursement_claims (kind, event_id, created_by) values ('event', $1, $2)
                 on conflict (event_id) where kind = 'event' do nothing returning id")
        .bind(event).bind(by).fetch_optional(ex).await
}

pub(crate) async fn move_event_invoices(ex: impl sqlx::PgExecutor<'_>, id: Uuid, event: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
            "update invoices i set claim_id = $1, updated_at = now()
              where i.status = 'approved'
                and (i.claim_id is null or exists (select 1 from reimbursement_claims k
                                                    where k.id = i.claim_id and k.kind = 'monthly' and k.status = 'draft'))
                and exists (select 1 from invoice_items ii join event_materials em on em.material_id = ii.material_id
                             where ii.invoice_id = i.id and ii.funding = 'seb' and em.event_id = $2)")
        .bind(id).bind(event).execute(ex).await?;
    Ok(())
}

pub(crate) async fn find_claim(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<ClaimRow>, sqlx::Error> {
    sqlx::query_as(concat!(claim_select!(), "where c.id = $1"))
        .bind(id).fetch_optional(ex).await
}

pub(crate) async fn list_claim_invoices(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Vec<InvoiceListRow>, sqlx::Error> {
    sqlx::query_as(
        "select i.id, i.submitted_by, i.purchased_on, i.currency::text as currency, i.total::float8 as total,
                i.total_try::float8 as total_try, i.paid_by, i.status, i.claim_id, i.created_at,
                (select count(*) from invoice_items x where x.invoice_id = i.id) as item_count,
                (select m.name from invoice_items x join materials m on m.id = x.material_id
                  where x.invoice_id = i.id order by m.name limit 1) as first_item,
                array(select distinct e.title from invoice_items x
                        join event_materials em on em.material_id = x.material_id
                        join events e on e.id = em.event_id where x.invoice_id = i.id) as event_titles,
                (select count(*) from invoice_attachments x where x.invoice_id = i.id) as attachment_count
           from invoices i where i.claim_id = $1 order by i.purchased_on")
        .bind(id).fetch_all(ex).await
}

pub(crate) async fn list_claim_people(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Vec<(Option<Uuid>, f64, i64)>, sqlx::Error> {
    sqlx::query_as(
        "select case when i.paid_by = 'member' then i.submitted_by end as who,
                sum(round(ii.amount * coalesce(i.fx_rate, 1), 2))::float8, count(distinct i.id)
           from invoices i join invoice_items ii on ii.invoice_id = i.id
          where i.claim_id = $1 and ii.funding = 'seb'
          group by 1 order by 1 nulls last")
        .bind(id).fetch_all(ex).await
}

pub(crate) async fn find_export_claim(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<ClaimRow>, sqlx::Error> {
    sqlx::query_as(concat!(claim_select!(), "where c.id = $1"))
        .bind(id).fetch_optional(ex).await
}

#[derive(sqlx::FromRow)]
pub(crate) struct ClaimExportRow {
    pub purchased_on: NaiveDate,
    pub user_name: String,
    pub material_name: String,
    pub event_title: Option<String>,
    pub funding: Option<String>,
    pub amount: f64,
}

pub(crate) async fn list_claim_export_items(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Vec<ClaimExportRow>, sqlx::Error> {
    // Iki `name` sutunu var: mevcut sirali okuma korunur.
    type Item = (NaiveDate, String, String, Option<String>, Option<String>, f64);
    let rows: Vec<Item> = sqlx::query_as(
        "select i.purchased_on, u.name, m.name, e.title, ii.funding,
                round(ii.amount * coalesce(i.fx_rate, 1), 2)::float8
           from invoices i join invoice_items ii on ii.invoice_id = i.id
           join materials m on m.id = ii.material_id
           join users u on u.id = i.submitted_by
           left join event_materials em on em.material_id = m.id
           left join events e on e.id = em.event_id
          where i.claim_id = $1 order by i.purchased_on, u.name, m.name")
        .bind(id).fetch_all(ex).await?;
    Ok(rows.into_iter().map(|(purchased_on, user_name, material_name, event_title, funding, amount)| ClaimExportRow {
        purchased_on, user_name, material_name, event_title, funding, amount,
    }).collect())
}

#[derive(sqlx::FromRow)]
pub(crate) struct ClaimStatusRow {
    pub status: String,
    pub kind: String,
    pub month: Option<NaiveDate>,
    pub title: Option<String>,
}

pub(crate) async fn lock_claim_status(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<ClaimStatusRow>, sqlx::Error> {
    sqlx::query_as(
        "select c.status, c.kind, c.month, e.title from reimbursement_claims c
           left join events e on e.id = c.event_id where c.id = $1 for update of c")
        .bind(id).fetch_optional(ex).await
}

pub(crate) async fn insert_purchase_entry(ex: impl sqlx::PgExecutor<'_>, id: Uuid, purchased_on: NaiveDate, by: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
            "insert into ledger_entries (occurred_on, amount, kind, description, invoice_id, created_by)
             select $2, -i.total_try, 'purchase',
                    left('Satın alım · ' || coalesce((select string_agg(m.name, ', ' order by m.name)
                         from invoice_items x join materials m on m.id = x.material_id where x.invoice_id = i.id), ''), 300),
                    i.id, $3
               from invoices i where i.id = $1")
        .bind(id).bind(purchased_on).bind(by).execute(ex).await?;
    Ok(())
}

pub(crate) async fn has_seb_items(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "select exists(select 1 from invoice_items where invoice_id = $1 and funding = 'seb')")
        .bind(id).fetch_one(ex).await
}

pub(crate) async fn has_draft_claim(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
                    "select exists(select 1 from reimbursement_claims where id = $1 and status = 'draft')")
        .bind(id).fetch_one(ex).await
}

pub(crate) async fn set_invoice_claim(ex: impl sqlx::PgExecutor<'_>, id: Uuid, claim: Option<Uuid>) -> Result<(), sqlx::Error> {
    sqlx::query("update invoices set claim_id = $2 where id = $1").bind(id).bind(claim).execute(ex).await?;
    Ok(())
}

pub(crate) async fn insert_monthly_draft(ex: impl sqlx::PgExecutor<'_>, day: NaiveDate, by: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into reimbursement_claims (kind, month, created_by)
         values ('monthly', date_trunc('month', $1::date)::date, $2)
         on conflict (month) where kind = 'monthly' do nothing")
        .bind(day).bind(by).execute(ex).await?;
    Ok(())
}

pub(crate) async fn find_monthly_draft(ex: impl sqlx::PgExecutor<'_>, day: NaiveDate) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar(
        "select id from reimbursement_claims where kind = 'monthly' and month = date_trunc('month', $1::date)::date
            and status = 'draft'")
        .bind(day).fetch_optional(ex).await
}

pub(crate) async fn read_claim_draft(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
            "select status = 'draft' from reimbursement_claims where id = $1").bind(id).fetch_one(ex).await
}

pub(crate) async fn clear_invoice_claim(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("update invoices set claim_id = null where id = $1").bind(id).execute(ex).await?;
    Ok(())
}

pub(crate) async fn insert_purchase_reversals(ex: impl sqlx::PgExecutor<'_>, id: Uuid, by: Uuid, timezone: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into ledger_entries (occurred_on, amount, kind, description, reverses_id, created_by)
         select (now() at time zone $3)::date, -e.amount, 'reversal', left('Ters kayıt · ' || e.description, 300), e.id, $2
           from ledger_entries e
          where e.invoice_id = $1 and e.kind = 'purchase'
            and not exists (select 1 from ledger_entries r where r.reverses_id = e.id)")
        .bind(id).bind(by).bind(timezone).execute(ex).await?;
    Ok(())
}

pub(crate) async fn clear_materials_purchased(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
        "update materials m set purchased = false, purchased_at = null, purchased_by = null, updated_at = now()
          where m.id in (select material_id from invoice_items where invoice_id = $1)
            and not exists (select 1 from invoice_items x join invoices i on i.id = x.invoice_id
                             where x.material_id = m.id and i.status = 'approved' and i.id <> $1)")
        .bind(id).execute(ex).await?;
    Ok(())
}

pub(crate) async fn lock_invoice_claim(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<(String, Option<Uuid>)>, sqlx::Error> {
    sqlx::query_as("select status, claim_id from invoices where id = $1 for update")
        .bind(id).fetch_optional(ex).await
}

pub(crate) async fn find_claim_draft(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<bool>, sqlx::Error> {
    sqlx::query_scalar("select status = 'draft' from reimbursement_claims where id = $1")
        .bind(id).fetch_optional(ex).await
}

pub(crate) async fn move_invoice_claim(ex: impl sqlx::PgExecutor<'_>, id: Uuid, claim: Option<Uuid>) -> Result<(), sqlx::Error> {
    sqlx::query("update invoices set claim_id = $2, updated_at = now() where id = $1")
        .bind(id).bind(claim).execute(ex).await?;
    Ok(())
}

#[derive(sqlx::FromRow)]
pub(crate) struct InvoiceRow {
    pub id: Uuid,
    pub submitted_by: Uuid,
    pub purchased_on: NaiveDate,
    pub currency: String,
    pub total: f64,
    pub fx_rate: Option<f64>,
    pub fx_on: Option<NaiveDate>,
    pub fx_source: Option<String>,
    pub total_try: f64,
    pub paid_by: String,
    pub payee_account_id: Option<Uuid>,
    pub vendor_id: Option<Uuid>,
    pub vendor_name: Option<String>,
    pub note: Option<String>,
    pub status: String,
    pub claim_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
pub(crate) struct PayeeRow {
    pub id: Uuid,
    pub label: String,
    pub holder_name: String,
    pub iban: Option<String>,
    pub iban_last4: String,
}

#[derive(sqlx::FromRow)]
pub(crate) struct ItemRow {
    pub material_id: Uuid,
    pub name: String,
    pub amount: f64,
    pub funding: Option<String>,
    pub event_id: Option<Uuid>,
    pub event_title: Option<String>,
    pub event_date: Option<NaiveDate>,
    pub category_id: Option<Uuid>,
    pub budget: Option<f64>,
    pub purchased: bool,
}

#[derive(sqlx::FromRow)]
pub(crate) struct ReviewRow {
    pub action: String,
    pub note: Option<String>,
    pub by_user: Option<Uuid>,
    pub at: DateTime<Utc>,
}

pub(crate) async fn find_invoice(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<InvoiceRow>, sqlx::Error> {
    sqlx::query_as(
        "select i.id, i.submitted_by, i.purchased_on, i.currency::text as currency, i.total::float8 as total,
                i.fx_rate::float8 as fx_rate, i.fx_on, i.fx_source, i.total_try::float8 as total_try, i.paid_by,
                i.payee_account_id, i.vendor_id, v.name as vendor_name, i.note, i.status, i.claim_id,
                i.created_at, i.updated_at
           from invoices i left join vendors v on v.id = i.vendor_id
          where i.id = $1")
        .bind(id).fetch_optional(ex).await
}

pub(crate) async fn find_payee(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<PayeeRow, sqlx::Error> {
    sqlx::query_as(
                "select id, label, holder_name, iban, iban_last4 from bank_accounts where id = $1")
        .bind(id).fetch_one(ex).await
}

pub(crate) async fn list_invoice_items(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Vec<ItemRow>, sqlx::Error> {
    sqlx::query_as(
        "select ii.material_id, m.name, ii.amount::float8 as amount, ii.funding,
                e.id as event_id, e.title as event_title, e.date as event_date,
                m.category_id, m.budget::float8 as budget, m.purchased
           from invoice_items ii
           join materials m on m.id = ii.material_id
           left join event_materials em on em.material_id = m.id
           left join events e on e.id = em.event_id
          where ii.invoice_id = $1 order by e.date nulls last, m.name")
        .bind(id).fetch_all(ex).await
}

pub(crate) async fn list_invoice_attachment_ids(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Vec<Uuid>, sqlx::Error> {
    sqlx::query_scalar(
        "select attachment_id from invoice_attachments where invoice_id = $1").bind(id).fetch_all(ex).await
}

pub(crate) async fn list_reviews(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Vec<ReviewRow>, sqlx::Error> {
    sqlx::query_as(
        "select action, note, by_user, at from invoice_reviews where invoice_id = $1 order by at")
        .bind(id).fetch_all(ex).await
}

#[derive(sqlx::FromRow)]
pub(crate) struct InvoiceListRow {
    pub id: Uuid,
    pub submitted_by: Uuid,
    pub purchased_on: NaiveDate,
    pub currency: String,
    pub total: f64,
    pub total_try: f64,
    pub paid_by: String,
    pub status: String,
    pub claim_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub item_count: i64,
    pub first_item: Option<String>,
    pub event_titles: Vec<String>,
    pub attachment_count: i64,
}

pub(crate) async fn list_invoices(ex: impl sqlx::PgExecutor<'_>, status: Option<&str>, mine: bool, user: Uuid) -> Result<Vec<InvoiceListRow>, sqlx::Error> {
    sqlx::query_as(
        "select i.id, i.submitted_by, i.purchased_on, i.currency::text as currency, i.total::float8 as total,
                i.total_try::float8 as total_try, i.paid_by, i.status, i.claim_id, i.created_at,
                (select count(*) from invoice_items x where x.invoice_id = i.id) as item_count,
                (select m.name from invoice_items x join materials m on m.id = x.material_id
                  where x.invoice_id = i.id order by m.name limit 1) as first_item,
                array(select distinct e.title from invoice_items x
                        join event_materials em on em.material_id = x.material_id
                        join events e on e.id = em.event_id where x.invoice_id = i.id) as event_titles,
                (select count(*) from invoice_attachments x where x.invoice_id = i.id) as attachment_count
           from invoices i
          where ($1::text is null or i.status = $1) and (not $2 or i.submitted_by = $3)
          order by (i.status = 'pending') desc, i.created_at desc limit 300")
        .bind(status).bind(mine).bind(user).fetch_all(ex).await
}

#[derive(sqlx::FromRow)]
pub(crate) struct InvoiceDecisionRow {
    pub submitted_by: Uuid,
    pub status: String,
    pub purchased_on: NaiveDate,
    pub paid_by: String,
    pub claim_id: Option<Uuid>,
}

pub(crate) async fn lock_invoice_decision(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<InvoiceDecisionRow>, sqlx::Error> {
    sqlx::query_as(
        "select submitted_by, status, purchased_on, paid_by, claim_id from invoices where id = $1 for update")
        .bind(id).fetch_optional(ex).await
}

pub(crate) async fn set_invoice_status(ex: impl sqlx::PgExecutor<'_>, id: Uuid, status: &str) -> Result<(), sqlx::Error> {
    sqlx::query("update invoices set status = $2, updated_at = now() where id = $1")
        .bind(id).bind(status).execute(ex).await?;
    Ok(())
}

pub(crate) async fn count_unapproved_items(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(
        "select count(*) from invoice_items ii join materials m on m.id = ii.material_id
          where ii.invoice_id = $1 and not (m.state = 3 and not m.owned)")
        .bind(id).fetch_one(ex).await
}

pub(crate) async fn approve_invoice(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("update invoices set status = 'approved' where id = $1").bind(id).execute(ex).await?;
    Ok(())
}

pub(crate) async fn set_item_funding(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
        "update invoice_items ii set funding = coalesce(
           (select n.attrs->>'ledger' from materials m join nodes n on n.id = m.category_id
             where m.id = ii.material_id), 'seb')
          where ii.invoice_id = $1")
        .bind(id).execute(ex).await?;
    Ok(())
}

pub(crate) async fn set_materials_purchased(ex: impl sqlx::PgExecutor<'_>, id: Uuid, by: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
        "update materials set purchased = true, purchased_at = now(), purchased_by = $2, updated_at = now()
          where id in (select material_id from invoice_items where invoice_id = $1) and not purchased")
        .bind(id).bind(by).execute(ex).await?;
    Ok(())
}

pub(crate) async fn has_payee_account(ex: impl sqlx::PgExecutor<'_>, account: Uuid, user: Uuid) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
            "select exists(select 1 from bank_accounts where id = $1 and user_id = $2 and deleted_at is null)")
        .bind(account).bind(user).fetch_one(ex).await
}

pub(crate) async fn count_approved_materials(ex: impl sqlx::PgExecutor<'_>, ids: &[Uuid]) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(
        "select count(*) from materials where id = any($1) and state = 3 and not owned")
        .bind(ids).fetch_one(ex).await
}

pub(crate) async fn has_live_vendor(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("select exists(select 1 from vendors where id = $1 and merged_into is null)")
        .bind(id).fetch_one(ex).await
}

pub(crate) async fn insert_invoice_items(ex: impl sqlx::PgExecutor<'_>, id: Uuid, ids: &[Uuid], amounts: &[i64]) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into invoice_items (invoice_id, material_id, amount)
         select $1, m, a::numeric / 100 from unnest($2::uuid[], $3::bigint[]) as t(m, a)")
        .bind(id).bind(ids).bind(amounts).execute(ex).await?;
    Ok(())
}

pub(crate) async fn insert_invoice_attachments(ex: impl sqlx::PgExecutor<'_>, id: Uuid, attachments: &[Uuid]) -> Result<(), sqlx::Error> {
    sqlx::query("insert into invoice_attachments (invoice_id, attachment_id) select $1, unnest($2::uuid[])")
        .bind(id).bind(attachments).execute(ex).await?;
    Ok(())
}

pub(crate) async fn insert_review(ex: impl sqlx::PgExecutor<'_>, id: Uuid, action: &str, note: Option<&str>, by: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("insert into invoice_reviews (invoice_id, action, note, by_user) values ($1, $2, $3, $4)")
        .bind(id).bind(action).bind(note).bind(by).execute(ex).await?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn insert_invoice(ex: impl sqlx::PgExecutor<'_>, user: Uuid, purchased_on: NaiveDate, currency: &str, total: i64, fx_rate: Option<i64>, fx_on: Option<NaiveDate>, fx_source: Option<&str>, paid_by: &str, payee: Option<Uuid>, vendor: Option<Uuid>, note: Option<&str>) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar(
        "insert into invoices (submitted_by, purchased_on, currency, total, fx_rate, fx_on, fx_source,
                               paid_by, payee_account_id, vendor_id, note)
         values ($1, $2, $3, $4::bigint::numeric / 100, $5::bigint::numeric / 1000000, $6, $7, $8, $9, $10, $11)
         returning id")
        .bind(user).bind(purchased_on).bind(currency).bind(total).bind(fx_rate).bind(fx_on)
        .bind(fx_source).bind(paid_by).bind(payee).bind(vendor).bind(note).fetch_one(ex).await
}

pub(crate) async fn lock_invoice_owner(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<(Uuid, String)>, sqlx::Error> {
    sqlx::query_as("select submitted_by, status from invoices where id = $1 for update")
        .bind(id).fetch_optional(ex).await
}

pub(crate) async fn delete_invoice_items(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("delete from invoice_items where invoice_id = $1").bind(id).execute(ex).await?;
    Ok(())
}

pub(crate) async fn delete_invoice_attachments(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("delete from invoice_attachments where invoice_id = $1").bind(id).execute(ex).await?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn update_invoice(ex: impl sqlx::PgExecutor<'_>, id: Uuid, purchased_on: NaiveDate, currency: &str, total: i64, fx_rate: Option<i64>, fx_on: Option<NaiveDate>, fx_source: Option<&str>, paid_by: &str, payee: Option<Uuid>, vendor: Option<Uuid>, note: Option<&str>) -> Result<(), sqlx::Error> {
    sqlx::query(
        "update invoices set purchased_on = $2, currency = $3, total = $4::bigint::numeric / 100,
                fx_rate = $5::bigint::numeric / 1000000, fx_on = $6, fx_source = $7, paid_by = $8,
                payee_account_id = $9, vendor_id = $10, note = $11, status = 'pending', updated_at = now()
          where id = $1")
        .bind(id).bind(purchased_on).bind(currency).bind(total).bind(fx_rate).bind(fx_on)
        .bind(fx_source).bind(paid_by).bind(payee).bind(vendor).bind(note).execute(ex).await?;
    Ok(())
}
