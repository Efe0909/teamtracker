# Envanter — `api/` fonksiyonları ve bağımlılıkları

Otomatik üretildi (imza = kaynaktaki hâli, boşluklar tek satıra indirildi).

Etiket: `H` handler (rotaya bağlı) · `h` yardımcı · `W` yazar (insert/update/delete ya da tx) · `T` transaction açar.
`dış` = başka modül çağrısı · `yerel` = aynı dosyadaki fn · `st` = kullanılan `AppState` alanları ·
`ÇAĞIRAN` = bu fn'i başka dosyadan çağıranlar (taşınınca onların yolu da güncellenir).

Toplam: 181 handler, 115 yazan handler.

Ajan dağılımı:
- **agent1:** common, records, cards, attachments, notify, chats, nodes, home, teams, bank_accounts, profile
- **agent2:** events, events/context, events/context/materials, purchasing, otf
- **agent3:** finance, budget, recurring, templates, admin, llm, llm_usage, quality (+ son temizlik)
- **kapsam dışı:** auth, meta, mod

Dosyalar arası bağımlılık (taşıma sırası bundan):

```
common ─────────────► herkes                      (agent1 böler)
records ◄──► cards                                (agent1, aynı commit)
records ◄── chats, attachments, events, otf       (1 → 2)
attachments ◄── cards, chats, finance             (1 → 3)
notify::fanout ◄── chats · home::manage_teams ◄── teams · bank_accounts::list_of ◄── profile
events ◄──► purchasing                            (agent2, aynı commit)
events ◄── otf, llm                               (2 → 3)
finance::{need, need_viewer, today} ◄── budget, recurring, templates, purchasing   (3 ← 2)
llm::load ◄── events/context(+materials) · llm::require ◄── llm_usage            (3 ← 2)
chats::authorize_read ◄── realtime.rs (api/mod.rs re-export)
purchasing::backfill_vendors ◄── main.rs
```

