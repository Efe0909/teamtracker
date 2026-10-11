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
//! Istem, model, parti buyuklugu ve zaman asimi VERI (`llm_tasks`, `llm_profiles`, `llm_prompts`;
//! koddaki istem `llm::SUGGEST_PROMPT`). Burada sozlesme var: ozet, cevap semasi, suzgec.
//!
//! Uc: `material_suggestions` (kapsam + `manage_purchases`), `llm::run` ile modeli cagirir
//! (limit, kayit), cevabi `sanitize` ile suzer. `try_suggest` yonetimdeki "Dene"dir.

use super::*;
use crate::llm::{self, Effective, Fail, Parsed, Status, Who};

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
    /// Parti buyuklugu (yonetimden): istem "en cok `max_items`" der, sunucu da keser.
    max_items: u32,
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
            max_items: DEFAULT_BATCH,
        }
    }

    pub fn with_rejected(mut self, rejected: Vec<String>) -> Self {
        self.rejected = rejected;
        self
    }

    pub fn with_max_items(mut self, n: u32) -> Self {
        self.max_items = n;
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

/// Varsayilan parti; arayuz 3'erli gosterir (spec/79 §9 madde 6). Yonetimden 3-15.
const DEFAULT_BATCH: u32 = 9;
/// Istemciden gelen `rejected`: en yeni bu kadar, her biri en cok bu uzunlukta.
const REJECTED_MAX: usize = 50;
const REJECTED_LEN: usize = 80;
const NAME_MAX: usize = 200;

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
/// mevcut kalem ya da reddedilenle (ya da kendi icinde) ayni adli olan atilir; en cok `max`.
fn sanitize(raw: Vec<RawItem>, existing: &[String], rejected: &[String], max: usize) -> Vec<Suggestion> {
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
        if out.len() >= max {
            break;
        }
    }
    out
}

fn suggest_contract() -> &'static llm::Contract {
    llm::contract(llm::SUGGEST).unwrap_or(&llm::CONTRACTS[0])
}

/// Saglayici cevabi -> suzulmus oneriler. Icerik JSON degilse `Parse`, semaya uymuyorsa `Schema`.
fn parse_reply(
    resp: &serde_json::Value, existing: &[String], rejected: &[String], max: usize,
) -> std::result::Result<Parsed<Vec<Suggestion>>, Status> {
    let content = crate::openrouter::reply(resp).ok_or(Status::Parse)?;
    let raw: Raw = serde_json::from_value(content).map_err(|_| Status::Schema)?;
    let asked = i32::try_from(raw.items.len()).unwrap_or(i32::MAX);
    let items = sanitize(raw.items, existing, rejected, max);
    let kept = i32::try_from(items.len()).unwrap_or(i32::MAX);
    Ok(Parsed { value: items, asked: Some(asked), kept: Some(kept), outcome: None })
}

fn chat_body(e: &Effective, brief: &MaterialBrief) -> serde_json::Value {
    let req = brief.request();
    crate::openrouter::chat_body(e, e.system(suggest_contract()).as_deref(), &req.user, "material_suggestions", &req.response_schema)
}

/// Etkinligin mevcut kalemleri HAM adlariyla (ozet temizlenmis adi tasir; eslesme gercek adla olmali).
async fn existing_names(st: &AppState, event: Uuid) -> Result<Vec<String>> {
    Ok(sqlx::query_scalar(
        "select m.name from materials m join event_materials em on em.material_id = m.id where em.event_id = $1")
        .bind(event).fetch_all(&st.pool).await?)
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

    let c = suggest_contract();
    let e = llm::settings(&st, c).await;
    let brief = MaterialBrief::from_context(&ctx).with_rejected(cleaned).with_max_items(e.batch);
    let existing = existing_names(&st, id).await?;
    let batch_id = Uuid::new_v4();
    let who = Who { user_id: Some(me.id), event_id: Some(id), is_try: false };
    let max = e.batch as usize;
    let done = llm::run(&st, c, &e, who, Some(batch_id), chat_body(&e, &brief),
        |resp| parse_reply(resp, &existing, &rejected, max)).await;
    match done.result {
        Ok(items) => Ok(Json(SuggestOut { items, batch_id })),
        Err(Fail::Limit) => Err(AppError::Limited("suggest_limit")),
        Err(Fail::Off | Fail::Disabled | Fail::Failed) => Err(AppError::Unavailable("suggest_unavailable")),
    }
}

/// `GET /api/events/{id}/material-brief[?free_text=true]`: oneri ucunun modele kullanici
/// mesaji olarak gonderdigi ozetin aynisi (`max_items` yonetimdeki partiden; `rejected`
/// istekle gelir, burada bos). Model cagrilmaz. Kapi `llm_context` ile ayni.
pub(crate) async fn material_brief(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Query(q): Query<Params>,
) -> Result<Json<MaterialBrief>> {
    let id = common::id(&raw)?;
    let ctx = build_context(&st, &me, id, q.free_text).await?;
    let e = llm::settings(&st, suggest_contract()).await;
    Ok(Json(MaterialBrief::from_context(&ctx).with_max_items(e.batch)))
}

