//! purchasing veri erisimi: yalniz SQL (ORM yok, KNOW-178). Is kurali domain/ icinde kalir.

use chrono::{DateTime, NaiveDate, Utc};
use serde_json::Value;
use uuid::Uuid;

#[derive(sqlx::FromRow)]
pub(crate) struct MatRow {
    pub(crate) id: Uuid,
    pub(crate) name: String,
    pub(crate) qty: i32,
    pub(crate) kind: String,
    pub(crate) priority: String,
    pub(crate) state: i16,
    pub(crate) owned: bool,
    pub(crate) purchased: bool,
    pub(crate) delivered: bool,
    pub(crate) sponsor_chosen: bool,
    pub(crate) price: Option<f64>,
    pub(crate) budget: Option<f64>,
    pub(crate) eta: Option<NaiveDate>,
    pub(crate) supplier: Option<String>,
    pub(crate) offer_count: i64,
    pub(crate) event_id: Option<Uuid>,
    pub(crate) event_title: Option<String>,
    pub(crate) event_date: Option<NaiveDate>,
    pub(crate) category_id: Option<Uuid>,
    pub(crate) needed_by: Option<NaiveDate>,
    pub(crate) invoiced: bool,
    pub(crate) created_by: Option<Uuid>,
    pub(crate) created_at: DateTime<Utc>,
    pub(crate) purchased_at: Option<DateTime<Utc>>,
}

/// Ortak FROM: secili ve en ucuz teklif yanal birlesimle (tek sorgu, N+1 yok).
macro_rules! mat_select {
    () => {
        "select m.id, m.name, m.qty, m.type as kind, m.priority, m.state, m.owned, m.purchased, m.delivered,
                m.sponsor_chosen,
                (case when m.sponsor_chosen then 0 else coalesce(cp.price, mp.price) end)::float8 as price,
                m.budget::float8 as budget,
                case when m.sponsor_chosen then m.sponsor_date else coalesce(cp.arrival_date, mp.arrival_date) end as eta,
                case when m.sponsor_chosen then 'Sponsor' else coalesce(cp.who, mp.who) end as supplier,
                (select count(*) from material_providers p where p.material_id = m.id) as offer_count,
                e.id as event_id, e.title as event_title, e.date as event_date, m.category_id, m.needed_by,
                exists(select 1 from invoice_items ii join invoices i on i.id = ii.invoice_id
                        where ii.material_id = m.id and i.status = 'approved') as invoiced,
                m.created_by, m.created_at, m.purchased_at
           from materials m
           left join event_materials em on em.material_id = m.id
           left join events e on e.id = em.event_id
           left join lateral (
             select p.price, p.arrival_date, coalesce(v.name, p.name, p.contact) as who
               from material_providers p left join vendors v on v.id = p.vendor_id
              where p.id = m.chosen_provider_id) cp on true
           left join lateral (
             select p.price, p.arrival_date, coalesce(v.name, p.name, p.contact) as who
               from material_providers p left join vendors v on v.id = p.vendor_id
              where p.material_id = m.id and p.price is not null order by p.price limit 1) mp on true "
    };
}

/// Kuyruklar (spec/81 §7.1). Kosul tek yerde, liste ve sayim ayni ifadeyi kullanir.
macro_rules! queue_where {
    () => {
        "(($1 = 'review' and m.state = 3 and not m.owned and not m.purchased)
          or ($1 = 'ship' and m.purchased and not m.delivered)
          or ($1 = 'invoice' and m.purchased and not exists(select 1 from invoice_items ii join invoices i on i.id = ii.invoice_id
                                                             where ii.material_id = m.id and i.status = 'approved'))
          or ($1 = 'open' and m.state < 3 and not m.owned)
          or $1 = 'all')"
    };
}

macro_rules! filter_where {
    () => {
        "($2::uuid is null or e.id = $2) and (not $3 or em.material_id is null)
         and ($4::text is null or m.type = $4) and ($5::uuid is null or m.category_id = $5)
         and ($6::text is null or m.name ilike '%' || $6 || '%'
              or exists(select 1 from material_providers p left join vendors v on v.id = p.vendor_id
                         where p.material_id = m.id and coalesce(v.name, p.name, p.contact) ilike '%' || $6 || '%'))
         and ($7::date is null or coalesce(e.date, m.needed_by) >= $7)
         and ($8::date is null or coalesce(e.date, m.needed_by) <= $8)"
    };
}

