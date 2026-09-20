//! `routes/dashboard.rs` karsiligi — istek govdesi, yetki, YAZMA yolu.

use axum::{extract::{Path, State}, response::{Html, IntoResponse, Response}};
use minijinja::context;

use crate::{auth::CurrentUser, error::{AppError, Result}, models::module, state::AppState};

/// Ana sayfa rozetleri — TEK sorgu, sayfa basina yedi COUNT degil.
#[derive(sqlx::FromRow)]
struct HomeStats {
    open: i64, unassigned: i64, mine: i64, all: i64, my_actions: i64, teams: i64,
}

pub async fn home(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
) -> Result<Response> {
    let stats: HomeStats = sqlx::query_as(
        "select
           coalesce(sum(case when status <> 'closed' then 1 else 0 end), 0)::bigint as open,
           coalesce(sum(case when status <> 'closed' and owner_id is null then 1 else 0 end), 0)::bigint as unassigned,
           coalesce(sum(case when status <> 'closed' and owner_id = $1 then 1 else 0 end), 0)::bigint as mine,
           count(*)::bigint as all,
           (select count(*) from actions
             where owner_id = $1 and status in ('open','in_progress'))::bigint as my_actions,
           (select count(*) from teams)::bigint as teams
         from records")
        .bind(u.id).fetch_one(&st.pool).await?;

    let pinned: Vec<String> = sqlx::query_scalar(
        "select slug from user_pins where user_id = $1")
        .bind(u.id).fetch_all(&st.pool).await?;

    let node_count = st.tree.read().expect("agac kilidi").len();

    let tpl = st.tpl.get_template("dashboard/home.html")?;
    let html = tpl.render(context! {
        user => &u,
        modules => module::views(&pinned),
        stats => context! {
            open => stats.open, unassigned => stats.unassigned, mine => stats.mine,
            all => stats.all, my_actions => stats.my_actions,
            teams => stats.teams, nodes => node_count,
        },
        // v1'de users.scope_node_id'nin adiydi; o sutun dustu. Dal izinleri
        // artik user_node_scopes (cok satir) — admin icin "tum agac".
        scope_name => if u.is_admin { "tüm ağaç" } else { "—" },
        app_address => "app.localhost:8000",
        csrf_token => "",
        rail_pins => Vec::<String>::new(),
        all_users => Vec::<String>::new(),
    })?;
    Ok(Html(html).into_response())
}

pub async fn table() -> Response {
    todo!("dashboard::table")
}

pub async fn record_page() -> Response {
    todo!("dashboard::record_page")
}

pub async fn admin_page() -> Response {
    todo!("dashboard::admin_page")
}

pub async fn toggle_pin() -> Response {
    todo!("dashboard::toggle_pin")
}

/// Iskele sayfa: HENUZ YAZILMAMIS modullerin "Yakında" ekrani.
///
/// HAZIR modul burada 404 verir — onun gercek rotasi zaten yukarida kayitli
/// ve axum statik segmenti dinamik olana tercih ediyor, yani `/tasks` buraya
/// hic gelmez. Yine de 404: `/{slug}` her seyi yutan bir kapi olmamali,
/// kayitli olmayan slug ile hazir modul ayni cevabi vermeli.
pub async fn module_page(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    Path(slug): Path<String>,
) -> Result<Response> {
    let Some(m) = module::by_slug(&slug).filter(|m| !m.ready) else {
        return Err(AppError::NotFound("sayfa yok".into()));
    };
    let tpl = st.tpl.get_template("dashboard/module.html")?;
    Ok(Html(tpl.render(context! {
        m => m, user => &u, csrf_token => "",
    })?).into_response())
}
