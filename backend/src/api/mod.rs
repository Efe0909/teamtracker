//! JSON API — Rust'in disariya actigi TEK yuzey (spec/15-sinirlar.md).
//!
//! HTML, sablon, statik dosya YOK: on yuz (frontend/) statik derlenir, nginx
//! verir. Butun uclar `/api` altinda; nginx yalniz bu oneki buraya vekiller.
//! Host ayrimi (app./dashboard./apex) on yuzun isi, burada yok.

mod admin;
mod attachments;
mod auth;
mod cards;
mod chats;
mod common;
mod events;
mod home;
mod meta;
mod nodes;
mod notify;
mod otf;
mod profile;
mod quality;
mod records;
mod teams;

use axum::{
    extract::{DefaultBodyLimit, State},
    routing::{delete, get, patch, post, put},
    Json, Router,
};
use axum_extra::extract::cookie::SignedCookieJar;
use serde::Serialize;
use uuid::Uuid;

use crate::{auth::CurrentUser, error::{AppError, Result}, media, state::AppState};

pub(crate) use chats::authorize_read as authorize_chat_read;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/me", get(me))
        .route("/api/auth/google", get(auth::google_start))
        .route("/api/auth/callback", get(auth::google_callback))
        .route("/api/auth/logout", post(auth::logout))
        .route("/api/auth/dev-login", get(auth::dev_login))
        .route("/api/meta", get(meta::meta))
        .route("/api/ws", get(crate::realtime::connect))
        .route("/api/me/profile", patch(profile::patch))
        .route("/api/users/{id}/name", patch(profile::rename))
        .route("/api/home", get(home::home))
        .route("/api/pins/{slug}", post(home::pin).delete(home::unpin))
        .route("/api/records", get(records::list).post(records::create))
        .route("/api/records/{id}", get(records::get).patch(records::patch))
        .route("/api/records/{id}/participants/{user}", put(records::add_participant).delete(records::remove_participant))
        .route("/api/records/{id}/join", post(records::join).delete(records::cancel_join))
        .route("/api/records/{id}/join-requests/{user}", post(records::decide_join))
        .route("/api/records/{id}/pin", put(records::pin).delete(records::unpin))
        .route("/api/records/{id}/card-order", put(records::set_card_order))
        .route("/api/records/{id}/actions", post(records::add_action))
        .route("/api/records/{id}/cards", post(cards::create))
        .route("/api/cards/{id}", patch(cards::patch).delete(cards::delete))
        .route("/api/cards/{id}/signup", put(cards::signup))
        .route("/api/cards/{id}/vote", put(cards::vote))
        .route("/api/cards/{id}/attachments", post(cards::attach))
        .route("/api/actions/mine", get(records::my_actions))
        .route("/api/actions/{id}", patch(records::patch_action))
        .route("/api/events", get(events::list).post(events::create))
        .route("/api/events/{id}", get(events::get).patch(events::patch))
        .route("/api/events/{id}/participants/{user}",
            put(events::put_participant).delete(events::remove_participant))
        .route("/api/events/{id}/teams/{team}", put(events::put_team).delete(events::remove_team))
        .route("/api/events/{id}/checkpoints", post(events::add_checkpoint))
        .route("/api/events/{id}/widgets", post(events::add_widget))
        .route("/api/events/{id}/materials", post(events::add_material))
        .route("/api/events/{id}/otf", get(otf::get).put(otf::put))
        .route("/api/events/{id}/otf/autofill", post(otf::autofill))
        .route("/api/events/{id}/otf.docx", get(otf::docx))
        .route("/api/event-checkpoints/{id}",
            patch(events::patch_checkpoint).delete(events::delete_checkpoint))
        .route("/api/event-checkpoints/{id}/requests", post(events::request_checkpoint))
        .route("/api/checkpoint-requests/{id}", post(events::resolve_request))
        .route("/api/event-widgets/{id}", delete(events::delete_widget))
        .route("/api/materials/{id}", patch(events::patch_material).delete(events::delete_material))
        .route("/api/materials/{id}/providers", post(events::add_provider))
        .route("/api/material-providers/{id}", patch(events::patch_provider).delete(events::delete_provider))
        .route("/api/materials/{id}/purchased", patch(events::set_purchased))
        .route("/api/chats/{id}/feed", get(chats::feed))
        .route("/api/chats/{id}/messages", post(chats::post))
        .route("/api/chats/inbox", get(chats::inbox))
        .route("/api/teams", get(home::teams).post(teams::create_team))
        .route("/api/teams/{id}",
            get(home::team).patch(teams::patch_team).delete(teams::delete_team))
        .route("/api/teams/{id}/nodes/{node}",
            put(teams::link_node).delete(teams::unlink_node))
        .route("/api/pillars", post(teams::create_pillar))
        .route("/api/pillars/{id}", patch(teams::patch_pillar).delete(teams::delete_pillar))
        .route("/api/teams/{id}/members", post(home::set_member))
        .route("/api/teams/{id}/members/{user}", delete(home::drop_member))
        .route("/api/notifications", get(notify::list))
        .route("/api/notifications/seen", post(notify::seen))
        .route("/api/me/notifications", get(notify::prefs).patch(notify::patch_prefs))
        .route("/api/chats/{id}/prefs", put(notify::set_chat))
        .route("/api/push/vapid", get(notify::vapid))
        .route("/api/push/subscriptions", post(notify::subscribe).delete(notify::unsubscribe))
        .route("/api/nodes", get(nodes::tree).post(nodes::create))
        .route("/api/nodes/{id}", patch(nodes::patch).delete(nodes::delete))
        .route("/api/nodes/{id}/favorite", put(nodes::favorite).delete(nodes::unfavorite))
        // Govde siniri yalniz yuklemede genis (axum varsayilani 2 MB); nginx
        // 12m, uygulama 10 MB — sinir asan istek nginx'ten degil buradan
        // anlasilir kodla doner.
        .route("/api/attachments", post(attachments::upload)
            .layer(DefaultBodyLimit::max(media::MAX_BYTES + 1)))
        .route("/api/attachments/{id}", get(attachments::get).delete(attachments::delete))
        .route("/api/attachments/{id}/thumb", get(attachments::thumb))
        .route("/api/attachments/{id}/tags", post(attachments::add_tag))
        .route("/api/attachments/{id}/tags/{tag}", delete(attachments::remove_tag))
        .route("/api/tags", get(attachments::tags))
        .route("/api/admin", get(admin::get))
        .route("/api/admin/activity", get(admin::activity))
        .route("/api/admin/quality", get(quality::get).put(quality::put).delete(quality::reset))
        .route("/api/admin/quality/try", post(quality::try_it))
        .route("/api/admin/users", post(admin::add_user))
        .route("/api/admin/users/{id}", patch(admin::patch_user))
        .route("/api/admin/roles", post(admin::create_role))
        .route("/api/admin/roles/{id}", patch(admin::patch_role).delete(admin::delete_role))
        // Bilinmeyen yol da JSON: istemci hic HTML gormez.
        .fallback(|| async { AppError::NotFound })
}

