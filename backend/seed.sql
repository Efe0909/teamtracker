-- Yerel gelistirme tohumu. VAROLAN VERIYI SILER.
-- Ilk hali tools/gen_seed.py ile Python arsivinden uretildi; arsiv kaldirildi,
-- kaynak artik BU DOSYA (elle duzenlenir). Testler basliklara bakiyor
-- ("Bütçe onayı 6 gündür bekliyor") — var olan satirlarin metnini degistirme.
-- Maliye ornekleri varsayilan acik; sabit API sozlesmesi icin psql -v seed_finance=false.
-- Ertelenmis fatura toplam denetimi icin BUTUN tohum tek islemde yuklenir.
\set ON_ERROR_STOP on
\if :{?seed_finance}
\else
\set seed_finance true
\endif
begin;
set local timezone = 'Europe/Istanbul';

-- Kokler (Birimler, Etkinlik Turleri, Etkinlik Yerleri) GOCUN (spec/74):
-- tohum yalniz Birimler'in ICINI yeniden kurar; etkinlik turleri/yerleri kalir.
-- `users` TRUNCATE edilmez: cascade `nodes`'u da (created_by FK) bosaltip
-- kokleri silerdi. Kullanicilar DELETE ile (FK kurallari: created_by null olur).
truncate teams, team_members, team_nodes, pillars, chats, records,
         record_participants, actions, cards, messages, activity,
         materials, vendors, bank_accounts, invoices, reimbursement_claims,
         ledger_entries, ledger_checks, finance_periods, budget_lines,
         recurring_expenses, fx_rates, mail_templates
  restart identity cascade;
delete from users;
delete from nodes where parent_id = (select id from nodes where key = 'units');

-- === kullanicilar ===
insert into users (id,email,name,color,is_admin,created_at) values ('075deca4-2769-59ea-ace4-039eed00ca23','efe@ekiptakip.local','Efe','#5b8cff',false,now() - interval '10 day');
insert into users (id,email,name,color,is_admin,created_at) values ('4f5c8d98-3962-5a7d-b38f-c4a7b023d676','selin@ekiptakip.local','Selin','#e5484d',true,now() - interval '9 day');
insert into users (id,email,name,color,is_admin,created_at) values ('7a995bfb-9114-538d-b999-14fa104f12a6','deniz@ekiptakip.local','Deniz','#d99a2b',false,now() - interval '8 day');
-- yetkisiz/iliskisiz kullanici senaryolari icin (hicbir dal izni yok)
insert into users (id,email,name,color,is_admin,created_at) values ('6a39d915-1ee4-44d2-b14b-323d87a5828e','ayse@ekiptakip.local','Ayşe','#2f9e8f',false,now() - interval '7 day');
insert into users (id,email,name,color,is_admin,created_at) values ('84f19ab9-1788-4761-9181-2ac9f0b7a436','mert@ekiptakip.local','Mert','#c2410c',false,now() - interval '6 day');
insert into users (id,email,name,color,is_admin,created_at) values ('8bb5cdb7-eabe-444b-bce5-350d58d623e8','zeynep@ekiptakip.local','Zeynep','#a21caf',false,now() - interval '5 day');
insert into users (id,email,name,color,is_admin,created_at) values ('f1b9e26d-3b3f-40db-a500-f25a3bd05c2c','can@ekiptakip.local','Can','#4d7c0f',false,now() - interval '4 day');
-- telefon: OTF formunda etkinlik sorumlusunun telefonu profilden gelir
update users set phone = v.phone from (values
  ('075deca4-2769-59ea-ace4-039eed00ca23'::uuid, '0532 111 22 33'),
  ('4f5c8d98-3962-5a7d-b38f-c4a7b023d676'::uuid, '0533 222 33 44'),
  ('7a995bfb-9114-538d-b999-14fa104f12a6'::uuid, '0535 333 44 55'),
  ('6a39d915-1ee4-44d2-b14b-323d87a5828e'::uuid, '0536 444 55 66'),
  ('84f19ab9-1788-4761-9181-2ac9f0b7a436'::uuid, '0537 555 66 77'),
  ('8bb5cdb7-eabe-444b-bce5-350d58d623e8'::uuid, '0538 666 77 88')
) as v(id, phone) where users.id = v.id;

-- === agac ===
insert into nodes (id,parent_id,name,node_type,sort_order) values ('a9394863-062f-5089-abd3-2a8c418fb542',(select id from nodes where key = 'units'),'Yıllık Bayi Toplantısı 2026','generic',0);
insert into nodes (id,parent_id,name,node_type,sort_order) values ('bbaee7a5-07f1-5b7d-875a-59fc6942a231','a9394863-062f-5089-abd3-2a8c418fb542','Malzeme Temini','generic',1);
insert into nodes (id,parent_id,name,node_type,sort_order) values ('57494550-15de-5aa6-9802-a5252f8f1e4a','bbaee7a5-07f1-5b7d-875a-59fc6942a231','Bütçe Onayı','step',2);
insert into nodes (id,parent_id,name,node_type,sort_order) values ('dd5ed529-e44d-54f6-afba-b218e4cbfaf8','bbaee7a5-07f1-5b7d-875a-59fc6942a231','Tedarikçi Seçimi','step',3);
insert into nodes (id,parent_id,name,node_type,sort_order) values ('06bae0c1-8cee-56db-bcfa-bdd35369822b','bbaee7a5-07f1-5b7d-875a-59fc6942a231','Sevkiyat & Teslim','step',4);
insert into nodes (id,parent_id,name,node_type,sort_order) values ('5827deb7-728d-5db6-9f39-14c104a85839','a9394863-062f-5089-abd3-2a8c418fb542','Mekan & Lojistik','generic',5);
insert into nodes (id,parent_id,name,node_type,sort_order) values ('41eee365-69dd-5754-aa3f-56db46389a7b','5827deb7-728d-5db6-9f39-14c104a85839','Salon Sözleşmesi','step',6);
insert into nodes (id,parent_id,name,node_type,sort_order) values ('8faf733b-1edf-5a47-ae49-21ae9e0aff78','5827deb7-728d-5db6-9f39-14c104a85839','Ulaşım & Konaklama','step',7);
insert into nodes (id,parent_id,name,node_type,sort_order) values ('3db083eb-480d-5074-a404-3ccaef898c23','a9394863-062f-5089-abd3-2a8c418fb542','İletişim & Tanıtım','generic',8);
insert into nodes (id,parent_id,name,node_type,sort_order) values ('e808326b-48df-5fb9-8fe5-91e41393c264',(select id from nodes where key = 'units'),'Üretim Hattı A','cell',9);
insert into nodes (id,parent_id,name,node_type,sort_order) values ('cb696ac4-63d5-5367-910e-029cc36793ef','e808326b-48df-5fb9-8fe5-91e41393c264','Dolum Makinesi','machine',10);
insert into nodes (id,parent_id,name,node_type,sort_order) values ('dfdd0adf-007d-5313-8641-4d93eab19700','cb696ac4-63d5-5367-910e-029cc36793ef','Kapak Ünitesi','machine',11);
insert into nodes (id,parent_id,name,node_type,sort_order) values ('47faa240-5071-59ad-95c3-4660ae2ff476','cb696ac4-63d5-5367-910e-029cc36793ef','Etiketleme Ünitesi','machine',12);

-- === dal izinleri (v1: users.scope_node_id) ===
insert into user_node_scopes (user_id,node_id) values ('075deca4-2769-59ea-ace4-039eed00ca23','bbaee7a5-07f1-5b7d-875a-59fc6942a231');
insert into user_scopes (user_id,scope) values ('075deca4-2769-59ea-ace4-039eed00ca23','edit_nodes');
insert into user_node_scopes (user_id,node_id) values ('7a995bfb-9114-538d-b999-14fa104f12a6','e808326b-48df-5fb9-8fe5-91e41393c264');
insert into user_scopes (user_id,scope) values ('7a995bfb-9114-538d-b999-14fa104f12a6','edit_nodes');

