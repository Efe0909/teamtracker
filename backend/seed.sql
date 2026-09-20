-- OTOMATIK URETILDI: shared/seed.py -> v2 semasi.
-- Uretec: tools/gen_seed.py. ELLE DUZENLEME — kaynak Python tarafi.
-- VAROLAN VERIYI SILER; yayinda asla kosturulmaz.

truncate users, nodes, teams, team_members, chats, records,
         record_participants, actions, cards, messages, activity
  restart identity cascade;

-- === kullanicilar ===
insert into users (id,email,name,color,is_admin,created_at) values ('075deca4-2769-59ea-ace4-039eed00ca23','efe@ekiptakip.local','Efe','#5b8cff',false,now() - interval '10 day');
insert into users (id,email,name,color,is_admin,created_at) values ('4f5c8d98-3962-5a7d-b38f-c4a7b023d676','selin@ekiptakip.local','Selin','#e5484d',true,now() - interval '9 day');
insert into users (id,email,name,color,is_admin,created_at) values ('7a995bfb-9114-538d-b999-14fa104f12a6','deniz@ekiptakip.local','Deniz','#d99a2b',false,now() - interval '8 day');

-- === agac ===
insert into nodes (id,parent_id,name,node_type,sort_order) values ('a9394863-062f-5089-abd3-2a8c418fb542',null,'Yıllık Bayi Toplantısı 2026','operational',0);
insert into nodes (id,parent_id,name,node_type,sort_order) values ('bbaee7a5-07f1-5b7d-875a-59fc6942a231','a9394863-062f-5089-abd3-2a8c418fb542','Malzeme Temini','generic',1);
insert into nodes (id,parent_id,name,node_type,sort_order) values ('57494550-15de-5aa6-9802-a5252f8f1e4a','bbaee7a5-07f1-5b7d-875a-59fc6942a231','Bütçe Onayı','step',2);
insert into nodes (id,parent_id,name,node_type,sort_order) values ('dd5ed529-e44d-54f6-afba-b218e4cbfaf8','bbaee7a5-07f1-5b7d-875a-59fc6942a231','Tedarikçi Seçimi','step',3);
insert into nodes (id,parent_id,name,node_type,sort_order) values ('06bae0c1-8cee-56db-bcfa-bdd35369822b','bbaee7a5-07f1-5b7d-875a-59fc6942a231','Sevkiyat & Teslim','step',4);
insert into nodes (id,parent_id,name,node_type,sort_order) values ('5827deb7-728d-5db6-9f39-14c104a85839','a9394863-062f-5089-abd3-2a8c418fb542','Mekan & Lojistik','generic',5);
insert into nodes (id,parent_id,name,node_type,sort_order) values ('41eee365-69dd-5754-aa3f-56db46389a7b','5827deb7-728d-5db6-9f39-14c104a85839','Salon Sözleşmesi','step',6);
insert into nodes (id,parent_id,name,node_type,sort_order) values ('8faf733b-1edf-5a47-ae49-21ae9e0aff78','5827deb7-728d-5db6-9f39-14c104a85839','Ulaşım & Konaklama','step',7);
insert into nodes (id,parent_id,name,node_type,sort_order) values ('3db083eb-480d-5074-a404-3ccaef898c23','a9394863-062f-5089-abd3-2a8c418fb542','İletişim & Tanıtım','generic',8);
insert into nodes (id,parent_id,name,node_type,sort_order) values ('e808326b-48df-5fb9-8fe5-91e41393c264',null,'Üretim Hattı A','cell',9);
insert into nodes (id,parent_id,name,node_type,sort_order) values ('cb696ac4-63d5-5367-910e-029cc36793ef','e808326b-48df-5fb9-8fe5-91e41393c264','Dolum Makinesi','machine',10);
insert into nodes (id,parent_id,name,node_type,sort_order) values ('dfdd0adf-007d-5313-8641-4d93eab19700','cb696ac4-63d5-5367-910e-029cc36793ef','Kapak Ünitesi','machine',11);
insert into nodes (id,parent_id,name,node_type,sort_order) values ('47faa240-5071-59ad-95c3-4660ae2ff476','cb696ac4-63d5-5367-910e-029cc36793ef','Etiketleme Ünitesi','machine',12);

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

