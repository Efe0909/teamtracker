//! Is mantigi katmani (refactor/README.md).
//!
//! `api/` yalniz kenar: cikarim (State, Path, Body…), yol kimligi ayristirma,
//! TEK domain cagrisi, yanit sarmalama. Yetki, dogrulama, SQL, transaction
//! burada — MCP ayni fonksiyonlari cagirsin diye axum tipi almaz.
//!
//! Dosyalar `api/` ile bire bir; taşima refactor/agent1-3.md sirasiyla.

pub(crate) mod admin;
pub(crate) mod attachments;
pub(crate) mod bank_accounts;
pub(crate) mod budget;
pub(crate) mod cards;
pub(crate) mod chats;
pub(crate) mod common;
pub(crate) mod events;
pub(crate) mod finance;
pub(crate) mod home;
pub(crate) mod llm;
pub(crate) mod llm_usage;
pub(crate) mod meta;
pub(crate) mod nodes;
pub(crate) mod notify;
pub(crate) mod otf;
pub(crate) mod profile;
pub(crate) mod purchasing;
pub(crate) mod quality;
pub(crate) mod records;
pub(crate) mod recurring;
pub(crate) mod teams;
pub(crate) mod templates;
