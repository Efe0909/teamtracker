//! Referans veri: kok semalari (spec/74).
//!
//! Kokler yalniz gocle dogar ve `key` tasir; kod koku ADLA degil key ile bulur.
//! Her kokun semasi burada: altina hangi tur girer, turu kim atar (admin mi
//! sunucu mu), shape ne, attrs nasil dogrulanir, alt agaci hangi yetki
//! duzenler. `operational` = kodun yarattigi slot; slotu kod ad yerine
//! `attrs.slot` ile tanir (ad degistirilebilir).
//!
//! Business logic burada (kod degismeden degismez); kokun ICI referans veri,
//! admin'in.

use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    db::tree::{Node, TreeIndex},
    models::enums::{NodeType, Shape, WidgetType},
};

pub const UNITS: &str = "units";
pub const EVENT_TYPES: &str = "event_types";
pub const EVENT_LOCATIONS: &str = "event_locations";

/// Varsayilan kural (Efe, 2026-10-02): hazirlik etkinlikten en gec bu kadar
/// gun once biter. Daha gec checkpoint REDDEDILMEZ, uyari isareti alir.
pub const DEADLINE_DAYS: i64 = 7;

/// Birimler'de admin'in secebilecegi turler.
pub const UNIT_TYPES: &[NodeType] =
    &[NodeType::Cell, NodeType::Machine, NodeType::Task, NodeType::Step, NodeType::Generic];

/// Yeni bir etkinlik turunun (`option`) otomatik slotlari: (gorunen ad, slot).
pub const OPTION_SLOTS: &[(&str, &str)] = &[("Adımlar", "steps"), ("Widget'lar", "widgets")];

/// Kokun alt agacini kim duzenler.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Editor {
    /// `edit_nodes` + dal izni (Birimler; bugunku agac yetkisi).
    Branch,
    /// Dal izni yok, tek scope.
    Scope(&'static str),
}

pub fn editor(root_key: Option<&str>) -> Editor {
    match root_key {
        Some(EVENT_TYPES) => Editor::Scope("manage_event_types"),
        Some(EVENT_LOCATIONS) => Editor::Scope("manage_event_locations"),
        _ => Editor::Branch,
    }
}

/// Bir ebeveynin altina ne eklenebilir.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChildRule {
    /// Admin secer (Birimler); shape admin'in (varsayilan tree).
    Free(&'static [NodeType]),
    /// Tur ve shape sunucudan.
    Fixed(NodeType, Shape),
    /// Bu dugumun altina eklenmez.
    Closed,
}

impl ChildRule {
    pub fn allows(self, t: NodeType) -> bool {
        match self {
            ChildRule::Free(types) => types.contains(&t),
            ChildRule::Fixed(f, _) => f == t,
            ChildRule::Closed => false,
        }
    }
}

pub fn slot(n: &Node) -> Option<&str> {
    n.attrs.get("slot").and_then(Value::as_str)
}

pub fn child_rule(tree: &TreeIndex, parent: &Node) -> ChildRule {
    if parent.shape == Shape::Leaf {
        return ChildRule::Closed;
    }
    match tree.root_key(parent.id) {
        Some(UNITS) => ChildRule::Free(UNIT_TYPES),
        Some(EVENT_TYPES) if parent.key.is_some() => ChildRule::Fixed(NodeType::Choice, Shape::List),
        Some(EVENT_TYPES) => match slot(parent) {
            Some("steps") => ChildRule::Fixed(NodeType::Checkpoint, Shape::Leaf),
            Some("widgets") => ChildRule::Fixed(NodeType::Widget, Shape::Leaf),
            // `option`'in altina dogrudan eklenmez: slotlari sunucu yaratir.
            _ => ChildRule::Closed,
        },
        Some(EVENT_LOCATIONS) if parent.key.is_some() => ChildRule::Fixed(NodeType::Location, Shape::Leaf),
        _ => ChildRule::Closed,
    }
}

/// Sablonda secilebilen widget turleri (`record` sablonda yok: spec/73 §3).
pub const TEMPLATE_WIDGETS: &[WidgetType] = &[WidgetType::Otf, WidgetType::Supplies];

