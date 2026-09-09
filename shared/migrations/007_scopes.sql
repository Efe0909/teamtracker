-- Yetki kapsamlari ve dugum bazli izinler (TODO.md "Yetki kapsamlari ve roller").
--
-- Bugunku model uc kaba bayrakti: is_admin, is_editor, users.scope_node_id.
-- Buradan itibaren yetki IKI parcadan olusuyor:
--
--   1. SCOPE — adlandirilmis izin ("edit_nodes"). Ne yapabilecegini soyler.
--   2. NODE PERMISSION — hangi dalda yapabilecegini soyler. Bir dugume izin
--      verilirse ALT AGACININ tamami kapsanir; ayri ayri satir yazilmaz.
--
-- Ikisi BIRLIKTE gerekiyor: "edit_nodes" kapsami olmayan kisi hicbir dalda
-- duzenleyemez; kapsami olup izinli dugumu olmayan da duzenleyemez.
--
-- Roller (bir kapsam demeti) HENUZ YOK. Once tekil kapsamlar oturacak, roller
-- onlarin uzerine kurulacak — rol tablosu eklendiginde bu tablo degismez,
-- yalnizca "etkin kapsamlar" hesabina ikinci bir kaynak eklenir.

-- --- user scopes -----------------------------------------------------------
-- Kapsam adlari KODDA tanimli (shared/scope.py). Veritabani serbest metin
-- kabul eder ama uygulama uydurma kapsami yok sayar: yazim hatasi sessizce
-- yetki vermesin.
create table if not exists user_scopes (
  user_id    uuid not null references users(id) on delete cascade,
  scope      text not null,
  granted_at timestamptz not null default now(),
  granted_by uuid references users(id) on delete set null,
  primary key (user_id, scope)
);

-- --- user node scopes ------------------------------------------------------
-- Alt agac KAPSANIR, tek tek satir yazilmaz: "Maliye"ye izni olan altindaki
-- her seyi duzenler. Kontrol TreeIndex.is_descendant ile O(1).
--
-- Dugum silinince satir da gider (cascade) — olmayan dugume izin tasima.
create table if not exists user_node_scopes (
  user_id    uuid not null references users(id) on delete cascade,
  node_id    uuid not null references nodes(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references users(id) on delete set null,
  primary key (user_id, node_id)
);

create index if not exists user_node_scopes_user_idx on user_node_scopes(user_id);

-- --- tree history -----------------------------------------------------------
-- AYRI TABLO KURULMADI: "ne oldu" sorusunun ikinci bir kaynagi olmasin.
-- events zaten bu is icin var ve 003'te ayni sekilde 'team' ile genisletilmisti.
--
-- events.subject_id FK DEGIL — dugum silinse bile gecmis satiri kalir. Bu
-- yuzden silme olayinin body'si dugum ADINI metin olarak tasir; yoksa kayit
-- "bir sey silindi" demekten oteye gitmez.
alter table events drop constraint if exists events_subject_type_check;
alter table events add constraint events_subject_type_check
  check (subject_type in ('item','change_request','team','node'));
