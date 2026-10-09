//! Etkinlige malzeme onerecek modelin istegi.
//!
//! `llm_context` her is icin ortak, GENIS yuktur: adimlar, teklifler, sponsor, butce,
//! durumlar... Malzeme onermek icin bunlarin cogu gurultu. Burada `Context`'ten YALNIZ
//! onerinin dayanacagi alanlar elle secilir:
//!   * etkinlik: tur, tarih, saat araligi, katilimci sayisi (miktar olcegi)
//!   * kazanimlar ve OTF: ne yapilacagi, universiteden zaten ne istendigi
//!   * mevcut kalemler: yalniz ad, tur, adet (ayni sey tekrar onerilmesin)
//!
//! YOK: adimlar, durum/oncelik, teklif ve fiyat, butce, sponsor, teslim/satin alma
//! durumu, kisi ve takim sayilari, kulup/yer yer tutucusu.
//!
//! Kaynak her zaman zaten temizlenmis `Context`: bu katman yeni bir veri yolu acmaz,
//! yalniz daraltir. Fiyat modele gitmez, cevapta da istenmez; gecmis fiyat vektor
//! indeksi gelince oradan beslenir (spec/73 §6b).
//!
//! HTTP ucu DEGIL: modele cagri yapan islev `material_request`'i cagirir, donen
//! `MaterialRequest`'i kendi saglayicisinin govdesine koyar.

use super::*;

const SYSTEM: &str = r#"You help a student club plan events. The user message is a JSON brief of one event.
Suggest the materials (things to buy, make or rent) the club still needs for it.

Brief:
- event: kind, date, start_time, end_time, attendees; title, description and place_description only when present.
- outcomes: what the event should teach or achieve.
- otf: the facility request sent to the university. otf.items are services the university provides (projector, microphone, cleaning, ...). age_group, purpose and notes appear only when present.
- existing: materials already on the event's list.

Rules:
- Suggest only what the brief supports. A thin brief gets a short list, possibly empty. At most 15 items.
- Never suggest anything already in `existing`, and never suggest what the university provides through `otf.items`.
- For per-person items scale qty to `attendees`; otherwise use the smallest quantity that works. If attendees is missing, do not guess a headcount: use qty 1 and say so in the reason.
- type: consumable is used up (paper, food, tape), equipment is reusable (cables, banners), service is hired or booked (printing, catering).
- Text like {{KISI}} or {{NO}} masks private details. Keep it as it is; never guess what it hides.
- No prices, no brands, no names of people or companies.
- Write name and reason in Turkish. name: short generic noun phrase. reason: one sentence tied to something in the brief.

Answer with JSON that matches the given schema, nothing else."#;

/// Cevabin uymasi gereken sema. Alanlar `materials` sutunlariyla hizali: `reason` kalemin
/// notuna, oncelik insanda kalir (varsayilan). Adet `1..=QTY_MAX` olmali; sema sinir
/// koymaz (bazi saglayicilar `minimum`'u reddeder), kalemi yazan taraf denetler.
fn response_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "materials": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": { "type": "string" },
                        "type": { "type": "string", "enum": ["consumable", "equipment", "service"] },
                        "qty": { "type": "integer" },
                        "reason": { "type": "string" }
                    },
                    "required": ["name", "type", "qty", "reason"],
                    "additionalProperties": false
                }
            }
        },
        "required": ["materials"],
        "additionalProperties": false
    })
}

/// Modele giden istegin saglayicidan bagimsiz hali.
pub struct MaterialRequest {
    /// Sabit talimat.
    pub system: &'static str,
    /// Kullanici mesaji: `MaterialBrief` JSON'u (sikistirilmis).
    pub user: String,
    /// Cevap semasi (JSON Schema).
    pub response_schema: serde_json::Value,
}

// --- ozet --------------------------------------------------------------------

#[derive(Serialize)]
pub struct MaterialBrief {
    event: EventBrief,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    outcomes: Vec<OutcomeBrief>,
    #[serde(skip_serializing_if = "Option::is_none")]
    otf: Option<OtfBrief>,
    /// Bos olsa da gider: "listede hicbir sey yok" bilgisi.
    existing: Vec<ExistingBrief>,
}

#[derive(Serialize)]
struct EventBrief {
    kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    date: Option<NaiveDate>,
    #[serde(skip_serializing_if = "Option::is_none")]
    start_time: Option<String>,
    /// OTF'ten gelir.
    #[serde(skip_serializing_if = "Option::is_none")]
    end_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    attendees: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    place_description: Option<String>,
}

#[derive(Serialize)]
struct OutcomeBrief {
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
}