#[expect(clippy::too_many_arguments)]
pub(crate) async fn list_materials(
    ex: impl sqlx::PgExecutor<'_>, queue: &str, event: Option<Uuid>, none: bool, kind: Option<&str>,
    category: Option<Uuid>, search: Option<&str>, from: Option<NaiveDate>, to: Option<NaiveDate>,
) -> Result<Vec<MatRow>, sqlx::Error> {
    sqlx::query_as(concat!(mat_select!(), "where ", queue_where!(), " and ", filter_where!(),
        " order by coalesce(e.date, m.needed_by) nulls last, e.title, m.name limit 500"))
        .bind(queue).bind(event).bind(none).bind(kind).bind(category).bind(search).bind(from).bind(to)
        .fetch_all(ex).await
}

#[expect(clippy::too_many_arguments)]
pub(crate) async fn count_materials(
    ex: impl sqlx::PgExecutor<'_>, queue: &str, event: Option<Uuid>, none: bool, kind: Option<&str>,
    category: Option<Uuid>, search: Option<&str>, from: Option<NaiveDate>, to: Option<NaiveDate>,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(concat!(
            "select count(*) from materials m left join event_materials em on em.material_id = m.id
               left join events e on e.id = em.event_id where ", queue_where!(), " and ", filter_where!()))
        .bind(queue).bind(event).bind(none).bind(kind).bind(category).bind(search).bind(from).bind(to)
        .fetch_one(ex).await
}

pub(crate) async fn find_wall_attrs(ex: impl sqlx::PgExecutor<'_>) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query_scalar("select attrs from nodes where key = 'finance'").fetch_optional(ex).await
}

pub(crate) async fn list_wall_materials(
    ex: impl sqlx::PgExecutor<'_>, kind: Option<&str>, category: Option<Uuid>, ledger: Option<&str>, search: Option<&str>,
) -> Result<Vec<MatRow>, sqlx::Error> {
    sqlx::query_as(concat!(mat_select!(),
        "left join nodes cat on cat.id = m.category_id
          where em.material_id is null and not m.owned
            and ($1::text is null or m.type = $1) and ($2::uuid is null or m.category_id = $2)
            and ($3::text is null or cat.attrs->>'ledger' = $3)
            and ($4::text is null or m.name ilike '%' || $4 || '%')
          order by m.created_at desc limit 5000"))
        .bind(kind).bind(category).bind(ledger).bind(search).fetch_all(ex).await
}

pub(crate) async fn active_category_exists(ex: impl sqlx::PgExecutor<'_>, category: Option<Uuid>) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("select exists(select 1 from nodes where id = $1 and node_type = 'category' and is_active)")
        .bind(category).fetch_one(ex).await
}

#[expect(clippy::too_many_arguments)]
pub(crate) async fn insert_material(
    ex: impl sqlx::PgExecutor<'_>, name: &str, kind: &str, qty: i32, notes: Option<&str>,
    category: Option<Uuid>, needed_by: Option<NaiveDate>, by: Uuid,
) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar(
        "insert into materials (name, type, qty, notes, category_id, needed_by, created_by)
         values ($1, $2, $3, $4, $5, $6, $7) returning id")
        .bind(name).bind(kind).bind(qty).bind(notes).bind(category).bind(needed_by).bind(by).fetch_one(ex).await
}

pub(crate) async fn find_vendor_name(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("select name from vendors where id = $1 and merged_into is null")
        .bind(id).fetch_optional(ex).await
}

pub(crate) async fn insert_provider(ex: impl sqlx::PgExecutor<'_>, id: Uuid, label: &str, price: Option<i64>, vendor: Option<Uuid>) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar(
        "insert into material_providers (material_id, contact, name, price, vendor_id)
                 values ($1, $2, $2, $3::bigint::numeric / 100, $4) returning id")
        .bind(id).bind(label).bind(price).bind(vendor).fetch_one(ex).await
}

pub(crate) async fn set_chosen_provider(ex: impl sqlx::PgExecutor<'_>, id: Uuid, pid: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("update materials set chosen_provider_id = $2, state = 2 where id = $1")
        .bind(id).bind(pid).execute(ex).await?;
    Ok(())
}

pub(crate) async fn find_material(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<MatRow>, sqlx::Error> {
    sqlx::query_as(concat!(mat_select!(), "where m.id = $1")).bind(id).fetch_optional(ex).await
}

#[derive(sqlx::FromRow)]
pub(crate) struct MatInvoice {
    pub(crate) id: Uuid,
    pub(crate) purchased_on: NaiveDate,
    pub(crate) status: String,
    pub(crate) amount: f64,
}

pub(crate) async fn list_material_invoices(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Vec<MatInvoice>, sqlx::Error> {
    sqlx::query_as(
        "select i.id, i.purchased_on, i.status, ii.amount::float8 as amount
           from invoice_items ii join invoices i on i.id = ii.invoice_id
          where ii.material_id = $1 order by i.purchased_on desc, i.created_at desc")
        .bind(id).fetch_all(ex).await
}

pub(crate) async fn lock_material(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<(bool, bool)>, sqlx::Error> {
    sqlx::query_as(
        "select m.purchased, exists(select 1 from event_materials em where em.material_id = m.id)
           from materials m where m.id = $1 for update")
        .bind(id).fetch_optional(ex).await
}

pub(crate) async fn set_material_state(ex: impl sqlx::PgExecutor<'_>, id: Uuid, state: i16) -> Result<(), sqlx::Error> {
    sqlx::query(
            "update materials set state = $2, delivered = case when $2 < 3 then false else delivered end,
                    updated_at = now() where id = $1")
        .bind(id).bind(state).execute(ex).await?;
    Ok(())
}

pub(crate) async fn set_needed_by(ex: impl sqlx::PgExecutor<'_>, id: Uuid, date: Option<NaiveDate>) -> Result<(), sqlx::Error> {
    sqlx::query("update materials set needed_by = $2, updated_at = now() where id = $1")
        .bind(id).bind(date).execute(ex).await?;
    Ok(())
}

pub(crate) async fn category_exists(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("select exists(select 1 from nodes where id = $1 and node_type = 'category')")
        .bind(id).fetch_one(ex).await
}

pub(crate) async fn set_category(ex: impl sqlx::PgExecutor<'_>, id: Uuid, category: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("update materials set category_id = $2, updated_at = now() where id = $1")
        .bind(id).bind(category).execute(ex).await?;
    Ok(())
}

pub(crate) async fn upsert_vendor(ex: impl sqlx::PgExecutor<'_>, label: &str, key: &str, by: Option<Uuid>) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar(
        "insert into vendors (name, name_key, created_by) values ($1, $2, $3)
         on conflict (name_key) where merged_into is null do update set name_key = excluded.name_key
         returning id")
        .bind(label).bind(key).bind(by).fetch_one(ex).await
}

pub(crate) async fn list_unlinked_providers(ex: impl sqlx::PgExecutor<'_>) -> Result<Vec<(Uuid, Option<String>, String)>, sqlx::Error> {
    sqlx::query_as(
        "select id, name, contact from material_providers where vendor_id is null").fetch_all(ex).await
}

pub(crate) async fn set_provider_vendor(ex: impl sqlx::PgExecutor<'_>, id: Uuid, vendor: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("update material_providers set vendor_id = $2 where id = $1")
        .bind(id).bind(vendor).execute(ex).await?;
    Ok(())
}

#[derive(sqlx::FromRow)]
pub(crate) struct VendorRow {
    pub(crate) id: Uuid,
    pub(crate) name: String,
    pub(crate) contact: Option<String>,
    pub(crate) phone: Option<String>,
    pub(crate) email: Option<String>,
    pub(crate) url: Option<String>,
    pub(crate) issues_invoice: Option<bool>,
    pub(crate) note: Option<String>,
    pub(crate) offer_count: i64,
    pub(crate) event_count: i64,
    pub(crate) invoice_total: f64,
    pub(crate) aliases: Vec<String>,
    pub(crate) created_at: DateTime<Utc>,
}

macro_rules! vendor_select {
    () => {
        "select v.id, v.name, v.contact, v.phone, v.email, v.url, v.issues_invoice, v.note,
                (select count(*) from material_providers p where p.vendor_id = v.id) as offer_count,
                (select count(distinct em.event_id) from material_providers p
                   join event_materials em on em.material_id = p.material_id where p.vendor_id = v.id) as event_count,
                coalesce((select sum(i.total_try) from invoices i where i.vendor_id = v.id and i.status = 'approved'), 0)::float8
                  as invoice_total,
                array(select a.name from vendors a where a.merged_into = v.id order by a.name) as aliases,
                v.created_at
           from vendors v "
    };
}

pub(crate) async fn list_vendors(ex: impl sqlx::PgExecutor<'_>, key: Option<String>) -> Result<Vec<VendorRow>, sqlx::Error> {
    sqlx::query_as(concat!(vendor_select!(),
        "where v.merged_into is null
           and ($1::text is null or v.name_key like '%' || $1 || '%'
                or exists(select 1 from vendors a where a.merged_into = v.id and a.name_key like '%' || $1 || '%'))
         order by v.name"))
        .bind(key).fetch_all(ex).await
}

pub(crate) async fn find_vendor_id(ex: impl sqlx::PgExecutor<'_>, key: &str) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar("select id from vendors where name_key = $1 and merged_into is null")
        .bind(key).fetch_optional(ex).await
}

#[expect(clippy::too_many_arguments)]
pub(crate) async fn set_vendor_details(
    ex: impl sqlx::PgExecutor<'_>, id: Uuid, contact: Option<String>, phone: Option<String>, email: Option<String>,
    url: Option<String>, issues_invoice: Option<bool>, note: Option<String>,
) -> Result<(), sqlx::Error> {
    sqlx::query("update vendors set contact = $2, phone = $3, email = $4, url = $5, issues_invoice = $6, note = $7 where id = $1")
        .bind(id).bind(contact).bind(phone).bind(email).bind(url).bind(issues_invoice).bind(note).execute(ex).await?;
    Ok(())
}

pub(crate) async fn find_vendor(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<VendorRow>, sqlx::Error> {
    sqlx::query_as(concat!(vendor_select!(), "where v.id = $1")).bind(id).fetch_optional(ex).await
}

#[derive(sqlx::FromRow)]
pub(crate) struct VendorOffer {
    pub(crate) material_id: Uuid,
    pub(crate) material: String,
    pub(crate) event_title: Option<String>,
    pub(crate) price: Option<f64>,
    pub(crate) chosen: bool,
    pub(crate) purchased: bool,
    pub(crate) at: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
pub(crate) struct VendorInvoice {
    pub(crate) id: Uuid,
    pub(crate) purchased_on: NaiveDate,
    #[sqlx(rename = "total_try")]
    pub(crate) total: f64,
    pub(crate) status: String,
}

pub(crate) async fn find_merged_into(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<Option<Uuid>>, sqlx::Error> {
    sqlx::query_scalar("select merged_into from vendors where id = $1").bind(id).fetch_optional(ex).await
}

pub(crate) async fn list_vendor_offers(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Vec<VendorOffer>, sqlx::Error> {
    sqlx::query_as(
        "select m.id as material_id, m.name as material, e.title as event_title, p.price::float8 as price,
                m.chosen_provider_id = p.id as chosen, m.purchased, m.updated_at as at
           from material_providers p join materials m on m.id = p.material_id
           left join event_materials em on em.material_id = m.id left join events e on e.id = em.event_id
          where p.vendor_id = $1 order by m.updated_at desc limit 200")
        .bind(id).fetch_all(ex).await
}

pub(crate) async fn list_vendor_invoices(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Vec<VendorInvoice>, sqlx::Error> {
    sqlx::query_as(
        "select id, purchased_on, total_try::float8, status from invoices where vendor_id = $1 order by purchased_on desc limit 100")
        .bind(id).fetch_all(ex).await
}

pub(crate) async fn lock_live_vendor(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<bool>, sqlx::Error> {
    sqlx::query_scalar("select merged_into is null from vendors where id = $1 for update")
        .bind(id).fetch_optional(ex).await
}

pub(crate) async fn vendor_key_exists(ex: impl sqlx::PgExecutor<'_>, key: &str, id: Uuid) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
            "select exists(select 1 from vendors where name_key = $1 and merged_into is null and id <> $2)")
        .bind(key).bind(id).fetch_one(ex).await
}

pub(crate) async fn set_vendor_name(ex: impl sqlx::PgExecutor<'_>, id: Uuid, name: String, key: String) -> Result<(), sqlx::Error> {
    sqlx::query("update vendors set name = $2, name_key = $3 where id = $1")
        .bind(id).bind(name).bind(key).execute(ex).await?;
    Ok(())
}

#[expect(clippy::too_many_arguments)]
pub(crate) async fn patch_vendor_details(
    ex: impl sqlx::PgExecutor<'_>, id: Uuid, contact: Option<Option<String>>, phone: Option<Option<String>>,
    email: Option<Option<String>>, url: Option<Option<String>>, issues_invoice: Option<Option<bool>>, note: Option<Option<String>>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "update vendors set
            contact = case when $2 then $3 else contact end,
            phone = case when $4 then $5 else phone end,
            email = case when $6 then $7 else email end,
            url = case when $8 then $9 else url end,
            issues_invoice = case when $10 then $11 else issues_invoice end,
            note = case when $12 then $13 else note end
          where id = $1")
        .bind(id)
        .bind(contact.is_some()).bind(contact.flatten())
        .bind(phone.is_some()).bind(phone.flatten())
        .bind(email.is_some()).bind(email.flatten())
        .bind(url.is_some()).bind(url.flatten())
        .bind(issues_invoice.is_some()).bind(issues_invoice.flatten())
        .bind(note.is_some()).bind(note.flatten())
        .execute(ex).await?;
    Ok(())
}