-- === kayitlar ===
-- records.chat_id NOT NULL: sohbet kayitla AYNI islemde dogar,
-- "sohbeti var mi" diye bir dal hicbir yerde olmaz.
insert into chats (id) values ('fb54605c-bdd8-5c5b-9415-a1b83d9eedd8');
insert into records (id,unit_id,team_id,chat_id,kind,title,description,status,priority,owner_id,created_by,due_date,created_at,updated_at) values ('556094c3-7ade-5964-988d-a848ac5778ef','57494550-15de-5aa6-9802-a5252f8f1e4a','b7d5cc5f-ef59-594b-a67a-6a356fd372f3','fb54605c-bdd8-5c5b-9415-a1b83d9eedd8','issue','Bütçe onayı 6 gündür bekliyor','Finans departmanı onay vermeden tedarikçi ile sözleşme imzalanamıyor. Zincirin tamamı bekliyor.','open','critical','7a995bfb-9114-538d-b999-14fa104f12a6','4f5c8d98-3962-5a7d-b38f-c4a7b023d676',date '2026-09-04',timestamptz '2026-09-08T00:59:19.628004+00:00',timestamptz '2026-09-20T00:39:19.628293+00:00');
insert into record_participants (record_id,user_id) values ('556094c3-7ade-5964-988d-a848ac5778ef','7a995bfb-9114-538d-b999-14fa104f12a6');
insert into record_participants (record_id,user_id) values ('556094c3-7ade-5964-988d-a848ac5778ef','4f5c8d98-3962-5a7d-b38f-c4a7b023d676');
insert into record_participants (record_id,user_id) values ('556094c3-7ade-5964-988d-a848ac5778ef','075deca4-2769-59ea-ace4-039eed00ca23');
insert into chats (id) values ('37d08cb0-acd8-548e-918c-8429c64c5bee');
insert into records (id,unit_id,team_id,chat_id,kind,title,description,status,priority,owner_id,created_by,due_date,created_at,updated_at) values ('9305276f-2d38-518a-adb9-ef4cbca5051b','06bae0c1-8cee-56db-bcfa-bdd35369822b','fc8b1cd5-7c9f-53c6-a2cc-978a9bec79a5','37d08cb0-acd8-548e-918c-8429c64c5bee','issue','Sevkiyat tarihi etkinlikten sonraya düşüyor','Tedarikçi teslim tarihi 3 Eylül; etkinlik 28 Ağustos.','in_progress','critical','075deca4-2769-59ea-ace4-039eed00ca23','075deca4-2769-59ea-ace4-039eed00ca23',date '2026-09-10',timestamptz '2026-09-09T00:59:19.628296+00:00',timestamptz '2026-09-19T21:59:19.628297+00:00');
insert into record_participants (record_id,user_id) values ('9305276f-2d38-518a-adb9-ef4cbca5051b','075deca4-2769-59ea-ace4-039eed00ca23');
insert into record_participants (record_id,user_id) values ('9305276f-2d38-518a-adb9-ef4cbca5051b','4f5c8d98-3962-5a7d-b38f-c4a7b023d676');
insert into chats (id) values ('9347d7b4-42b1-582a-a88f-0408878c2309');
insert into records (id,unit_id,team_id,chat_id,kind,title,description,status,priority,owner_id,created_by,due_date,created_at,updated_at) values ('e7819ffb-890e-57cf-a535-a34db36d5af3','dfdd0adf-007d-5313-8641-4d93eab19700',null,'9347d7b4-42b1-582a-a88f-0408878c2309','task','Kapak Ünitesi — tekrar eden kayıp','3 DMS kaydından açıldı. Tekrar eden duruş, LE''ye taşınması değerlendiriliyor.','pending','high','7a995bfb-9114-538d-b999-14fa104f12a6','4f5c8d98-3962-5a7d-b38f-c4a7b023d676',null,timestamptz '2026-09-12T00:59:19.628299+00:00',timestamptz '2026-09-19T19:59:19.628299+00:00');
insert into record_participants (record_id,user_id) values ('e7819ffb-890e-57cf-a535-a34db36d5af3','7a995bfb-9114-538d-b999-14fa104f12a6');
insert into chats (id) values ('d369df23-d89b-54e9-a6b2-8734060bc43f');
insert into records (id,unit_id,team_id,chat_id,kind,title,description,status,priority,owner_id,created_by,due_date,created_at,updated_at) values ('f78ab92f-f2a8-5002-ad5b-2abc9c2d3589','57494550-15de-5aa6-9802-a5252f8f1e4a','b7d5cc5f-ef59-594b-a67a-6a356fd372f3','d369df23-d89b-54e9-a6b2-8734060bc43f','task','Onay akışına vekalet mekanizması ekle','CFO izindeyken onay zinciri duruyor; vekalet tanımı gerekiyor.','in_progress','medium','075deca4-2769-59ea-ace4-039eed00ca23','4f5c8d98-3962-5a7d-b38f-c4a7b023d676',null,timestamptz '2026-09-14T00:59:19.628300+00:00',timestamptz '2026-09-18T22:59:19.628301+00:00');
insert into record_participants (record_id,user_id) values ('f78ab92f-f2a8-5002-ad5b-2abc9c2d3589','075deca4-2769-59ea-ace4-039eed00ca23');
insert into record_participants (record_id,user_id) values ('f78ab92f-f2a8-5002-ad5b-2abc9c2d3589','4f5c8d98-3962-5a7d-b38f-c4a7b023d676');
insert into chats (id) values ('77a5053c-6b77-58a0-a6f8-4d890a9787ff');
insert into records (id,unit_id,team_id,chat_id,kind,title,description,status,priority,owner_id,created_by,due_date,created_at,updated_at) values ('2e1b1635-e910-5381-94c7-6779396b5de0','dd5ed529-e44d-54f6-afba-b218e4cbfaf8','fc8b1cd5-7c9f-53c6-a2cc-978a9bec79a5','77a5053c-6b77-58a0-a6f8-4d890a9787ff','issue','Tedarikçi teklifleri karşılaştırılamıyor','Üç teklif farklı formatta geldi; kıyas tablosu çıkarılamıyor.','open','medium','075deca4-2769-59ea-ace4-039eed00ca23','075deca4-2769-59ea-ace4-039eed00ca23',null,timestamptz '2026-09-13T00:59:19.628302+00:00',timestamptz '2026-09-18T00:59:19.628303+00:00');
insert into record_participants (record_id,user_id) values ('2e1b1635-e910-5381-94c7-6779396b5de0','075deca4-2769-59ea-ace4-039eed00ca23');