#[derive(Serialize)]
struct OtfBrief {
    #[serde(skip_serializing_if = "Vec::is_empty")]
    items: Vec<ItemBrief>,
    #[serde(skip_serializing_if = "Option::is_none")]
    age_group: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    purpose: Option<String>,
    /// Listede olmayan serbest kazanim metni.
    #[serde(skip_serializing_if = "Option::is_none")]
    other_outcomes: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    notes: Vec<NoteBrief>,
}

#[derive(Serialize)]
struct ItemBrief {
    label: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    quantity: Option<i32>,
}

#[derive(Serialize)]
struct NoteBrief {
    section: &'static str,
    text: String,
}

#[derive(Serialize)]
struct ExistingBrief {
    name: String,
    #[serde(rename = "type")]
    kind: MaterialType,
    qty: i32,
}

impl OtfBrief {
    /// Hicbir sey tasimiyorsa (yalniz bitis saati, o da `event`'e gider) `None`:
    /// bos nesne modele gitmesin.
    fn from_ctx(o: &OtfCtx) -> Option<Self> {
        let brief = OtfBrief {
            items: o.items.iter().map(|i| ItemBrief { label: i.label, quantity: i.quantity }).collect(),
            age_group: o.age_group.clone(),
            purpose: o.purpose.clone(),
            other_outcomes: o.free_outcomes.clone(),
            notes: o.notes.iter().map(|n| NoteBrief { section: n.section, text: n.text.clone() }).collect(),
        };
        let empty = brief.items.is_empty() && brief.age_group.is_none() && brief.purpose.is_none()
            && brief.other_outcomes.is_none() && brief.notes.is_empty();
        (!empty).then_some(brief)
    }
}

impl MaterialBrief {
    /// `llm_context` ciktisindan daraltir. Alanlar tek tek secilir: `Context`'e yeni alan
    /// eklense ozete kendiliginden girmez.
    pub fn from_context(c: &Context) -> Self {
        MaterialBrief {
            event: EventBrief {
                kind: c.event.kind.clone(),
                date: c.event.date,
                start_time: c.event.start_time.clone(),
                end_time: c.otf.as_ref().and_then(|o| o.end_time.clone()),
                attendees: c.event.attendees,
                title: c.event.title.clone(),
                description: c.event.description.clone(),
                place_description: c.event.place_description.clone(),
            },
            outcomes: c.outcomes.iter()
                .map(|o| OutcomeBrief { name: o.name.clone(), description: o.description.clone() })
                .collect(),
            otf: c.otf.as_ref().and_then(OtfBrief::from_ctx),
            existing: c.materials.iter()
                .map(|m| ExistingBrief { name: m.name.clone(), kind: m.kind, qty: m.qty })
                .collect(),
        }
    }

    pub fn request(&self) -> MaterialRequest {
        MaterialRequest {
            system: SYSTEM,
            // Duz structlar: serilestirme hata veremez (repo'daki `to_value(..).unwrap_or_default()` gibi).
            user: serde_json::to_string(self).unwrap_or_default(),
            response_schema: response_schema(),
        }
    }
}

