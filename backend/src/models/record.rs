//! `records` satiri ve TABLO SATIRI bicimi.
//!
//! Gorev tablosu ve takim sayfasi AYNI satiri cizer; bicim tek yerde dursun
//! ki "geciken" tanimi iki ekranda ayrismasin.

use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use uuid::Uuid;

/// Ekranda gorunen durum/oncelik etiketleri. Anahtar Ingilizce, etiket Turkce.
pub const STATUSES: &[(&str, &str)] = &[
    ("open", "Açık"), ("in_progress", "Devam"),
    ("pending", "Beklemede"), ("closed", "Kapandı"),
];
pub const PRIORITIES: &[(&str, &str)] = &[
    ("critical", "Kritik"), ("high", "Yüksek"), ("medium", "Orta"), ("low", "Düşük"),
];

/// Tablo sorgusunun ham satiri.
#[derive(Debug, sqlx::FromRow)]
pub struct RecordListRow {
    pub id: Uuid,
    pub unit_id: Uuid,
    pub kind: String,
    pub title: String,
    pub status: String,
    pub priority: String,
    pub owner_id: Option<Uuid>,
    pub due_date: Option<NaiveDate>,
    pub updated_at: DateTime<Utc>,
    pub team_name: Option<String>,
    pub team_color: Option<String>,
    pub open_action_count: i64,
}

#[derive(Debug, Serialize)]
pub struct Chip { pub name: String, pub color: Option<String> }

#[derive(Debug, Serialize)]
pub struct RecordRow {
    pub id: Uuid,
    pub kind: String,
    pub title: String,
    pub status: String,
    pub priority: String,
    pub team: Option<Chip>,
    pub assignee: Option<Chip>,
    /// Son iki ata: "Malzeme Temini › Bütçe Onayı". Tam yol degil — tablo
    /// satirina sigmiyor ve son iki seviye kaydin nerede oldugunu soyluyor.
    pub path: String,
    pub due: Option<NaiveDate>,
    pub overdue: bool,
    pub open_action_count: i64,
    pub time: String,
}

/// "3 dk", "5 sa", "12 gün" — tablo satirinda tam tarih yer kaplardi.
pub fn short_time(t: DateTime<Utc>) -> String {
    let d = Utc::now().signed_duration_since(t);
    let (m, h, g) = (d.num_minutes(), d.num_hours(), d.num_days());
    if m < 1 { "şimdi".into() }
    else if m < 60 { format!("{m} dk") }
    else if h < 24 { format!("{h} sa") }
    else { format!("{g} gün") }
}