#[derive(Serialize)]
struct Me {
    user: Option<MeUser>,
    /// "google" | "fake" — on yuz hangi giris formunu cizecegini buradan bilir.
    auth: &'static str,
    /// Degistiren isteklerde `X-CSRF-Token` olarak geri gelir. Oturum yoksa null.
    csrf: Option<String>,
    /// YALNIZ sahte kimlikte: gelistirme giris formu icin kullanici listesi.
    #[serde(skip_serializing_if = "Option::is_none")]
    dev_users: Option<Vec<DevUser>>,
}

#[derive(Serialize)]
struct MeUser {
    id: Uuid,
    name: String,
    email: String,
    color: Option<String>,
    is_admin: bool,
}

#[derive(Serialize, sqlx::FromRow)]
struct DevUser {
    id: Uuid,
    name: String,
    color: Option<String>,
}

async fn me(State(st): State<AppState>, jar: SignedCookieJar, user: Option<CurrentUser>) -> Result<Json<Me>> {
    let fake = st.cfg.fake_identity();
    let dev_users = if fake {
        Some(sqlx::query_as("select id, name, color from users where is_active order by name")
            .fetch_all(&st.pool).await?)
    } else {
        None
    };
    // Token yalniz kullanici GERCEKTEN cozulduyse: kapatilmis hesabin cerezi
    // hala imzali olabilir.
    let csrf = user.as_ref()
        .and_then(|_| crate::auth::read_session(&jar, &st.cfg))
        .map(|s| s.csrf);
    Ok(Json(Me {
        user: user.map(|CurrentUser(u)| MeUser {
            id: u.id, name: u.name, email: u.email, color: u.color, is_admin: u.is_admin,
        }),
        auth: if fake { "fake" } else { "google" },
        csrf,
        dev_users,
    }))
}