-- === takimlar (her birine bir chats satiri) ===
insert into chats (id) values ('83bcd37e-650a-5353-9e33-67d5cebd01e4');
insert into teams (id,name,description,chat_id,color) values ('2ebfe4f2-d0cc-5e82-9579-059601fe9275','Tasarım','Görsel üretim: afiş, sosyal medya, sahne tasarımı.','83bcd37e-650a-5353-9e33-67d5cebd01e4','#8e6bff');
insert into chats (id) values ('3673b099-afa3-5af3-bedb-d9834935206f');
insert into teams (id,name,description,chat_id,color) values ('b7d5cc5f-ef59-594b-a67a-6a356fd372f3','Maliye','Bütçe, onay akışları ve ödemeler.','3673b099-afa3-5af3-bedb-d9834935206f','#1c8a5b');
insert into chats (id) values ('19a11e32-eeac-511e-bb5a-3bced961cd5a');
insert into teams (id,name,description,chat_id,color) values ('fc8b1cd5-7c9f-53c6-a2cc-978a9bec79a5','Satın Alım','Tedarikçi seçimi, sözleşme ve sevkiyat takibi.','19a11e32-eeac-511e-bb5a-3bced961cd5a','#b4501a');
insert into team_members (team_id,user_id,role) values ('2ebfe4f2-d0cc-5e82-9579-059601fe9275','075deca4-2769-59ea-ace4-039eed00ca23','lead');
insert into team_members (team_id,user_id,role) values ('2ebfe4f2-d0cc-5e82-9579-059601fe9275','4f5c8d98-3962-5a7d-b38f-c4a7b023d676','mentor');
insert into team_members (team_id,user_id,role) values ('b7d5cc5f-ef59-594b-a67a-6a356fd372f3','4f5c8d98-3962-5a7d-b38f-c4a7b023d676','lead');
insert into team_members (team_id,user_id,role) values ('b7d5cc5f-ef59-594b-a67a-6a356fd372f3','075deca4-2769-59ea-ace4-039eed00ca23','member');
insert into team_members (team_id,user_id,role) values ('fc8b1cd5-7c9f-53c6-a2cc-978a9bec79a5','7a995bfb-9114-538d-b999-14fa104f12a6','member');
insert into team_members (team_id,user_id,role) values ('fc8b1cd5-7c9f-53c6-a2cc-978a9bec79a5','075deca4-2769-59ea-ace4-039eed00ca23','member');
-- Ayse Tasarim, Mert Satin Alim, Zeynep Maliye; Can takimsiz (yeni gelen)
insert into team_members (team_id,user_id,role) values ('2ebfe4f2-d0cc-5e82-9579-059601fe9275','6a39d915-1ee4-44d2-b14b-323d87a5828e','member');
insert into team_members (team_id,user_id,role) values ('fc8b1cd5-7c9f-53c6-a2cc-978a9bec79a5','84f19ab9-1788-4761-9181-2ac9f0b7a436','lead');
insert into team_members (team_id,user_id,role) values ('b7d5cc5f-ef59-594b-a67a-6a356fd372f3','8bb5cdb7-eabe-444b-bce5-350d58d623e8','member');

-- === takim <-> agac baglari (team_nodes, spec/22) ===
insert into team_nodes (team_id,node_id) values ('b7d5cc5f-ef59-594b-a67a-6a356fd372f3','57494550-15de-5aa6-9802-a5252f8f1e4a');
insert into team_nodes (team_id,node_id) values ('fc8b1cd5-7c9f-53c6-a2cc-978a9bec79a5','dd5ed529-e44d-54f6-afba-b218e4cbfaf8');
insert into team_nodes (team_id,node_id) values ('fc8b1cd5-7c9f-53c6-a2cc-978a9bec79a5','06bae0c1-8cee-56db-bcfa-bdd35369822b');
insert into team_nodes (team_id,node_id) values ('2ebfe4f2-d0cc-5e82-9579-059601fe9275','3db083eb-480d-5074-a404-3ccaef898c23');

-- === pillar'lar (her birinin OZEL takimi + sohbeti) ===
insert into chats (id) values ('e06edac5-43c7-54fe-bb16-709e29993e6c');
insert into teams (id,name,description,chat_id,color) values ('d615f71d-4e38-5eb1-b9ec-fa10341c9d16','Güvenlik','İş güvenliği pillar''ı.','e06edac5-43c7-54fe-bb16-709e29993e6c','#d13350');
insert into pillars (id,name,description,color,team_id,sort_order) values ('d8f95951-d7a9-51a0-9010-0aa28a8115c8','Güvenlik','İş güvenliği pillar''ı.','#d13350','d615f71d-4e38-5eb1-b9ec-fa10341c9d16',0);
insert into chats (id) values ('f8d3a04f-804f-5813-85bc-6bdd53c0f89b');
insert into teams (id,name,description,chat_id,color) values ('5aaca90a-6a2c-5366-8b7d-4af9b8039dc2','Kalite','Kalite pillar''ı.','f8d3a04f-804f-5813-85bc-6bdd53c0f89b','#2c74ad');
insert into pillars (id,name,description,color,team_id,sort_order) values ('b3ee4ed6-ec9c-52ff-8cd4-326d0d6e31dc','Kalite','Kalite pillar''ı.','#2c74ad','5aaca90a-6a2c-5366-8b7d-4af9b8039dc2',1);
insert into team_members (team_id,user_id,role) values ('d615f71d-4e38-5eb1-b9ec-fa10341c9d16','7a995bfb-9114-538d-b999-14fa104f12a6','lead');
insert into team_members (team_id,user_id,role) values ('d615f71d-4e38-5eb1-b9ec-fa10341c9d16','4f5c8d98-3962-5a7d-b38f-c4a7b023d676','member');
insert into team_members (team_id,user_id,role) values ('5aaca90a-6a2c-5366-8b7d-4af9b8039dc2','075deca4-2769-59ea-ace4-039eed00ca23','lead');
insert into team_members (team_id,user_id,role) values ('5aaca90a-6a2c-5366-8b7d-4af9b8039dc2','7a995bfb-9114-538d-b999-14fa104f12a6','mentor');

