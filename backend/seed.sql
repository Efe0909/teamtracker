-- Gelistirme tohumu. VAROLAN VERIYI SILER — yayinda asla kosturulmaz.
--
-- Python tarafindaki shared/seed.py'nin karsiligi; ayni adlar ve ayni
-- iliskiler, cunku tests/test_api.py bu basliklari ariyor.

truncate users, nodes, teams, team_members, chats, records,
         record_participants, actions, cards, messages, activity
  restart identity cascade;

-- === kullanicilar ==========================================================
insert into users (id, email, name, color, is_admin, created_at) values
  ('a0000000-0000-0000-0000-000000000001','efe@ekiptakip.local',  'Efe',  '#5b8cff', false, now() - interval '3 day'),
  ('a0000000-0000-0000-0000-000000000002','selin@ekiptakip.local','Selin','#e5484d', true,  now() - interval '2 day'),
  ('a0000000-0000-0000-0000-000000000003','deniz@ekiptakip.local','Deniz','#d99a2b', false, now() - interval '1 day');

-- === agac ==================================================================
insert into nodes (id, parent_id, name, node_type, sort_order) values
  ('b0000000-0000-0000-0000-000000000001', null, 'Üretim Hattı A', 'cell', 0),
  ('b0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'Malzeme Temini', 'machine', 0),
  ('b0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000002', 'Bütçe Onayı',    'task', 0),
  ('b0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000002', 'Sevkiyat',       'task', 1),
  ('b0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000001', 'Tedarik',        'machine', 1),
  ('b0000000-0000-0000-0000-000000000006', null, 'Pillars', 'operational', 1),
  ('b0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000006', 'SN', 'pillar', 0),
  ('b0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-000000000006', 'E&T','pillar', 1);

-- === takimlar (her birine bir chats satiri) ================================
insert into chats (id) values
  ('c0000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-000000000002'),
  ('c0000000-0000-0000-0000-000000000003');

insert into teams (id, name, description, chat_id, color) values
  ('d0000000-0000-0000-0000-000000000001','Tasarım',   'Görsel üretim: afiş, sosyal medya, sahne tasarımı.', 'c0000000-0000-0000-0000-000000000001','#8e6bff'),
  ('d0000000-0000-0000-0000-000000000002','Maliye',    'Bütçe, onay akışları ve ödemeler.',                  'c0000000-0000-0000-0000-000000000002','#1c8a5b'),
  ('d0000000-0000-0000-0000-000000000003','Satın Alım','Tedarikçi seçimi, sözleşme ve sevkiyat takibi.',     'c0000000-0000-0000-0000-000000000003','#b4501a');

insert into team_members (team_id, user_id, role) values
  ('d0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','lead'),
  ('d0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','mentor'),
  ('d0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000002','lead'),
  ('d0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','member'),
  ('d0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000003','member'),
  ('d0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000001','member');

-- === kayitlar ==============================================================
-- Her kaydin bir chats satiri var: records.chat_id NOT NULL. Kayit ile ayni
-- islemde dogar, "sohbeti var mi" diye bir dal hicbir yerde olmaz.
insert into chats (id) values
  ('c1000000-0000-0000-0000-000000000001'),
  ('c1000000-0000-0000-0000-000000000002'),
  ('c1000000-0000-0000-0000-000000000003');

insert into records (id, unit_id, team_id, pillar_id, chat_id, kind, title, description,
                     status, priority, owner_id, created_by, due_date, created_at) values
  ('e0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000003',
   'd0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000007',
   'c1000000-0000-0000-0000-000000000001','issue',
   'Bütçe onayı 6 gündür bekliyor',
   'Finans departmanı onay vermeden tedarikçi ile sözleşme imzalanamıyor. Zincirin tamamı bekliyor.',
   'open','critical','a0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000002',
   date '2026-09-04', now() - interval '12 day'),

  ('e0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000004',
   'd0000000-0000-0000-0000-000000000003', null,
   'c1000000-0000-0000-0000-000000000002','issue',
   'Sevkiyat tarihi etkinlikten sonraya düşüyor',
   'Tedarikçi teslim tarihi 3 Eylül; etkinlik 28 Ağustos.',
   'in_progress','critical','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001',
   date '2026-09-10', now() - interval '11 day'),

  ('e0000000-0000-0000-0000-000000000003','b0000000-0000-0000-0000-000000000005',
   'd0000000-0000-0000-0000-000000000003', null,
   'c1000000-0000-0000-0000-000000000003','task',
   'Teklif karşılaştırma tablosu hazırlanacak',
   'Üç tedarikçinin fiyat ve teslim süreleri yan yana konacak.',
   'open','high','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002',
   null, now() - interval '5 day');

insert into record_participants (record_id, user_id) values
  ('e0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000003'),
  ('e0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002'),
  ('e0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001'),
  ('e0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001'),
  ('e0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000002'),
  ('e0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000001');

insert into actions (record_id, title, owner_id, created_by, status, due_date) values
  ('e0000000-0000-0000-0000-000000000001','Finans ile toplantı ayarla',
   'a0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000002','open', date '2026-09-02'),
  ('e0000000-0000-0000-0000-000000000002','Tedarikçiden fiyat kilidi al',
   'a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','open', date '2026-09-08');

insert into messages (chat_id, author_id, body, created_at) values
  ('c1000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002',
   'Finans bugün dönmedi, yarın tekrar arayacağım.', now() - interval '20 minute');

insert into activity (chat_id, actor_id, verb, subject_label, target_label) values
  ('c1000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002',
   'action_added','Finans ile toplantı ayarla','Selin');
