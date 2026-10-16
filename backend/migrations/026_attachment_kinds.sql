-- Ekler: belge ve metin aileleri, amac basina sinir (spec/83).
--
-- `kind` dogrulama ve sunumu secer (gorsel inline, digerleri indirme);
-- `purpose` yuklemenin hangi uctan geldigini ve hangi sinirla kabul edildigini
-- tutar. Mevcut satirlarin hepsi sohbet/kart/profil gorseli: 'image', 'chat'.

alter table attachments
  add column kind    text not null default 'image' check (kind in ('image','document','text')),
  add column purpose text not null default 'chat'
    check (purpose in ('chat','avatar','banner','invoice','ledger'));

alter table attachments drop constraint attachments_mime_check;
alter table attachments add constraint attachments_mime_check check (mime in (
  'image/jpeg','image/png','image/webp','image/gif',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/markdown','text/plain','text/csv','text/x-python'));

-- Aile ile MIME tutarli; gorsel olmayanin kucuk resmi ve boyutu yok.
alter table attachments add constraint attachments_kind_mime
  check ((kind = 'image') = (mime like 'image/%'));
alter table attachments add constraint attachments_kind_shape
  check (kind = 'image' or (thumb_key is null and width is null and height is null));
-- Profil fotografi ve takim kapagi amaciyla yuklenen yalniz gorsel olabilir.
alter table attachments add constraint attachments_face_is_image
  check (purpose not in ('avatar','banner') or kind = 'image');