-- === kayitlar ===
-- records.chat_id NOT NULL: sohbet kayitla AYNI islemde dogar.
insert into chats (id) values ('fb54605c-bdd8-5c5b-9415-a1b83d9eedd8');
insert into records (id,unit_id,team_id,chat_id,kind,title,description,status,priority,owner_id,created_by,due_date,created_at,updated_at) values ('556094c3-7ade-5964-988d-a848ac5778ef','57494550-15de-5aa6-9802-a5252f8f1e4a','b7d5cc5f-ef59-594b-a67a-6a356fd372f3','fb54605c-bdd8-5c5b-9415-a1b83d9eedd8','issue','Bütçe onayı 6 gündür bekliyor','Finans departmanı onay vermeden tedarikçi ile sözleşme imzalanamıyor. Zincirin tamamı bekliyor.','open','critical','7a995bfb-9114-538d-b999-14fa104f12a6','4f5c8d98-3962-5a7d-b38f-c4a7b023d676',date '2026-09-04',timestamptz '2026-09-08T04:31:03.408342+00:00',timestamptz '2026-09-20T04:11:03.408439+00:00');
insert into record_participants (record_id,user_id) values ('556094c3-7ade-5964-988d-a848ac5778ef','7a995bfb-9114-538d-b999-14fa104f12a6');
insert into record_participants (record_id,user_id) values ('556094c3-7ade-5964-988d-a848ac5778ef','4f5c8d98-3962-5a7d-b38f-c4a7b023d676');
insert into record_participants (record_id,user_id) values ('556094c3-7ade-5964-988d-a848ac5778ef','075deca4-2769-59ea-ace4-039eed00ca23');
insert into chats (id) values ('37d08cb0-acd8-548e-918c-8429c64c5bee');
insert into records (id,unit_id,team_id,chat_id,kind,title,description,status,priority,owner_id,created_by,due_date,created_at,updated_at) values ('9305276f-2d38-518a-adb9-ef4cbca5051b','06bae0c1-8cee-56db-bcfa-bdd35369822b','fc8b1cd5-7c9f-53c6-a2cc-978a9bec79a5','37d08cb0-acd8-548e-918c-8429c64c5bee','issue','Sevkiyat tarihi etkinlikten sonraya düşüyor','Tedarikçi teslim tarihi 3 Eylül; etkinlik 28 Ağustos.','in_progress','critical','075deca4-2769-59ea-ace4-039eed00ca23','075deca4-2769-59ea-ace4-039eed00ca23',date '2026-09-10',timestamptz '2026-09-09T04:31:03.408442+00:00',timestamptz '2026-09-20T01:31:03.408443+00:00');
insert into record_participants (record_id,user_id) values ('9305276f-2d38-518a-adb9-ef4cbca5051b','075deca4-2769-59ea-ace4-039eed00ca23');
insert into record_participants (record_id,user_id) values ('9305276f-2d38-518a-adb9-ef4cbca5051b','4f5c8d98-3962-5a7d-b38f-c4a7b023d676');
insert into chats (id) values ('9347d7b4-42b1-582a-a88f-0408878c2309');
insert into records (id,unit_id,team_id,chat_id,kind,title,description,status,priority,owner_id,created_by,due_date,created_at,updated_at) values ('e7819ffb-890e-57cf-a535-a34db36d5af3','dfdd0adf-007d-5313-8641-4d93eab19700',null,'9347d7b4-42b1-582a-a88f-0408878c2309','task','Kapak Ünitesi — tekrar eden kayıp','3 DMS kaydından açıldı. Tekrar eden duruş, LE''ye taşınması değerlendiriliyor.','pending','high','7a995bfb-9114-538d-b999-14fa104f12a6','4f5c8d98-3962-5a7d-b38f-c4a7b023d676',null,timestamptz '2026-09-12T04:31:03.408444+00:00',timestamptz '2026-09-19T23:31:03.408445+00:00');
insert into record_participants (record_id,user_id) values ('e7819ffb-890e-57cf-a535-a34db36d5af3','7a995bfb-9114-538d-b999-14fa104f12a6');
insert into chats (id) values ('d369df23-d89b-54e9-a6b2-8734060bc43f');
insert into records (id,unit_id,team_id,chat_id,kind,title,description,status,priority,owner_id,created_by,due_date,created_at,updated_at) values ('f78ab92f-f2a8-5002-ad5b-2abc9c2d3589','57494550-15de-5aa6-9802-a5252f8f1e4a','b7d5cc5f-ef59-594b-a67a-6a356fd372f3','d369df23-d89b-54e9-a6b2-8734060bc43f','task','Onay akışına vekalet mekanizması ekle','CFO izindeyken onay zinciri duruyor; vekalet tanımı gerekiyor.','in_progress','medium','075deca4-2769-59ea-ace4-039eed00ca23','4f5c8d98-3962-5a7d-b38f-c4a7b023d676',null,timestamptz '2026-09-14T04:31:03.408446+00:00',timestamptz '2026-09-19T02:31:03.408446+00:00');
insert into record_participants (record_id,user_id) values ('f78ab92f-f2a8-5002-ad5b-2abc9c2d3589','075deca4-2769-59ea-ace4-039eed00ca23');
insert into record_participants (record_id,user_id) values ('f78ab92f-f2a8-5002-ad5b-2abc9c2d3589','4f5c8d98-3962-5a7d-b38f-c4a7b023d676');
insert into chats (id) values ('77a5053c-6b77-58a0-a6f8-4d890a9787ff');
insert into records (id,unit_id,team_id,chat_id,kind,title,description,status,priority,owner_id,created_by,due_date,created_at,updated_at) values ('2e1b1635-e910-5381-94c7-6779396b5de0','dd5ed529-e44d-54f6-afba-b218e4cbfaf8','fc8b1cd5-7c9f-53c6-a2cc-978a9bec79a5','77a5053c-6b77-58a0-a6f8-4d890a9787ff','issue','Tedarikçi teklifleri karşılaştırılamıyor','Üç teklif farklı formatta geldi; kıyas tablosu çıkarılamıyor.','open','medium','075deca4-2769-59ea-ace4-039eed00ca23','075deca4-2769-59ea-ace4-039eed00ca23',null,timestamptz '2026-09-13T04:31:03.408447+00:00',timestamptz '2026-09-18T04:31:03.408448+00:00');
insert into record_participants (record_id,user_id) values ('2e1b1635-e910-5381-94c7-6779396b5de0','075deca4-2769-59ea-ace4-039eed00ca23');

-- === kayit <-> pillar (ortogonal) ===
update records set pillar_id = 'd8f95951-d7a9-51a0-9010-0aa28a8115c8' where id = '9305276f-2d38-518a-adb9-ef4cbca5051b';
update records set pillar_id = 'b3ee4ed6-ec9c-52ff-8cd4-326d0d6e31dc' where id = 'e7819ffb-890e-57cf-a535-a34db36d5af3';
update records set pillar_id = 'b3ee4ed6-ec9c-52ff-8cd4-326d0d6e31dc' where id = '2e1b1635-e910-5381-94c7-6779396b5de0';

-- === eylemler ===
insert into actions (record_id,title,created_by,status,due_date,created_at) values ('556094c3-7ade-5964-988d-a848ac5778ef','CFO vekalet onayını IT üzerinden tamamlat','4f5c8d98-3962-5a7d-b38f-c4a7b023d676','open',date '2026-09-22',timestamptz '2026-09-09T04:31:03.408452+00:00');
insert into actions (record_id,title,created_by,status,due_date,created_at) values ('556094c3-7ade-5964-988d-a848ac5778ef','Tedarikçiden fiyat kilidi uzatması iste','4f5c8d98-3962-5a7d-b38f-c4a7b023d676','in_progress',date '2026-09-19',timestamptz '2026-09-10T04:31:03.408454+00:00');
insert into actions (record_id,title,created_by,status,due_date,created_at) values ('2e1b1635-e910-5381-94c7-6779396b5de0','Teklifleri tek şablona geçir','075deca4-2769-59ea-ace4-039eed00ca23','closed',null,timestamptz '2026-09-14T04:31:03.408454+00:00');
insert into actions (record_id,title,created_by,status,due_date,created_at) values ('9305276f-2d38-518a-adb9-ef4cbca5051b','Alternatif kargo firmalarından süre al','075deca4-2769-59ea-ace4-039eed00ca23','open',date '2026-09-24',timestamptz '2026-09-18T04:31:03.408455+00:00');
-- atananlar (birden fazla kisi olabilir; sonuncusu havuzda)
insert into action_assignees (action_id, user_id)
select a.id, v.u::uuid from actions a join (values
  ('CFO vekalet onayını IT üzerinden tamamlat', '7a995bfb-9114-538d-b999-14fa104f12a6'),
  ('Tedarikçiden fiyat kilidi uzatması iste', '075deca4-2769-59ea-ace4-039eed00ca23'),
  ('Teklifleri tek şablona geçir', '075deca4-2769-59ea-ace4-039eed00ca23')) as v(t, u) on v.t = a.title;