```
===api/admin.rs===
→ domain/admin.rs · 526 satır · 18 fn
h   fn group<T>(rows: Vec<(Uuid, T)>) -> HashMap<Uuid, Vec<T>>
h   async fn view(p: &PgPool, me: &User) -> Result<Json<AdminView>>
      yerel: group
h   async fn can_manage(st: &AppState, me: &User) -> Result<()>
      dış: common::has_scope
h   fn admin_only(me: &User) -> Result<()>
H   pub async fn get(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<AdminView>>
      rota: GET /api/admin
      yerel: can_manage view
      st: pool
HW  pub async fn add_user(State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<NewUser>) -> Result<Json<AdminView>>
      rota: POST /api/admin/users
      dış: common::text crate::mail::enqueue crate::mail::invite
      yerel: can_manage view
      st: cfg pool
HWT pub async fn patch_user(State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap, Path(raw): Path<String>, Body(op): Body<UserOp>) -> Result<Json<AdminView>>
      rota: PATCH /api/admin/users/{id}
      dış: audit::client_ip audit::forbidden audit::log_event common::id
      yerel: admin_only can_manage node_name role_name valid_scopes view within_grant
      st: pool
h   async fn within_grant(st: &AppState, me: &User, target: Uuid, op: &UserOp) -> Result<()>
      dış: common::tree scope::active scope::permitted_nodes
      st: pool
h   async fn valid_scopes(p: &PgPool, names: &[String]) -> Result<()>
h   async fn role_name(p: &PgPool, id: Uuid) -> Result<String>
h   fn node_name(st: &AppState, id: Uuid) -> Result<String>
      dış: common::tree
h   fn valid_role_color(color: &str) -> Result<()>
h   fn valid_role_nodes(st: &AppState, nodes: &[Uuid]) -> Result<()>
      dış: common::tree crate::refdata crate::refdata::under
hW  async fn write_role(st: &AppState, tx: &mut sqlx::Transaction<'_, sqlx::Postgres>, id: Option<Uuid>, me: &User, b: RoleIn) -> Result<Uuid>
      dış: common::text
      yerel: valid_role_color valid_role_nodes valid_scopes
      st: pool
HWT pub async fn create_role(State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap, Body(b): Body<RoleIn>) -> Result<Json<AdminView>>
      rota: POST /api/admin/roles
      dış: audit::client_ip audit::log_event
      yerel: admin_only view write_role
      st: pool
HWT pub async fn patch_role(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<RoleIn>) -> Result<Json<AdminView>>
      rota: PATCH /api/admin/roles/{id}
      dış: common::id
      yerel: admin_only role_name view write_role
      st: pool
HW  pub async fn delete_role(State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap, Path(raw): Path<String>) -> Result<Json<AdminView>>
      rota: DELETE /api/admin/roles/{id}
      dış: audit::client_ip audit::log_event common::id
      yerel: admin_only view
      st: pool
H   pub async fn activity(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<Vec<PersonUse>>>
      rota: GET /api/admin/activity
      yerel: can_manage
      st: pool

===api/attachments.rs===
→ domain/attachments.rs · 357 satır · 16 fn
h   pub async fn views(p: &PgPool, me: &User, ids: &[Uuid], can_tag: bool) -> Result<HashMap<Uuid, AttachView>>
h   pub async fn can_tag(st: &AppState, me: &User, record: Option<&Record>, team: Option<Uuid>) -> Result<bool>
      dış: common::has_scope scope::can_edit_record
      st: pool tree
h   async fn place(st: &AppState, id: Uuid) -> Result<(Option<Record>, Option<Uuid>)>
      st: pool
h   async fn one(st: &AppState, me: &User, id: Uuid) -> Result<AttachView>
      yerel: can_tag place views
      st: pool
HW  pub async fn upload(State(st): State<AppState>, CurrentUser(me): CurrentUser, Query(q): Query<UploadQuery>, body: std::result::Result<Bytes, BytesRejection>) -> Result<Json<AttachView>>
      rota: POST /api/attachments
      dış: media media::active_volume media::checksum media::new_keys media::path_in media::process media::write_atomic
      yerel: views
      st: pool
h   fn media_err(e: MediaError) -> AppError
h   async fn blob(st: &AppState, id: Uuid) -> Result<Blob>
      st: pool
h   async fn serve(st: &AppState, me: &User, raw: &str, thumb: bool) -> Result<Response>
      dış: common::id media media::path_in records::is_restricted
      yerel: blob content_disposition place
      st: pool
h   fn content_disposition(kind: &str, name: &str) -> String
H   pub async fn get(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Response>
      rota: GET /api/attachments/{id}
      yerel: serve
H   pub async fn thumb(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Response>
      rota: GET /api/attachments/{id}/thumb
      yerel: serve
HW  pub async fn delete(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<StatusCode>
      rota: DELETE /api/attachments/{id}
      dış: common::id media::remove
      yerel: blob
      st: pool
H   pub async fn tags(State(st): State<AppState>, CurrentUser(_): CurrentUser) -> Result<Json<Vec<TagOut>>>
      rota: GET /api/tags
      st: pool
HW  pub async fn add_tag(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<TagIn>) -> Result<Json<AttachView>>
      rota: POST /api/attachments/{id}/tags
      dış: common::has_scope common::id common::text mentions::handle
      yerel: one tags
      st: pool
HW  pub async fn remove_tag(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path((raw, tag)): Path<(String, String)>) -> Result<Json<AttachView>>
      rota: DELETE /api/attachments/{id}/tags/{tag}
      dış: common::id
      yerel: one
      st: pool
h   pub async fn claimable(p: &PgPool, me: Uuid, ids: &mut Vec<Uuid>) -> Result<()>
      dış: media media::unowned

===api/auth.rs===
KAPSAM DIŞI — kimlik altyapısı (çerez, OAuth) — kenarda kalır

===api/bank_accounts.rs===
→ domain/bank_accounts.rs · 133 satır · 8 fn
h   pub fn iban(raw: &str) -> Option<String>
      yerel: mod97
h   fn mod97(s: &str) -> u32
h   pub async fn list_of(st: &AppState, user: Uuid) -> Result<Vec<BankAccount>>
      st: pool
      ÇAĞIRAN: api/profile.rs
H   pub async fn list(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<Vec<BankAccount>>>
      rota: GET /api/me/bank-accounts
      yerel: list_of
HWT pub async fn create(State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<NewAccount>) -> Result<Json<Vec<BankAccount>>>
      rota: POST /api/me/bank-accounts
      dış: common::text
      yerel: iban list_of
      st: pool
h   async fn own(tx: &mut sqlx::PgConnection, me: Uuid, id: Uuid) -> Result<bool>
HWT pub async fn patch(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(p): Body<AccountPatch>) -> Result<Json<Vec<BankAccount>>>
      rota: PATCH /api/me/bank-accounts/{id}
      dış: common::id common::text
      yerel: list_of own
      st: pool
HWT pub async fn delete(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<Vec<BankAccount>>>
      rota: DELETE /api/me/bank-accounts/{id}
      dış: common::id
      yerel: list_of own
      st: pool

===api/budget.rs===
→ domain/budget.rs · 476 satır · 16 fn
H   pub async fn periods(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<Vec<Period>>>
      rota: GET /api/finance/periods
      st: pool
h   fn check_period(name: &str, from: NaiveDate, to: NaiveDate) -> Result<String>
h   async fn period_one(st: &AppState, id: Uuid) -> Result<Period>
      st: pool
HW  pub async fn create_period(State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<PeriodIn>) -> Result<Json<Period>>
      rota: POST /api/finance/periods
      yerel: check_period period_one
      st: pool
HW  pub async fn patch_period(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<PeriodIn>) -> Result<Json<Period>>
      rota: PATCH /api/finance/periods/{id}
      dış: common::id
      yerel: check_period period_one
      st: pool
HW  pub async fn delete_period(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<serde_json::Value>>
      rota: DELETE /api/finance/periods/{id}
      dış: common::id
      st: pool
h   async fn budget_rows(st: &AppState, period: Uuid) -> Result<Vec<BudgetRow>>
      st: pool
H   pub async fn budget(State(st): State<AppState>, CurrentUser(me): CurrentUser, Query(q): Query<BudgetQuery>) -> Result<Json<BudgetView>>
      rota: GET /api/finance/budget
      dış: common::has_scope
      yerel: budget_rows period_one
      st: pool
HW  pub async fn put_line(State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<LineIn>) -> Result<Json<BudgetView>>
      rota: PUT /api/finance/budget
      dış: common::text
      yerel: budget_rows period_one
      st: pool
h   async fn analysis_rows(st: &AppState, group: &str, from: NaiveDate, to: NaiveDate) -> Result<Vec<AnalysisRow>>
      st: pool
h   fn analysis_range(q: &AnalysisQuery) -> (String, NaiveDate, NaiveDate)
H   pub async fn analysis(State(st): State<AppState>, CurrentUser(me): CurrentUser, Query(q): Query<AnalysisQuery>) -> Result<Json<Analysis>>
      rota: GET /api/finance/analysis
      yerel: analysis_range analysis_rows
h   fn xlsx_response(bytes: Vec<u8>, name: &str) -> Response
h   fn xlsx_fail(e: String) -> AppError
H   pub async fn analysis_xlsx(State(st): State<AppState>, CurrentUser(me): CurrentUser, Query(q): Query<AnalysisQuery>) -> Result<Response>
      rota: GET /api/finance/analysis.xlsx
      dış: xlsx::table
      yerel: analysis_range analysis_rows xlsx_response
H   pub async fn budget_xlsx(State(st): State<AppState>, CurrentUser(me): CurrentUser, Query(q): Query<BudgetQuery>) -> Result<Response>
      rota: GET /api/finance/budget.xlsx
      dış: xlsx::table
      yerel: budget_rows period_one xlsx_response
      st: pool

===api/cards.rs===
→ domain/cards.rs · 477 satır · 18 fn
h   fn of(m: &Map<String, Value>) -> Self
h   fn clean_poll(data: &Map<String, Value>, out: &mut Map<String, Value>, fixed: Option<PollFeatures>) -> Result<()>
      dış: common::text
h   fn vote_options(v: &Value) -> Vec<usize>
h   fn poll_closed(closes_at: Option<&str>) -> bool
h   fn kind(t: &str) -> Option<&'static CardType>
h   fn clean(t: &CardType, title: Option<String>, data: &Map<String, Value>, fixed: Option<PollFeatures>) -> Result<Value>
      dış: common::text
      yerel: clean_poll
h   pub fn id(&self) -> Uuid
h   pub async fn of_record(st: &AppState, me: &User, rec: &Record) -> Result<Vec<CardView>>
      yerel: kind poll_closed vote_options
      st: pool
      ÇAĞIRAN: api/records.rs
hW  pub async fn insert(tx: &mut sqlx::Transaction<'_, sqlx::Postgres>, record: Uuid, me: Uuid, card_type: &str, title: Option<String>, data: &Map<String, Value>) -> Result<()>
      dış: media::sweep
      yerel: clean kind link_option_photos
      ÇAĞIRAN: api/records.rs
hW  async fn link_option_photos(tx: &mut sqlx::Transaction<'_, sqlx::Postgres>, card: Uuid, me: Uuid, data: &Value) -> Result<()>
HWT pub async fn create(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<CardIn>) -> Result<Json<Detail>>
      rota: POST /api/records/{id}/cards
      dış: common::id records::detail_of records::load records::require_edit records::touch
      yerel: insert
      st: pool
h   async fn load(st: &AppState, raw: &str) -> Result<(Uuid, Option<&'static CardType>, Record)>
      dış: common::id records::load
      yerel: kind
      st: pool
HWT pub async fn patch(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<CardIn>) -> Result<Json<Detail>>
      rota: PATCH /api/cards/{id}
      dış: media::sweep records::detail_of records::require_edit records::touch
      yerel: clean link_option_photos load
      st: pool
HWT pub async fn delete(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<Detail>>
      rota: DELETE /api/cards/{id}
      dış: records::detail_of records::require_edit records::touch
      yerel: load
      st: pool
HW  pub async fn signup(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<SignupIn>) -> Result<Json<Detail>>
      rota: PUT /api/cards/{id}/signup
      dış: common::text records::detail_of records::may_respond
      yerel: load
      st: pool
h   fn valid_ballot(picked: &[usize], other: bool, n: usize, allow_other: bool, multiple: bool) -> bool
HW  pub async fn vote(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<VoteIn>) -> Result<Json<Detail>>
      rota: PUT /api/cards/{id}/vote
      dış: common::text records::detail_of records::may_respond
      yerel: load poll_closed valid_ballot
      st: pool
HWT pub async fn attach(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<AttachIn>) -> Result<Json<Detail>>
      rota: POST /api/cards/{id}/attachments
      dış: records::detail_of records::require_edit records::touch
      yerel: load
      st: pool

===api/chats.rs===
→ domain/chats.rs · 216 satır · 7 fn
H   pub async fn inbox(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<Vec<InboxChat>>>
      rota: GET /api/chats/inbox
      st: pool
h   async fn chat_exists(st: &AppState, chat: Uuid) -> Result<()>
      st: pool
h   pub(crate) async fn authorize_read(st: &AppState, me: &crate::models::user::User, chat: Uuid) -> Result<()>
      dış: records::is_restricted
      yerel: chat_exists
      st: pool
H   pub async fn feed(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<Feed>>
      rota: GET /api/chats/{id}/feed
      dış: common::id
      yerel: authorize_read owner
      st: pool
h   async fn owner(st: &AppState, chat: Uuid) -> Result<(Option<Record>, Option<Uuid>)>
      st: pool
HWT pub async fn post(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<NewMessage>) -> Result<Json<Posted>>
      rota: POST /api/chats/{id}/messages
      dış: common::id common::text crate::api::notify::fanout records::touch scope::can_edit_record
      yerel: chat_exists invite
      st: clone pool tree
hW  async fn invite(tx: &mut sqlx::Transaction<'_, sqlx::Postgres>, record: Uuid, by: Uuid, body: &str) -> Result<()>
      dış: mentions mentions::handle mentions::tokens

===api/common.rs===
KAPSAM DIŞI — kurulumda bölündü (bkz. 00-kurulum)

===api/events/context/materials.rs===
→ domain/events/context/materials.rs · 369 satır · 16 fn
h   fn response_schema() -> serde_json::Value
h   fn from_ctx(o: &OtfCtx) -> Option<Self>
h   pub fn from_context(c: &Context) -> Self
h   fn key(s: &str) -> String
      dış: redact::fold
h   fn sanitize(raw: Vec<RawItem>, existing: &[String], rejected: &[String], max: usize) -> Vec<Suggestion>
      yerel: key
h   fn suggest_contract() -> &'static llm::Contract
      dış: llm llm::contract
h   fn parse_reply(resp: &serde_json::Value, existing: &[String], rejected: &[String], max: usize) -> std::result::Result<Parsed<Vec<Suggestion>>, Status>
      dış: crate::openrouter::reply
      yerel: sanitize
h   fn chat_body(e: &Effective, brief: &MaterialBrief) -> serde_json::Value
      dış: crate::openrouter::chat_body
      yerel: suggest_contract
h   async fn existing_names(st: &AppState, event: Uuid) -> Result<Vec<String>>
      st: pool
HW  pub(crate) async fn material_suggestions(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<SuggestIn>) -> Result<Json<SuggestOut>>
      dış: common::id crate::api::llm::load llm::run llm::settings redact::redact
      yerel: chat_body existing_names parse_reply suggest_contract
      st: pool
H   pub(crate) async fn reject_suggestion(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path((raw, sraw)): Path<(String, String)>) -> Result<axum::http::StatusCode>
      dış: common::id
      yerel: decide
      st: pool
hW  pub(crate) async fn decide(conn: &mut sqlx::PgConnection, event: Uuid, sid: Uuid, by: Uuid, status: &str, material: Option<Uuid>) -> Result<()>
H   pub(crate) async fn material_brief(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Query(q): Query<Params>) -> Result<Json<MaterialBrief>>
      dış: common::id crate::api::llm::load llm::settings
      yerel: suggest_contract
      st: pool
h   pub(crate) fn sample_input() -> serde_json::Value
h   fn names_in(brief: &serde_json::Value, key: &str) -> Vec<String>
h   pub(crate) async fn try_suggest(st: &AppState, me: &User, e: &Effective, input: serde_json::Value) -> Result<serde_json::Value>
      dış: crate::openrouter::chat_body llm llm::run
      yerel: existing_names names_in parse_reply response_schema suggest_contract
      ÇAĞIRAN: api/llm.rs

===api/events/context.rs===
→ domain/events/context.rs · 387 satır · 10 fn
h   fn short(&self, s: &str) -> String
      dış: redact::redact
h   fn free(&self, s: Option<&str>) -> Option<String>
h   fn note(&self, column: &str) -> Option<&str>
h   pub(crate) async fn known_names(st: &AppState) -> Result<Known>
      st: cfg pool
      ÇAĞIRAN: api/llm.rs
h   fn offer_label(i: usize) -> String
h   fn material_ctx(s: &Scrub, m: Material) -> MaterialCtx
      yerel: offer_label
h   async fn otf_ctx(st: &AppState, s: &Scrub<'_>, id: Uuid) -> Result<Option<OtfCtx>>
      st: pool
H   pub(crate) async fn llm_context(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Query(q): Query<Params>) -> Result<Json<Context>>
      dış: common::id
      yerel: build_context
h   async fn build_context(st: &AppState, me: &User, id: Uuid, free_text: bool) -> Result<Context>
      dış: crate::api::llm::load redact
      yerel: known_names material_ctx otf_ctx
      st: pool
H   pub(crate) async fn llm_restore(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<RestoreIn>) -> Result<Json<RestoreOut>>
      dış: common::id redact::restore
      st: cfg pool

===api/events.rs===
→ domain/events.rs · 1406 satır · 55 fn
h   async fn load(pool: &PgPool, id: Uuid) -> Result<EventRow>
H   pub async fn list(State(st): State<AppState>, CurrentUser(_me): CurrentUser) -> Result<Json<Vec<EventRow>>>
      rota: GET /api/events
      dış: budget::float8
      st: pool
h   async fn detail_of(st: &AppState, me: &User, event: EventRow) -> Result<Detail>
      dış: common::has_scope crate::db::scope::can_edit_record records::load
      yerel: attach_providers fill_levels
      st: pool tree
h   async fn reply(st: &AppState, me: &User, id: Uuid) -> Result<Json<Detail>>
      yerel: detail_of load
      st: pool
H   pub async fn get(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<Detail>>
      rota: GET /api/events/{id}
      dış: common::id
      yerel: reply require_visible
h   pub(crate) async fn require_visible(st: &AppState, me: &User, id: Uuid) -> Result<()>
      dış: records::is_restricted records::load
      yerel: load
      st: pool
      ÇAĞIRAN: api/otf.rs
h   pub(crate) async fn editable(st: &AppState, me: &User, id: Uuid) -> Result<(EventRow, Record)>
      dış: common::has_scope records::load records::require_edit
      yerel: load
      st: pool
      ÇAĞIRAN: api/otf.rs
h   async fn require_scope(st: &AppState, me: &User, scope: &str) -> Result<()>
      dış: common::has_scope refdata refdata::template
h   fn check_kind(st: &AppState, id: Uuid) -> Result<()>
      dış: common::tree refdata refdata::under
h   fn check_location(st: &AppState, id: Option<Uuid>) -> Result<()>
      dış: common::tree refdata refdata::under
HWT pub async fn create(State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<NewEvent>) -> Result<Json<Created>>
      rota: POST /api/events
      dış: common::has_scope common::text common::tree decision decision::entry_state decision::gate records::change records::check_description records::check_title records::check_unit records::log records::log_override refdata::template
      yerel: check_kind
      st: pool
h   fn json(v: impl Serialize) -> serde_json::Value
h   async fn log_change(tx: &mut sqlx::Transaction<'_, Postgres>, twin: &Record, me: &User, field: &str, from: serde_json::Value, to: serde_json::Value) -> Result<()>
      dış: records::change records::log
HWT pub async fn patch(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(EventPatchBody { patch: p, quality_override }): Body<EventPatchBody>) -> Result<Json<Detail>>
      rota: PATCH /api/events/{id}
      dış: common::has_scope common::id common::text common::tree decision decision::entry_state decision::gate records::change records::check_description records::check_title records::check_user records::log records::log_override records::may_set_owner records::touch
      yerel: check_location editable json log_change reply
      st: pool
HWT pub async fn put_participant(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path((raw, user)): Path<(String, String)>, Body(b): Body<ParticipantBody>) -> Result<Json<Detail>>
      rota: PUT /api/events/{id}/participants/{user}
      dış: common::id common::text records::check_user records::touch
      yerel: editable reply
      st: pool
HWT pub async fn remove_participant(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path((raw, user)): Path<(String, String)>) -> Result<Json<Detail>>
      rota: DELETE /api/events/{id}/participants/{user}
      dış: common::id
      yerel: editable reply
      st: pool
HW  pub async fn put_team(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path((raw, team)): Path<(String, String)>) -> Result<Json<Detail>>
      rota: PUT /api/events/{id}/teams/{team}
      dış: common::id records::check_team
      yerel: editable reply
      st: pool
HW  pub async fn remove_team(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path((raw, team)): Path<(String, String)>) -> Result<Json<Detail>>
      rota: DELETE /api/events/{id}/teams/{team}
      dış: common::id
      yerel: editable reply
      st: pool
HW  pub async fn add_checkpoint(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<NewCheckpoint>) -> Result<Json<Detail>>
      rota: POST /api/events/{id}/checkpoints
      dış: common::id common::text
      yerel: load reply require_scope
      st: pool
h   async fn event_of(pool: &PgPool, sql: &'static str, id: Uuid) -> Result<Uuid>
      dış: common::present
h   async fn is_approver(st: &AppState, me: &User, ev: &EventRow) -> Result<bool>
      dış: common::has_scope
h   async fn require_approver(st: &AppState, me: &User, ev: &EventRow) -> Result<()>
      yerel: is_approver
HWT pub async fn patch_checkpoint(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<CheckpointPatch>) -> Result<Json<Detail>>
      rota: PATCH /api/event-checkpoints/{id}
      dış: common::id
      yerel: editable event_of reply require_approver require_scope
      st: pool
HW  pub async fn delete_checkpoint(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<Detail>>
      rota: DELETE /api/event-checkpoints/{id}
      dış: common::id
      yerel: event_of load reply require_approver
      st: pool
h   fn as_str(&self) -> &'static str
HWT pub async fn request_checkpoint(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<NewRequest>) -> Result<Json<Detail>>
      rota: POST /api/event-checkpoints/{id}/requests
      dış: common::id records::log records::touch
      yerel: editable event_of reply
      st: pool
HWT pub async fn resolve_request(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<Resolve>) -> Result<Json<Detail>>
      rota: POST /api/checkpoint-requests/{id}
      dış: common::id records::load records::log records::touch
      yerel: load reply require_approver
      st: pool
HW  pub async fn add_widget(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<NewWidget>) -> Result<Json<Detail>>
      rota: POST /api/events/{id}/widgets
      dış: common::id records::load
      yerel: editable load reply require_scope
      st: pool
HW  pub async fn delete_widget(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<Detail>>
      rota: DELETE /api/event-widgets/{id}
      dış: common::id
      yerel: editable reply require_scope
      st: pool
HWT pub async fn add_material(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<NewMaterial>) -> Result<Json<Detail>>
      rota: POST /api/events/{id}/materials
      dış: common::id common::text
      yerel: load reply require_scope
      st: pool
h   async fn attach_providers<'e>(ex: impl sqlx::PgExecutor<'e>, materials: &mut [Material]) -> Result<()>
h   fn overage_level(ln: Option<f64>, yellow_max_ln: f64) -> Option<u8>
h   fn base_at(bases: &[(DateTime<Utc>, f64)], at: DateTime<Utc>) -> Option<f64>
h   async fn fill_levels(pool: &PgPool, materials: &mut [Material]) -> Result<()>
      yerel: base_at overage_level overage_ln
h   fn card_price(m: &Material) -> Option<f64>
h   fn overage_ln(price: Option<f64>, budget: Option<f64>) -> Option<f64>
hW  async fn refresh_overage(conn: &mut sqlx::PgConnection, material: Uuid) -> Result<()>
      yerel: apply attach_providers
h   async fn require_unpurchased(pool: &PgPool, material: Uuid) -> Result<()>
      dış: common::present
h   fn apply(mut m: Material, b: MaterialPatch) -> Result<Material>
      dış: common::text
      yerel: card_price overage_ln
h   async fn material_event(pool: &PgPool, id: Uuid) -> Result<Option<Uuid>>
h   pub(crate) async fn material_one(pool: &PgPool, id: Uuid) -> Result<Material>
      yerel: attach_providers fill_levels
      ÇAĞIRAN: api/purchasing.rs
h   async fn mat_reply(st: &AppState, me: &User, material: Uuid, event: Option<Uuid>) -> Result<Json<MatReply>>
      yerel: material_one reply
      st: pool
HWT pub async fn patch_material(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<MaterialPatch>) -> Result<Json<MatReply>>
      rota: PATCH /api/materials/{id}
      dış: common::id
      yerel: apply attach_providers mat_reply material_event require_scope
      st: pool
HW  pub async fn delete_material(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<MatReply>>
      rota: DELETE /api/materials/{id}
      dış: common::id
      yerel: material_event reply require_scope require_unpurchased
      st: pool
HWT pub async fn add_provider(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<NewProvider>) -> Result<Json<MatReply>>
      rota: POST /api/materials/{id}/providers
      dış: common::id common::text super::purchasing::ensure_vendor super::purchasing::offer_label
      yerel: mat_reply material_event refresh_overage require_scope require_unpurchased
      st: pool
HWT pub async fn delete_provider(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<MatReply>>
      rota: DELETE /api/material-providers/{id}
      dış: common::id
      yerel: mat_reply provider_owner refresh_overage require_scope require_unpurchased
      st: pool
h   async fn provider_owner(pool: &PgPool, id: Uuid) -> Result<(Uuid, Option<Uuid>)>
      dış: common::present
HWT pub async fn patch_provider(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<ProviderPatch>) -> Result<Json<MatReply>>
      rota: PATCH /api/material-providers/{id}
      dış: common::id common::text super::purchasing::ensure_vendor super::purchasing::offer_label
      yerel: mat_reply provider_owner refresh_overage require_scope require_unpurchased
      st: pool
HW  pub async fn set_purchased(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<PurchasedPatch>) -> Result<Json<Material>>
      rota: PATCH /api/materials/{id}/purchased
      dış: common::id
      yerel: material_one require_scope
      st: pool
h   fn purchase_rows(materials: &[Material]) -> Vec<&Material>
h   fn supplier_of(m: &Material) -> Option<&Provider>
h   fn xlsx_row(m: &Material) -> purchases_xlsx::Row
      dış: purchases_xlsx
      yerel: card_price eta_of supplier_of
h   fn excel_serial(d: NaiveDate) -> i64
h   fn eta_of(m: &Material) -> Option<NaiveDate>
H   pub async fn purchases_xlsx(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Response>
      rota: GET /api/events/{id}/purchases.xlsx
      dış: common::id purchases_xlsx purchases_xlsx::render
      yerel: detail_of load purchase_rows require_visible
      st: pool

===api/finance.rs===
→ domain/finance.rs · 1343 satır · 35 fn
h   pub(super) async fn is_viewer(st: &AppState, me: &User) -> Result<bool>
      dış: crate::db::scope::active
      st: pool
h   pub(super) async fn need_viewer(st: &AppState, me: &User) -> Result<()>
      yerel: is_viewer
      ÇAĞIRAN: api/budget.rs api/purchasing.rs api/templates.rs
h   pub(super) async fn need(st: &AppState, me: &User, scope: &'static str) -> Result<()>
      dış: common::has_scope
      yerel: scope_denied
h   fn scope_denied(scope: &str) -> &'static str
h   pub(super) fn today() -> NaiveDate
h   fn text(v: Option<String>, max: usize, code: &'static str) -> Result<Option<String>>
      dış: common::text
h   fn shape(b: InvoiceIn, today: NaiveDate) -> Result<Valid>
      dış: finance::currency
      yerel: text
h   async fn check_refs(tx: &mut PgConnection, me: &User, v: &mut Valid) -> Result<()>
hW  async fn write_body(tx: &mut PgConnection, id: Uuid, v: &Valid) -> Result<()>
hW  async fn review(tx: &mut PgConnection, id: Uuid, action: &str, note: Option<&str>, by: Uuid) -> Result<()>
HWT pub async fn submit(State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<InvoiceIn>) -> Result<Json<InvoiceView>>
      rota: POST /api/finance/invoices
      yerel: check_refs review shape today view write_body
      st: pool
HWT pub async fn edit(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<InvoiceIn>) -> Result<Json<InvoiceView>>
      rota: PUT /api/finance/invoices/{id}
      dış: common::id
      yerel: check_refs review shape today view write_body
      st: pool
h   async fn view(st: &AppState, me: &User, id: Uuid) -> Result<InvoiceView>
      dış: audit::log_event budget::float8 common::has_scope
      yerel: is_viewer
      st: pool
H   pub async fn get(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<InvoiceView>>
      rota: GET /api/finance/invoices/{id}
      dış: common::id
      yerel: view
H   pub async fn list(State(st): State<AppState>, CurrentUser(me): CurrentUser, Query(q): Query<ListQuery>) -> Result<Json<Vec<InvoiceRowOut>>>
      rota: GET /api/finance/invoices
      yerel: is_viewer
      st: pool
HWT pub async fn decide(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<DecisionIn>) -> Result<Json<InvoiceView>>
      rota: POST /api/finance/invoices/{id}/decision
      dış: common::id
      yerel: approve cancel need review text view
      st: pool
hW  async fn approve(tx: &mut PgConnection, me: &User, id: Uuid, purchased_on: NaiveDate, paid_by: &str, claim: Option<Uuid>) -> Result<()>
      yerel: monthly_claim
hW  async fn monthly_claim(tx: &mut PgConnection, me: &User, day: NaiveDate) -> Result<Option<Uuid>>
hW  async fn cancel(tx: &mut PgConnection, me: &User, id: Uuid, claim: Option<Uuid>) -> Result<()>
HWT pub async fn move_claim(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<ClaimMove>) -> Result<Json<InvoiceView>>
      rota: PUT /api/finance/invoices/{id}/claim
      dış: common::id
      yerel: need view
      st: pool
H   pub async fn purchasable(State(st): State<AppState>, CurrentUser(_me): CurrentUser) -> Result<Json<Vec<Purchasable>>>
      rota: GET /api/finance/purchasable
      st: pool
H   pub async fn claims(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<Vec<ClaimOut>>>
      rota: GET /api/finance/claims
      yerel: need_viewer
      st: pool
H   pub async fn claim_slots(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<Vec<ClaimSlot>>>
      rota: GET /api/finance/claim-slots
      yerel: need_viewer
      st: pool
HW  pub async fn create_claim(State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<ClaimIn>) -> Result<Json<ClaimDetail>>
      rota: POST /api/finance/claims
      yerel: claim_detail need
      st: pool
h   async fn claim_detail(st: &AppState, id: Uuid) -> Result<ClaimDetail>
      st: pool
H   pub async fn claim(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<ClaimDetail>>
      rota: GET /api/finance/claims/{id}
      dış: common::id
      yerel: claim_detail need_viewer
H   pub async fn claim_xlsx(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<axum::response::Response>
      rota: GET /api/finance/claims/{id}/xlsx
      dış: common::id crate::xlsx crate::xlsx::table
      yerel: need_viewer
      st: pool
HWT pub async fn patch_claim(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<ClaimPatch>) -> Result<Json<ClaimDetail>>
      rota: PATCH /api/finance/claims/{id}
      dış: common::id
      yerel: claim_detail need
      st: pool
H   pub async fn ledger(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<LedgerView>>
      rota: GET /api/finance/ledger
      dış: common::has_scope
      yerel: need_viewer today
      st: pool
HWT pub async fn add_entry(State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<EntryIn>) -> Result<Json<LedgerView>>
      rota: POST /api/finance/ledger
      dış: finance::signed_cents
      yerel: ledger need text today
      st: pool
HWT pub async fn reverse_entry(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<ReverseIn>) -> Result<Json<LedgerView>>
      rota: POST /api/finance/ledger/{id}/reverse
      dış: common::id
      yerel: ledger need text today
      st: pool
HW  pub async fn add_check(State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<CheckIn>) -> Result<Json<LedgerView>>
      rota: POST /api/finance/ledger/checks
      dış: finance::signed_cents
      yerel: ledger need today
      st: pool
HW  pub async fn payout(State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<PayoutIn>) -> Result<Json<LedgerView>>
      rota: POST /api/finance/payouts
      yerel: ledger need text today
      st: pool
H   pub async fn summary(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<Summary>>
      rota: GET /api/finance/summary
      yerel: need_viewer today
      st: pool
HW  pub async fn fx(State(st): State<AppState>, CurrentUser(_me): CurrentUser, Query(q): Query<FxQuery>) -> Result<Json<Value>>
      rota: GET /api/finance/fx
      dış: finance::currency finance::lookback finance::parse_tcmb finance::tcmb_url
      yerel: today
      st: cfg http pool

===api/home.rs===
→ domain/home.rs · 179 satır · 12 fn
H   pub async fn home(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<Home>>
      rota: GET /api/home
      st: pool
HW  pub async fn pin(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(slug): Path<String>) -> Result<StatusCode>
      rota: POST /api/pins/{slug}
      st: pool
HW  pub async fn unpin(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(slug): Path<String>) -> Result<StatusCode>
      rota: DELETE /api/pins/{slug}
      st: pool
h   async fn team_views(st: &AppState, only: Option<Uuid>) -> Result<Vec<TeamView>>
      st: pool
H   pub async fn teams(State(st): State<AppState>, CurrentUser(_): CurrentUser) -> Result<Json<Vec<TeamView>>>
      rota: GET /api/teams
      yerel: team_views
H   pub async fn team(State(st): State<AppState>, CurrentUser(_): CurrentUser, Path(raw): Path<String>) -> Result<Json<TeamView>>
      rota: GET /api/teams/{id}
      dış: common::id
      yerel: one_team
h   pub(super) async fn manage_teams(st: &AppState, me: &crate::models::user::User) -> Result<()>
      dış: common::has_scope
      ÇAĞIRAN: api/teams.rs
h   async fn team_chat(st: &AppState, team: Uuid) -> Result<Uuid>
      st: pool
hW  async fn wall(st: &AppState, chat: Uuid, actor: Uuid, verb: &str, person: &str, detail: Option<String>) -> Result<()>
      st: pool
HW  pub async fn set_member(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<MemberIn>) -> Result<Json<TeamView>>
      rota: POST /api/teams/{id}/members
      dış: common::id
      yerel: manage_teams one_team team_chat wall
      st: pool
HW  pub async fn drop_member(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path((raw, user)): Path<(String, String)>) -> Result<Json<TeamView>>
      rota: DELETE /api/teams/{id}/members/{user}
      dış: common::id
      yerel: manage_teams one_team team_chat wall
      st: pool
h   async fn one_team(st: &AppState, id: Uuid) -> Result<Json<TeamView>>
      yerel: team_views

===api/llm.rs===
→ domain/llm.rs · 641 satır · 37 fn
h   pub(crate) async fn require(st: &AppState, me: &User) -> Result<()>
      dış: common::has_scope
      ÇAĞIRAN: api/llm_usage.rs
h   async fn log(st: &AppState, headers: &HeaderMap, me: &User, event: &str, detail: &str)
      dış: audit::client_ip audit::log_event
h   pub(crate) async fn load(pool: &PgPool) -> Result<LlmConfig>
      ÇAĞIRAN: api/events/context.rs api/events/context/materials.rs
h   async fn view(st: &AppState) -> Result<Json<LlmView>>
      yerel: load
      st: pool
H   pub async fn get(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<LlmView>>
      rota: GET /api/admin/llm
      yerel: require view
HW  pub async fn put(State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap, Body(cfg): Body<LlmConfig>) -> Result<Json<LlmView>>
      rota: PUT /api/admin/llm
      dış: audit::client_ip audit::log_event
      yerel: require view
      st: pool
H   pub async fn redact_try(State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<RedactIn>) -> Result<Json<Value>>
      rota: POST /api/admin/llm/redact-try
      dış: crate::redact::redact events::known_names
      yerel: load require
      st: pool
HW  pub async fn reset(State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap) -> Result<Json<LlmView>>
      rota: DELETE /api/admin/llm
      dış: audit::client_ip audit::log_event
      yerel: require view
      st: pool
h   async fn limits_of(pool: &PgPool, profile: Option<Uuid>) -> Result<Vec<LimitRow>>
H   pub async fn list_limits(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<Vec<LimitRow>>>
      rota: GET /api/admin/llm/limits
      yerel: limits_of require
      st: pool
h   fn valid_limit(b: &LimitIn) -> bool
HW  pub async fn put_limit(State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap, Path(raw): Path<String>, Body(b): Body<LimitIn>) -> Result<Json<ProfileView>>
      rota: POST /api/admin/llm/profiles/{id}/limits
      yerel: log profile_or_404 profile_view require valid_limit
      st: pool
HW  pub async fn delete_limit(State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap, Path(raw): Path<String>) -> Result<Json<ProfileView>>
      rota: DELETE /api/admin/llm/limits/{id}
      dış: common::id llm::profile
      yerel: log profile_view require
      st: pool
h   fn endpoint_on(st: &AppState, e: Endpoint) -> bool
      dış: llm llm::service_on
h   async fn profile_view(st: &AppState, p: ProfileRow) -> Result<ProfileView>
      yerel: endpoint_on limits_of
      st: pool
h   async fn profile_or_404(pool: &PgPool, raw: &str) -> Result<ProfileRow>
      dış: common::id llm::profile
h   async fn all_profiles(st: &AppState) -> Result<Vec<ProfileView>>
      yerel: profile_view
      st: pool
H   pub async fn list_profiles(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<Vec<ProfileView>>>
      rota: GET /api/admin/llm/profiles
      yerel: all_profiles require
H   pub async fn get_profile(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<ProfileView>>
      rota: GET /api/admin/llm/profiles/{id}
      yerel: profile_or_404 profile_view require
      st: pool
h   async fn name_taken(pool: &PgPool, name: &str, except: Option<Uuid>) -> Result<bool>
h   fn check_fields(name: &str, model: &str, endpoint: Endpoint, params: &Params) -> Result<()>
      dış: llm::valid_model llm::valid_profile_name
HW  pub async fn create_profile(State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap, Body(b): Body<NewProfileIn>) -> Result<Json<ProfileView>>
      rota: POST /api/admin/llm/profiles
      dış: llm::profile
      yerel: check_fields log name_taken profile_view require
      st: pool
HW  pub async fn put_profile(State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap, Path(raw): Path<String>, Body(b): Body<ProfileIn>) -> Result<Json<ProfileView>>
      rota: PUT /api/admin/llm/profiles/{id}
      dış: llm::profile llm::tested
      yerel: check_fields endpoint_on log name_taken profile_or_404 profile_view require
      st: pool
HW  pub async fn delete_profile(State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap, Path(raw): Path<String>) -> Result<Json<Vec<ProfileView>>>
      rota: DELETE /api/admin/llm/profiles/{id}
      yerel: all_profiles log profile_or_404 require
      st: pool
h   fn sample(c: &Contract) -> Value
      dış: events::material_sample
h   fn contract_of(raw: &str) -> Result<&'static Contract>
      dış: llm::contract
h   async fn task_view(st: &AppState, c: &'static Contract) -> Result<TaskView>
      dış: llm::combine llm::profile llm::service_on llm::settings llm::task
      yerel: sample
      st: pool
H   pub async fn list_tasks(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<Vec<TaskView>>>
      rota: GET /api/admin/llm/tasks
      dış: llm
      yerel: require task_view
H   pub async fn get_task(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<TaskView>>
      rota: GET /api/admin/llm/tasks/{feature}
      yerel: contract_of require task_view
HW  pub async fn put_task(State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap, Path(raw): Path<String>, Body(b): Body<TaskIn>) -> Result<Json<TaskView>>
      rota: PUT /api/admin/llm/tasks/{feature}
      dış: decision llm::profile llm::service_on llm::task llm::tested llm::valid_batch
      yerel: contract_of log require task_view
      st: pool
H   pub async fn try_it(State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<TryIn>) -> Result<Json<Value>>
      rota: POST /api/admin/llm/try
      dış: decision::try_model events::try_suggest llm llm::profile llm::settings llm::valid_batch llm::valid_model
      yerel: contract_of prompt_body require
      st: pool
h   async fn prompt_body(pool: &PgPool, feature: &str, version: i32) -> Result<String>
h   fn prompt_contract(raw: &str) -> Result<(&'static Contract, &'static str)>
      yerel: contract_of
h   async fn prompts(st: &AppState, c: &'static Contract, code_default: &'static str) -> Result<Json<PromptsView>>
      dış: llm::settings
      st: pool
H   pub async fn get_prompts(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<PromptsView>>
      rota: GET /api/admin/llm/prompts/{feature}
      yerel: prompt_contract prompts require
HW  pub async fn add_prompt(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<PromptIn>) -> Result<Json<PromptsView>>
      rota: POST /api/admin/llm/prompts/{feature}
      yerel: prompt_contract prompts require
      st: pool
HW  pub async fn activate_prompt(State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap, Path(raw): Path<String>, Body(b): Body<ActiveIn>) -> Result<Json<PromptsView>>
      rota: PUT /api/admin/llm/prompts/{feature}/active
      dış: llm::service_on llm::settings llm::tested
      yerel: log prompt_body prompt_contract prompts require
      st: pool

===api/llm_usage.rs===
→ domain/llm_usage.rs · 396 satır · 12 fn
h   fn date(raw: Option<&str>) -> Result<Option<NaiveDate>>
h   fn parse(q: &FilterIn, today: NaiveDate) -> Result<Self>
      yerel: date
h   fn daily_ok(&self) -> bool
H   pub async fn usage(State(st): State<AppState>, CurrentUser(me): CurrentUser, Query(q): Query<FilterIn>) -> Result<Json<UsageView>>
      rota: GET /api/admin/llm/usage
      dış: llm llm::boundary llm::today
      st: pool
h   fn cursor(raw: Option<&str>) -> Result<(Option<DateTime<Utc>>, Option<Uuid>)>
H   pub async fn calls(State(st): State<AppState>, CurrentUser(me): CurrentUser, Query(q): Query<FilterIn>) -> Result<Json<CallsView>>
      rota: GET /api/admin/llm/calls
      dış: llm llm::today
      yerel: cursor
      st: pool
H   pub async fn call(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<CallDetail>>
      rota: GET /api/admin/llm/calls/{id}
      dış: common::id
      st: pool
H   pub async fn status(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<StatusView>>
      rota: GET /api/admin/llm/status
      dış: llm llm::boundary llm::service_on llm::settings
      st: cfg pool
H   pub async fn key(State(st): State<AppState>, CurrentUser(me): CurrentUser, Query(q): Query<RefreshIn>) -> Result<Json<KeyView>>
      rota: GET /api/admin/llm/key
      dış: llm llm::service_on
      st: llm_cache
h   fn per_million(v: Option<&Value>) -> Option<f64>
h   fn model_info(m: &Value) -> Option<ModelInfo>
      yerel: per_million
H   pub async fn models(State(st): State<AppState>, CurrentUser(me): CurrentUser, Query(q): Query<RefreshIn>) -> Result<Json<ModelsView>>
      rota: GET /api/admin/llm/models
      st: llm_cache

===api/meta.rs===
KAPSAM DIŞI — statik meta, iş mantığı yok

===api/nodes.rs===
→ domain/nodes.rs · 493 satır · 19 fn
H   pub async fn tree(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<TreeView>>
      rota: GET /api/nodes
      yerel: view
      st: pool
h   fn locked(n: &crate::db::tree::Node) -> Option<&'static str>
h   async fn view(st: &AppState, access: &NodeAccess) -> Result<TreeView>
      dış: common::tree refdata::child_rule refdata::warnings
      yerel: locked
      st: pool
h   fn name_of(raw: String) -> Result<String>
      dış: common::text
h   fn check_name(name: &str) -> Result<()>
      dış: common common::min_chars
h   fn check_description(description: Option<&str>) -> Result<()>
      dış: common common::min_chars
h   fn parse_type(raw: String) -> Result<NodeType>
h   fn list_fits(tree: &TreeIndex, parent: Uuid, t: NodeType, except: Option<Uuid>) -> bool
h   fn shape_fits(tree: &TreeIndex, id: Uuid, shape: Shape) -> bool
h   fn attrs_for(t: NodeType, raw: Option<Value>) -> Result<Value>
      dış: refdata::validate_attrs
HWT pub async fn create(State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<NewNode>) -> Result<Json<TreeView>>
      rota: POST /api/nodes
      dış: common::has_scope common::text common::tree refdata refdata::child_rule
      yerel: attrs_for check_description check_name fixed_name_for list_fits log name_of view
      st: pool rebuild_tree structure
h   fn fixed_name_for(t: NodeType, attrs: &Value) -> Option<String>
      dış: refdata::widget_label_of
h   fn shape_error(e: sqlx::Error) -> AppError
      dış: common::present
HWT pub async fn patch(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(p): Body<NodePatch>) -> Result<Json<TreeView>>
      rota: PATCH /api/nodes/{id}
      dış: common::has_scope common::id common::text common::tree refdata::child_rule refdata::fixed_name
      yerel: attrs_for check_description check_name fixed_name_for list_fits locked log shape_fits view
      st: pool rebuild_tree structure
hW  async fn log(tx: &mut Tx<'_>, actor: Uuid, verb: &str, subject: &str, target: Option<&str>, detail: Value) -> Result<()>
HWT pub async fn delete(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<TreeView>>
      rota: DELETE /api/nodes/{id}
      dış: common::id common::tree
      yerel: locked log view
      st: pool rebuild_tree structure
HW  pub async fn favorite(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<Vec<Uuid>>>
      rota: PUT /api/nodes/{id}/favorite
      dış: common::id common::tree
      yerel: favorites_of
      st: pool
HW  pub async fn unfavorite(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<Vec<Uuid>>>
      rota: DELETE /api/nodes/{id}/favorite
      dış: common::id
      yerel: favorites_of
      st: pool
h   async fn favorites_of(st: &AppState, user: Uuid) -> Result<Json<Vec<Uuid>>>
      st: pool

===api/notify.rs===
→ domain/notify.rs · 242 satır · 12 fn
h   async fn load_prefs(st: &AppState, me: Uuid) -> Result<Prefs>
      st: pool
h   fn mentions_me(body: Option<&str>, my_handle: &str) -> bool
      dış: mentions mentions::tokens
H   pub async fn list(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<NoticeList>>
      rota: GET /api/notifications
      dış: mentions::handle push::decide
      yerel: load_prefs mentions_me
      st: pool
HW  pub async fn seen(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<StatusCode>
      rota: POST /api/notifications/seen
      st: pool
H   pub async fn prefs(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<Prefs>>
      rota: GET /api/me/notifications
      dış: common::present
      yerel: load_prefs
HW  pub async fn patch_prefs(State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(p): Body<PrefsPatch>) -> Result<Json<Prefs>>
      rota: PATCH /api/me/notifications
      yerel: load_prefs
      st: pool
HW  pub async fn set_chat(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<ChatPref>) -> Result<Json<Prefs>>
      rota: PUT /api/chats/{id}/prefs
      dış: common::id
      yerel: load_prefs
      st: pool
HW  pub async fn subscribe(State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<Subscription>) -> Result<StatusCode>
      rota: POST /api/push/subscriptions
      st: pool
HW  pub async fn unsubscribe(State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<Unsubscribe>) -> Result<StatusCode>
      rota: DELETE /api/push/subscriptions
      st: pool
H   pub async fn vapid(State(st): State<AppState>, CurrentUser(_): CurrentUser) -> Json<VapidKey>
      rota: GET /api/push/vapid
      dış: push::decide
      st: vapid
h   pub async fn fanout(st: AppState, chat: Uuid, author: Uuid, body: String)
      yerel: fanout_inner
      st: vapid
      ÇAĞIRAN: api/chats.rs
hW  async fn fanout_inner(st: &AppState, chat: Uuid, author: Uuid, body: &str) -> Result<()>
      dış: mentions::handle push::decide
      yerel: load_prefs mentions_me
      st: pool vapid

===api/otf.rs===
→ domain/otf.rs · 423 satır · 22 fn
h   async fn load_review(pool: &PgPool, id: Uuid) -> Result<Option<Review>>
h   async fn source_of(pool: &PgPool, id: Uuid) -> Result<Option<Source>>
h   async fn snapshot(pool: &PgPool, id: Uuid) -> Result<serde_json::Value>
      yerel: load_contacts load_fields load_items load_outcome_ids
h   async fn event_info(pool: &PgPool, id: Uuid) -> Result<EventInfo>
h   async fn load_fields(pool: &PgPool, id: Uuid) -> Result<Fields>
h   async fn load_items(pool: &PgPool, id: Uuid) -> Result<Vec<Item>>
h   async fn load_contacts(pool: &PgPool, id: Uuid) -> Result<Vec<Uuid>>
h   fn outcomes_text(picked: &[String], free: Option<&str>) -> String
h   async fn load_outcome_ids(pool: &PgPool, id: Uuid) -> Result<Vec<Uuid>>
h   fn in_tree_order(st: &AppState, mut ids: Vec<Uuid>) -> Vec<Uuid>
      dış: common::tree
h   async fn outcome_options(st: &AppState, selected: &[Uuid]) -> Result<Vec<OutcomeOption>>
      dış: common::tree refdata refdata::under
      st: pool
h   fn check_outcomes(st: &AppState, ids: &[Uuid], current: &[Uuid]) -> Result<()>
      dış: common::tree refdata refdata::under
h   fn deadline(date: NaiveDate) -> NaiveDate
h   fn month(d: NaiveDate) -> usize
h   fn file_name(code: &str, date: Option<NaiveDate>) -> String
      yerel: month
h   fn view(st: &AppState, ev: &EventInfo, fields: Fields, items: Vec<Item>, contacts: Vec<Uuid>, autofill_source: Option<Source>, review: Option<Review>) -> View
      dış: otf
      yerel: file_name month
      st: cfg
H   pub async fn get(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<View>>
      rota: GET /api/events/{id}/otf
      dış: common::id events::require_visible
      yerel: reply
h   async fn reply(st: &AppState, id: Uuid) -> Result<Json<View>>
      yerel: event_info in_tree_order load_contacts load_fields load_items load_outcome_ids load_review outcome_options source_of view
      st: pool
HWT pub async fn autofill(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<View>>
      rota: POST /api/events/{id}/otf/autofill
      dış: common::id events::editable
      yerel: reply source_of
      st: pool
h   fn clean(v: Option<String>, max: usize, code: &'static str) -> Result<Option<String>>
      dış: common::text
HWT pub async fn put(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<Input>) -> Result<Json<View>>
      rota: PUT /api/events/{id}/otf
      dış: common::id crate::api::records::check_user events::editable otf::section_of
      yerel: check_outcomes clean load_outcome_ids load_review reply snapshot
      st: pool
H   pub async fn docx(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Response>
      rota: GET /api/events/{id}/otf.docx
      dış: common::id common::tree events::require_visible otf otf::render
      yerel: event_info file_name in_tree_order load_fields load_items load_outcome_ids load_review month outcomes_text
      st: cfg pool

===api/profile.rs===
→ domain/profile.rs · 159 satır · 4 fn
HW  pub async fn rename(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(p): Body<NameIn>) -> Result<StatusCode>
      rota: PATCH /api/users/{id}/name
      dış: common::has_scope common::id common::present common::text
      st: pool
h   fn phone_ok(p: &str) -> bool
HWT pub async fn patch(State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(p): Body<ProfilePatch>) -> Result<StatusCode>
      rota: PATCH /api/me/profile
      dış: common::text crate::media
      yerel: phone_ok
      st: pool
H   pub async fn export(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Response>
      rota: GET /api/me/export
      st: pool

===api/purchasing.rs===
→ domain/purchasing.rs · 591 satır · 15 fn
H   pub async fn materials(State(st): State<AppState>, CurrentUser(me): CurrentUser, Query(q): Query<MatQuery>) -> Result<Json<MatList>>
      rota: GET /api/finance/materials
      dış: normalize::key
      st: pool
h   async fn wall_defaults(st: &AppState) -> Result<(i64, i64)>
      st: pool
H   pub async fn wall(State(st): State<AppState>, CurrentUser(me): CurrentUser, Query(q): Query<WallQuery>) -> Result<Json<Wall>>
      rota: GET /api/finance/wall
      yerel: wall_defaults
      st: pool
HWT pub async fn create_material(State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<NewMaterial>) -> Result<Json<MatRow>>
      rota: POST /api/finance/materials
      dış: common::text
      yerel: ensure_vendor materials one
      st: pool
h   async fn one(st: &AppState, id: Uuid) -> Result<MatRow>
      dış: super::events
      st: pool
H   pub async fn material(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<MatFull>>
      rota: GET /api/finance/materials/{id}
      dış: common::id common::present super::events::material_one
      yerel: one
      st: pool
HWT pub async fn patch_material(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<MaterialPatch>) -> Result<Json<MatRow>>
      rota: PATCH /api/finance/materials/{id}
      dış: common::id
      yerel: one
      st: pool
hW  pub async fn ensure_vendor(conn: &mut sqlx::PgConnection, label: &str, by: Option<Uuid>) -> Result<Option<Uuid>>
      dış: normalize::key
      yerel: vendors
      ÇAĞIRAN: api/events.rs
h   pub fn offer_label<'a>(name: Option<&'a str>, contact: &'a str) -> Option<&'a str>
      ÇAĞIRAN: api/events.rs
hW  pub async fn backfill_vendors(pool: &sqlx::PgPool) -> Result<u64>
      yerel: ensure_vendor offer_label
H   pub async fn vendors(State(st): State<AppState>, CurrentUser(me): CurrentUser, Query(q): Query<VendorQuery>) -> Result<Json<Vec<VendorRow>>>
      rota: GET /api/finance/vendors
      dış: normalize::key
      st: pool
HW  pub async fn create_vendor(State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<VendorIn>) -> Result<Json<Value>>
      rota: POST /api/finance/vendors
      dış: common::text normalize::key
      yerel: ensure_vendor vendor_one
      st: pool
h   async fn vendor_one(st: &AppState, id: Uuid) -> Result<VendorRow>
      st: pool
H   pub async fn vendor(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<VendorDetail>>
      rota: GET /api/finance/vendors/{id}
      dış: common::id common::present
      yerel: vendor_one
      st: pool
HWT pub async fn patch_vendor(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<VendorPatch>) -> Result<Json<VendorRow>>
      rota: PATCH /api/finance/vendors/{id}
      dış: common::id common::text normalize::key
      yerel: vendor_one
      st: pool

===api/quality.rs===
→ domain/quality.rs · 75 satır · 6 fn
h   fn admin_only(me: &User) -> Result<()>
h   async fn view(st: &AppState) -> Result<Json<QualityView>>
      dış: crate::config
      st: cfg pool quality
H   pub async fn get(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<QualityView>>
      rota: GET /api/admin/quality
      yerel: admin_only view
HW  pub async fn put(State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap, Body(cfg): Body<QualityConfig>) -> Result<Json<QualityView>>
      rota: PUT /api/admin/quality
      dış: audit::client_ip audit::log_event
      yerel: admin_only view
      st: pool quality
HW  pub async fn reset(State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap) -> Result<Json<QualityView>>
      rota: DELETE /api/admin/quality
      dış: audit::client_ip audit::log_event decision
      yerel: admin_only view
      st: pool quality
H   pub async fn try_it(State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<TryIn>) -> Result<Json<decision::Quality>>
      rota: POST /api/admin/quality/try
      dış: decision::try_with
      yerel: admin_only
      st: quality

===api/records.rs===
→ domain/records.rs · 1010 satır · 37 fn
H   pub async fn list(State(st): State<AppState>, CurrentUser(me): CurrentUser, Query(params): Query<HashMap<String, String>>) -> Result<Json<Vec<RecordSummary>>>
      rota: GET /api/records
      dış: common::tree
      st: pool
h   fn decider(me: &User, rec: &Record) -> bool
h   pub(crate) async fn load(pool: &PgPool, id: Uuid) -> Result<Record>
      ÇAĞIRAN: api/cards.rs api/events.rs
h   pub(crate) async fn detail_of(st: &AppState, me: &User, rec: Record) -> Result<Detail>
      dış: cards::of_record common::has_scope scope::can_edit_record
      yerel: decider
      st: pool tree
      ÇAĞIRAN: api/cards.rs
H   pub async fn get(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<Detail>>
      rota: GET /api/records/{id}
      dış: common::id
      yerel: detail_of load
      st: pool
h   pub(crate) async fn may_set_owner(st: &AppState, me: &User, rec: &Record, to: Option<Uuid>) -> Result<bool>
      dış: common::tree scope
      st: pool
      ÇAĞIRAN: api/events.rs
hW  async fn add_action_owners(tx: &mut sqlx::Transaction<'_, Postgres>, record_id: Uuid, owners: &[Uuid], by: Uuid) -> Result<()>
h   async fn check_owners(pool: &PgPool, ids: Vec<Uuid>) -> Result<Vec<Uuid>>
hW  async fn set_action_owners(tx: &mut sqlx::Transaction<'_, Postgres>, action: Uuid, owners: &[Uuid], by: Uuid) -> Result<()>
h   pub(crate) async fn require_edit(st: &AppState, me: &User, rec: &Record) -> Result<()>
      dış: scope::can_edit_record
      st: pool tree
      ÇAĞIRAN: api/cards.rs api/events.rs
h   pub(crate) async fn check_user(pool: &PgPool, id: Option<Uuid>) -> Result<()>
      ÇAĞIRAN: api/events.rs api/otf.rs
h   pub(crate) async fn check_team(pool: &PgPool, id: Option<Uuid>) -> Result<()>
      ÇAĞIRAN: api/events.rs
h   pub(crate) fn check_unit(st: &AppState, id: Uuid) -> Result<()>
      dış: common::tree crate::refdata crate::refdata::under
      ÇAĞIRAN: api/events.rs
h   async fn check_pillar(pool: &PgPool, id: Option<Uuid>) -> Result<()>
hW  pub(crate) async fn log(tx: &mut sqlx::Transaction<'_, Postgres>, chat_id: Uuid, actor: Uuid, verb: &str, subject: &str, target: Option<&str>, detail: Option<String>) -> Result<()>
      ÇAĞIRAN: api/events.rs
h   pub(crate) fn change(from: impl Serialize, to: impl Serialize) -> Option<String>
      ÇAĞIRAN: api/events.rs
h   pub(crate) fn check_title(title: &str) -> Result<()>
      dış: common common::min_chars
      ÇAĞIRAN: api/events.rs
h   pub(crate) fn check_description(d: Option<&str>) -> Result<()>
      dış: common common::min_chars
      ÇAĞIRAN: api/events.rs
h   pub(crate) async fn log_override(tx: &mut sqlx::Transaction<'_, Postgres>, chat_id: Uuid, actor: Uuid, subject: &str, field: &str, reasons: Option<Vec<&'static str>>) -> Result<()>
      yerel: log
      ÇAĞIRAN: api/events.rs
h   async fn closing(st: &AppState, actor: Uuid, note: Option<String>, context: &str, override_: bool, bypass_quality: bool) -> Result<(String, Option<Vec<&'static str>>, Option<decision::Quality>)>
      dış: common common::min_chars common::text decision decision::gate_with
HWT pub async fn create(State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<NewRecord>) -> Result<(StatusCode, Json<Created>)>
      rota: POST /api/records
      dış: cards::insert common::has_scope common::text decision decision::entry_state decision::gate
      yerel: change check_description check_pillar check_team check_title check_unit check_user log log_override
      st: pool
HWT pub async fn patch(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(body): Body<RecordPatchBody>) -> Result<Json<Patched>>
      rota: PATCH /api/records/{id}
      dış: common::has_scope common::id common::text decision decision::entry_state decision::gate_with
      yerel: bind_value change check_description check_pillar check_team check_title check_unit check_user closing decider detail_of load log log_override may_set_owner require_edit
      st: pool
h   fn bind_value<'q>(q: PgQuery<'q>, field: &str, v: &serde_json::Value) -> Result<PgQuery<'q>>
HWT pub async fn add_action(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<NewAction>) -> Result<Json<Detail>>
      rota: POST /api/records/{id}/actions
      dış: common::has_scope common::id common::text
      yerel: add_action_owners change check_owners detail_of load log require_edit set_action_owners touch
      st: pool
HWT pub async fn patch_action(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(body): Body<ActionPatchBody>) -> Result<Json<Detail>>
      rota: PATCH /api/actions/{id}
      dış: common::has_scope common::id common::text
      yerel: add_action_owners change check_owners closing detail_of load log log_override require_edit set_action_owners touch
      st: pool
hW  pub async fn touch(tx: &mut sqlx::Transaction<'_, Postgres>, record_id: Uuid) -> Result<()>
      ÇAĞIRAN: api/cards.rs api/chats.rs api/events.rs
H   pub async fn my_actions(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<Vec<MyAction>>>
      rota: GET /api/actions/mine
      st: pool
HWT pub async fn add_participant(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path((raw, user)): Path<(String, String)>) -> Result<Json<Detail>>
      rota: PUT /api/records/{id}/participants/{user}
      dış: common::id
      yerel: check_user detail_of load require_edit touch
      st: pool
HWT pub async fn remove_participant(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path((raw, user)): Path<(String, String)>) -> Result<Json<Detail>>
      rota: DELETE /api/records/{id}/participants/{user}
      dış: common::id
      yerel: detail_of load require_edit touch
      st: pool
HW  pub async fn pin(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<Detail>>
      rota: PUT /api/records/{id}/pin
      dış: common::id
      yerel: detail_of load
      st: pool
HW  pub async fn unpin(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<Detail>>
      rota: DELETE /api/records/{id}/pin
      dış: common::id
      yerel: detail_of load
      st: pool
HW  pub async fn set_card_order(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<CardOrder>) -> Result<Json<Detail>>
      rota: PUT /api/records/{id}/card-order
      dış: common::id
      yerel: detail_of load
      st: pool
HWT pub async fn join(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<Detail>>
      rota: POST /api/records/{id}/join
      dış: common::id scope::can_edit_record
      yerel: detail_of load log touch
      st: pool tree
HW  pub async fn cancel_join(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<Detail>>
      rota: DELETE /api/records/{id}/join
      dış: common::id
      yerel: detail_of load
      st: pool
HWT pub async fn decide_join(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path((raw, user)): Path<(String, String)>, Body(b): Body<Decision>) -> Result<Json<Detail>>
      rota: POST /api/records/{id}/join-requests/{user}
      dış: common::id
      yerel: decider detail_of load log touch
      st: pool
h   pub(crate) async fn is_restricted(st: &AppState, me: &User, rec: &Record) -> Result<bool>
      dış: scope::can_edit_record
      st: pool tree
      ÇAĞIRAN: api/attachments.rs api/chats.rs api/events.rs
h   pub(crate) async fn may_respond(st: &AppState, me: &User, rec: &Record) -> Result<bool>
      dış: scope::can_edit_record
      st: pool tree
      ÇAĞIRAN: api/cards.rs

===api/recurring.rs===
→ domain/recurring.rs · 109 satır · 6 fn
H   pub async fn list(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<Vec<Recurring>>>
      rota: GET /api/finance/recurring
      st: pool
h   async fn check(st: &AppState, b: &RecurringIn) -> Result<(String, i64, String)>
      dış: common::text
      st: pool
HW  pub async fn create(State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<RecurringIn>) -> Result<Json<Recurring>>
      rota: POST /api/finance/recurring
      yerel: check one
      st: pool
h   async fn one(st: &AppState, id: Uuid) -> Result<Recurring>
      dış: common::present
      st: pool
HW  pub async fn patch(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<RecurringPatch>) -> Result<Json<Recurring>>
      rota: PATCH /api/finance/recurring/{id}
      dış: common::id
      yerel: check one
      st: pool
HW  pub async fn delete(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<serde_json::Value>>
      rota: DELETE /api/finance/recurring/{id}
      dış: common::id
      st: pool

===api/teams.rs===
→ domain/teams.rs · 358 satır · 15 fn
h   fn name_of(raw: String) -> Result<String>
      dış: common::text
h   fn check_name(name: &str) -> Result<()>
      dış: common common::min_chars
h   fn check_description(description: Option<&str>, bypass_quality: bool) -> Result<()>
      dış: common common::min_chars
h   fn name_taken(e: sqlx::Error) -> AppError
hW  async fn wall(tx: &mut Tx<'_>, chat: Uuid, actor: Uuid, verb: &str, subject: &str, target: Option<&str>, detail: Option<String>) -> Result<()>
hW  async fn set_banner(tx: &mut Tx<'_>, team: Uuid, banner: Option<Uuid>) -> Result<()>
      dış: crate::media
hW  async fn insert_team(tx: &mut Tx<'_>, actor: Uuid, name: &str, description: Option<&str>, color: Option<&str>) -> Result<(Uuid, Uuid)>
      yerel: wall
HWT pub async fn create_team(State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<NewTeam>) -> Result<(StatusCode, Json<CreatedTeam>)>
      rota: POST /api/teams
      dış: common::has_scope common::present common::text
      yerel: check_description check_name insert_team name_of
      st: pool
HWT pub async fn patch_team(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(p): Body<TeamPatch>) -> Result<StatusCode>
      rota: PATCH /api/teams/{id}
      dış: common common::has_scope common::id common::min_chars common::text
      yerel: check_description set_banner wall
      st: pool
HW  pub async fn delete_team(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<StatusCode>
      rota: DELETE /api/teams/{id}
      dış: common::id
      st: pool
HWT pub async fn link_node(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path((raw, node)): Path<(String, String)>) -> Result<StatusCode>
      rota: PUT /api/teams/{id}/nodes/{node}
      dış: common::id common::tree crate::refdata crate::refdata::under
      yerel: wall
      st: pool
HWT pub async fn unlink_node(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path((raw, node)): Path<(String, String)>) -> Result<StatusCode>
      rota: DELETE /api/teams/{id}/nodes/{node}
      dış: common::id
      yerel: wall
      st: pool
HWT pub async fn create_pillar(State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<NewTeam>) -> Result<(StatusCode, Json<CreatedPillar>)>
      rota: POST /api/pillars
      dış: common::has_scope common::present common::text
      yerel: check_description check_name insert_team name_of
      st: pool
HWT pub async fn patch_pillar(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(p): Body<PillarPatch>) -> Result<StatusCode>
      rota: PATCH /api/pillars/{id}
      dış: common::has_scope common::id common::text
      yerel: check_description check_name set_banner wall
      st: pool
HWT pub async fn delete_pillar(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<StatusCode>
      rota: DELETE /api/pillars/{id}
      dış: common::id
      st: pool

===api/templates.rs===
→ domain/templates.rs · 76 satır · 6 fn
H   pub async fn list(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<Vec<Template>>>
      rota: GET /api/finance/templates
      st: pool
h   fn check(b: &TemplateIn) -> Result<String>
      dış: common::text
h   async fn one(st: &AppState, id: Uuid) -> Result<Template>
      st: pool
HW  pub async fn create(State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<TemplateIn>) -> Result<Json<Template>>
      rota: POST /api/finance/templates
      yerel: check one
      st: pool
HW  pub async fn replace(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<TemplateIn>) -> Result<Json<Template>>
      rota: PUT /api/finance/templates/{id}
      dış: common::id
      yerel: check one
      st: pool
HW  pub async fn delete(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<serde_json::Value>>
      rota: DELETE /api/finance/templates/{id}
      dış: common::id
      st: pool

```