-- === eylemler ===
insert into actions (record_id,title,owner_id,created_by,status,due_date,created_at) values ('556094c3-7ade-5964-988d-a848ac5778ef','CFO vekalet onayını IT üzerinden tamamlat','7a995bfb-9114-538d-b999-14fa104f12a6','4f5c8d98-3962-5a7d-b38f-c4a7b023d676','open',date '2026-09-22',timestamptz '2026-09-09T00:59:19.628308+00:00');
insert into actions (record_id,title,owner_id,created_by,status,due_date,created_at) values ('556094c3-7ade-5964-988d-a848ac5778ef','Tedarikçiden fiyat kilidi uzatması iste','075deca4-2769-59ea-ace4-039eed00ca23','4f5c8d98-3962-5a7d-b38f-c4a7b023d676','in_progress',date '2026-09-19',timestamptz '2026-09-10T00:59:19.628311+00:00');
insert into actions (record_id,title,owner_id,created_by,status,due_date,created_at) values ('2e1b1635-e910-5381-94c7-6779396b5de0','Teklifleri tek şablona geçir','075deca4-2769-59ea-ace4-039eed00ca23','075deca4-2769-59ea-ace4-039eed00ca23','closed',null,timestamptz '2026-09-14T00:59:19.628311+00:00');
insert into actions (record_id,title,owner_id,created_by,status,due_date,created_at) values ('9305276f-2d38-518a-adb9-ef4cbca5051b','Alternatif kargo firmalarından süre al',null,'075deca4-2769-59ea-ace4-039eed00ca23','open',date '2026-09-24',timestamptz '2026-09-18T00:59:19.628313+00:00');