-- === sohbet ve gunluk ===
-- events BOLUNDU: konusma -> messages, denetim -> activity (spec §5, §6).
insert into activity (chat_id,actor_id,verb,subject_label,detail,created_at) values ('fb54605c-bdd8-5c5b-9415-a1b83d9eedd8','4f5c8d98-3962-5a7d-b38f-c4a7b023d676','note','Bütçe onayı 6 gündür bekliyor','Selin bu hatayı açtı ve Deniz''e atadı',timestamptz '2026-09-08T04:31:03.408456+00:00');
insert into messages (chat_id,author_id,body,created_at) values ('fb54605c-bdd8-5c5b-9415-a1b83d9eedd8','4f5c8d98-3962-5a7d-b38f-c4a7b023d676','Deniz, finanstan dönüş var mı? Tedarikçi fiyat kilidi cuma bitiyor.',timestamptz '2026-09-08T04:39:03.408457+00:00');
insert into messages (chat_id,author_id,body,created_at) values ('fb54605c-bdd8-5c5b-9415-a1b83d9eedd8','7a995bfb-9114-538d-b999-14fa104f12a6','CFO izinde, vekaleten onay için IT''den yetki devri istedim.',timestamptz '2026-09-09T07:31:03.408458+00:00');
insert into activity (chat_id,actor_id,verb,subject_label,detail,created_at) values ('fb54605c-bdd8-5c5b-9415-a1b83d9eedd8',null,'note','Bütçe onayı 6 gündür bekliyor','Durum "Açık" olarak kaldı — 3 gündür hareket yok',timestamptz '2026-09-11T04:31:03.408458+00:00');
insert into messages (chat_id,author_id,body,created_at) values ('fb54605c-bdd8-5c5b-9415-a1b83d9eedd8','075deca4-2769-59ea-ace4-039eed00ca23','Bu bir DH kaydı ama üçüncü tekrar. Kapak Ünitesi''ndeki gibi LE''ye taşıyalım mı?',timestamptz '2026-09-20T04:11:03.408459+00:00');
insert into activity (chat_id,actor_id,verb,subject_label,detail,created_at) values ('37d08cb0-acd8-548e-918c-8429c64c5bee','075deca4-2769-59ea-ace4-039eed00ca23','note','Sevkiyat tarihi etkinlikten sonraya düşüyor','Efe bu hatayı açtı',timestamptz '2026-09-09T04:31:03.408459+00:00');
insert into messages (chat_id,author_id,body,created_at) values ('37d08cb0-acd8-548e-918c-8429c64c5bee','075deca4-2769-59ea-ace4-039eed00ca23','Bu aslında bütçe onayının türevi; zinciri o tutuyor.',timestamptz '2026-09-20T01:31:03.408460+00:00');
insert into activity (chat_id,actor_id,verb,subject_label,detail,created_at) values ('9347d7b4-42b1-582a-a88f-0408878c2309','4f5c8d98-3962-5a7d-b38f-c4a7b023d676','note','Kapak Ünitesi — tekrar eden kayıp','Selin bu görevi açtı ve Deniz''e atadı',timestamptz '2026-09-12T04:31:03.408460+00:00');
insert into messages (chat_id,author_id,body,created_at) values ('9347d7b4-42b1-582a-a88f-0408878c2309','7a995bfb-9114-538d-b999-14fa104f12a6','3 DMS kaydından açıldı, kök neden analizi bekliyor.',timestamptz '2026-09-19T23:31:03.408461+00:00');
insert into messages (chat_id,author_id,body,created_at) values ('d369df23-d89b-54e9-a6b2-8734060bc43f','4f5c8d98-3962-5a7d-b38f-c4a7b023d676','Standart şablon hazırlıyorum.',timestamptz '2026-09-19T02:31:03.408462+00:00');
insert into messages (chat_id,author_id,body,created_at) values ('77a5053c-6b77-58a0-a6f8-4d890a9787ff','075deca4-2769-59ea-ace4-039eed00ca23','Üç teklif farklı formatta geldi.',timestamptz '2026-09-18T04:31:03.408462+00:00');
insert into messages (chat_id,author_id,body,created_at) values ('3673b099-afa3-5af3-bedb-d9834935206f','4f5c8d98-3962-5a7d-b38f-c4a7b023d676','Bu hafta önceliğimiz bütçe onayı; vekalet çıkmazsa cuma eskale ediyoruz.',timestamptz '2026-09-18T04:31:03.408463+00:00');
insert into messages (chat_id,author_id,body,created_at) values ('3673b099-afa3-5af3-bedb-d9834935206f','075deca4-2769-59ea-ace4-039eed00ca23','Fiyat kilidi için tedarikçiyle konuştum, bir hafta daha var.',timestamptz '2026-09-19T00:31:03.408464+00:00');
insert into messages (chat_id,author_id,body,created_at) values ('19a11e32-eeac-511e-bb5a-3bced961cd5a','075deca4-2769-59ea-ace4-039eed00ca23','Alternatif kargo tekliflerini bugün topluyorum, akşam buraya bırakırım.',timestamptz '2026-09-19T22:31:03.408464+00:00');
insert into messages (chat_id,author_id,body,created_at) values ('83bcd37e-650a-5353-9e33-67d5cebd01e4','4f5c8d98-3962-5a7d-b38f-c4a7b023d676','Afiş taslakları hazır; ölçüler için Efe''den dönüş bekliyorum.',timestamptz '2026-09-17T04:31:03.408465+00:00');

-- === maliye: etkinliksiz kalem + teklifler (acilistaki tedarikci geri doldurmasini dener) ===
delete from materials where name = 'Koli bandı';
with m as (
  insert into materials (name, state, category_id, needed_by)
  values ('Koli bandı', 3, (select id from nodes where node_type = 'category' order by sort_order limit 1), current_date + 5)
  returning id)
insert into material_providers (material_id, contact, name, price)
  select id, 'Matbaa Ekin', null, 120 from m
  union all select id, '0212 555 01 42', 'Kesimhane Ltd', 90 from m
  union all select id, '0532 000 00 00', null, 80 from m;

\if :seed_finance

-- === maliye: iliskili gelistirme senaryolari (spec/81) ===
-- Tarihler bugune gore kayar; duvar ve yaklasan odemeler zamanla bosalmaz.
-- Kimlikler kararli, yardimcilar yalniz bu psql oturumunda yasar.
create function pg_temp.seed_id(key text) returns uuid language sql immutable as $$
  select md5('finance-seed:' || key)::uuid
$$;
create function pg_temp.seed_user(handle text) returns uuid language sql stable as $$
  select id from users where email = handle || '@ekiptakip.local'
$$;
create function pg_temp.seed_category(category_order integer) returns uuid language sql stable as $$
  select id from nodes where parent_id = (select id from nodes where key = 'budget_categories')
    and sort_order = category_order and node_type = 'category'
$$;

-- Zeynep maliyenin tamamini, Mert tedarigi kullanir; Deniz yetkisiz uye kalir.
insert into user_scopes (user_id, scope) values
  (pg_temp.seed_user('zeynep'), 'review_purchases'),
  (pg_temp.seed_user('zeynep'), 'manage_budgets'),
  (pg_temp.seed_user('zeynep'), 'manage_ledger'),
  (pg_temp.seed_user('zeynep'), 'manage_purchases'),
  (pg_temp.seed_user('mert'), 'manage_purchases');

-- Sentetik, mod-97 saglamasi gecerli IBAN'lar; gercek kisi hesabi degildir.
insert into bank_accounts (id, user_id, label, holder_name, iban, iban_last4, is_default)
select pg_temp.seed_id('account:' || handle), pg_temp.seed_user(handle),
       'Deneme hesabı', holder, iban, right(iban, 4), true
from (values ('efe', 'Efe', 'TR200000000000000000000001'),
             ('selin', 'Selin', 'TR900000000000000000000002'),
             ('ayse', 'Ayşe', 'TR630000000000000000000003'),
             ('mert', 'Mert', 'TR360000000000000000000004'),
             ('zeynep', 'Zeynep', 'TR090000000000000000000005')) as v(handle, holder, iban);

insert into vendors (id, name, name_key, contact, phone, email, url, issues_invoice, note, created_by) values
  (pg_temp.seed_id('vendor:print'), 'Ekin Matbaa', 'ekin matbaa', 'Baskı birimi',
   '0212 555 01 42', 'baski@ekin.example', 'https://ekin.example', true,
   'Renk provası istenir. Teklif tutarları toplam sipariş bedelidir.', pg_temp.seed_user('mert')),
  (pg_temp.seed_id('vendor:tech'), 'Kampüs Elektronik', 'elektronik kampus', 'Teknik satış',
   '0216 555 02 20', 'satis@kampus.example', 'https://kampus.example', true,
   'Dövizli ekipman ve atölye parçaları.', pg_temp.seed_user('mert')),
  (pg_temp.seed_id('vendor:office'), 'Ada Kırtasiye', 'ada kirtasiye', 'Kurumsal satış',
   '0212 555 03 30', 'siparis@ada.example', null, true,
   'Sarf malzemelerinde haftalık teslimat.', pg_temp.seed_user('mert')),
  (pg_temp.seed_id('vendor:catering'), 'Kampüs İkram', 'ikram kampus', 'Etkinlik servisi',
   '0532 555 04 40', null, null, false,
   'Fatura kesmiyor; sipariş öncesinde belge durumu teyit edilmeli.', pg_temp.seed_user('zeynep')),
  (pg_temp.seed_id('vendor:stage'), 'Sahne Atölyesi', 'atolyesi sahne', 'Organizasyon',
   null, 'etkinlik@sahne.example', 'https://sahne.example', null,
   'Fatura bilgisi henüz doğrulanmadı.', pg_temp.seed_user('mert'));

