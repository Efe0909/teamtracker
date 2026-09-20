//! `routes/dashboard.rs` karsiligi — istek govdesi, yetki, YAZMA yolu.

use axum::{extract::{Path, Query, State}, response::{Html, IntoResponse, Response}};
use std::collections::{BTreeMap, HashMap};

use minijinja::context;
use serde::Serialize;
use uuid::Uuid;

use crate::models::user::User;
use sqlx::{Postgres, QueryBuilder};

use crate::{
    auth::CurrentUser,
    error::{AppError, Result},
    db::filters::{Filters, QUICK_FILTERS},
    models::{action::Action, module, record::Record, record::{short_time, Chip, RecordListRow, RecordRow, PRIORITIES, STATUSES}},
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
    Query(params): Query<HashMap<String, String>>,
) -> Result<Response> {
    let f = Filters::parse(&params);

    // Iki sorgu da AYNI where'i kullanir: ozet ile tablo ayrisamaz.
    let (mut raw, mut summary) = {
        let tree = st.tree.read().expect("agac kilidi");

        let mut qb = QueryBuilder::<Postgres>::new(
            "select r.id, r.unit_id, r.kind, r.title, r.status, r.priority,
                    r.owner_id, r.due_date, r.updated_at,
                    t.name as team_name, t.color as team_color,
                    (select count(*) from actions a
                      where a.record_id = r.id and a.status in ('open','in_progress'))
                      ::bigint as open_action_count
               from records r
               left join teams t on t.id = r.team_id");
        f.push_where(&mut qb, &u, &tree);
        qb.push(f.order_by());

        let mut sb = QueryBuilder::<Postgres>::new(
            "select
               coalesce(sum(case when r.status <> 'closed' then 1 else 0 end),0)::bigint,
               coalesce(sum(case when r.status = 'closed' then 1 else 0 end),0)::bigint,
               count(*)::bigint,
               coalesce(sum(case when r.status <> 'closed' and r.priority='critical' then 1 else 0 end),0)::bigint,
               coalesce(sum(case when r.status <> 'closed' and r.priority='high'     then 1 else 0 end),0)::bigint,
               coalesce(sum(case when r.status <> 'closed' and r.priority='medium'   then 1 else 0 end),0)::bigint,
               coalesce(sum(case when r.status <> 'closed' and r.priority='low'      then 1 else 0 end),0)::bigint
             from records r");
        f.push_where(&mut sb, &u, &tree);
        (qb, sb)
    };

    let raw: Vec<RecordListRow> = raw.build_query_as().fetch_all(&st.pool).await?;
    let summary: (i64, i64, i64, i64, i64, i64, i64) =
        summary.build_query_as().fetch_one(&st.pool).await?;

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
        statuses   => STATUSES.iter().copied().collect::<BTreeMap<_,_>>(),
        priorities => PRIORITIES.iter().copied().collect::<BTreeMap<_,_>>(),
        filters    => filter_defs(&st, &people).await?,
        quick      => QUICK_FILTERS,
        selected   => selected_map(&params, &f),
        orderings  => [("activity", "Son hareket"), ("date", "Son tarih"),
                       ("priority", "Öncelik"), ("newest", "En yeni")]
                      .into_iter().collect::<BTreeMap<_,_>>(),
        nodes   => unit_options(&st),
        pillars => pillar_options(&st),
        teams   => team_options(&st).await?,
        card_types => BTreeMap::<String, u8>::new(),
    }).await?;
    Ok(Html(html).into_response())
}

/// Kayit sayfasi. MODAL DEGIL, tam sayfa: URL paylasilabilir, mobil geri
/// tusu calisir (KNOW-112).
pub async fn record_page(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    Path(id): Path<Uuid>,
) -> Result<Response> {
    let html = render::page(&st, &u, "dashboard/record.html",
                            record_ctx(&st, &u, id).await?).await?;
    Ok(Html(html).into_response())
}

