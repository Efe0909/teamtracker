//! Baglanti havuzu.
//!
//! `max_connections` TEK SURECE gore: agac indeksi surec bellegindedir
//! (KNOW-85), ikinci bir surec zaten calistirilamaz.
use sqlx::postgres::{PgPool, PgPoolOptions};

pub async fn connect(url: &str) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(8)
        .min_connections(1)
        .connect(url)
        .await
}