-- Onceki, icinde bulunulan ve sonraki alti aylik donem; cakisma yok.
create temporary table seed_periods on commit drop as
select key, start_on, end_on from (values
  ('previous', date_trunc('month', current_date)::date - interval '6 months', date_trunc('month', current_date)::date),
  ('current', date_trunc('month', current_date)::date, date_trunc('month', current_date)::date + interval '6 months'),
  ('next', date_trunc('month', current_date)::date + interval '6 months', date_trunc('month', current_date)::date + interval '12 months')
) as v(key, start_on, end_on);
insert into finance_periods (id, name, span)
select pg_temp.seed_id('period:' || key),
       case key when 'previous' then 'Önceki dönem' when 'current' then 'Güncel dönem' else 'Gelecek dönem' end
         || ' · ' || to_char(start_on, 'YYYY-MM'), daterange(start_on::date, end_on::date, '[)')
from seed_periods;

-- Etkinliklerin ikiz kayitlari ve satin alim widget'lari gercek backend kalibinda.
create temporary table seed_events (
  key text primary key, title text, kind_order integer, status text,
  day date, owner_handle text, attendees integer
) on commit drop;
insert into seed_events values
  ('welcome', 'Kulübe hoş geldin buluşması', 4, 'done',
   (date_trunc('month', current_date) - interval '2 months')::date + 10, 'ayse', 120),
  ('workshop', 'Elektronik atölyesi', 1, 'done', current_date - 12, 'efe', 30),
  ('meetup', 'Üye tanışma akşamı', 2, 'done', current_date - 7, 'mert', 60),
  ('fair', 'Kampüs bilim şenliği', 4, 'confirmed', current_date + 18, 'selin', 200),
  ('visit', 'Teknoloji merkezi gezisi', 3, 'planning', current_date + 70, 'mert', 25);
insert into chats (id) select pg_temp.seed_id('chat:' || key) from seed_events;
insert into records (id, unit_id, chat_id, kind, title, description, status, owner_id, created_by)
select pg_temp.seed_id('record:' || key), 'a9394863-062f-5089-abd3-2a8c418fb542',
       pg_temp.seed_id('chat:' || key), 'task', title,
       'Etkinliğin satın alımları, faturaları ve bütçe takibi bu kayıtta bir araya gelir.',
       case when status = 'done' then 'closed' else 'open' end,
       pg_temp.seed_user(owner_handle), pg_temp.seed_user(owner_handle)
from seed_events;
insert into events (id, record_id, title, kind_id, status, owner_id, date, place, attendees, description, created_by)
select pg_temp.seed_id('event:' || e.key), pg_temp.seed_id('record:' || e.key), e.title, n.id, e.status,
       pg_temp.seed_user(e.owner_handle), e.day, 'Kampüs etkinlik alanı', e.attendees,
       'Maliye örneği: etkinliğe bağlı alımlar ve SEB iade dosyası birlikte izlenir.', pg_temp.seed_user(e.owner_handle)
from seed_events e join nodes n on n.parent_id = (select id from nodes where key = 'event_types')
  and n.sort_order = e.kind_order;
insert into event_participants (event_id, user_id, role)
select pg_temp.seed_id('event:' || key), pg_temp.seed_user(owner_handle), 'Etkinlik sorumlusu' from seed_events;
insert into record_participants (record_id, user_id)
select pg_temp.seed_id('record:' || key), pg_temp.seed_user(owner_handle) from seed_events;
insert into event_teams (event_id, team_id)
select pg_temp.seed_id('event:' || key), 'b7d5cc5f-ef59-594b-a67a-6a356fd372f3' from seed_events;
insert into event_widgets (event_id, widget_type, position)
select pg_temp.seed_id('event:' || key), 'supplies', 0 from seed_events;