/// Modele cagri yapan islevin giris noktasi. Gorunurluk denetimi, `free_text_allowed`
/// kapisi ve temizleme `llm_context` ile AYNI (`build_context`). `free_text` varsayilan
/// olarak KAPALI verilmeli (spec/73 §6b): acinca baslik, aciklama ve notlar da gider.
pub(crate) async fn material_request(
    st: &AppState, me: &User, id: Uuid, free_text: bool,
) -> Result<MaterialRequest> {
    let ctx = build_context(st, me, id, free_text).await?;
    Ok(MaterialBrief::from_context(&ctx).request())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn material(name: &str, kind: MaterialType, qty: i32) -> MaterialCtx {
        MaterialCtx {
            name: name.into(), kind, priority: Priority::High, stage: "Onaylandı", qty, owned: true,
            delivered: true, purchased: true, budget: Some(500.0), overage_level: Some(1),
            sponsor: SponsorCtx { requested: true, chosen: true, qty: Some(2), date: None },
            offers: vec![OfferCtx {
                label: "Teklif A".into(), price: Some(480.0), unit_price: Some(48.0),
                arrival_date: None, chosen: true, overage_level: Some(0),
            }],
            notes: Some("kurşunsuz olsun".into()),
        }
    }

    /// Her alanı dolu, serbest metin açık bir bağlam.
    fn full() -> Context {
        Context {
            club: "{{KULUP}}",
            free_text: true,
            event: EventCtx {
                kind: "Eğitim".into(), status: "planned".into(), priority: "high".into(),
                date: NaiveDate::from_ymd_opt(2026, 10, 25), weekday: Some("Pazar"),
                start_time: Some("14:00".into()), attendees: Some(40), participant_count: 3, team_count: 2,
                place: Some("{{YER}}"), title: Some("Lehim atölyesi".into()),
                description: Some("Temel lehim".into()), place_description: Some("Projeksiyonlu sınıf".into()),
            },
            outcomes: vec![OutcomeCtx { name: "Devre okuma".into(), description: Some("Şema çözümleme".into()) }],
            otf: Some(OtfCtx {
                end_time: Some("17:00".into()),
                items: vec![ItemCtx { key: "av_projector", label: "Projeksiyon", quantity: Some(1) }],
                age_group: Some("18-25".into()), purpose: Some("Tanıtım".into()),
                free_outcomes: Some("Lehim temeli".into()),
                notes: vec![NoteCtx { section: "Teknik hizmetler", text: "Uzatma kablosu".into() }],
            }),
            checkpoints: vec![CheckpointCtx { label: Some("Mekan".into()), custom: false, date: None, done: true }],
            materials: vec![material("Lehim teli", MaterialType::Consumable, 10)],
        }
    }

    #[test]
    fn keeps_only_what_the_suggestion_needs() {
        let got = serde_json::to_value(MaterialBrief::from_context(&full())).unwrap();
        assert_eq!(got, json!({
            "event": {
                "kind": "Eğitim", "date": "2026-10-25", "start_time": "14:00", "end_time": "17:00",
                "attendees": 40, "title": "Lehim atölyesi", "description": "Temel lehim",
                "place_description": "Projeksiyonlu sınıf"
            },
            "outcomes": [{ "name": "Devre okuma", "description": "Şema çözümleme" }],
            "otf": {
                "items": [{ "label": "Projeksiyon", "quantity": 1 }],
                "age_group": "18-25", "purpose": "Tanıtım", "other_outcomes": "Lehim temeli",
                "notes": [{ "section": "Teknik hizmetler", "text": "Uzatma kablosu" }]
            },
            "existing": [{ "name": "Lehim teli", "type": "consumable", "qty": 10 }]
        }));
    }

    #[test]
    fn free_text_off_leaves_no_free_text_keys() {
        let mut c = full();
        c.free_text = false;
        c.event.title = None;
        c.event.description = None;
        c.event.place_description = None;
        c.otf = Some(OtfCtx {
            end_time: Some("17:00".into()),
            items: vec![ItemCtx { key: "av_projector", label: "Projeksiyon", quantity: None }],
            age_group: None, purpose: None, free_outcomes: None, notes: vec![],
        });
        let got = serde_json::to_value(MaterialBrief::from_context(&c)).unwrap();
        assert_eq!(got["event"], json!({
            "kind": "Eğitim", "date": "2026-10-25", "start_time": "14:00", "end_time": "17:00", "attendees": 40
        }));
        assert_eq!(got["otf"], json!({ "items": [{ "label": "Projeksiyon" }] }));
    }

    #[test]
    fn otf_with_only_an_end_time_is_dropped_but_the_time_stays() {
        let mut c = full();
        c.otf = Some(OtfCtx {
            end_time: Some("17:00".into()), items: vec![], age_group: None, purpose: None,
            free_outcomes: None, notes: vec![],
        });
        c.outcomes.clear();
        c.materials.clear();
        let got = serde_json::to_value(MaterialBrief::from_context(&c)).unwrap();
        assert!(got.get("otf").is_none() && got.get("outcomes").is_none());
        assert_eq!(got["event"]["end_time"], "17:00");
        // Bos liste "hicbir sey yok" demektir, anahtar kalir.
        assert_eq!(got["existing"], json!([]));
    }

    #[test]
    fn request_carries_the_brief_and_a_matching_schema() {
        let brief = MaterialBrief::from_context(&full());
        let req = brief.request();
        let sent: serde_json::Value = serde_json::from_str(&req.user).unwrap();
        assert_eq!(sent, serde_json::to_value(&brief).unwrap());
        assert!(!req.user.contains('\n'), "kullanici mesaji sikistirilmis olmali");
        assert!(req.system.contains("existing") && req.system.contains("Turkish"));

        let item = &req.response_schema["properties"]["materials"]["items"];
        assert_eq!(item["required"], json!(["name", "type", "qty", "reason"]));
        // Sema degerleri `MaterialType` ile ayni olmali; yeni deger eklenince burasi derlenmez.
        for v in item["properties"]["type"]["enum"].as_array().unwrap() {
            match serde_json::from_value::<MaterialType>(v.clone()).unwrap() {
                MaterialType::Consumable | MaterialType::Equipment | MaterialType::Service => {}
            }
        }
        assert_eq!(item["properties"]["type"]["enum"].as_array().unwrap().len(), 3);
    }
}
