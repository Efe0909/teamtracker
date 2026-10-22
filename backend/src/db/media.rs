//! Medya depolama veri erişimi: yalnız SQL.

use crate::media::Volume;

/// `a` takma adli ek icin "hicbir sahibe bagli degil" kosulu: supurme ve
/// `claimable` AYNI metni kullanir (spec/83 §4.1). Listede olmayan bag,
/// supurmede ekini kaybeder; test kosulu goclerdeki `references attachments`
/// satirlariyla karsilastirir (`OWNER_TABLES`). Makro: sorgu `concat!` ile
/// statik kalsin.
macro_rules! unowned {
    () => {
        "not exists (select 1 from card_attachments x where x.attachment_id = a.id)
         and not exists (select 1 from message_attachments x where x.attachment_id = a.id)
         and not exists (select 1 from users x where x.avatar_id = a.id)
         and not exists (select 1 from teams x where x.banner_id = a.id)
         and not exists (select 1 from invoice_attachments x where x.attachment_id = a.id)
         and not exists (select 1 from ledger_attachments x where x.attachment_id = a.id)"
    };
}
pub(crate) use unowned;

pub(crate) async fn find_active_volume(ex: impl sqlx::PgExecutor<'_>) -> Result<Option<Volume>, sqlx::Error> {
    sqlx::query_as("select id, mount_path, media_prefix from storage_volumes where is_active")
        .fetch_optional(ex).await
}

pub(crate) async fn upsert_volume(
    ex: impl sqlx::PgExecutor<'_>, root: &str, device: Option<String>,
    fs_uuid: Option<String>, fs_type: Option<String>, online: bool,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "with v as (
           insert into storage_volumes (label, kind, mount_path, device, fs_uuid, fs_type,
                                        is_active, is_online, checked_at)
           values ('default', 'local', $1, $2, $3, $4, true, $5, now())
           on conflict (label) do update set mount_path = $1, device = $2, fs_uuid = $3,
             fs_type = $4, is_active = true, is_online = $5, checked_at = now()
           returning id)
         update storage_volumes set is_active = false
          where is_active and id <> (select id from v)")
        .bind(root).bind(device).bind(fs_uuid).bind(fs_type).bind(online)
        .execute(ex).await?;
    Ok(())
}

pub(crate) async fn delete_orphan_chats(ex: impl sqlx::PgExecutor<'_>) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query(
        "delete from chats c
          where c.created_at < now() - interval '1 day'
            and not exists (select 1 from records r where r.chat_id = c.id)
            and not exists (select 1 from teams t where t.chat_id = c.id)")
        .execute(ex).await?.rows_affected())
}

#[derive(sqlx::FromRow)]
pub(crate) struct DeletedAttachment {
    pub mount_path: String,
    pub media_prefix: String,
    pub storage_key: String,
    pub thumb_key: Option<String>,
}

pub(crate) async fn delete_unowned_attachments(ex: impl sqlx::PgExecutor<'_>) -> Result<Vec<DeletedAttachment>, sqlx::Error> {
    sqlx::query_as(concat!(
        "with d as (
           delete from attachments a
            where a.created_at < now() - interval '1 day' and ", unowned!(), "
           returning volume_id, storage_key, thumb_key)
         select v.mount_path, v.media_prefix, d.storage_key, d.thumb_key
           from d join storage_volumes v on v.id = d.volume_id"))
        .fetch_all(ex).await
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    /// Eki sahiplenen bag tablolari: (tablo, sutun) — `unowned!` ile ayni liste.
    const OWNER_TABLES: &[(&str, &str)] = &[
        ("card_attachments", "attachment_id"),
        ("message_attachments", "attachment_id"),
        ("users", "avatar_id"),
        ("teams", "banner_id"),
        ("invoice_attachments", "attachment_id"),
        ("ledger_attachments", "attachment_id"),
    ];

    /// Eke isaret eden ama SAHIPLENMEYEN tablolar (etiket baglari).
    const NON_OWNER_TABLES: &[&str] = &["attachment_tags"];

    /// Goclerde eke isaret eden her tablo ya sahip listesinde ya etiket listesinde;
    /// sahip listesindeki her bag `unowned!` kosulunda. Yeni bag tablosu eklenip
    /// burada unutulursa supurme o tablonun eklerini siler.
    #[test]
    fn ownership_list_matches_migrations() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("migrations");
        let mut found = Vec::new();
        let mut files: Vec<_> = std::fs::read_dir(&dir).map(|d| d.flatten().map(|e| e.path()).collect()).unwrap_or_default();
        files.sort();
        assert!(!files.is_empty(), "goc dizini okunamadi");
        for f in files {
            let mut table = String::new();
            for line in std::fs::read_to_string(&f).unwrap_or_default().lines() {
                let l = line.trim().to_ascii_lowercase();
                for p in ["create table if not exists ", "create table ", "alter table "] {
                    if let Some(rest) = l.strip_prefix(p) {
                        table = rest.split([' ', '(']).next().unwrap_or_default().to_string();
                        break;
                    }
                }
                if l.contains("references attachments") && !found.contains(&table) {
                    found.push(table.clone());
                }
            }
        }
        let sql = unowned!();
        for t in &found {
            let owner = OWNER_TABLES.iter().find(|(o, _)| o == t);
            assert!(owner.is_some() || NON_OWNER_TABLES.contains(&t.as_str()), "{t} listede yok");
            if let Some((o, c)) = owner {
                assert!(sql.contains(&format!("from {o} x where x.{c} = a.id")), "{o}.{c} unowned! kosulunda yok");
            }
        }
        assert_eq!(found.len(), OWNER_TABLES.len() + NON_OWNER_TABLES.len());
    }
}
