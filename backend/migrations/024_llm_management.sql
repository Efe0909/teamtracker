-- Yonetim > Veri isleme ve LLM (spec/79 §11): model ayari, cagri kaydi, maliyet,
-- dolar limitleri, surumlu istem, istege bagli govde saklama.
--
-- Ozellik (feature) KODDA sabittir (sozlesme: uc turu, sema, suzgec); burada yalniz
-- verisi durur. Satir yoksa kodun ve manifestin varsayilani gecerli.

create table llm_features (
    feature        text primary key,
    model          text not null,
    -- Sozlesmeye gore dogrulanir (llm.rs `Params`); bilinmeyen alan reddedilir.
    params         jsonb not null default '{}',
    enabled        boolean not null default true,
    store_bodies   boolean not null default false,
    -- NULL = koddaki istem (surum 0).
    prompt_version int,
    -- Modelin son basarili "Dene"si kayitta kullanildiysa zamani; NULL = denenmeden kaydedildi.
    tested_at      timestamptz,
    updated_by     uuid references users(id) on delete set null,
    updated_at     timestamptz not null default now()
);

-- Her model cagrisi bir satir: basarili, basarisiz (ucret dogmus olabilir) ve limite
-- takilan. Servis kapaliyken (anahtar yok / external_off) satir YAZILMAZ: cagri yok.
-- Istem ve cevap GOVDESI burada yok (llm_call_bodies, istege bagli, 7 gun).
create table llm_calls (
    id                uuid primary key default gen_random_uuid(),
    created_at        timestamptz not null default now(),
    feature           text not null,
    model             text not null,
    user_id           uuid references users(id) on delete set null,
    event_id          uuid references events(id) on delete set null,
    is_try            boolean not null default false,
    prompt_version    int,
    status            text not null
        check (status in ('ok', 'limit', 'http', 'timeout', 'network', 'parse', 'schema')),
    http_status       int,
    -- Kisa hata izi (asama + saglayici mesaji); istem/cevap icerigi degil.
    error             text check (char_length(error) <= 500),
    ms                int not null default 0,
    prompt_tokens     int,
    completion_tokens int,
    -- USD; saglayici vermediyse NULL ("maliyet bilinmiyor").
    cost_usd          double precision,
    or_gen_id         text,
    batch_id          uuid,
    asked             int,
    kept              int,
    -- Kalite kapisi karari: pass | low.
    outcome           text
);
create index llm_calls_model_time on llm_calls (model, created_at);
create index llm_calls_time on llm_calls (created_at);

create table llm_call_bodies (
    call_id    uuid primary key references llm_calls(id) on delete cascade,
    request    jsonb not null,
    response   text,
    created_at timestamptz not null default now()
);
create index llm_call_bodies_time on llm_call_bodies (created_at);

-- Gunluk ozet: KISI YOK, kalici. llm_calls 180 gun sonra silinir; maliyet gecmisi buradan.
create table llm_usage_daily (
    day               date not null,
    feature           text not null,
    model             text not null,
    calls             int not null,
    errors            int not null,
    prompt_tokens     bigint not null,
    completion_tokens bigint not null,
    cost_usd          double precision not null,
    unpriced          int not null,
    ms_total          bigint not null,
    primary key (day, feature, model)
);

-- Model basina dolar tavani; pencere kayan (son N dakika). Model basina istenen kadar.
create table llm_limits (
    id             uuid primary key default gen_random_uuid(),
    model          text not null,
    window_minutes int not null check (window_minutes between 15 and 44640),
    usd            double precision not null check (usd > 0 and usd < 100000),
    created_by     uuid references users(id) on delete set null,
    created_at     timestamptz not null default now(),
    unique (model, window_minutes)
);

-- Istem surumleri: yalniz ekleme. Etkin olan llm_features.prompt_version.
create table llm_prompts (
    feature    text not null,
    version    int not null check (version > 0),
    body       text not null check (char_length(btrim(body)) between 1 and 8000),
    created_by uuid references users(id) on delete set null,
    created_at timestamptz not null default now(),
    primary key (feature, version)
);

-- Yonetim > Veri isleme ve LLM sekmesinin tamami (spec/75).
insert into scopes (name) values ('manage_llm') on conflict (name) do nothing;

-- Denetim izi olay turleri. 001'deki liste `quality_config_*` ve `llm_config_*`
-- olaylarini tanimiyordu: o yazmalar kisitta DUSUYORDU (audit::log_event hatayi yalniz
-- loga yazar, istek gecer). Liste kodda kullanilan her turu kapsar.
alter table security_events drop constraint security_events_event_type_check;
alter table security_events add constraint security_events_event_type_check
  check (event_type in ('login','login_denied','logout','permission_denied',
                        'deactivation','scope_granted','scope_revoked',
                        'role_granted','role_revoked','role_created',
                        'role_deleted','admin_granted','admin_revoked',
                        'quality_config_changed','quality_config_reset',
                        'llm_config_changed','llm_config_reset',
                        'llm_feature_changed','llm_prompt_changed','llm_limit_changed',
                        'llm_bodies_on','llm_bodies_off'));
