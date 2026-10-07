# Demo: seed data, guided capture, PDF guide

Everything here runs against a **local throw-away stack**. It never touches production data:
the database is called `ekiptakip_demo`, auth is the fake identity (`EKIPTAKIP_AUTH=sahte`),
and every person, e-mail (`@demo.example`), phone (`0555 000 xx xx`), event and record is fiction.

The pipeline has three stages, each usable on its own:

```
demo/stack.sh seed          seed/        capture/                pdf/
 empty DB + API + Vite  ->  API replay -> Playwright walkthrough -> EkipTakip-Rehber.pdf + GUIDE.md
```

| Path | What it is |
|---|---|
| `stack.sh` | Brings up/tears down the demo stack (Postgres DB, Rust API, Vite) and snapshots/restores the seeded DB |
| `seed/` | Python replay of a lived-in club history **through the real API** (not `backend/seed.sql`) |
| `capture/` | Playwright walkthrough: 24 chapters, one persona each, writes `shots/*.jpg` + `steps.json` |
| `pdf/build.mjs` | Turns `steps.json` + `shots/` into a Scribe-style 16:9 PDF and a GitHub-readable `GUIDE.md` |
| `guide/` | Generated guide (screenshots, PDF, Markdown). Committed on the `claude/demo` branch only |
| `out/` | Logs, media, scratch output. Git-ignored |

## Requirements

- PostgreSQL 16 reachable on `127.0.0.1:5432` with user/password `ekiptakip` (`docker compose up -d` works, so does a native install)
- Rust toolchain (the API is built with `cargo build` on first use) and Node 20+ (`npm ci` runs in `frontend/` on first use)
- Python 3 (standard library only; developed on 3.13), `psql`, `lsof`
- Playwright with Chromium (`npm i -g playwright`); the scripts also look it up in the global `node_modules`

## Run it

```bash
demo/stack.sh seed                      # empty DB + seed + snapshot (API :8000)
demo/stack.sh up                        # API :8000 + Vite :5173 (no-op if already running)

node demo/capture/run.mjs               # all 24 chapters -> demo/guide/ (steps.json + shots/)
node demo/capture/run.mjs --only gorevler,takimlar    # a few chapters -> demo/out/dev/

node demo/pdf/build.mjs                 # demo/guide/EkipTakip-Rehber.pdf + GUIDE.md
node demo/pdf/build.mjs --no-pdf        # HTML only (fast); open demo/guide/pdf/index.html
```

The capture changes data (it creates records, an event, a team, a user…). Run
`demo/stack.sh restore` before every capture so each run starts from the same snapshot.
The PDF's unit tree, event types, locations and people come from the **clean snapshot**
(`ekiptakip_demo_snap`), not from the working database. Override the connection with `SNAP_PSQL`.

## What the seed contains

- **People:** 9 active users plus one who left the club; one admin, five roles, branch grants
- **Structure:** 5 teams, 2 pillars, and exactly one unit subtree (`Etkinlik`, below)
- **Reference data:** 8 event types (with step/widget templates) and 6 event locations
- **History:** 41 records (open, pending, in progress, closed, cancelled), 45 actions, cards (pool, poll, meeting),
  ~120 chat messages with replies, mentions and image attachments
- **Events:** 10 events spanning the whole lifecycle (done, cancelled, confirmed, planning, idea), timeline checkpoints,
  an OTF form and a purchases list

```
Etkinlik(Cell)
    |Takvim Planlama(Makine)
    |   |Etkinlik fikiri bulma(Görev)
    |   |Takvim Oluşturma(Görev)
    |Etkinlik Planlama(Makine)
    |   |Katılımcı Sayısı Belirleme(Adım)
    |   |Mekan ve Yer Seçimi(Adım)
    |   |Malzeme ve Kaynak Planlama(Görev)
    |   |Etkinlik Öncesi Hazırlık(Görev)
    |   |Ekip ve Görev Dağılımı(Görev)
    |SEB iletişim(Makine)
    |   |ETF(Adım)
    |   |OTF(Adım)
    |   |Ek talepler(Görev)
```