/// attrs dogrulama — ture gore izinli anahtarlar; bilinmeyen anahtar reddedilir.
/// Slot attrs'i (`slot`) yalniz sunucu yazar, buradan gecmez.
pub fn validate_attrs(t: NodeType, attrs: &Value) -> Result<Value, &'static str> {
    let obj = attrs.as_object().ok_or("invalid_attrs")?;
    match t {
        NodeType::Checkpoint => {
            if obj.keys().any(|k| k != "offset_days") {
                return Err("invalid_attrs");
            }
            let d = obj.get("offset_days").and_then(Value::as_i64).ok_or("invalid_attrs")?;
            if !(-365..=365).contains(&d) {
                return Err("invalid_attrs");
            }
            Ok(json!({ "offset_days": d }))
        }
        NodeType::Widget => {
            if obj.keys().any(|k| k != "widget") {
                return Err("invalid_attrs");
            }
            let w: WidgetType = obj.get("widget").cloned()
                .and_then(|v| serde_json::from_value(v).ok()).ok_or("invalid_attrs")?;
            if !TEMPLATE_WIDGETS.contains(&w) {
                return Err("invalid_attrs");
            }
            Ok(json!({ "widget": w }))
        }
        _ if obj.is_empty() => Ok(json!({})),
        _ => Err("invalid_attrs"),
    }
}

/// Uyari isaretleri: kayit REDDEDILMEZ, agacta isaret cikar (spec/74 §4.6).
pub fn warnings(tree: &TreeIndex, n: &Node) -> Vec<&'static str> {
    let mut w = Vec::new();
    match n.node_type {
        NodeType::Choice => {
            for (_, s) in OPTION_SLOTS {
                if !tree.children(n.id).iter().filter_map(|c| tree.get(*c)).any(|c| slot(c) == Some(s)) {
                    w.push("missing_slot");
                }
            }
        }
        NodeType::Checkpoint => match n.attrs.get("offset_days").and_then(Value::as_i64) {
            None => w.push("invalid_attrs"),
            Some(d) if d > -DEADLINE_DAYS => w.push("late_checkpoint"),
            Some(_) => {}
        },
        NodeType::Widget => {
            let ok = n.attrs.get("widget").cloned()
                .and_then(|v| serde_json::from_value::<WidgetType>(v).ok())
                .is_some_and(|t| TEMPLATE_WIDGETS.contains(&t));
            if !ok {
                w.push("unknown_widget");
            }
        }
        NodeType::Operational if n.key.is_none()
            && !OPTION_SLOTS.iter().any(|(_, s)| slot(n) == Some(s)) => w.push("unknown_slot"),
        _ => {}
    }
    w
}

/// Bir etkinlik turunun sablonu: aktif checkpoint'ler (ad, gun farki) ve
/// widget turleri. Etkinlik olusturulurken KOPYALANIR (spec/73 §4).
pub fn template(tree: &TreeIndex, option: Uuid) -> (Vec<(String, i16)>, Vec<WidgetType>) {
    let mut steps = Vec::new();
    let mut widgets = Vec::new();
    for s in tree.children(option).iter().filter_map(|id| tree.get(*id)) {
        let kids = tree.children(s.id).iter().filter_map(|id| tree.get(*id)).filter(|c| c.is_active);
        match slot(s) {
            Some("steps") => steps.extend(kids.filter_map(|c| {
                c.attrs.get("offset_days").and_then(Value::as_i64)
                    .map(|d| (c.name.clone(), d.clamp(i16::MIN as i64, i16::MAX as i64) as i16))
            })),
            Some("widgets") => widgets.extend(kids.filter_map(|c| {
                c.attrs.get("widget").cloned().and_then(|v| serde_json::from_value::<WidgetType>(v).ok())
                    .filter(|t| TEMPLATE_WIDGETS.contains(t))
            })),
            _ => {}
        }
    }
    widgets.dedup();
    (steps, widgets)
}

