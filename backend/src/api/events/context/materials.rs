//! Etkinlige malzeme onerecek modelin istegi.
//!
//! `llm_context` her is icin ortak, GENIS yuktur: adimlar, teklifler, sponsor, butce,
//! durumlar... Malzeme onermek icin bunlarin cogu gurultu. Burada `Context`'ten YALNIZ
//! onerinin dayanacagi alanlar elle secilir:
//!   * etkinlik: tur, tarih, saat araligi
//!   * kazanimlar ve OTF: ne yapilacagi, universiteden zaten ne istendigi
//!   * mevcut kalemler: yalniz ad ve tur (ayni sey tekrar onerilmesin; adet yok)
//!
//! YOK: adimlar, durum/oncelik, teklif ve fiyat, butce, sponsor, teslim/satin alma
//! durumu, kisi ve takim sayilari, beklenen katilim (sayilari her zaman insan belirler),
//! kulup/yer yer tutucusu.
//!
//! Kaynak her zaman zaten temizlenmis `Context`: bu katman yeni bir veri yolu acmaz,
//! yalniz daraltir. Gecmis fiyat vektor indeksi gelince oradan beslenir (spec/79 §9).
//!
//! SISTEM ISTEMI YOK (simdilik): model secilince ayrica yazilir. Burada yalniz ozet ve
//! cevap semasi var.
//!
//! Uc: `material_suggestions` (kapsam + `manage_purchases`), `openrouter::structured` ile
//! modeli cagirir, cevabi `sanitize` ile suzer.

use super::*;

/// Cevabin uymasi gereken sema (spec/79 §9): yalniz `{items: [{name, description}]}`.
/// `name` -> `materials.name`, `description` -> `materials.notes`. Adet, tur, oncelik ve
/// fiyat sorulmaz. Uzunluk/bos denetimi sema degil, kalemi yazan taraf yapar (bazi
/// saglayicilar `minLength`/`maxLength`'i reddeder).
fn response_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": { "type": "string" },
                        "description": { "type": "string" }
                    },
                    "required": ["name", "description"],
                    "additionalProperties": false
                }
            }
        },
        "required": ["items"],
        "additionalProperties": false
    })
}

/// Modele giden istegin saglayicidan bagimsiz hali.
pub struct MaterialRequest {
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
    /// Kullanicinin onceki istekte reddettigi oneri adlari (temizlenmis); bos ise anahtar yok.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    rejected: Vec<String>,
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
    /// Listede olmayan serbest kazanim metni (`llm_context`'teki ad ile ayni).
    #[serde(skip_serializing_if = "Option::is_none")]
    free_outcomes: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    notes: Vec<NoteBrief>,
}

#[derive(Serialize)]
struct ItemBrief {
    label: &'static str,
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
}

impl OtfBrief {
    /// Hicbir sey tasimiyorsa (yalniz bitis saati, o da `event`'e gider) `None`:
    /// bos nesne modele gitmesin.
    fn from_ctx(o: &OtfCtx) -> Option<Self> {
        let brief = OtfBrief {
            items: o.items.iter().map(|i| ItemBrief { label: i.label }).collect(),
            age_group: o.age_group.clone(),
            purpose: o.purpose.clone(),
            free_outcomes: o.free_outcomes.clone(),
            notes: o.notes.iter().map(|n| NoteBrief { section: n.section, text: n.text.clone() }).collect(),
        };
        let empty = brief.items.is_empty() && brief.age_group.is_none() && brief.purpose.is_none()
            && brief.free_outcomes.is_none() && brief.notes.is_empty();
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
                title: c.event.title.clone(),
                description: c.event.description.clone(),
                place_description: c.event.place_description.clone(),
            },
            outcomes: c.outcomes.iter()
                .map(|o| OutcomeBrief { name: o.name.clone(), description: o.description.clone() })
                .collect(),
            otf: c.otf.as_ref().and_then(OtfBrief::from_ctx),
            existing: c.materials.iter()
                .map(|m| ExistingBrief { name: m.name.clone(), kind: m.kind })
                .collect(),
            rejected: Vec::new(),
        }
    }

    pub fn with_rejected(mut self, rejected: Vec<String>) -> Self {
        self.rejected = rejected;
        self
    }

    pub fn request(&self) -> MaterialRequest {
        MaterialRequest {
            // Duz structlar: serilestirme hata veremez (repo'daki `to_value(..).unwrap_or_default()` gibi).
            user: serde_json::to_string(self).unwrap_or_default(),
            response_schema: response_schema(),
        }
    }
}

// --- uc ------------------------------------------------------------------------