/// "Dene" ornegi: spec/79 §9'daki ilk denemenin ozeti (robotik atolyesi). Yonetimde
/// duzenlenebilir JSON olarak gosterilir; gercek kisi/firma yok.
pub(crate) fn sample_input() -> serde_json::Value {
    serde_json::json!({
        "brief": {
            "event": { "kind": "Atölye", "date": "2026-10-25", "start_time": "14:00", "end_time": "17:00",
                       "title": "Robotik atölyesi", "description": "Arduino ile robot kolu yapımı" },
            "outcomes": [{ "name": "Devre okuma", "description": "Basit şema çözümleme" }],
            "otf": { "items": [{ "label": "Projeksiyon" }, { "label": "Mikrofon" }, { "label": "Sınıf düzeni" }],
                     "purpose": "Katılımcılar servo motorlu bir robot kolu yapar" },
            "existing": [{ "name": "Arduino seti", "type": "equipment" }, { "name": "Lehim teli", "type": "consumable" }],
            "max_items": DEFAULT_BATCH
        }
    })
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TryInput {
    /// Elle yazilmis ozet (ornek); `existing`/`rejected` icinden suzgec de calisir.
    #[serde(default)]
    brief: Option<serde_json::Value>,
    /// Gercek etkinlik: temizlenmis `llm_context` yolu, `llm_config`'in serbest metin kuraliyla.
    #[serde(default)]
    event_id: Option<Uuid>,
    #[serde(default)]
    free_text: bool,
}

fn names_in(brief: &serde_json::Value, key: &str) -> Vec<String> {
    brief.get(key).and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|x| {
        x.as_str().or_else(|| x.get("name").and_then(|n| n.as_str())).map(String::from)
    }).collect()).unwrap_or_default()
}

/// Yonetim > LLM > Dene (malzeme onerisi). Kaydetmez; `is_try` satiri yazilir.
pub(crate) async fn try_suggest(
    st: &AppState, me: &User, e: &Effective, input: serde_json::Value,
) -> Result<serde_json::Value> {
    let input: TryInput = serde_json::from_value(input).map_err(|_| AppError::BadRequest("invalid_body"))?;
    let (user, existing, rejected, event_id) = match (input.brief, input.event_id) {
        (Some(mut b), None) if b.is_object() => {
            b["max_items"] = serde_json::json!(e.batch);
            let text = serde_json::to_string(&b).map_err(|_| AppError::BadRequest("invalid_body"))?;
            if text.chars().count() > 20_000 {
                return Err(AppError::BadRequest("invalid_body"));
            }
            (text, names_in(&b, "existing"), names_in(&b, "rejected"), None)
        }
        (None, Some(id)) => {
            let ctx = build_context(st, me, id, input.free_text).await?;
            let brief = MaterialBrief::from_context(&ctx).with_max_items(e.batch);
            (brief.request().user, existing_names(st, id).await?, vec![], Some(id))
        }
        _ => return Err(AppError::BadRequest("invalid_body")),
    };
    let c = suggest_contract();
    let body = crate::openrouter::chat_body(e, e.system(c).as_deref(), &user, "material_suggestions", &response_schema());
    let who = Who { user_id: Some(me.id), event_id, is_try: true };
    let max = e.batch as usize;
    let done = llm::run(st, c, e, who, None, body, |resp| {
        let p = parse_reply(resp, &existing, &rejected, max)?;
        Ok(Parsed { value: serde_json::json!({ "items": p.value }), asked: p.asked, kept: p.kept, outcome: None })
    }).await;
    serde_json::to_value(llm::TryOut::of(&e.model, done)?).map_err(|_| AppError::BadRequest("invalid_body"))
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
            "existing": [{ "name": "Lehim teli", "type": "consumable" }],
            "max_items": 9
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
        let got = sanitize(raw, &["Lehim Teli".into()], &["projeksiyon".into()], 9);
        assert_eq!(got, vec![
            Suggestion { name: "Kablo".into(), description: "uzatma için".into() },
            Suggestion { name: "Makas".into(), description: "kesmek için".into() },
        ]);
    }

    #[test]
    fn sanitize_caps_the_batch() {
        let raw: Vec<RawItem> = (0..20).map(|i| item(&format!("Kalem {i}"), "d")).collect();
        assert_eq!(sanitize(raw, &[], &[], 9).len(), 9);
        let raw = (0..20).map(|i| item(&format!("Kalem {i}"), "d")).collect();
        assert_eq!(sanitize(raw, &[], &[], 4).len(), 4, "parti yonetimden");
    }

    #[test]
    fn reply_parse_error_kinds() {
        let ok = json!({ "choices": [{ "message": { "content":
            r#"{"items":[{"name":"Servo motor","description":"Kol eklemi"},{"name":"Lehim teli","description":"x"}]}"# } }] });
        let p = parse_reply(&ok, &["Lehim teli".into()], &[], 9).unwrap();
        assert_eq!((p.asked, p.kept, p.value.len()), (Some(2), Some(1), 1), "asked modelden, kept suzgecten");
        let not_json = json!({ "choices": [{ "message": { "content": "Sure! Here you go" } }] });
        assert_eq!(parse_reply(&not_json, &[], &[], 9).err(), Some(Status::Parse));
        let wrong = json!({ "choices": [{ "message": { "content": r#"{"suggestions":[]}"# } }] });
        assert_eq!(parse_reply(&wrong, &[], &[], 9).err(), Some(Status::Schema));
    }

    #[test]
    fn sample_input_is_a_brief_without_people() {
        let s = sample_input();
        assert!(s["brief"]["event"].is_object() && s["brief"]["existing"].is_array());
        assert_eq!(names_in(&s["brief"], "existing"), ["Arduino seti", "Lehim teli"]);
        let text = s.to_string();
        for key in ["attendees", "participant", "owner", "@"] {
            assert!(!text.contains(key), "{key}");
        }
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
