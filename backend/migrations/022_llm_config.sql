-- LLM'e giden etkinlik verisinin temizleme kurallari (yonetimden degisir,
-- yeniden derleme gerekmez). TEK satir; satir yoksa kodun varsayilanlari gecerli
-- (kalite kapisi `quality_config` ile ayni kalip).
create table llm_config (
    id         boolean primary key default true check (id),
    config     jsonb not null,
    updated_by uuid references users(id) on delete set null,
    updated_at timestamptz not null default now()
);