/// Dugum `key` kokunun altinda mi (kokun kendisi haric)?
pub fn under(tree: &TreeIndex, id: Uuid, key: &str) -> bool {
    tree.get(id).is_some_and(|n| n.key.is_none()) && tree.root_key(id) == Some(key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::tree::NodeRow;

    fn row(id: u8, parent: Option<u8>, t: NodeType, shape: Shape, key: Option<&str>, attrs: Value) -> NodeRow {
        NodeRow {
            id: Uuid::from_u128(id as u128), parent_id: parent.map(|p| Uuid::from_u128(p as u128)),
            name: format!("n{id}"), node_type: t, sort_order: id as i32, is_active: true,
            key: key.map(String::from), shape, attrs,
        }
    }
    fn u(id: u8) -> Uuid { Uuid::from_u128(id as u128) }

    /// event_types(1) > Atolye(2) > steps(3) > cp(4,-7), cp(5,-3); widgets(6) > otf(7)
    /// units(10) > cell(11)
    fn fixture() -> TreeIndex {
        TreeIndex::build(vec![
            row(1, None, NodeType::Operational, Shape::List, Some(EVENT_TYPES), json!({})),
            row(2, Some(1), NodeType::Choice, Shape::List, None, json!({})),
            row(3, Some(2), NodeType::Operational, Shape::List, None, json!({"slot": "steps"})),
            row(4, Some(3), NodeType::Checkpoint, Shape::Leaf, None, json!({"offset_days": -7})),
            row(5, Some(3), NodeType::Checkpoint, Shape::Leaf, None, json!({"offset_days": -3})),
            row(6, Some(2), NodeType::Operational, Shape::List, None, json!({"slot": "widgets"})),
            row(7, Some(6), NodeType::Widget, Shape::Leaf, None, json!({"widget": "otf"})),
            row(10, None, NodeType::Operational, Shape::Tree, Some(UNITS), json!({})),
            row(11, Some(10), NodeType::Cell, Shape::Tree, None, json!({})),
        ])
    }

    #[test]
    fn rules_follow_root_schema() {
        let t = fixture();
        let g = |id| t.get(u(id)).cloned().unwrap_or_else(|| panic!("yok {id}"));
        assert_eq!(child_rule(&t, &g(1)), ChildRule::Fixed(NodeType::Choice, Shape::List));
        assert_eq!(child_rule(&t, &g(2)), ChildRule::Closed);
        assert_eq!(child_rule(&t, &g(3)), ChildRule::Fixed(NodeType::Checkpoint, Shape::Leaf));
        assert_eq!(child_rule(&t, &g(4)), ChildRule::Closed);
        assert_eq!(child_rule(&t, &g(10)), ChildRule::Free(UNIT_TYPES));
        assert_eq!(editor(t.root_key(u(4))), Editor::Scope("manage_event_types"));
        assert_eq!(editor(t.root_key(u(11))), Editor::Branch);
        assert!(under(&t, u(11), UNITS) && !under(&t, u(10), UNITS) && !under(&t, u(4), UNITS));
    }

    #[test]
    fn template_and_warnings() {
        let t = fixture();
        let (steps, widgets) = template(&t, u(2));
        assert_eq!(steps, vec![("n4".to_string(), -7), ("n5".to_string(), -3)]);
        assert_eq!(widgets, vec![WidgetType::Otf]);
        let g = |id| t.get(u(id)).cloned().unwrap_or_else(|| panic!("yok {id}"));
        assert!(warnings(&t, &g(4)).is_empty());
        assert_eq!(warnings(&t, &g(5)), vec!["late_checkpoint"]);
        assert!(warnings(&t, &g(2)).is_empty());
    }

    #[test]
    fn attrs_are_validated_per_type() {
        assert!(validate_attrs(NodeType::Checkpoint, &json!({"offset_days": -7})).is_ok());
        assert!(validate_attrs(NodeType::Checkpoint, &json!({"offset_days": "x"})).is_err());
        assert!(validate_attrs(NodeType::Checkpoint, &json!({"offset_days": -7, "x": 1})).is_err());
        assert!(validate_attrs(NodeType::Widget, &json!({"widget": "otf"})).is_ok());
        assert!(validate_attrs(NodeType::Widget, &json!({"widget": "record"})).is_err());
        assert!(validate_attrs(NodeType::Cell, &json!({})).is_ok());
        assert!(validate_attrs(NodeType::Cell, &json!({"a": 1})).is_err());
    }
}
