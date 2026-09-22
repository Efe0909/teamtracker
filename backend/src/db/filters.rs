//! Gorev tablosu filtreleri.
//!
//! Kurallar (spec/10-kararlar.md "Sorgular"):
//!   - suzme/siralama SQL'de; Rust'a donen satir EKRANDA GORUNEN satirdir
//!   - siralama SABIT sozlukten okunur, kullanici girdisiyle birlestirilmez
//!   - alt agac tin/tout ile bellekteki agactan — recursive CTE yok
//!   - metin aramasi tsvector/GIN, LIKE '%..%' yok
//!
//! GECERSIZ DEGER FILTREYI DUSURUR, ISTEGI DEGIL. `?team=xx` ya da
//! `?sort='; drop table records;--` sessizce yok sayilir ve tablo suzmesiz
//! doner — 400 vermek kullaniciya bir sey kazandirmiyor, sorguya sizmak ise
//! kaybettiriyor.

use std::collections::HashMap;

use sqlx::{Postgres, QueryBuilder};
use uuid::Uuid;

use crate::{db::tree::TreeIndex, models::user::User};

/// Anahtar disaridan gelir ama SQL SABIT buradan okunur — birlestirme yok.
const ORDERINGS: &[(&str, &str)] = &[
    ("activity", "r.updated_at desc"),
    ("date", "r.due_date is null, r.due_date"),
    ("priority", "case r.priority when 'critical' then 0 when 'high' then 1 \
                  when 'medium' then 2 else 3 end"),
    ("newest", "r.created_at desc"),
];
const DEFAULT_ORDER: &str = "activity";

pub const QUICK_FILTERS: &[(&str, &str)] = &[
    ("all", "Hepsi"), ("week", "Bu hafta"), ("my_actions", "Açık eylemim"),
    ("overdue", "Geciken"), ("unassigned", "Atanmamış"),
];

const KINDS: &[&str] = &["issue", "task"];
const STATUSES: &[&str] = &["open", "in_progress", "pending", "closed"];
const PRIORITIES: &[&str] = &["critical", "high", "medium", "low"];

#[derive(Debug, Clone, PartialEq)]
pub enum Person { Me, None_, Id(Uuid) }

#[derive(Debug, Clone, PartialEq)]
pub enum Pillar { None_, Id(Uuid) }

#[derive(Debug, Default)]
pub struct Filters {
    pub kind: Option<String>,
    pub status: Option<String>,
    pub priority: Option<String>,
    pub team: Option<Uuid>,
    pub person: Option<Person>,
    pub node: Option<Uuid>,
    pub pillar: Option<Pillar>,
    pub search: Option<String>,
    pub quick: String,
    pub sort: String,
}

fn pick(p: &HashMap<String, String>, key: &str, allowed: &[&str]) -> Option<String> {
    p.get(key).map(|s| s.trim()).filter(|s| allowed.contains(s)).map(String::from)
}

fn uuid_of(p: &HashMap<String, String>, key: &str) -> Option<Uuid> {
    p.get(key).and_then(|s| s.trim().parse().ok())
}

impl Filters {
    /// Ham sorgu parametrelerinden. Her alan KENDI BASINA dogrulanir; biri
    /// gecersizse yalniz o duser.
    pub fn parse(p: &HashMap<String, String>) -> Self {
        Filters {
            kind: pick(p, "kind", KINDS),
            status: pick(p, "status", STATUSES),
            priority: pick(p, "priority", PRIORITIES),
            team: uuid_of(p, "team"),
            person: p.get("person").map(|s| s.trim()).and_then(|v| match v {
                "" => None,
                "me" => Some(Person::Me),
                "none" => Some(Person::None_),
                other => other.parse().ok().map(Person::Id),
            }),
            node: uuid_of(p, "node"),
            pillar: p.get("pillar").map(|s| s.trim()).and_then(|v| match v {
                "" => None,
                "none" => Some(Pillar::None_),
                other => other.parse().ok().map(Pillar::Id),
            }),
            search: p.get("search").map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
            quick: p.get("quick").map(|s| s.trim()).filter(|q| {
                QUICK_FILTERS.iter().any(|(k, _)| k == q)
            }).unwrap_or("all").to_string(),
            sort: p.get("sort").map(|s| s.trim()).filter(|s| {
                ORDERINGS.iter().any(|(k, _)| k == s)
            }).unwrap_or(DEFAULT_ORDER).to_string(),
        }
    }