-- Kategori: 0 sponsorluk, 1 demirbas, 2 promosyon (SEB), 3 etkinlik, 4 sarf (genel).
-- Teklif fiyatlari birim degil TOPLAM; backend qty ile tekrar carpmaz.
create temporary table seed_materials (
  key text primary key, name text, category_order integer, event_key text,
  type text, qty integer, state smallint, due date, budget numeric,
  price numeric, vendor_key text, notes text
) on commit drop;
insert into seed_materials values
  ('welcome-print', 'Karşılama afişleri', 2, 'welcome', 'consumable', 60, 3, null, 2500, 2400, 'print', 'SEB iadesi geldi; üyeye ödeme kısmen yapıldı.'),
  ('workshop-parts', 'Atölye elektronik kitleri', 1, 'workshop', 'equipment', 15, 3, null, 3000, 3159.38, 'tech', '75 USD; kur fatura gününde sabitlendi.'),
  ('meetup-food', 'Tanışma akşamı ikramı', 3, 'meetup', 'service', 60, 3, null, 1000, 950, 'catering', 'Kulüp kasasından ödendi, SEB dosyasına girmez.'),
  ('meetup-badges', 'Üye yaka kartları', 2, 'meetup', 'consumable', 60, 3, null, 600, 620, 'print', 'Etkinlik iade dosyası gönderildi.'),
  ('office-stickers', 'Kulüp tanıtım stickerları', 2, null, 'consumable', 300, 3, current_date - 3, 1300, 1200, 'print', 'Genel fonlu sarfla aynı faturada.'),
  ('office-folders', 'Evrak klasörleri', 4, null, 'consumable', 10, 3, current_date - 3, 500, 500, 'office', 'Karma faturanın hemen ödenebilir genel payı.'),
  ('office-toner', 'Yazıcı toneri', 4, null, 'consumable', 1, 3, current_date - 5, 900, 850, 'office', 'Üye ödedi; 350 TL geri ödendi.'),
  ('office-archive', 'Geçen ayın tanıtım baskıları', 2, null, 'consumable', 100, 3,
   (date_trunc('month', current_date) - interval '1 month')::date + 8, 2000, 1800, 'print', 'Geçen ayın gönderilmiş dosyasında.'),
  ('equipment-archive', 'USB ses arabirimi', 1, null, 'equipment', 1, 3,
   (date_trunc('month', current_date) - interval '2 months')::date + 5, 1900, 1810, 'tech', '40 EUR; SEB beklenenden az iade etti.'),
  ('unfiled-print', 'Ek tanıtım broşürleri', 0, null, 'consumable', 100, 3, current_date - 2, 750, 720, 'print', 'Onaylı fakat dosyasız; Genel ekranında uyarı üretir.'),
  ('fair-print', 'Bilim şenliği stant panosu', 0, 'fair', 'consumable', 2, 3, null, 1500, 1400, 'print', 'Aylık taslaktan etkinlik dosyasına taşınabilir.'),
  ('fair-lanyards', 'Şenlik boyun askıları', 2, 'fair', 'consumable', 100, 3, null, 2000, 1800, 'print', 'Fatura onay bekliyor.'),
  ('fair-badges', 'Şenlik katılımcı kartları', 2, 'fair', 'consumable', 100, 3, null, 800, 700, 'print', 'Boyun askılarıyla aynı faturada.'),
  ('office-tools', 'Havya uç seti', 1, null, 'equipment', 1, 3, current_date - 4, 1100, 1126.73, 'tech', 'Düzeltilip yeniden gönderildi; 24,90 EUR.'),
  ('fair-deposit', 'Şenlik alanı kurulum hizmeti', 3, 'fair', 'service', 1, 3, null, 3500, 3200, 'stage', 'Kulüp ödemesi; onaydan sonra kasa gideri oluşur.'),
  ('office-receipt', 'Atölye temizlik malzemeleri', 4, null, 'consumable', 6, 3, current_date - 6, 450, 430, 'office', 'Fatura bilgisi için düzeltme istendi.'),
  ('office-personal', 'Kişisel kullanım aksesuarı', 4, null, 'equipment', 1, 3, current_date - 8, 1000, 990, 'tech', 'Kulüp harcaması olmadığı için reddedildi.'),
  ('office-duplicate', 'Yedek temizlik paketi', 4, null, 'consumable', 6, 3, current_date - 5, 450, 430, 'office', 'Gönderen mükerrer faturayı geri çekti.'),
  ('cancelled-cable', 'İade edilen uzatma kablosu', 1, null, 'equipment', 1, 3, current_date - 9, 1300, 1250, 'tech', 'Onay sonrası iptal; kasa gideri ters kayıtla kapandı.'),
  ('fair-projector', 'Projeksiyon kiralama', 3, 'fair', 'service', 1, 3, null, 5000, 6500, 'stage', 'Onaylı, alınacak; yüzde 30 bütçe aşımı.'),
  ('fair-stage', 'Sahne ses sistemi', 3, 'fair', 'service', 1, 2, null, 3000, 5400, 'stage', 'Teklif aşamasında; yüksek bütçe aşımı.'),
  ('fair-posters', 'Yönlendirme tabelaları', 2, 'fair', 'consumable', 20, 1, null, 800, null, null, 'Tedarikçi teklifleri henüz gelmedi.'),
  ('fair-stream', 'Canlı yayın hizmeti', 3, 'fair', 'service', 1, 0, null, null, null, null, 'Yeni ihtiyaç; bütçe ve teklif yok.'),
  ('office-paper', 'A4 fotokopi kâğıdı', 4, null, 'consumable', 5, 3, current_date + 5, 800, 600, 'office', 'Etkinliksiz, bütçenin altında, alınacak.'),
  ('storage-rack', 'Gezi ekipmanı taşıma rafı', 1, 'visit', 'equipment', 1, 3, null, 1000, 1800, 'tech', 'Yetmiş gün sonraki gezi için; yaklaşan ödemelerde henüz görünmez.'),
  ('sponsor-water', 'Sponsor destekli içme suyu', 0, 'fair', 'consumable', 120, 3, null, 1500, null, null, 'Sponsor seçili; kasaya taahhüt sıfır.'),
  ('owned-speaker', 'Depodaki taşınabilir hoparlör', 1, 'fair', 'equipment', 1, 0, null, null, null, null, 'Zaten var; satın alım kuyruklarına girmez.'),
  ('undated-repair', 'Depo ekipmanı bakım hizmeti', 3, null, 'service', 1, 3, null, 2500, 2400, 'stage', 'Tarihsiz onaylı kalem; ihtiyaç tarihi sonradan girilecek.'),
  ('office-desk', 'Kulüp odası çalışma masası', 1, null, 'equipment', 1, 0, current_date + 14, null, null, null, 'Duvar: ihtiyaç yeni açıldı, bütçe ve teklif yok.'),
  ('office-labels', 'Dolap etiketleri', 4, null, 'consumable', 40, 1, current_date + 8, 300, null, null, 'Duvar: teklifler bekleniyor.'),
  ('office-banner', 'Kulüp odası tanıtım afişi', 2, null, 'consumable', 2, 2, current_date + 10, 1000, 1300, 'print', 'Duvar: teklif geldi, bütçe onayı bekleniyor.'),
  ('office-cabinet', 'Arşiv dolabı', 1, null, 'equipment', 1, 3, current_date + 70, 4000, 6500, 'tech', 'Duvar: varsayılan aralık dışında, yüksek bütçe aşımı.'),
  ('office-adapter', 'Sunum adaptörü', 1, null, 'equipment', 1, 3, current_date + 2, 2000, 1850, 'tech', 'Maliye satın alındı işaretledi; teslimat ve fatura bekleniyor.');
insert into materials (id, name, category_id, type, qty, state, needed_by, budget, notes, priority,
                       has_sponsor, sponsor_chosen, sponsor_qty, sponsor_date, in_sponsor_record, owned, created_by, created_at)
select pg_temp.seed_id('material:' || key), name, pg_temp.seed_category(category_order), type, qty, state, due, budget, notes,
       case when key = 'office-adapter' then 'critical' when key = 'fair-projector' then 'high' else 'medium' end,
       key = 'sponsor-water', key = 'sponsor-water',
       case when key = 'sponsor-water' then qty end,
       case when key = 'sponsor-water' then current_date + 15 end,
       false, key = 'owned-speaker', pg_temp.seed_user('mert'),
       least(now() - interval '30 days',
         (coalesce(due, (select day from seed_events e where e.key = event_key), current_date) - 14)::timestamptz)
from seed_materials;
insert into event_materials (material_id, event_id)
select pg_temp.seed_id('material:' || key), pg_temp.seed_id('event:' || event_key)
from seed_materials where event_key is not null;
insert into material_providers (id, material_id, contact, name, price, arrival_date, vendor_id)
select pg_temp.seed_id('offer:' || m.key), pg_temp.seed_id('material:' || m.key),
       coalesce(v.phone, v.url, v.name), v.name, m.price,
       coalesce(m.due, e.day), v.id
from seed_materials m join vendors v on v.id = pg_temp.seed_id('vendor:' || m.vendor_key)
left join seed_events e on e.key = m.event_key where m.price is not null;
update materials m set chosen_provider_id = p.id,
       overage_ln = case when m.budget is not null and p.price > 0 then ln((p.price / m.budget)::float8) end
from material_providers p join seed_materials s on p.id = pg_temp.seed_id('offer:' || s.key)
where p.material_id = m.id;
-- Ayni kalemde iki alternatif teklif; secili fiyat en ucuz olmak zorunda degil.
insert into material_providers (material_id, contact, name, price, arrival_date, vendor_id) values
  (pg_temp.seed_id('material:fair-projector'), 'https://kampus.example', 'Kampüs Elektronik', 5800,
   current_date + 19, pg_temp.seed_id('vendor:tech')),
  (pg_temp.seed_id('material:fair-stage'), '0532 555 04 40', 'Kampüs İkram', null,
   null, pg_temp.seed_id('vendor:catering'));

-- Iade dosyalari: her asama, aylik/etkinlik, kismi tahsilat.
insert into reimbursement_claims (id, kind, month, event_id, status, sent_at, approved_at, created_by, created_at) values
  (pg_temp.seed_id('claim:current'), 'monthly', date_trunc('month', current_date)::date, null,
   'draft', null, null, pg_temp.seed_user('zeynep'), now() - interval '4 days'),
  (pg_temp.seed_id('claim:previous'), 'monthly', (date_trunc('month', current_date) - interval '1 month')::date, null,
   'sent', now() - interval '10 days', null, pg_temp.seed_user('zeynep'), now() - interval '35 days'),
  (pg_temp.seed_id('claim:archive'), 'monthly', (date_trunc('month', current_date) - interval '2 months')::date, null,
   'office_approved', now() - interval '40 days', now() - interval '30 days', pg_temp.seed_user('zeynep'), now() - interval '55 days'),
  (pg_temp.seed_id('claim:welcome'), 'event', null, pg_temp.seed_id('event:welcome'),
   'office_approved', now() - interval '35 days', now() - interval '25 days', pg_temp.seed_user('zeynep'), now() - interval '50 days'),
  (pg_temp.seed_id('claim:workshop'), 'event', null, pg_temp.seed_id('event:workshop'),
   'office_approved', now() - interval '9 days', now() - interval '3 days', pg_temp.seed_user('zeynep'), now() - interval '10 days'),
  (pg_temp.seed_id('claim:meetup'), 'event', null, pg_temp.seed_id('event:meetup'),
   'sent', now() - interval '4 days', null, pg_temp.seed_user('zeynep'), now() - interval '5 days');

