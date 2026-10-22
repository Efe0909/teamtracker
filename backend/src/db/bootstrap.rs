//! İlk yönetici veri erişimi: yalnız SQL.

pub(crate) async fn upsert_admin(ex: impl sqlx::PgExecutor<'_>, email: &str, colors: Vec<&str>) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query(
        "with u as (
               insert into users (email, name, color, is_admin, is_active)
               values ($1, split_part($1, '@', 1),
                       ($2::text[])[1 + ((select count(*) from users) % 6)::int], true, true)
               on conflict (lower(email)) do update set is_admin = true, is_active = true
                 where not (users.is_admin and users.is_active)
               returning email)
             insert into security_events (event_type, email, detail)
             select 'admin_granted', email, 'bootstrap' from u")
        .bind(email).bind(colors).execute(ex).await?.rows_affected())
}
