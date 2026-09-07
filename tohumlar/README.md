# tohumlar/ — durum anlık görüntüleri (`.sql`)

`GET /test/disa-aktar?ad=<isim>` buraya yazar, `POST /test/yukle?yol=<isim>.sql`
buradan okur (`spec/70-guvenlik.md` §12). Yol bu dizine **hapsedilmiştir**:
dışarı çıkan bir yol ya da sembolik bağ 403 döner.

Dosyalar **git'e girmez** (`.gitignore`): dışa aktarım gerçek kart içeriği ve
kullanıcı e-postaları taşır — veritabanı dosyasıyla aynı hassasiyet. Paylaşmak
istediğin bir örnek varsa önce içini temizle, sonra bilerek `git add -f` yap.

Bilinen bir başlangıç noktasına dönmek için dosya gerekmez:

```bash
curl -X POST -H "X-Test-Anahtari: $EKIPTAKIP_TEST_ANAHTARI" \
  "http://127.0.0.1:8000/test/yukle?yol=varsayilan"     # shared/seed.py
```
