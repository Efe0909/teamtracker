//! Bellekte agac indeksi (spec/10-kararlar.md "Ağaç bellekte").
//!
//! Veritabaninda adjacency list durur (`nodes.parent_id`); okuma icin her
//! istekte SQL'e gidilmez. Yapi degistiginde indeks KOMPLE yeniden kurulur —
//! kismi guncelleme YOK. Birkac bin dugumde tam kurulum mikrosaniyeler surer,
//! kismi guncelleme hata kaynagidir (KNOW-179).
//!
//! TEK SUREC varsayimi: indeks surec bellegindedir (KNOW-85). Python'da bu bir
//! yorumdu ve `--workers 1` kurali kimse tarafindan uygulanmiyordu; burada
//! `Arc<RwLock<TreeIndex>>` paylasimi TIPTE gorunur kiliyor.

use std::collections::HashMap;

use uuid::Uuid;

use crate::models::enums::NodeType;

#[derive(Debug, Clone)]
pub struct Node {
    pub id: Uuid,
    pub parent_id: Option<Uuid>,
    pub name: String,
    pub node_type: NodeType,
    pub sort_order: i32,
    pub is_active: bool,
    /// Euler turu girisi — `build()` dolduruyor.
    pub tin: u32,
    /// Euler turu cikisi.
    pub tout: u32,
    pub depth: u32,
}

/// `nodes` tablosundan okunan ham satir.
///
/// `is_active` Option DEGIL: eksik sutun sessizce "hepsi aktif" olmamali,
/// goc kosmadan agac kurulmasin. Python'da bu bir yorumdu, burada tip.
#[derive(Debug, sqlx::FromRow)]
pub struct NodeRow {
    pub id: Uuid,
    pub parent_id: Option<Uuid>,
    pub name: String,
    pub node_type: NodeType,
    pub sort_order: i32,
    pub is_active: bool,
}

#[derive(Debug, Default)]
pub struct TreeIndex {
    nodes: HashMap<Uuid, Node>,
    children: HashMap<Uuid, Vec<Uuid>>,
    roots: Vec<Uuid>,
    /// Euler turu sirasi — ekrandaki agac sirasi.
    ///
    /// Python her `nodes_of_type()` cagrisinda yeniden siraliyordu (cagri
    /// basina O(n log n)); burada kurulumda bir kez hesaplaniyor.
    order: Vec<Uuid>,
}

impl TreeIndex {
    pub fn build(rows: Vec<NodeRow>) -> Self {
        let mut ix = TreeIndex::default();

        for r in rows {
            ix.children.entry(r.id).or_default();
            ix.nodes.insert(r.id, Node {
                id: r.id, parent_id: r.parent_id, name: r.name,
                node_type: r.node_type, sort_order: r.sort_order,
                is_active: r.is_active,
                tin: 0, tout: 0, depth: 0,
            });
        }

        // Ebeveyni AGACTA OLMAYAN dugum kok sayilir — silinmis bir ebeveyne
        // isaret eden satir agaci dusurmemeli.
        for (&id, node) in ix.nodes.iter() {
            match node.parent_id.and_then(|p| ix.children.get_mut(&p)) {
                Some(kids) => kids.push(id),
                None => ix.roots.push(id),
            }
        }

        // Siralama anahtarlari ONCE cikariliyor: `ix`'i odunc alan bir
        // closure ile `ix.roots.sort_by_key` ayni anda calismaz.
        let keys: HashMap<Uuid, (i32, String)> = ix.nodes.iter()
            .map(|(&id, n)| (id, (n.sort_order, n.name.clone())))
            .collect();
        ix.roots.sort_by(|a, b| keys[a].cmp(&keys[b]));
        for kids in ix.children.values_mut() {
            kids.sort_by(|a, b| keys[a].cmp(&keys[b]));
        }

        // Euler turu — YINELEMESIZ. Derin agacta yigin tasmasina yer birakma.
        let mut counter: u32 = 0;
        let mut stack: Vec<(Uuid, bool)> = Vec::new();
        for &root in ix.roots.iter().rev() {
            stack.push((root, false));
        }
        while let Some((id, closing)) = stack.pop() {
            if closing {
                if let Some(n) = ix.nodes.get_mut(&id) {
                    n.tout = counter;
                }
                counter += 1;
                continue;
            }
            let depth = match ix.nodes[&id].parent_id {
                Some(p) if ix.nodes.contains_key(&p) => ix.nodes[&p].depth + 1,
                _ => 0,
            };
            if let Some(n) = ix.nodes.get_mut(&id) {
                n.tin = counter;
                n.depth = depth;
            }
            counter += 1;
            ix.order.push(id);
            stack.push((id, true));
            for &kid in ix.children[&id].iter().rev() {
                stack.push((kid, false));
            }
        }
        ix
    }

