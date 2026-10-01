# 22 — Takımlar ve pillar'lar ağaçtan ayrıldı

Durum: **karar** (2026-10-01). Hedef şema `db-scheme-export.sql`'de (ER görünümü).
KNOW-261 (pillar ağaçta düğüm) ve KNOW-262 (takım = düğüm projeksiyonu) **geçersiz**.

## Model

```
pillars ── team_id ──> teams ── chat_id ──> chats     (her pillar'ın ÖZEL takımı, 1:1)
records ── pillar_id ──> pillars                       (kayıt ↔ pillar, ortogonal)
teams ──< team_nodes >── nodes                          (takım ↔ ağaç, N:M)
```

- Ağaç yalnız **yapı**: `nodes.node_type` artık `team` ve `pillar` almaz
  (`cell, machine, task, step, operational, generic`).
- **Takım** bağımsız varlık: ağaçtan değil `/api/teams`'ten açılır. Ağaçla bağı
  `team_nodes` (bir takım birçok düğümde, bir düğümde birçok takım).
- **Pillar** bağımsız varlık, düğüme bağlanmaz. Her pillar'ın **bir özel takımı**
  var (`pillars.team_id`, NOT NULL, UNIQUE, ON DELETE RESTRICT). Pillar'ın üyeleri ve
  sohbeti = özel takımının üyeleri ve sohbeti. Sıradan takımların pillar alanı YOK.
- Özel takımın adı pillar'ın adıdır; pillar yeniden adlandırılınca takım da.
  `teams.name` UNIQUE olduğu için çakışma `409 name_taken`.

## Göç: `backend/migrations/002_teams_pillars.sql`

Tek işlem, kurulu veritabanında veri kaybetmeden:

1. `pillars`, `team_nodes` tabloları (şema `db-scheme-export.sql` ile birebir).
2. `team` türlü her düğüm: `teams.node_id = düğüm` olan takım için, düğümün
   **üstü** varsa `team_nodes(team_id, parent_id)` (takım o birimde çalışıyordu).
3. `pillar` türlü her düğüm: yeni sohbet + takım (ad = düğüm adı; çakışırsa
   `"<ad> (pillar)"`) + `pillars` satırı **aynı uuid'le** (`pillars.id = nodes.id`) —
   `records.pillar_id` değerleri geçerli kalır. `is_active`, `sort_order`,
   `description`, `created_by` düğümden.
4. `records.pillar_id` FK'si `nodes` yerine `pillars`'a.
5. `team`/`pillar` düğümlerinin çocukları düğümün üstüne taşınır, sonra bu
   düğümler silinir (`user_node_scopes` satırları cascade ile gider).
6. `teams.node_id`, `teams_node_uniq`, `teams_node_id_fkey` düşer.
7. `nodes_node_type_check` yeni küme.

## API sözleşmesi

Yetki: takım ve pillar **yazmaları** `manage_teams` kapsamı ya da admin. Pillar
**silme** yalnız admin. Okumalar giriş yapmış herkese.

### `GET /api/meta` (değişen alanlar)

```ts
type NodeType = "cell" | "machine" | "task" | "step" | "operational" | "generic";

interface MetaTeam {
  id: Uuid; name: string; description: string | null; color: string | null;
  chat_id: Uuid;
  node_ids: Uuid[];          // team_nodes; ad sırasıyla değil, ağaç sırasıyla gerekmez
  pillar_id: Uuid | null;    // bu takım bir pillar'ın ÖZEL takımıysa o pillar
}

interface MetaPillar {
  id: Uuid; name: string; description: string | null; color: string | null;
  team_id: Uuid; is_active: boolean; sort_order: number;
}

interface Meta { me; users; teams: MetaTeam[]; pillars: MetaPillar[]; nodes }
// pillars: sort_order, sonra ad. Pasifler de gelir (is_active ile).
```

### Takımlar

| Uç | Gövde | Yanıt | Hatalar |
|---|---|---|---|
| `POST /api/teams` | `{ name, description: string\|null, color: string\|null }` | `201 { id }` — sohbetiyle birlikte | `400 invalid_name`, `409 name_taken`, `403` |
| `PATCH /api/teams/{id}` | `{ name?, description?, color? }` (yok = değişmez, `null` = sil) | `204` | `409 name_taken`, `409 team_is_pillar` (özel takımın **adı** buradan değişmez, pillar'dan) |
| `DELETE /api/teams/{id}` | — | `204`; `records.team_id` NULL olur, sohbet tetikleyiciyle gider | `409 team_is_pillar` |
| `PUT /api/teams/{id}/nodes/{node}` | — | `204` (idempotent) | `400 invalid_node` (yok ya da pasif) |
| `DELETE /api/teams/{id}/nodes/{node}` | — | `204` (yoksa da 204) | |

`GET /api/teams`, `GET /api/teams/{id}`, üyelik uçları değişmez. Her yazma
takım sohbetine `activity` bırakır (mevcut üyelik kalıbı): fiiller
`team_created`, `team_renamed`, `team_node_linked`, `team_node_unlinked`
(`target_label` = düğüm adı).

### Pillar'lar

| Uç | Gövde | Yanıt | Hatalar |
|---|---|---|---|
| `POST /api/pillars` | `{ name, description: string\|null, color: string\|null }` | `201 { id, team_id }` — sohbet + özel takım + pillar tek işlemde | `400 invalid_name`, `409 name_taken` |
| `PATCH /api/pillars/{id}` | `{ name?, description?, color?, is_active?, sort_order? }` | `204`; ad/açıklama/renk özel takıma da yazılır | `409 name_taken` |
| `DELETE /api/pillars/{id}` | — | `204`; pillar + özel takımı + sohbeti gider, `records.pillar_id` NULL | `403` (admin değil) |

Pillar listesi ayrı uç değil: `meta.pillars`. Pillar sayfası özel takımın
`GET /api/teams/{team_id}`'sini ve `GET /api/records?pillar={id}`'yi kullanır.

### Kayıtlar

- `pillar_id` artık `pillars.id`; geçerlilik: var ve `is_active` (`400 invalid_pillar`).
- `?pillar=` süzgeci `pillars` tablosuna bakar (`none` aynen).

### Ağaç (`/api/nodes`)

- `root_types` / `child_types` `team` ve `pillar` içermez; o türle yazma `400 invalid_type`.
- Takım projeksiyonu kodu (düğümden takım doğurma/eşleme) silinir.
- `delete_counts`'a `teams: number` eklenir (bağlı `team_nodes` sayısı) — silme
  onayı "3 takımın bağı kopacak" diyebilsin. Bağ silmeyi engellemez (cascade).