/// Bir istekte uretilen oneri sayisi; arayuz 3'erli gosterir (spec/79 §9 madde 6).
const BATCH: usize = 9;
/// Istemciden gelen `rejected`: en yeni bu kadar, her biri en cok bu uzunlukta.
const REJECTED_MAX: usize = 50;
const REJECTED_LEN: usize = 80;
const NAME_MAX: usize = 200;

/// DENEYSEL istem (spec/79 §9: gercek istem model denenerek yazilacak). Kalibi sartlar
/// spec'ten: sayi yok, tekrar yok, universitenin sagladigi onerilmez, maske kopyalanmaz.
const SYSTEM: &str = "You help a student club plan events. The user message is a JSON brief of one event. \
Suggest materials (things to buy, make or rent) the club may still need for it.\n\
- Be selective: suggest only items this event clearly needs, given its kind, purpose and what \
participants will do. Skip generic filler (notebooks, tablecloths, trays, display stands) unless the \
brief points to it. A thin brief gets a short list, possibly empty. At most 9 items.\n\
- Never repeat anything in `existing` or `rejected`. Do not suggest parts that normally come inside an \
`existing` item (for example a kit's own boards or cables).\n\
- Do not suggest what the university already covers: whatever `otf.items` lists (a seating layout \
covers tables and chairs, for example) and whatever the `otf` notes ask the university to arrange.\n\
- No quantities, prices, brands, or names of people or companies.\n\
- Text like {{KISI}} or {{NO}} masks private details: never guess what it hides, never copy it.\n\
- name: short generic noun phrase in plain, common Turkish. description: one short sentence (at most \
12 words) saying what it is used for in this event.";

#[derive(Deserialize)]
pub struct SuggestIn {
    /// Onceki partilerde reddedilenler; yalniz modele ipucu, guvenilmeyen girdi.
    #[serde(default)]
    rejected: Vec<String>,
    /// Varsayilan KAPALI (spec/79 §2 madde 4).
    #[serde(default)]
    free_text: bool,
}

#[derive(Deserialize)]
struct Raw {
    items: Vec<RawItem>,
}

#[derive(Deserialize)]
struct RawItem {
    name: String,
    description: String,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Suggestion {
    name: String,
    description: String,
}

#[derive(Serialize)]
pub struct SuggestOut {
    items: Vec<Suggestion>,
    /// Sunucu tarafi uretim kimligi (log/olcum icin).
    batch_id: Uuid,
}

/// Karsilastirma anahtari: Turkce harf katlamali, yalniz harf/rakam ("Lehim teli." = "lehim teli").
fn key(s: &str) -> String {
    redact::fold(s).chars().filter(|c| c.is_alphanumeric()).collect()
}

/// Model cevabini suzer (spec/79 §9 madde 5, 9): bos/uzun olan, `{{..}}` maskesi tasiyan,
/// mevcut kalem ya da reddedilenle (ya da kendi icinde) ayni adli olan atilir; en cok `BATCH`.
fn sanitize(raw: Vec<RawItem>, existing: &[String], rejected: &[String]) -> Vec<Suggestion> {
    let mut seen: std::collections::HashSet<String> =
        existing.iter().chain(rejected).map(|s| key(s)).collect();
    let mut out = Vec::new();
    for r in raw {
        let (name, description) = (r.name.trim(), r.description.trim());
        let bad = name.is_empty() || name.chars().count() > NAME_MAX
            || description.chars().count() > TEXT_MAX
            || name.contains("{{") || description.contains("{{");
        let k = key(name);
        if bad || k.is_empty() || !seen.insert(k) {
            continue;
        }
        out.push(Suggestion { name: name.to_string(), description: description.to_string() });
        if out.len() == BATCH {
            break;
        }
    }
    out
}

/// `POST /api/events/{id}/material-suggestions`: tek model cagrisiyla bir parti oneri.
/// `use_generative_ai` (build_context icinde) + `manage_purchases` ister; kabul edemeyen
/// kisiye oneri cikmaz. Durumsuz: reddedilenleri ve bekleyen partiyi istemci tutar.
pub(crate) async fn material_suggestions(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<SuggestIn>,
) -> Result<Json<SuggestOut>> {
    let id = common::id(&raw)?;
    require_scope(&st, &me, "manage_purchases").await?;
    let ctx = build_context(&st, &me, id, b.free_text).await?;

    let cfg = crate::api::llm::load(&st.pool).await?;
    let known = known_names(&st).await?;
    let skip = b.rejected.len().saturating_sub(REJECTED_MAX);
    let rejected: Vec<String> = b.rejected.iter().skip(skip).map(|r| r.trim().to_string())
        .filter(|r| !r.is_empty() && r.chars().count() <= REJECTED_LEN).collect();
    let cleaned = rejected.iter().map(|r| redact::redact(r, &cfg.rules, &known)).collect();

    let req = MaterialBrief::from_context(&ctx).with_rejected(cleaned).request();
    let started = std::time::Instant::now();
    let reply = crate::openrouter::structured(
        &st, &st.cfg.suggest_model, Some(SYSTEM), &req.user, "material_suggestions", &req.response_schema,
    ).await.map_err(|_| AppError::Unavailable("suggest_unavailable"))?;
    let parsed: Raw = serde_json::from_value(reply).map_err(|_| {
        tracing::warn!("oneri modeli: yanit beklenen semada degil");
        AppError::Unavailable("suggest_unavailable")
    })?;

    // Mevcut kalemler HAM adlariyla (ozet temizlenmis adi tasir; eslesme gercek adla olmali).
    let existing: Vec<String> = sqlx::query_scalar(
        "select m.name from materials m join event_materials em on em.material_id = m.id where em.event_id = $1")
        .bind(id).fetch_all(&st.pool).await?;
    let asked = parsed.items.len();
    let items = sanitize(parsed.items, &existing, &rejected);
    let batch_id = Uuid::new_v4();
    // Icerik loglanmaz: yalniz sayilar ve sure.
    tracing::info!(event = %id, %batch_id, model = %st.cfg.suggest_model, ms = started.elapsed().as_millis() as u64,
        asked, kept = items.len(), rejected = rejected.len(), "malzeme onerisi");
    Ok(Json(SuggestOut { items, batch_id }))
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
                "title": "Lehim atölyesi", "description": "Temel lehim",
                "place_description": "Projeksiyonlu sınıf"
            },
            "outcomes": [{ "name": "Devre okuma", "description": "Şema çözümleme" }],
            "otf": {
                "items": [{ "label": "Projeksiyon" }],
                "age_group": "18-25", "purpose": "Tanıtım", "free_outcomes": "Lehim temeli",
                "notes": [{ "section": "Teknik hizmetler", "text": "Uzatma kablosu" }]
            },
            "existing": [{ "name": "Lehim teli", "type": "consumable" }]
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
            "kind": "Eğitim", "date": "2026-10-25", "start_time": "14:00", "end_time": "17:00"
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