create temporary table seed_invoices (
  key text primary key, user_handle text, day date, currency text, total numeric,
  fx_rate numeric, fx_source text, paid_by text, vendor_key text, status text,
  claim_key text, note text
) on commit drop;
insert into seed_invoices values
  ('welcome', 'ayse', (date_trunc('month', current_date) - interval '2 months')::date + 8, 'TRY', 2400, null, null, 'member', 'print', 'approved', 'welcome', 'Karşılama buluşması baskıları.'),
  ('workshop', 'efe', current_date - 14, 'USD', 75, 42.125, 'manual', 'member', 'tech', 'approved', 'workshop', 'Kur elle girildi; örnek değer, güncel piyasa kuru değildir.'),
  ('meetup-food', 'mert', current_date - 7, 'TRY', 950, null, null, 'club', 'catering', 'approved', null, 'Kasadan yapılan etkinlik harcaması.'),
  ('meetup-badges', 'mert', current_date - 8, 'TRY', 620, null, null, 'member', 'print', 'approved', 'meetup', 'SEB dosyası gönderildi; tahsilat bekleniyor.'),
  ('office-mixed', 'efe', current_date, 'TRY', 1700, null, null, 'member', 'print', 'approved', 'current', '1200 TL SEB, 500 TL genel; tek faturada iki fon.'),
  ('office-toner', 'zeynep', current_date - 5, 'TRY', 850, null, null, 'member', 'office', 'approved', null, 'Üyeye kısmi ödeme yapıldı.'),
  ('office-archive', 'selin', (date_trunc('month', current_date) - interval '1 month')::date + 8, 'TRY', 1800, null, null, 'club', 'print', 'approved', 'previous', 'Önceki ayın kulüp ödemesi.'),
  ('equipment-archive', 'selin', (date_trunc('month', current_date) - interval '2 months')::date + 5, 'EUR', 40, 45.25, 'manual', 'club', 'tech', 'approved', 'archive', '1810 TL talebe 1600 TL iade geldi.'),
  ('unfiled', 'ayse', current_date - 2, 'TRY', 720, null, null, 'member', 'print', 'approved', null, 'Dosya bağı elle kaldırıldı; uygun taslağa taşınmayı bekliyor.'),
  ('fair-print', 'selin', current_date, 'TRY', 1400, null, null, 'member', 'print', 'approved', 'current', 'Şenlik için erkenden alınan baskı.'),
  ('fair-lanyards', 'ayse', current_date - 3, 'TRY', 2500, null, null, 'member', 'print', 'pending', null, 'İki kalemli fatura, onay bekliyor.'),
  ('office-tools', 'mert', current_date - 4, 'EUR', 24.90, 45.25, 'tcmb', 'member', 'tech', 'pending', null, 'Belge düzeltildi ve yeniden gönderildi; kur örnek önbellekten.'),
  ('fair-deposit', 'selin', current_date - 1, 'TRY', 3200, null, null, 'club', 'stage', 'pending', null, 'Kulüp ödemesi henüz onaylanmadı.'),
  ('office-receipt', 'ayse', current_date - 6, 'TRY', 430, null, null, 'member', 'office', 'changes_requested', null, 'Satıcı bilgisi eksik; düzeltme bekleniyor.'),
  ('office-personal', 'mert', current_date - 8, 'TRY', 990, null, null, 'member', 'tech', 'rejected', null, 'Kulüp kapsamı dışındaki harcama.'),
  ('office-duplicate', 'ayse', current_date - 5, 'TRY', 430, null, null, 'member', 'office', 'withdrawn', null, 'Gönderen mükerrer kaydı fark etti.'),
  ('cancelled-cable', 'zeynep', current_date - 9, 'TRY', 1250, null, null, 'club', 'tech', 'cancelled', null, 'Ürün iade edildi; onay ve kasa hareketi geri alındı.');
insert into invoices (id, submitted_by, purchased_on, currency, total, fx_rate, fx_on, fx_source,
                      paid_by, payee_account_id, vendor_id, status, claim_id, note, created_at, updated_at)
select pg_temp.seed_id('invoice:' || key), pg_temp.seed_user(user_handle), day, currency, total, fx_rate,
       case when fx_rate is not null then day end, fx_source, paid_by,
       case when paid_by = 'member' then pg_temp.seed_id('account:' || user_handle) end,
       pg_temp.seed_id('vendor:' || vendor_key), status,
       case when claim_key is not null then pg_temp.seed_id('claim:' || claim_key) end,
       note, least(now(), day::timestamptz + interval '10 hours'), least(now(), day::timestamptz + interval '12 hours')
from seed_invoices;
insert into invoice_items (invoice_id, material_id, amount, funding)
select i.id, pg_temp.seed_id('material:' || v.material_key), v.amount,
       case when i.status in ('approved', 'cancelled') then n.attrs->>'ledger' end
from (values
  ('welcome', 'welcome-print', 2400), ('workshop', 'workshop-parts', 75),
  ('meetup-food', 'meetup-food', 950), ('meetup-badges', 'meetup-badges', 620),
  ('office-mixed', 'office-stickers', 1200), ('office-mixed', 'office-folders', 500),
  ('office-toner', 'office-toner', 850), ('office-archive', 'office-archive', 1800),
  ('equipment-archive', 'equipment-archive', 40), ('unfiled', 'unfiled-print', 720),
  ('fair-print', 'fair-print', 1400), ('fair-lanyards', 'fair-lanyards', 1800),
  ('fair-lanyards', 'fair-badges', 700), ('office-tools', 'office-tools', 24.90),
  ('fair-deposit', 'fair-deposit', 3200), ('office-receipt', 'office-receipt', 430),
  ('office-personal', 'office-personal', 990), ('office-duplicate', 'office-duplicate', 430),
  ('cancelled-cable', 'cancelled-cable', 1250)
) as v(invoice_key, material_key, amount)
join invoices i on i.id = pg_temp.seed_id('invoice:' || v.invoice_key)
join materials m on m.id = pg_temp.seed_id('material:' || v.material_key)
join nodes n on n.id = m.category_id;

-- Gonderim ve karar izi; onaysiz faturalarin fonu/bought isareti bos kalir.
insert into invoice_reviews (invoice_id, action, by_user, at)
select id, 'submit', submitted_by, created_at from invoices;
insert into invoice_reviews (invoice_id, action, note, by_user, at)
select id,
       case status when 'approved' then 'approve' when 'changes_requested' then 'changes'
                   when 'rejected' then 'reject' when 'withdrawn' then 'withdraw' end,
       case status when 'changes_requested' then 'Satıcı unvanı ve vergi numarası okunmuyor; belgeyi yenileyebilir misin?'
                   when 'rejected' then 'Bu harcama kulüp faaliyeti kapsamında değil.'
                   when 'withdrawn' then 'Aynı belge ikinci kez gönderilmiş.' end,
       case when status = 'withdrawn' then submitted_by else pg_temp.seed_user('zeynep') end,
       updated_at
from invoices where status not in ('pending', 'cancelled');
insert into invoice_reviews (invoice_id, action, note, by_user, at) values
  (pg_temp.seed_id('invoice:office-tools'), 'changes', 'Döviz tutarı ve fatura tarihi okunmuyor.', pg_temp.seed_user('zeynep'), (current_date - 3)::timestamptz + interval '9 hours'),
  (pg_temp.seed_id('invoice:office-tools'), 'resubmit', 'Belgenin okunaklı kopyası ve doğru tutar eklendi.', pg_temp.seed_user('mert'), (current_date - 2)::timestamptz + interval '11 hours'),
  (pg_temp.seed_id('invoice:cancelled-cable'), 'approve', null, pg_temp.seed_user('zeynep'), (current_date - 8)::timestamptz + interval '10 hours'),
  (pg_temp.seed_id('invoice:cancelled-cable'), 'cancel', 'Ürün satıcıya iade edildi.', pg_temp.seed_user('zeynep'), (current_date - 6)::timestamptz + interval '10 hours');
update invoices set updated_at = (select max(at) from invoice_reviews r where r.invoice_id = invoices.id);
update materials m set purchased = true, purchased_at = i.updated_at, purchased_by = pg_temp.seed_user('zeynep'),
       delivered = m.id <> pg_temp.seed_id('material:fair-print'), updated_at = i.updated_at
