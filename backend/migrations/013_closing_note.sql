-- spec/76: `closed`'a geciste kapanis notu (iptal degil). Satirda durur, ayrica
-- kaydin akisina `closing_note` olgusu yazilir. Yeniden acmak notu siler.
-- Eski kapali satirlar notsuz kalir (null): kural yalniz yeni geciste.
alter table records add column closing_note text;
alter table actions add column closing_note text;
