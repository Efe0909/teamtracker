# tohumlar/ — durum anlık görüntüleri (`.sql`)

`tools/durum.py` buraya yazar, buradan okur (`spec/80-veritabani.md` §10):

```bash
.venv/bin/python tools/durum.py disa-aktar -o yedek   # tohumlar/yedek.sql
.venv/bin/python tools/durum.py yukle yedek           # geri yükle
.venv/bin/python tools/durum.py yukle varsayilan      # depodaki shared/seed.py
```

Dosyalar **git'e girmez** (`.gitignore`): dışa aktarım gerçek kart içeriği ve
kullanıcı e-postaları taşır — veritabanı dosyasıyla aynı hassasiyet. Paylaşmak
istediğin bir örnek varsa önce içini temizle, sonra bilerek `git add -f` yap.

Dökümleri başka bir yerde tutmak için: `EKIPTAKIP_TOHUMLAR=/yol/dizin`.