    /// O(1) yetki kontrolu. **Dugum kendi atasi sayilir.**
    ///
    /// Yetki her istekte kosuyor; ata yurumesi (her ata icin bir sorgu) kabul
    /// edilemezdi, Euler araligi bunu tek karsilastirmaya indiriyor.
    pub fn is_descendant(&self, node: Uuid, ancestor: Uuid) -> bool {
        match (self.nodes.get(&node), self.nodes.get(&ancestor)) {
            (Some(n), Some(a)) => a.tin <= n.tin && n.tout <= a.tout,
            _ => false,
        }
    }

    pub fn get(&self, id: Uuid) -> Option<&Node> {
        self.nodes.get(&id)
    }

    pub fn name(&self, id: Uuid) -> &str {
        self.nodes.get(&id).map(|n| n.name.as_str()).unwrap_or("?")
    }

    pub fn subtree(&self, id: Uuid) -> Vec<Uuid> {
        let Some(root) = self.nodes.get(&id) else { return Vec::new() };
        // Euler araligi zaten bitisik: tin sirasinda [tin, tout] arasi tam
        // olarak alt agac. Python cocuk listelerini geziyordu; bu dilim.
        self.order.iter().copied()
            .filter(|i| {
                let n = &self.nodes[i];
                root.tin <= n.tin && n.tout <= root.tout
            })
            .collect()
    }

    /// Kokten dugume kadar yol, dugum DAHIL.
    pub fn ancestors(&self, id: Uuid) -> Vec<Uuid> {
        let mut path = Vec::new();
        let mut cur = Some(id);
        while let Some(c) = cur {
            let Some(n) = self.nodes.get(&c) else { break };
            path.push(c);
            cur = n.parent_id;
        }
        path.reverse();
        path
    }

    /// "Su turdeki tum dugumler" — spec/72 §2'nin sorgu primitifi.
    ///
    /// Pasiflik MIRAS KALMAZ: ustu kapali olan bir dugum burada gorunmeye
    /// devam eder, yalniz kendi bayragina bakilir (bilincli plan karari).
    pub fn of_type(&self, node_type: NodeType, active_only: bool) -> Vec<Uuid> {
        self.order.iter().copied()
            .filter(|i| {
                let n = &self.nodes[i];
                n.node_type == node_type && (!active_only || n.is_active)
            })
            .collect()
    }

    /// `items.unit_id` olabilecek dugumler — `team` ve `pillar` HARIC
    /// (spec/21-sema-v2.md §10). Birim listesini besleyen sey bu.
    pub fn units(&self, active_only: bool) -> Vec<Uuid> {
        self.order.iter().copied()
            .filter(|i| {
                let n = &self.nodes[i];
                n.node_type.is_unit() && (!active_only || n.is_active)
            })
            .collect()
    }

    pub fn roots(&self) -> &[Uuid] { &self.roots }
    pub fn order(&self) -> &[Uuid] { &self.order }
    pub fn len(&self) -> usize { self.nodes.len() }
    pub fn is_empty(&self) -> bool { self.nodes.is_empty() }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn n(id: u8, parent: Option<u8>, name: &str, t: NodeType) -> NodeRow {
        NodeRow {
            id: Uuid::from_u128(id as u128),
            parent_id: parent.map(|p| Uuid::from_u128(p as u128)),
            name: name.into(), node_type: t, sort_order: 0, is_active: true,
        }
    }
    fn u(id: u8) -> Uuid { Uuid::from_u128(id as u128) }