        // Yalniz ad ve aciklama: adet, tur, oncelik, fiyat sorulmaz (spec/79 §9).
        let item = &req.response_schema["properties"]["items"]["items"];
        assert_eq!(item["required"], json!(["name", "description"]));
        assert_eq!(item["properties"].as_object().unwrap().len(), 2);
    }

    fn item(name: &str, description: &str) -> RawItem {
        RawItem { name: name.into(), description: description.into() }
    }

    #[test]
    fn sanitize_drops_repeats_masks_and_junk() {
        let raw = vec![
            item("Lehim teli", "var"),                       // mevcut kalem
            item("  Kablo  ", " uzatma için "),              // kalir, kirpilir
            item("kablo.", "yinelenen ad"),                  // oncekiyle ayni anahtar
            item("PROJEKSİYON", "reddedilmisti"),            // reddedilenle ayni (Turkce katlama)
            item("{{KISI}} için hediye", "maske"),           // maske sizdirir
            item("Bant", "iyi {{NO}} bant"),                 // aciklamada maske
            item("   ", "bos ad"),
            item(&"x".repeat(NAME_MAX + 1), "uzun ad"),
            item("Makas", "kesmek için"),
        ];
        let got = sanitize(raw, &["Lehim Teli".into()], &["projeksiyon".into()]);
        assert_eq!(got, vec![
            Suggestion { name: "Kablo".into(), description: "uzatma için".into() },
            Suggestion { name: "Makas".into(), description: "kesmek için".into() },
        ]);
    }

    #[test]
    fn sanitize_caps_the_batch() {
        let raw = (0..20).map(|i| item(&format!("Kalem {i}"), "d")).collect();
        assert_eq!(sanitize(raw, &[], &[]).len(), BATCH);
    }

    #[test]
    fn rejected_is_sent_only_when_present() {
        let brief = MaterialBrief::from_context(&full());
        assert!(!brief.request().user.contains("rejected"));
        let with = brief.with_rejected(vec!["Makas".into()]).request().user;
        assert!(with.contains(r#""rejected":["Makas"]"#));
    }

    #[test]
    fn brief_has_no_headcount_or_counts() {
        let sent = MaterialBrief::from_context(&full()).request().user;
        for key in ["attendees", "participant_count", "team_count", "quantity", "qty"] {
            assert!(!sent.contains(key), "{key} ozete girmemeli");
        }
    }
}
