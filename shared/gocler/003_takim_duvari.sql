-- Takim duvari: events.subject_type 'team' degerini kazanir
-- (spec/20-sema.md §2a ve §5, ekran spec/60-kaynak-uyarlama.md 2.5).
--
-- Ayri bir mesajlasma altyapisi KURULMAZ: kart akisiyla ayni tablo, ayni indeks
-- (events_subject_idx zaten (subject_type, subject_id, created_at)), ayni sablon.
--
-- Kisit adi 001_sema.sql'de otomatik uretildi. Once dusur sonra genis haliyle
-- geri koy: dosya yeniden kosarsa da ayni yere varir (goc idempotent kalsin).
alter table events drop constraint if exists events_subject_type_check;
alter table events add constraint events_subject_type_check
  check (subject_type in ('item','change_request','team'));
