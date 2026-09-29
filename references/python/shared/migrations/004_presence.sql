-- Varlik (presence): kim su an cevrimici, en son ne zaman gorundu.
--
-- Ayri bir "oturumlar" tablosu KURULMAZ. Oturum zaten imzali cerezde
-- (spec/70-guvenlik.md); burada tutulan sey oturum degil, son gorulme ANI.
-- Tek sutun yetiyor: "cevrimici" turetilmis bir soru — last_seen_at yeterince
-- yakin mi, o kadar.
--
-- last_login_at zaten vardi ve BASKA bir soruyu yanitliyor: "en son ne zaman
-- GIRIS yapti". Sekmesi acik duran biri gunlerce giris yapmadan cevrimici
-- olabilir; ikisi karistirilmamali.

alter table users add column if not exists last_seen_at timestamptz;

-- "Kim cevrimici" sorgusu sutunu tersten tarar; ekipteki herkesi listeleyen
-- ekranlar (sohbet basligi, ileride yonetim panosu) bunu kullanacak.
create index if not exists users_last_seen_idx on users(last_seen_at desc);
