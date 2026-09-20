//! `actions` satiri — isirik buyuklugunde, KISIYE atanan is.
//!
//! Havuz karti BURADA DEGIL: o bir karttir (KNOW-279).

use chrono::NaiveDate;
use serde::Serialize;
use uuid::Uuid;

use crate::render::UserChip;

/// Ekranda gorunen eylem durumu. Kayit durumundan FARKLI: eylemde `pending`
/// yok, `cancelled` var.
pub const ACTION_STATUS: &[(&str, &str)] = &[
    ("open", "Açık"), ("in_progress", "Devam"),
    ("closed", "Kapandı"), ("cancelled", "İptal"),
];

#[derive(Debug, sqlx::FromRow)]
struct ActionRow {
    id: Uuid,
    title: String,
    owner_id: Option<Uuid>,
    status: String,
    due_date: Option<NaiveDate>,
}

#[derive(Debug, Serialize)]
pub struct Action {
    pub id: Uuid,
    pub title: String,
    pub status: String,
    pub status_label: &'static str,
    pub assignee: Option<Assignee>,
    pub due: Option<NaiveDate>,
    pub overdue: bool,
    /// Sablon "bitti mi" diye buna bakar; durum kumesini yeniden yazmaz.
    pub done: bool,
    /// Listedeki ILK tamamlanan eylem. Sablon "Tamamlanan / iptal" ayracini
    /// buna gore ciziyor — Jinja2 surumu bunu namespace() ile kendisi
    /// hesapliyordu (KNOW-126: sablona is mantigi koyma).
    pub first_done: bool,
}

#[derive(Debug, Serialize)]
pub struct Assignee { pub name: String, pub color: Option<String> }

impl Action {
    pub async fn of_record(
        pool: &sqlx::PgPool, record_id: Uuid, people: &[UserChip],
    ) -> Result<Vec<Action>, sqlx::Error> {
        let rows: Vec<ActionRow> = sqlx::query_as(
            "select id, title, owner_id, status, due_date from actions
              where record_id = $1
              -- ACIK olanlar once: sablon \"Tamamlanan\" ayracini ilk bitmis
              -- eylemde ciziyor, sira bu yuzden onemli.
              order by (status in ('closed','cancelled')), created_at")
            .bind(record_id).fetch_all(pool).await?;

        let today = chrono::Utc::now().date_naive();
        let mut seen_done = false;
        Ok(rows.into_iter().map(|r| {
            let p = r.owner_id.and_then(|i| people.iter().find(|p| p.id == i));
            let done = matches!(r.status.as_str(), "closed" | "cancelled");
            let first_done = done && !seen_done;
            seen_done |= done;
            Action {
                status_label: ACTION_STATUS.iter().find(|(k, _)| *k == r.status)
                    .map(|(_, v)| *v).unwrap_or("?"),
                assignee: p.map(|p| Assignee { name: p.name.clone(), color: p.color.clone() }),
                overdue: !done && r.due_date.map(|d| d < today).unwrap_or(false),
                done, first_done,
                id: r.id, title: r.title, status: r.status, due: r.due_date,
            }
        }).collect())
    }
}