    /// kok(1) ├ a(2) ├ a1(4)
    ///        │      └ a2(5)
    ///        └ b(3)
    /// ayri kok: pillar(6), team(7)
    fn fixture() -> TreeIndex {
        TreeIndex::build(vec![
            n(1, None,    "kok",    NodeType::Cell),
            n(2, Some(1), "a",      NodeType::Machine),
            n(3, Some(1), "b",      NodeType::Machine),
            n(4, Some(2), "a1",     NodeType::Task),
            n(5, Some(2), "a2",     NodeType::Task),
            n(6, None,    "pillar", NodeType::Pillar),
            n(7, Some(1), "team",   NodeType::Team),
        ])
    }

    #[test]
    fn is_descendant_euler_araligi() {
        let ix = fixture();
        assert!(ix.is_descendant(u(1), u(1)), "dugum kendi atasi sayilir");
        assert!(ix.is_descendant(u(4), u(1)), "torun");
        assert!(ix.is_descendant(u(4), u(2)), "cocuk");
        assert!(!ix.is_descendant(u(1), u(4)), "ters yon");
        assert!(!ix.is_descendant(u(4), u(3)), "kardes dali");
        assert!(!ix.is_descendant(u(4), u(6)), "ayri kok");
        assert!(!ix.is_descendant(u(4), u(99)), "olmayan dugum");
    }

    #[test]
    fn subtree_tam_alt_agaci_verir() {
        let ix = fixture();
        let mut s = ix.subtree(u(2));
        s.sort();
        assert_eq!(s, vec![u(2), u(4), u(5)], "kendisi + iki cocuk");
        assert_eq!(ix.subtree(u(4)), vec![u(4)], "yaprak yalniz kendisi");
        assert_eq!(ix.subtree(u(99)), Vec::<Uuid>::new(), "olmayan dugum bos");
        assert_eq!(ix.subtree(u(1)).len(), 6, "kok: kendisi + 5 torun");
    }

    #[test]
    fn order_tin_sirasinda() {
        let ix = fixture();
        let tins: Vec<u32> = ix.order().iter().map(|i| ix.get(*i).unwrap().tin).collect();
        let mut sorted = tins.clone();
        sorted.sort();
        assert_eq!(tins, sorted, "order Euler turu sirasinda olmali");
        assert_eq!(ix.order().len(), 7, "her dugum bir kez");
    }

    #[test]
    fn depth_kokten_sayilir() {
        let ix = fixture();
        assert_eq!(ix.get(u(1)).unwrap().depth, 0);
        assert_eq!(ix.get(u(2)).unwrap().depth, 1);
        assert_eq!(ix.get(u(4)).unwrap().depth, 2);
    }

    #[test]
    fn units_team_ve_pillari_eler() {
        let ix = fixture();
        let units = ix.units(true);
        assert!(!units.contains(&u(6)), "pillar unit DEGIL");
        assert!(!units.contains(&u(7)), "team unit DEGIL");
        assert!(units.contains(&u(2)), "machine unit");
        assert_eq!(units.len(), 5, "7 dugum - pillar - team");
    }

    #[test]
    fn ebeveyni_olmayan_satir_kok_sayilir() {
        // Silinmis bir ebeveyne isaret eden satir agaci DUSURMEMELI.
        let ix = TreeIndex::build(vec![n(2, Some(99), "oksuz", NodeType::Machine)]);
        assert_eq!(ix.roots(), &[u(2)]);
        assert!(ix.is_descendant(u(2), u(2)));
    }

    #[test]
    fn bos_agac() {
        let ix = TreeIndex::build(vec![]);
        assert!(ix.is_empty());
        assert_eq!(ix.subtree(u(1)), Vec::<Uuid>::new());
    }
}
