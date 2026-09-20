//! `routes/dashboard.rs` karsiligi — istek govdesi, yetki, YAZMA yolu.

use axum::{extract::{Path, State}, response::{Html, IntoResponse, Response}};
use minijinja::context;

use crate::{
    auth::CurrentUser,
    error::{AppError, Result},
    models::{module, record::{short_time, Chip, RecordListRow, RecordRow, PRIORITIES, STATUSES}},
    render,
    state::AppState,
};

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

/// Gorev tablosu. Suzme ve siralama SQL'de; ozet AYNI where ile tek sorgu.
///
/// Python'da tum kayitlari cekip Rust'ta elemek YASAK (KNOW-181) — burada da
/// oyle: satir sayisi ekranda gorunen satir sayisidir.
pub async fn table(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
) -> Result<Response> {
    let raw: Vec<RecordListRow> = sqlx::query_as(
        "select r.id, r.unit_id, r.kind, r.title, r.status, r.priority,
                r.owner_id, r.due_date, r.updated_at,
                t.name as team_name, t.color as team_color,
                (select count(*) from actions a
                  where a.record_id = r.id and a.status in ('open','in_progress'))
                  ::bigint as open_action_count
           from records r
           left join teams t on t.id = r.team_id
          order by case r.priority when 'critical' then 0 when 'high' then 1
                                   when 'medium' then 2 else 3 end,
                   r.updated_at desc")
        .fetch_all(&st.pool).await?;

    let summary: (i64, i64, i64, i64, i64, i64, i64) = sqlx::query_as(
        "select
           coalesce(sum(case when status <> 'closed' then 1 else 0 end),0)::bigint,
           coalesce(sum(case when status = 'closed' then 1 else 0 end),0)::bigint,
           count(*)::bigint,
           coalesce(sum(case when status <> 'closed' and priority='critical' then 1 else 0 end),0)::bigint,
           coalesce(sum(case when status <> 'closed' and priority='high'     then 1 else 0 end),0)::bigint,
           coalesce(sum(case when status <> 'closed' and priority='medium'   then 1 else 0 end),0)::bigint,
           coalesce(sum(case when status <> 'closed' and priority='low'      then 1 else 0 end),0)::bigint
         from records")
        .fetch_one(&st.pool).await?;

    let people = render::all_users(&st).await?;
    let today = chrono::Utc::now().date_naive();
    let rows: Vec<RecordRow> = {
        let tree = st.tree.read().expect("agac kilidi");
        raw.into_iter().map(|r| {
            let anc = tree.ancestors(r.unit_id);
            RecordRow {
                path: anc.iter().rev().take(2).rev()
                    .map(|&n| tree.name(n)).collect::<Vec<_>>().join(" › "),
                team: r.team_name.map(|name| Chip { name, color: r.team_color }),
                assignee: r.owner_id.and_then(|id| people.iter().find(|p| p.id == id))
                    .map(|p| Chip { name: p.name.clone(), color: p.color.clone() }),
                overdue: r.due_date.map(|d| d < today).unwrap_or(false)
                    && r.status != "closed",
                time: short_time(r.updated_at),
                id: r.id, kind: r.kind, title: r.title,
                status: r.status, priority: r.priority,
                due: r.due_date, open_action_count: r.open_action_count,
            }
        }).collect()
    };

    let html = render::page(&st, &u, "dashboard/tasks.html", context! {
        rows => rows,
        summary => context! {
            open => summary.0, closed => summary.1, all => summary.2,
            critical => summary.3, high => summary.4,
            medium => summary.5, low => summary.6,
        },
        statuses   => STATUSES.iter().copied().collect::<std::collections::BTreeMap<_,_>>(),
        priorities => PRIORITIES.iter().copied().collect::<std::collections::BTreeMap<_,_>>(),
        // TODO(filtre): shared/filters.py karsiligi yazilinca dolacak.
        filters => Vec::<u8>::new(),
        quick => Vec::<u8>::new(),
        selected => context! { quick => "", sort => "activity" },
        orderings => [("activity", "Son hareket"), ("date", "Son tarih"),
                      ("priority", "Öncelik"), ("newest", "En yeni")]
                     .into_iter().collect::<std::collections::BTreeMap<_,_>>(),
        nodes => Vec::<u8>::new(),
        pillars => Vec::<u8>::new(),
        teams => Vec::<u8>::new(),
        card_types => std::collections::BTreeMap::<String, u8>::new(),
    }).await?;
    Ok(Html(html).into_response())
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
