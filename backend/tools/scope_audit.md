| endpoint | code checks | jev scopes (p>0.7) | jev actor | flag |
|---|---|---|---|---|
| `GET /api/auth/dev-login` | no_session | - | admin_only (0.91) | actor: code anyone_logged_in vs jev admin_only |
| `GET /api/meta` | is_admin, membership | - | anyone_logged_in (1.00) | actor: code record_member vs jev anyone_logged_in |
| `PATCH /api/me/profile` | owner_id | - | anyone_logged_in (0.98) | actor: code owner_or_editor vs jev anyone_logged_in |
| `GET /api/home` | owner_id | - | anyone_logged_in (1.00) | actor: code owner_or_editor vs jev anyone_logged_in |
| `GET /api/records` | owner_id | - | anyone_logged_in (0.62) | actor: code owner_or_editor vs jev anyone_logged_in |
| `POST /api/records` | owner_id | - | anyone_logged_in (0.48) | actor: code owner_or_editor vs jev anyone_logged_in |
| `GET /api/records/{id}` | is_admin, can_edit, owner_id, membership | - | anyone_logged_in (0.47) | actor: code owner_or_editor/record_member vs jev anyone_logged_in |
| `POST /api/records/{id}/join` | is_admin, can_edit, owner_id, membership | - | anyone_logged_in (0.86) | actor: code owner_or_editor/record_member vs jev anyone_logged_in |
| `DELETE /api/records/{id}/join` | is_admin, can_edit, owner_id, membership | - | anyone_logged_in (0.63) | actor: code owner_or_editor/record_member vs jev anyone_logged_in |
| `PUT /api/records/{id}/pin` | is_admin, can_edit, owner_id, membership | - | anyone_logged_in (0.77) | actor: code owner_or_editor/record_member vs jev anyone_logged_in |
| `GET /api/actions/mine` | owner_id | - | anyone_logged_in (0.95) | actor: code owner_or_editor vs jev anyone_logged_in |
| `POST /api/events` | owner_id | - | anyone_logged_in (0.34) | actor: code owner_or_editor vs jev anyone_logged_in |
| `GET /api/events/{id}` | manage_events, can_manage, can_edit, owner_id | - | owner_or_editor (0.42) | code has manage_events, jev p=0.17 |
| `GET /api/events/{id}/otf.docx` | session_only | - | owner_or_editor (0.46) | actor: code anyone_logged_in vs jev owner_or_editor |
| `POST /api/materials/{id}/providers` | manage_events, manage_purchases, can_manage, can_edit, owner_id | manage_purchases | scope_holder (1.00) | code has manage_events, jev p=0.24 |
| `GET /api/chats/{id}/feed` | can_edit | - | record_member (0.75) | actor: code owner_or_editor vs jev record_member |
| `GET /api/teams` | membership | - | anyone_logged_in (0.83) | actor: code record_member vs jev anyone_logged_in |
| `GET /api/teams/{id}` | membership | - | anyone_logged_in (0.58) | actor: code record_member vs jev anyone_logged_in |
| `GET /api/notifications` | owner_id, membership | - | anyone_logged_in (0.98) | actor: code owner_or_editor/record_member vs jev anyone_logged_in |
| `GET /api/nodes` | branch/NodeAccess | - | anyone_logged_in (0.72) | actor: code branch_editor vs jev anyone_logged_in |
| `POST /api/nodes` | edit_nodes, hard_delete_nodes, manage_event_types, manage_event_locations, branch/NodeAccess, owner_id | edit_nodes | branch_editor (0.95) | code has hard_delete_nodes, jev p=0.03; code has manage_event_types, jev p=0.17; code has manage_event_locations, jev p=0.11 |
| `PATCH /api/nodes/{id}` | edit_nodes, hard_delete_nodes, manage_event_types, manage_event_locations, branch/NodeAccess | edit_nodes | branch_editor (0.94) | code has hard_delete_nodes, jev p=0.04; code has manage_event_types, jev p=0.11; code has manage_event_locations, jev p=0.09 |
| `DELETE /api/nodes/{id}` | edit_nodes, hard_delete_nodes, manage_event_types, manage_event_locations, branch/NodeAccess | hard_delete_nodes | scope_holder (0.68) | code has manage_event_types, jev p=0.16; code has manage_event_locations, jev p=0.12 |
| `POST /api/attachments` | is_admin, owner_id | - | record_member (0.44) | actor: code owner_or_editor vs jev record_member |
| `GET /api/attachments/{id}` | owner_id | - | anyone_logged_in (0.47) | actor: code owner_or_editor vs jev anyone_logged_in |
| `GET /api/attachments/{id}/thumb` | owner_id | - | anyone_logged_in (0.49) | actor: code owner_or_editor vs jev anyone_logged_in |
| `POST /api/attachments/{id}/tags` | create_tags, tag_media, is_admin, can_edit, owner_id, membership | tag_media | scope_holder (0.86) | code has create_tags, jev p=0.28 |