/// Kayit sayfasinin baglami. Masaustu ve mobil AYNI parcalari ciziyor
/// (KNOW-265), o yuzden baglam da ortak.
pub async fn record_ctx(st: &AppState, u: &User, id: Uuid) -> Result<minijinja::Value> {
    let rec = Record::fetch(&st.pool, id).await?
        .ok_or_else(|| AppError::NotFound("kayıt yok".into()))?;

    let people = render::all_users(st).await?;
    let feed = crate::db::feed::of_chat(&st.pool, rec.chat_id, u.id, &people).await?;

    let parts: Vec<Uuid> = sqlx::query_scalar(
        "select user_id from record_participants where record_id = $1")
        .bind(id).fetch_all(&st.pool).await?;

    let actions = Action::of_record(&st.pool, id, &people).await?;
    let teams = team_options(st).await?;
    let find = |uid: Option<Uuid>| uid.and_then(|i| people.iter().find(|p| p.id == i));

    let (crumbs, pillar) = {
        let tree = st.tree.read().expect("agac kilidi");
        (tree.ancestors(rec.unit_id).into_iter()
            .map(|n| (n.to_string(), tree.name(n).to_string()))
            .collect::<Vec<_>>(),
         rec.pillar_id.map(|p| tree.name(p).to_string()))
    };

    let status_label = STATUSES.iter().find(|(k, _)| *k == rec.status).map(|(_, v)| *v);
    let priority_label = PRIORITIES.iter().find(|(k, _)| *k == rec.priority).map(|(_, v)| *v);

    Ok(context! {
        item => &rec,
        assignee => find(rec.owner_id),
        creator => find(Some(rec.created_by)),
        team => teams.iter().find(|t| Some(t.id.as_str()) == rec.team_id.map(|i| i.to_string()).as_deref()),
        teams => &teams,
        // Ucuncu oge RENK: takim secim dialogunda da ekranin geri kalanindaki
        // nokta gorunsun — "hangisiydi bu" her seferinde sorulmasin.
        team_options => [("".to_string(), "—".to_string(), None)].into_iter()
            .chain(teams.iter().map(|t| (t.id.clone(), t.name.clone(), t.color.clone())))
            .collect::<Vec<_>>(),
        pillar => pillar,
        pillar_options => pillar_options(st),
        participants => parts.iter().filter_map(|p| find(Some(*p))).collect::<Vec<_>>(),
        feed => feed,
        crumbs => crumbs.into_iter().map(|(id, name)| context!{ id => id, name => name })
            .collect::<Vec<_>>(),
        statuses => STATUSES.iter().copied().collect::<BTreeMap<_,_>>(),
        priorities => PRIORITIES.iter().copied().collect::<BTreeMap<_,_>>(),
        status_label => status_label,
        priority_label => priority_label,
        created => short_time(rec.created_at),
        actions => actions,
        action_status => crate::models::action::ACTION_STATUS.iter().copied()
            .collect::<BTreeMap<_,_>>(),
        open_action_count => 0,
        cards => Vec::<u8>::new(),
        card_types => BTreeMap::<String, u8>::new(),
        can_edit => true,
        // Son tarih AYRI bir kapsam ister (edit_deadline): kural hem kayit
        // alanina hem eyleme ayni sekilde uygulaniyor.
        can_edit_deadline => u.is_admin,
        user_options => people.iter()
            .map(|p| (p.id.to_string(), p.name.clone()))
            .collect::<Vec<_>>(),
        url => format!("/record/{id}/field"),
        oob_feed => false,
        oob => false,
    })
}
pub async fn admin_page() -> Response { todo!("dashboard::admin_page") }
pub async fn toggle_pin() -> Response { todo!("dashboard::toggle_pin") }

/// Sablonun cizdigi filtre kutulari. Yeni bir boyut eklemek = buraya bir
/// giris; rota ve sablon degismez.
#[derive(Serialize)]
struct Opt { value: String, label: String }

/// Gruplanmis secenekler. Gruplamayi SUNUCU yapar: Jinja2 surumu bunu
/// sablonda `namespace()` ile hesapliyordu, minijinja'da o yok ve zaten
/// sablona ait bir is degil (KNOW-126).
#[derive(Serialize)]
struct OptGroup { label: Option<String>, options: Vec<Opt> }

#[derive(Serialize)]
struct FilterDef {
    param: &'static str,
    label: &'static str,
    /// ACIK BIR TUR ISARETI: sablon "secenek listesi bos mu" diye BAKMAZ.
    /// Bakiyordu ve bos bir tabloda (ornegin hic takim yokken) select
    /// filtresi sessizce metin kutusuna dusuyor, yazilan deger de yutuluyordu.
    input_type: &'static str,
    groups: Vec<OptGroup>,
}

/// Duz listeyi ardisik ayni-gruplari birlestirerek gruplara boler.
fn group_opts(flat: Vec<(String, String, Option<String>)>) -> Vec<OptGroup> {
    let mut out: Vec<OptGroup> = Vec::new();
    for (value, label, grp) in flat {
        match out.last_mut() {
            Some(g) if g.label == grp => g.options.push(Opt { value, label }),
            _ => out.push(OptGroup { label: grp, options: vec![Opt { value, label }] }),
        }
    }
    out
}