-- === sohbet ve gunluk ===
-- events BOLUNDU: konusma -> messages, denetim -> activity (spec §5, §6).
insert into activity (chat_id,actor_id,verb,subject_label,detail,created_at) values ('fb54605c-bdd8-5c5b-9415-a1b83d9eedd8','4f5c8d98-3962-5a7d-b38f-c4a7b023d676','note','Bütçe onayı 6 gündür bekliyor','Selin bu hatayı açtı ve Deniz''e atadı',timestamptz '2026-09-08T00:59:19.628313+00:00');
insert into messages (chat_id,author_id,body,created_at) values ('fb54605c-bdd8-5c5b-9415-a1b83d9eedd8','4f5c8d98-3962-5a7d-b38f-c4a7b023d676','Deniz, finanstan dönüş var mı? Tedarikçi fiyat kilidi cuma bitiyor.',timestamptz '2026-09-08T01:07:19.628314+00:00');
insert into messages (chat_id,author_id,body,created_at) values ('fb54605c-bdd8-5c5b-9415-a1b83d9eedd8','7a995bfb-9114-538d-b999-14fa104f12a6','CFO izinde, vekaleten onay için IT''den yetki devri istedim.',timestamptz '2026-09-09T03:59:19.628315+00:00');
insert into activity (chat_id,actor_id,verb,subject_label,detail,created_at) values ('fb54605c-bdd8-5c5b-9415-a1b83d9eedd8',null,'note','Bütçe onayı 6 gündür bekliyor','Durum "Açık" olarak kaldı — 3 gündür hareket yok',timestamptz '2026-09-11T00:59:19.628316+00:00');
insert into messages (chat_id,author_id,body,created_at) values ('fb54605c-bdd8-5c5b-9415-a1b83d9eedd8','075deca4-2769-59ea-ace4-039eed00ca23','Bu bir DH kaydı ama üçüncü tekrar. Kapak Ünitesi''ndeki gibi LE''ye taşıyalım mı?',timestamptz '2026-09-20T00:39:19.628316+00:00');
insert into activity (chat_id,actor_id,verb,subject_label,detail,created_at) values ('37d08cb0-acd8-548e-918c-8429c64c5bee','075deca4-2769-59ea-ace4-039eed00ca23','note','Sevkiyat tarihi etkinlikten sonraya düşüyor','Efe bu hatayı açtı',timestamptz '2026-09-09T00:59:19.628317+00:00');
insert into messages (chat_id,author_id,body,created_at) values ('37d08cb0-acd8-548e-918c-8429c64c5bee','075deca4-2769-59ea-ace4-039eed00ca23','Bu aslında bütçe onayının türevi; zinciri o tutuyor.',timestamptz '2026-09-19T21:59:19.628318+00:00');
insert into activity (chat_id,actor_id,verb,subject_label,detail,created_at) values ('9347d7b4-42b1-582a-a88f-0408878c2309','4f5c8d98-3962-5a7d-b38f-c4a7b023d676','note','Kapak Ünitesi — tekrar eden kayıp','Selin bu görevi açtı ve Deniz''e atadı',timestamptz '2026-09-12T00:59:19.628318+00:00');
insert into messages (chat_id,author_id,body,created_at) values ('9347d7b4-42b1-582a-a88f-0408878c2309','7a995bfb-9114-538d-b999-14fa104f12a6','3 DMS kaydından açıldı, kök neden analizi bekliyor.',timestamptz '2026-09-19T19:59:19.628319+00:00');
insert into messages (chat_id,author_id,body,created_at) values ('d369df23-d89b-54e9-a6b2-8734060bc43f','4f5c8d98-3962-5a7d-b38f-c4a7b023d676','Standart şablon hazırlıyorum.',timestamptz '2026-09-18T22:59:19.628319+00:00');
insert into messages (chat_id,author_id,body,created_at) values ('77a5053c-6b77-58a0-a6f8-4d890a9787ff','075deca4-2769-59ea-ace4-039eed00ca23','Üç teklif farklı formatta geldi.',timestamptz '2026-09-18T00:59:19.628320+00:00');
insert into messages (chat_id,author_id,body,created_at) values ('3673b099-afa3-5af3-bedb-d9834935206f','4f5c8d98-3962-5a7d-b38f-c4a7b023d676','Bu hafta önceliğimiz bütçe onayı; vekalet çıkmazsa cuma eskale ediyoruz.',timestamptz '2026-09-18T00:59:19.628321+00:00');
insert into messages (chat_id,author_id,body,created_at) values ('3673b099-afa3-5af3-bedb-d9834935206f','075deca4-2769-59ea-ace4-039eed00ca23','Fiyat kilidi için tedarikçiyle konuştum, bir hafta daha var.',timestamptz '2026-09-18T20:59:19.628321+00:00');
insert into messages (chat_id,author_id,body,created_at) values ('19a11e32-eeac-511e-bb5a-3bced961cd5a','075deca4-2769-59ea-ace4-039eed00ca23','Alternatif kargo tekliflerini bugün topluyorum, akşam buraya bırakırım.',timestamptz '2026-09-19T18:59:19.628322+00:00');
insert into messages (chat_id,author_id,body,created_at) values ('83bcd37e-650a-5353-9e33-67d5cebd01e4','4f5c8d98-3962-5a7d-b38f-c4a7b023d676','Afiş taslakları hazır; ölçüler için Efe''den dönüş bekliyorum.',timestamptz '2026-09-17T00:59:19.628323+00:00');
