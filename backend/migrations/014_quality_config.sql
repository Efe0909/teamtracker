-- Kalite kapisi (spec/76) sorulari ve esikleri: yonetim sayfasindan degisir,
-- yeniden derleme gerekmez. TEK satir; satir yoksa kodun varsayilanlari gecerli.
create table quality_config (
    id         boolean primary key default true check (id),
    config     jsonb not null,
    updated_by uuid references users(id) on delete set null,
    updated_at timestamptz not null default now()
);