from invoice_items ii join invoices i on i.id = ii.invoice_id
where ii.material_id = m.id and i.status = 'approved';
-- Eski satin alindi kapisi faturadan once kullanilabilir: fatura/teslim kuyrugu.
update materials set purchased = true, purchased_at = now() - interval '1 day',
       purchased_by = pg_temp.seed_user('zeynep'), delivered = false
where id = pg_temp.seed_id('material:office-adapter');

-- Kasa: acilis, gelir, kategorili gider, fatura gideri, iade, uye odemesi ve ters kayit.
insert into ledger_entries (id, occurred_on, amount, kind, description, created_by) values
  (pg_temp.seed_id('ledger:opening'), (date_trunc('month', current_date) - interval '3 months')::date,
   15000, 'opening', 'Dönem başı devreden kulüp bakiyesi', pg_temp.seed_user('zeynep')),
  (pg_temp.seed_id('ledger:income'), current_date - 20, 6000, 'income', 'Mezunlar dayanışma desteği', pg_temp.seed_user('zeynep'));
insert into ledger_entries (occurred_on, amount, kind, description, category_id, event_id, created_by) values
  (current_date - 7, -600, 'expense', 'Tanışma akşamı salon temizliği', pg_temp.seed_category(3), pg_temp.seed_id('event:meetup'), pg_temp.seed_user('zeynep')),
  (current_date - 3, -250, 'expense', 'Kulüp odası kırtasiye gideri', pg_temp.seed_category(4), null, pg_temp.seed_user('zeynep'));
insert into ledger_entries (id, occurred_on, amount, kind, description, invoice_id, created_by, created_at)
select pg_temp.seed_id('ledger:purchase:' || s.key), i.purchased_on, -i.total_try,
       'purchase', 'Satın alım · ' || s.note, i.id, pg_temp.seed_user('zeynep'), i.updated_at
from seed_invoices s join invoices i on i.id = pg_temp.seed_id('invoice:' || s.key)
where i.paid_by = 'club' and i.status in ('approved', 'cancelled');
insert into ledger_entries (occurred_on, amount, kind, description, reverses_id, created_by) values
  (current_date - 6, 1250, 'reversal', 'Ters kayıt · uzatma kablosu iadesi', pg_temp.seed_id('ledger:purchase:cancelled-cable'), pg_temp.seed_user('zeynep'));
insert into ledger_entries (id, occurred_on, amount, kind, description, created_by) values
  (pg_temp.seed_id('ledger:refund:archive'), current_date - 24, 1600, 'seb_refund', 'SEB iadesi · önceki aylık dosya (kısmi)', pg_temp.seed_user('zeynep')),
  (pg_temp.seed_id('ledger:refund:welcome'), current_date - 20, 2400, 'seb_refund', 'SEB iadesi · kulübe hoş geldin buluşması', pg_temp.seed_user('zeynep'));
update reimbursement_claims set status = 'paid', paid_at = (current_date - 24)::timestamptz,
  received_amount = 1600, ledger_entry_id = pg_temp.seed_id('ledger:refund:archive')
where id = pg_temp.seed_id('claim:archive');
update reimbursement_claims set status = 'paid', paid_at = (current_date - 20)::timestamptz,
  received_amount = 2400, ledger_entry_id = pg_temp.seed_id('ledger:refund:welcome')
where id = pg_temp.seed_id('claim:welcome');
insert into ledger_entries (occurred_on, amount, kind, description, payee_user_id, created_by) values
  (current_date - 18, -1200, 'member_payout', 'Ayşe · karşılama baskısı iadesinin ilk taksiti', pg_temp.seed_user('ayse'), pg_temp.seed_user('zeynep')),
  (current_date - 2, -350, 'member_payout', 'Zeynep · toner ödemesinin ilk taksiti', pg_temp.seed_user('zeynep'), pg_temp.seed_user('selin'));
insert into ledger_checks (checked_on, bank_balance, created_by, created_at)
select current_date - 10, coalesce(sum(amount), 0), pg_temp.seed_user('zeynep'), now() - interval '10 days'
from ledger_entries where occurred_on <= current_date - 10;
-- Son mutabakatta 75 TL fark: Genel ve Kasa ekranlarinda fark uyarisi gorulur.
insert into ledger_checks (checked_on, bank_balance, created_by)
select current_date, sum(amount) - 75, pg_temp.seed_user('zeynep') from ledger_entries;

-- Her kategoride plan; etkinlik paylari ve gelecek donem de secilebilir.
insert into budget_lines (period_id, category_id, amount, note)
select pg_temp.seed_id('period:' || p.key), pg_temp.seed_category(v.category_order),
       v.amount * case p.key when 'previous' then 0.8 when 'next' then 1.1 else 1 end,
       'Etkinliklerden bağımsız kategori payı.'
from seed_periods p cross join (values (0, 5000), (1, 9000), (2, 6000), (3, 12000), (4, 2000)) as v(category_order, amount);
insert into budget_lines (period_id, category_id, event_id, amount, note)
select p.id, pg_temp.seed_category(v.category_order), e.id, v.amount, v.note
from (values
  ('fair', 0, 2500, 'Sponsor stantlarının baskı desteği.'),
  ('fair', 2, 3500, 'Kart, askı ve yönlendirme baskıları.'),
  ('fair', 3, 8500, 'Projeksiyon ve kurulum; taahhüt planı aşabilir.'),
  ('workshop', 1, 3000, 'Elektronik kitleri için ayrılan pay.'),
  ('meetup', 3, 1200, 'İkram ve salon giderleri; gerçekleşen planı aştı.'),
  ('visit', 1, 2000, 'Taşıma ekipmanı payı.')
) as v(event_key, category_order, amount, note)
join events e on e.id = pg_temp.seed_id('event:' || v.event_key)
join finance_periods p on p.span @> e.date;

insert into recurring_expenses (name, amount, currency, every, next_on, category_id, is_active) values
  ('Kulüp odası interneti', 450, 'TRY', 'month', current_date - 3, pg_temp.seed_category(4), true),
  ('Dosya paylaşım hizmeti', 12, 'USD', 'month', current_date + 7, pg_temp.seed_category(4), true),
  ('Kulüp alan adı', 650, 'TRY', 'year', current_date + 20, pg_temp.seed_category(4), true),
  ('Ekipman bakım sözleşmesi', 2400, 'TRY', 'year', current_date + 65, pg_temp.seed_category(1), true),
  ('Eski tasarım aboneliği', 15, 'EUR', 'month', current_date + 2, pg_temp.seed_category(2), false);
-- Bunlar dis servise cikmadan formu denemek icin SENTETIK kur degerleri.
insert into fx_rates (day, currency, rate)
select current_date - d, currency, rate
from generate_series(0, 7) as d cross join (values ('USD', 42.125), ('EUR', 45.25)) as v(currency, rate);
insert into mail_templates (name, format, body, created_by) values
  ('Aylık SEB harcama bildirimi', 'md', $body$Merhaba,

{{club_name}} kulübünün {{period:tarih}} dönemi harcama bildirimi ektedir.
Toplam talep: **{{total:para}}**.

{{expenses:matris(Kişi:metin, Açıklama:metin, Tutar:para)}}

İyi çalışmalar,
{{sender_name}}$body$, pg_temp.seed_user('zeynep')),
  ('Etkinlik harcama dosyası', 'html', $body$<p>Merhaba,</p>
<p><strong>{{event_name}}</strong> etkinliğinin {{event_date:tarih}} tarihli harcama dosyasını iletiyoruz.</p>
<p>SEB iade talebi: <strong>{{total:para}}</strong></p>
<p>Belgeler ve kişi bazlı ödeme listesi ektedir.</p>
<p>İyi çalışmalar,<br>{{sender_name}}</p>$body$, pg_temp.seed_user('zeynep')),
  ('Üyeye ödeme bildirimi', 'md', $body$Merhaba {{member_name}},

{{description}} harcaman için **{{amount:para}}** tutarındaki ödeme {{paid_on:tarih}} tarihinde hesabına gönderildi.

Teşekkürler,
{{sender_name}}$body$, pg_temp.seed_user('zeynep'));

\endif

commit;