async fn filter_defs(st: &AppState, people: &[render::UserChip]) -> Result<Vec<FilterDef>> {
    let sel = |v: &str, l: &str| (v.to_string(), l.to_string(), None);
    let teams = team_options(st).await?;

    Ok(vec![
        FilterDef { param: "kind", label: "Tür", input_type: "select",
            groups: group_opts(vec![sel("issue", "Hata"), sel("task", "Görev")]) },
        FilterDef { param: "status", label: "Durum", input_type: "select",
            groups: group_opts(STATUSES.iter().map(|(k, v)| sel(k, v)).collect()) },
        FilterDef { param: "priority", label: "Öncelik", input_type: "select",
            groups: group_opts(PRIORITIES.iter().map(|(k, v)| sel(k, v)).collect()) },
        FilterDef { param: "team", label: "Takım", input_type: "select",
            groups: group_opts(teams.iter().map(|t| sel(&t.id, &t.name)).collect()) },
        FilterDef { param: "person", label: "Sorumlu", input_type: "select",
            groups: group_opts([sel("me", "Ben"), sel("none", "Atanmamış")].into_iter()
                .chain(people.iter().map(|p| sel(&p.id.to_string(), &p.name))).collect()) },
        FilterDef { param: "node", label: "Birim", input_type: "select",
            groups: group_opts(unit_options(st).into_iter()
                .map(|o| (o.id, o.label, Some(o.group))).collect()) },
        FilterDef { param: "pillar", label: "Pillar", input_type: "select",
            groups: group_opts([sel("none", "Pillar'sız")].into_iter()
                .chain(pillar_options(st).into_iter().map(|o| (o.id, o.name, None))).collect()) },
        FilterDef { param: "search", label: "Ara", input_type: "text", groups: vec![] },
    ])
}

/// Sablonun select'leri isaretlemesi icin. YALNIZCA gecerli deger uretenler
/// girer — yansitilan ham girdi DEGIL (XSS ve yaniltici secim ikisi birden).
fn selected_map(params: &HashMap<String, String>, f: &Filters) -> BTreeMap<String, String> {
    let mut m = BTreeMap::new();
    let mut put = |k: &str, v: Option<String>| { if let Some(v) = v { m.insert(k.into(), v); } };
    put("kind", f.kind.clone());
    put("status", f.status.clone());
    put("priority", f.priority.clone());
    put("team", f.team.map(|v| v.to_string()));
    put("node", f.node.map(|v| v.to_string()));
    put("search", f.search.clone());
    if let Some(p) = &f.person {
        m.insert("person".into(), match p {
            crate::db::filters::Person::Me => "me".into(),
            crate::db::filters::Person::None_ => "none".into(),
            crate::db::filters::Person::Id(i) => i.to_string(),
        });
    }
    if let Some(p) = &f.pillar {
        m.insert("pillar".into(), match p {
            crate::db::filters::Pillar::None_ => "none".into(),
            crate::db::filters::Pillar::Id(i) => i.to_string(),
        });
    }
    let _ = params;
    m.insert("quick".into(), f.quick.clone());
    m.insert("sort".into(), f.sort.clone());
    m
}

/// Birim secenegi. Sablon `n.depth` ile girinti ciziyor, filtre kutusu
/// `label` (girintisi icine islenmis) ve `group` (tur basligi) kullaniyor —
/// tek liste iki yeri besliyor.
#[derive(Serialize, Clone)]
struct UnitOption {
    id: String,
    name: String,
    depth: u32,
    label: String,
    group: String,
}

/// PASIF dugumler CIKMAZ (pasiflik ileriye doniktir), TAKIM ve PILLAR da
/// cikmaz — kayit onlara `unit_id` ile baglanmaz (spec/21-sema-v2.md §10).
/// Bugunku Python'da bu suzme YOK, takim ve pillar satirlari listede
/// gorunuyor.
fn unit_options(st: &AppState) -> Vec<UnitOption> {
    let tree = st.tree.read().expect("agac kilidi");
    tree.units(true).into_iter().map(|id| {
        let n = tree.get(id).expect("units icindeki dugum");
        UnitOption {
            id: id.to_string(),
            name: n.name.clone(),
            depth: n.depth,
            label: format!("{}{}", "· ".repeat(n.depth as usize), n.name),
            group: n.node_type.label().to_string(),
        }
    }).collect()
}

#[derive(Serialize, Clone)]
struct NamedOption { id: String, name: String, color: Option<String> }

/// Pillar ORTOGONAL bir boyut: tanimi AGACTA (node_type='pillar'), tek kaynak.
fn pillar_options(st: &AppState) -> Vec<NamedOption> {
    let tree = st.tree.read().expect("agac kilidi");
    tree.of_type(crate::models::enums::NodeType::Pillar, true).into_iter()
        .map(|id| NamedOption { id: id.to_string(), name: tree.name(id).into(), color: None })
        .collect()
}

async fn team_options(st: &AppState) -> Result<Vec<NamedOption>> {
    Ok(sqlx::query_as::<_, (uuid::Uuid, String, Option<String>)>(
        "select id, name, color from teams order by name")
        .fetch_all(&st.pool).await?
        .into_iter()
        .map(|(id, name, color)| NamedOption { id: id.to_string(), name, color })
        .collect())
}

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
