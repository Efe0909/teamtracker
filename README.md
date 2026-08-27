# EkipTakip — alpha-0.1 (Faz 1)

Tek dikey dilim: hiyerarşi + kayıtlar + kart içi sohbet + alan değişiklikleri.
Yığın: Python 3.12 + FastAPI + Jinja2 + HTMX + SQLite, ham SQL, ORM yok, JS framework yok.

## Çalıştır

```bash
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python fastapi "uvicorn[standard]" jinja2 python-multipart pytest httpx
.venv/bin/python seed.py                  # ekiptakip.db'yi siler ve yeniden tohumlar
.venv/bin/uvicorn app:app --workers 1 --reload
```

`--workers 1` şart: ağaç indeksi süreç belleğinde (00-BASLA.md Karar 2).

## Test

```bash
.venv/bin/python -m pytest tests -q
```

`tests/test_tree.py` TreeIndex birim testleri, `tests/test_api.py` altı kabul kriterinin
uç karşılığı (403 dahil).

## Dosyalar

| Dosya | Ne |
|---|---|
| `app.py` | uçlar, gruplama/sıralama, sistem olayı yazımı |
| `db.py` | ham SQL yardımcıları, `new_id()`, `now()`, `as_bool()` |
| `tree.py` | `TreeIndex` — Euler tour, `is_descendant` O(1) |
| `auth.py` | `current_user` (Faz 2'de OAuth), `can_edit_item` |
| `schema.sql` | Faz 1 tabloları (users, nodes, items, item_participants, events) |
| `seed.py` | `layout-a.html`'deki ağaç, kartlar ve akış |
| `templates/base.html` | tek yerleşim dosyası |
| `templates/fragments/*` | layout'tan bağımsız parçalar (skin kuralı) |
| `static/app.css` | `layout-a.html`'den alınan token'lı CSS |

## Sahte kullanıcılar (Faz 1)

| Kişi | Yetki | Kapsam |
|---|---|---|
| Efe (varsayılan) | editor | Malzeme Temini |
| Selin | admin | tüm ağaç |
| Deniz | — | Üretim Hattı A |

Rayın altındaki avatardan değiştirilir (`POST /switch/{user_id}`, çerez `uid`).

## Uçlar

`GET /` · `GET /panel/inbox` · `GET /panel/tree` · `GET /node/{id}/items` ·
`GET /item/{id}` · `POST /item/{id}/message` · `PATCH /item/{id}/field` · `POST /item` ·
`GET /whoami` · `POST /switch/{user_id}`

Tam sayfa / parça ayrımı `HX-Request` başlığıyla.

## Faz 1'de yok

Giriş/OAuth, push, pivot, panel, talep akışı (`change_requests`), IWS terfisi, dosya ekleme.
