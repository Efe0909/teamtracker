-- Dugumlere aciklama alani (veri yonetimi ekrani).
--
-- Ad tek basina yetmiyor: "Bütçe Onayı" ne demek, sinirlari ne, kim sorumlu —
-- bunlar bugun kimsenin yazamadigi yerlerde kaliyor. Serbest metin YETERLI:
-- form-builder yok (spec/60-kaynak-uyarlama.md §4), yapilandirilmis alanlar
-- ihtiyac belirince ayri sutun olur.
--
-- nodes tablosu bellekteki TreeIndex'e de besleniyor ama aciklama ORAYA
-- GIRMEZ: agac indeksi gezinme icin, aciklama yalnizca detay ekraninda
-- okunuyor. Indekste tutmak her istekte tasinan yuku buyutur.

alter table nodes add column if not exists description text;