    /// `where` parcalarini ekler. Sorgu `records r` takma adini kullanir.
    pub fn push_where(&self, qb: &mut QueryBuilder<Postgres>, user: &User, tree: &TreeIndex) {
        qb.push(" where 1=1");

        if let Some(v) = &self.kind { qb.push(" and r.kind = ").push_bind(v.clone()); }
        if let Some(v) = &self.status { qb.push(" and r.status = ").push_bind(v.clone()); }
        if let Some(v) = &self.priority { qb.push(" and r.priority = ").push_bind(v.clone()); }
        if let Some(v) = self.team { qb.push(" and r.team_id = ").push_bind(v); }

        match &self.person {
            Some(Person::Me) => { qb.push(" and r.owner_id = ").push_bind(user.id); }
            Some(Person::None_) => { qb.push(" and r.owner_id is null"); }
            Some(Person::Id(id)) => { qb.push(" and r.owner_id = ").push_bind(*id); }
            None => {}
        }

        // ALT AGAC bellekteki agactan — Euler araligi, recursive CTE yok.
        // Bilinmeyen dugum bos kume verir ve filtre DUSER (istegi dusurmez).
        if let Some(id) = self.node {
            let ids = tree.subtree(id);
            if !ids.is_empty() {
                qb.push(" and r.unit_id = any(").push_bind(ids).push(")");
            }
        }

        match &self.pillar {
            Some(Pillar::None_) => { qb.push(" and r.pillar_id is null"); }
            Some(Pillar::Id(id)) if tree.get(*id).is_some() => {
                qb.push(" and r.pillar_id = ").push_bind(*id);
            }
            _ => {}
        }

        if let Some(q) = &self.search {
            // tsvector/GIN. Kullanici metni HAM sorguya degil, kelime basi
            // prefix'ine cevrilir (KNOW-145'in Postgres karsiligi).
            let terms: Vec<String> = q.split_whitespace()
                .filter(|w| !w.is_empty())
                .map(|w| format!("{}:*", w.replace(['&', '|', '!', '(', ')', ':', '\''], " ").trim()))
                .filter(|w| w.len() > 2)
                .collect();
            if !terms.is_empty() {
                qb.push(" and r.search_vector @@ to_tsquery('tr', ")
                  .push_bind(terms.join(" & ")).push(")");
            }
        }

        self.push_quick(qb, user);
    }

    /// Hizli filtreler — kadans HAFTA (spec/10-kararlar.md).
    fn push_quick(&self, qb: &mut QueryBuilder<Postgres>, user: &User) {
        let today = chrono::Utc::now().date_naive();
        match self.quick.as_str() {
            // Bu haftanin gundemi: son 7 gunde hareket VEYA son tarihi 7 gun icinde.
            "week" => {
                qb.push(" and (r.updated_at >= ")
                  .push_bind(today - chrono::Duration::days(7))
                  .push(" or (r.due_date is not null and r.due_date <= ")
                  .push_bind(today + chrono::Duration::days(7))
                  .push(" and r.status <> 'closed'))");
            }
            "my_actions" => {
                qb.push(" and r.id in (select record_id from actions where owner_id = ")
                  .push_bind(user.id)
                  .push(" and status in ('open','in_progress'))");
            }
            // GECIKEN: kaydin KENDISI degil, acik bir EYLEMININ son tarihi
            // gecmis olsa da dusmeli.
            "overdue" => {
                qb.push(" and ((r.due_date < ").push_bind(today)
                  .push(" and r.status <> 'closed') or r.id in \
                         (select record_id from actions where due_date < ")
                  .push_bind(today)
                  .push(" and status in ('open','in_progress')))");
            }
            "unassigned" => { qb.push(" and r.owner_id is null and r.status <> 'closed'"); }
            _ => {}
        }
    }

    /// Deterministik kuyruk: (secilen sutun, id). Ayni veride ayni sira.
    pub fn order_by(&self) -> String {
        let col = ORDERINGS.iter().find(|(k, _)| *k == self.sort)
            .map(|(_, v)| *v)
            .unwrap_or_else(|| ORDERINGS[0].1);
        format!(" order by {col}, r.id")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn gecersiz_deger_filtreyi_dusurur_istegi_degil() {
        let f = Filters::parse(&params(&[
            ("team", "xx"), ("sort", "'; drop table records;--"), ("quick", "bilinmez"),
            ("status", "uydurma"), ("kind", "hicbiri"),
        ]));
        assert!(f.team.is_none(), "gecersiz uuid duser");
        assert!(f.status.is_none() && f.kind.is_none(), "sozlukte olmayan deger duser");
        assert_eq!(f.sort, "activity", "gecersiz sort VARSAYILANA duser");
        assert_eq!(f.quick, "all", "gecersiz quick VARSAYILANA duser");
    }

    #[test]
    fn siralama_sabit_sozlukten() {
        // Kullanici girdisi order by'a HIC girmez: bilinmeyen anahtar zaten
        // parse'ta duser, order_by sabit metinden okur.
        let f = Filters::parse(&params(&[("sort", "'; drop table records;--")]));
        let o = f.order_by();
        assert!(!o.contains("drop"), "kullanici girdisi order by'a sizmamali");
        assert!(o.ends_with(", r.id"), "deterministik kuyruk");
    }

    #[test]
    fn gecerli_degerler_gecer() {
        let f = Filters::parse(&params(&[
            ("kind", "issue"), ("status", "open"), ("priority", "critical"),
            ("person", "me"), ("pillar", "none"), ("quick", "overdue"), ("sort", "newest"),
        ]));
        assert_eq!(f.kind.as_deref(), Some("issue"));
        assert_eq!(f.person, Some(Person::Me));
        assert_eq!(f.pillar, Some(Pillar::None_));
        assert_eq!(f.quick, "overdue");
        assert!(f.order_by().contains("created_at desc"));
    }
}
