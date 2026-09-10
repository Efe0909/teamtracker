-- Medya ekleri: karta/duvara asilan gorseller (spec/ ekler, CONTRACT-V2.md §1).
--
-- BU DOSYA YERINDE YENIDEN YAZILDI (donuk göç kuralına aykırı DEĞİL).
-- CLAUDE.md'nin "göç dosya adları artık donuk" kurali *kurulu* bir
-- veritabaninda uygulanmis göçler icin gecerli: adi degisirse
-- schema_migrations onu tanimaz, uygulanmamis sayilir ve YENIDEN KOSAR.
-- Bu dosya:
--   1. HENUZ HICBIR gercek veritabanina karsi calismadi (bu commit'ten
--      onceki hali de dahil) — birlestirilmemis bir ozellik dalinda yasadi.
--   2. Dal `claude/media-attachments-internal-chats-6od3r5` — ana dala
--      hicbir zaman girmedi, dolayisiyla hicbir kurulumun schema_migrations
--      tablosunda '009_attachments.sql' satiri yok.
--   3. Dagitim `nix flake update teamtracker` ile deponun ANA DALINI takip
--      ediyor; bu dal ana dala kadar hicbir makineye ulasmiyor.
-- Rename/rewrite burada SERBESTTI cunku veritabani "bos" sayilir. Batch 2'den
-- (bu yeniden yazimdan) SONRA dosya GERCEKTEN dondu: bir daha adi da,
-- iceriginin semantigi de degismeyecek — yeni ihtiyac 010+ ile gelir.
--
-- --- neden degisti (CONTRACT-V2.md §"Why this changes") -------------------
-- Batch 1 dar bir semaya karsi kuruldu (attachments.event_id -> events.id).
-- Batch 2 bunu genisletiyor: (a) donanim kokeni — bir satirin fiziksel
-- olarak HANGI birimde durdugu, kok yolu degistiginde de cevaplanabilmeli
-- (test VM'indeki virtio disk -> Pi'deki SATA -> belki NAS); (b) genis sahiplik
-- — ekler sohbet olaylariyla sinirli degil, ileride karta (items), is
-- semalarina (nodes) ve takima (teams) da asilacak (spec/60 §2.4, §2.7).
--
-- --- storage_volumes: donanim cevabi -----------------------------------
-- Bir dosyanin mutlak yolu: mount_path / media_prefix / storage_key. Eski
-- satirlar eski birimlerine bakmaya devam eder, boylece VM->Pi->NAS gecisi
-- sirasinda birden fazla birimden ayni anda servis edilebilir ve hangi
-- dosyalarin hala kopyalanmasi gerektigi sorgulanabilir.
create table if not exists storage_volumes (
  id           uuid primary key default gen_random_uuid(),
  label        text not null unique,     -- 'sata', 'sd', 'nas'
  kind         text not null check (kind in ('local','removable','nas')),
  mount_path   text not null,            -- '/home/efe/sata'
  media_prefix text not null default '', -- 'ekiptakip/media'
  device       text,                     -- gözlemlenen: '/dev/vda1', by-label hedefi
  fs_uuid      text,                     -- gözlemlenen
  fs_type      text,                     -- 'ext4'
  is_active    boolean not null default false,  -- YENİ yüklemeler buraya gider
  is_online    boolean not null default false,  -- açılışta doğrulandı mı
  checked_at   timestamptz,
  note         text,
  created_at   timestamptz not null default now()
);

-- Aynı anda YALNIZCA BİR etkin birim olabilir. Kısmi tekil indeks: is_active
-- olan bütün satırlar aynı anahtarı (true) paylaşır, ikincisi çakışır.
create unique index if not exists storage_volumes_single_active
  on storage_volumes ((is_active)) where is_active;

-- --- attachments: genis sahiplik -----------------------------------------
-- owner_id KASITLI OLARAK FK DEGIL — dort ayri tabloya (events, items, nodes,
-- teams) isaret edebiliyor, tek bir FK bunu karsilayamaz. Bu, events.subject_id
-- ile AYNI sekil (001_schema.sql); 007_scopes.sql zaten o karari belgeliyor.
-- Sonucu durustce soylemek gerekir: bir sahip silindiginde ek satiri artik
-- pesinden GITMIYOR (cascade yok) — hem yetim satir hem yetim blob mumkun.
-- tools/media_gc.py bu ikisini de raporlayan/temizleyen arac (baska bir ajanin
-- alani, CONTRACT-V2.md §7).
--
-- checksum YENI ve UCUZ: baytlar zaten media.save() icinde akarken hesaplanan
-- sha256 hex — NAS'a tasinirken kopya dogrulamasi icin.
create table if not exists attachments (
  id            uuid primary key default gen_random_uuid(),
  owner_type    text not null check (owner_type in ('event','item','node','team')),
  owner_id      uuid not null,
  volume_id     uuid not null references storage_volumes(id) on delete restrict,
  uploader_id   uuid references users(id) on delete set null,
  mime          text not null
                check (mime in ('image/jpeg','image/png','image/webp','image/gif')),
  byte_size     bigint not null check (byte_size > 0),
  checksum      text,                    -- sha256 hex; NAS taşımasında kopya doğrulaması
  width         integer,
  height        integer,
  original_name text,
  storage_key   text not null,
  thumb_key     text,
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  deleted_by    uuid references users(id) on delete set null,
  unique (volume_id, storage_key)
);
create index if not exists attachments_owner_idx
  on attachments(owner_type, owner_id, created_at);

-- owner_type -> owner_id eslesmesi (bugun sadece 'event' baglaniyor, digerleri
-- arayuz hazir olsun diye acildi -- CONTRACT-V2.md §1b):
--   event  -> events.id      (kart sohbeti VE takim duvari, subject_type ile ayrisir)
--   item   -> items.id       (kart ekler kutusu, spec/60 §2.4, henuz kablanmadi)
--   node   -> nodes.id       (is semalari / tanimlar, henuz kablanmadi)
--   team   -> teams.id       (henuz kablanmadi)
