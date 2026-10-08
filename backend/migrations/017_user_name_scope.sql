-- Kullanici adini degistirme kapsami: sahibi kendi adini ve baskasininkini
-- degistirir. Bu kapsam yoksa ad herkes icin salt okunur (yalniz ilk ekleme).
insert into scopes (name) values ('edit_user_names')
on conflict (name) do nothing;