Every unit has a one-line description (see `seed/structure.py`). Names are kept exactly as specified,
including `Etkinlik fikiri bulma`. The API requires names of at least 5 characters, so the two short units
`ETF` and `OTF` are inserted with SQL after the rest of the tree is created through the API.

## Determinism

- **Time zone:** sqlx pins the DB connection to UTC, so the seed, the browser (`timezoneId: "UTC"`) and `TZ` all use UTC.
- **Virtual clock:** the seed replays history through the API, then shifts the `timestamptz` columns so that
  "today" lines up with the real run date. Dates in the stories are anchored to it (`seed/cal.py`), so
  *overdue / this week / in 3 days* stay true whenever you run it.
- **Capture clock:** the browser's `Date#getHours` is pinned to 10:00 so greetings are stable.
  Chat lines created *during* a capture (a sent message, a system line) still show the real run time.
- **Locale:** Chromium is launched with `--lang=tr-TR` and a Turkish process locale so native time inputs use 24 h.
- **Overrides in the browser context** (`capture/lib.mjs`): `/api/meta` is answered with `external_off: []` (no integration shows as
  switched off) and `GET /api/admin/quality` with `service_on: true`, so the admin screens render their full state without real integrations.

## Capture framework

`capture/chapters/NN-name.mjs` default-exports `{ id, title, persona, role, intro, run({ R, open }) }`.
`const { page } = await open("Kaan Demir")` returns a page logged in as that person (dev login). Each `R.step(page, {...})`:

| Option | Meaning |
|---|---|
| `id`, `title`, `text`, `tip` | Step identity and the caption (Turkish, `**bold**` allowed) |
| `target` | A Playwright locator, `{x,y,w,h}`, `{t, label}`, or an array of them: the area to highlight |
| `act` | The action to perform **after** the screenshot (usually the click being described) |
| `click` | Draw a cursor on the target; defaults to `true` when `act` is given, `false` for look-only steps |
| `hover` | Hover this locator before the shot (controls that only show on hover, like pencil icons) |
| `wait`, `after` | Milliseconds to settle before the shot (default 250) and after `act` (default 350) |
| `clipTo`, `clipPad` | Crop tall pages (run in a taller viewport) at the bottom of a locator, plus padding |

Screenshots are **clean** (no rings, badges or cursor); the highlight layer is drawn by `pdf/build.mjs` from the
measured boxes in `steps.json`, so restyling the guide never needs a re-capture.
To add a chapter, drop a new file in `capture/chapters/`; chapters run in file-name order.

## PDF builder

`pdf/build.mjs` renders one 1920×1080 page per step (vector dim layer with holes, orange ring, numbered badge, cursor,
labelled regions for overview steps, phone frame for mobile), plus cover, how-to-read, cast, unit tree, unit table,
event types and locations, table of contents with links, chapter dividers, tips and a closing page.

- Screenshots are down-scaled through a Chromium canvas first (desktop 1560 px wide, phone 660 px, JPEG q0.8); the originals stay untouched.
- Blurred CSS shadows and SVG `<mask>` are avoided on purpose: Chromium embeds both as raster images. The same 318 pages came out at 85 MB with blur shadows, 48 MB with the mask, and 39 MB (screenshots only) with vector shapes.
- The app's own modal backdrop is detected from the screenshot's top-left corner, and the extra dim is skipped in that case.
- The PDF has bookmarks (`outline`) and is tagged; `GUIDE.md` has the same content with relative image links (`shots/…`).

## Notes for whoever reuses this

- The caption language is Turkish because the UI is Turkish; identifiers, file names and routes are English.
- `ETF` / `SEB` are not expanded anywhere because the source brief did not define them; the one-line unit descriptions were written for the demo.
- The Activity matrix and a few product strings use English month/day names; that is the product, not the guide.
