// Yonetim paneli (R3-F01..F06): kisiler + roller. Kaynak: e02d71d
// `fragments/admin_main.html`. Yetki SUNUCUDA; `is_admin` yalniz admin'e
// ozel dugmeleri (admin yap, rol tanimi) gostermek icin. Duzenleme kontrolleri
// yerel <details> icinde: satir kapaliyken liste taranabilir kalir.

import { useEffect, useState } from "react";
import { ApiError, errorText } from "../../api/client";
import { adminOps, useAdmin, useAdminWrite, useRenameUser } from "../../api/hooks";
import type { AdminPerson, AdminRole, AdminView, Uuid, UserOp } from "../../api/types";
import { ago, NOTIFY, SCOPE } from "../../lib/labels";
import { useLookup } from "../../lib/lookup";
import { Icon } from "../../ui/icons";
import { Button, Empty, Loading, Picker as UiPicker, Req, Segmented, Tag, ui, useToast, type Option } from "../../ui/ui";
import { NodeTreePicker } from "../../features/nodes/NodePicker";
import { AdminAvatar, EditableAvatar } from "../../features/profile/EditableAvatar";
import { useStored } from "../../lib/stored";
import { AdminActivity } from "./AdminActivity";
import { AdminLlm } from "./AdminLlm";
import { AdminQuality } from "./AdminQuality";
import { ErrorScreen } from "../errors/ErrorScreen";
import s from "./dashboard.module.css";

type Tab = "people" | "activity" | "quality" | "llm";

const SUBTITLE: Record<Tab, string> = {
  people: "Kim girebilir, neyi değiştirebilir.",
  activity: "Kim ne zaman uğruyor, ne kadar iş çıkarıyor.",
  quality: "Kayıt ve kapanış notlarını tartan modelin soruları ve eşikleri.",
  llm: "Yapay zekâ çağrıları: model, limit, istem, maliyet, geçmiş ve modele giden verinin temizlenmesi.",
};

/** Modulu iki kapsam acar, kapsamlari ayri (spec/79 §11.7): `manage_users` kisiler ve
 *  aktivite, `manage_llm` LLM sekmesi; Kalite kapisi yalniz admin. Yetkin olmayan sekme
 *  KILITLI gorunur. Uclar yine kendisi kontrol eder. */
export function Admin() {
  const L = useLookup();
  const people = L.can("manage_users");
  const llm = L.can("manage_llm");
  const [tab, setTab] = useState<Tab>(people ? "people" : "llm");
  useEffect(() => {
    document.title = "Yönetim — EkipTakip";
  }, []);
  return (
    <div className={s.page} style={{ maxWidth: tab === "llm" ? 1180 : 960 }}>
      <div className={s.pageHead}>
        <div className={s.pageTitle}>
          <h1>Yönetim</h1>
          <p className={s.pageSub}>{SUBTITLE[tab]}</p>
        </div>
      </div>
      <Segmented label="Yönetim bölümü" value={tab} onChange={setTab}
        options={[
          { value: "people", label: "Kişiler ve roller", locked: !people },
          { value: "activity", label: "Aktivite", locked: !people },
          // Soru metni kayıt kararlarını değiştirir: yalnız admin (uç da 403 verir).
          { value: "quality", label: "Kalite kapısı", locked: !L.meta.me.is_admin },
          { value: "llm", label: "Veri işleme ve LLM", locked: !llm },
        ]} />
      {tab === "quality" ? <AdminQuality /> : tab === "activity" ? <AdminActivity />
        : tab === "llm" ? <AdminLlm /> : <People />}
    </div>
  );
}

function People() {
  const q = useAdmin();
  if (q.error !== null)
    return <ErrorScreen code={q.error instanceof ApiError && q.error.code === "forbidden" ? "forbidden" : "network"} />;
  if (q.data === undefined) return <Loading />;
  return <PeopleScreen v={q.data} />;
}

function PeopleScreen({ v }: { v: AdminView }) {
  const roleById = new Map(v.roles.map((r) => [r.id, r]));
  const [peopleOpen, setPeopleOpen] = useStored("admin.people.open", true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  return (
    <>
      <h2 className={s.sectionTitle}>Kişi ekle</h2>
      <AddUser />
      <h2 className={s.sectionTitle}>
        <button type="button" className={s.navHeadBtn} aria-expanded={peopleOpen} onClick={() => setPeopleOpen(!peopleOpen)}
          style={{ font: "inherit", color: "inherit", padding: 0 }}>
          <Icon name="chevron" size={14} /> Kullanıcılar<span className={s.count}>{v.people.length}</span>
        </button>
      </h2>
      {!peopleOpen ? null : v.people.length === 0 ? (
        <Empty title="Liste boş.">Yukarıdan ilk kullanıcıyı ekle.</Empty>
      ) : (
        <>
          {selected.size > 0 && <BulkBar v={v} selected={selected} onClear={() => setSelected(new Set())} />}
          <ul className={`${s.surface} ${s.adminList}`}>
            {v.people.map((p) => (
              <PersonRow key={p.id} p={p} v={v} roleById={roleById} checked={selected.has(p.id)}
                onCheck={(on) => setSelected((prev) => {
                  const next = new Set(prev);
                  if (on) next.add(p.id); else next.delete(p.id);
                  return next;
                })} />
            ))}
          </ul>
        </>
      )}
      <h2 className={s.sectionTitle}>
        Roller<span className={s.count}>{v.roles.length}</span>
      </h2>
      <p className={s.lead} style={{ marginTop: -6 }}>
        Rol bir kapsam demeti. Rolün kapsamlarını değiştirmek sahiplerine anında yansır. Oluşturma ve silme yalnız
        yöneticide.
      </p>
      <Roles v={v} />
    </>
  );
}

function AddUser() {
  const m = useAdminWrite();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className={`${s.surface} ${s.adminForm} ${ui.formStack}`}
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        m.mutate(adminOps.addUser(email, name), {
          onSuccess: () => {
            // Form sessizce bosalinca "oldu mu?" sorusu kaliyordu.
            toast({ text: `${name} eklendi.`, error: false });
            setEmail("");
            setName("");
          },
          onError: (x) => setErr(errorText(x)),
        });
      }}
    >
      {err !== null && <p className={ui.error} role="alert">{err}</p>}
      <div className={ui.grid2}>
        <label className={ui.field}>
          <span>E-posta<Req /></span>
          <input className={ui.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
            placeholder="ad@ornek.com" autoComplete="off" spellCheck={false} />
        </label>
        <label className={ui.field}>
          <span>Ad<Req /></span>
          <input className={ui.input} value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} />
        </label>
      </div>
      <p className={s.dim}>Eklenen kişi bu e-postanın Google hesabıyla girer. Listede olmayan e-posta giremez. Kişiye davet postası (telefona kurulum + bildirim anlatımı) otomatik hazırlanır.</p>
      <div className={ui.dact}>
        <Button type="submit" variant="primary" aria-busy={m.isPending} disabled={m.isPending}>
          {m.isPending ? "Ekleniyor…" : "Kullanıcı ekle"}
        </Button>
      </div>
    </form>
  );
}

const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** "Bildirim: yalnız anmalar · sessiz 22:00–07:00 · 2 cihaz · 1 sohbet özel" */
function notifySummary(p: AdminPerson): string {
  const parts = [`Bildirim: ${NOTIFY[p.notify_level].short}`];
  if (p.quiet_start !== null && p.quiet_end !== null) parts.push(`sessiz ${hh(p.quiet_start)}–${hh(p.quiet_end)}`);
  parts.push(p.push_devices === 0 ? "anlık bildirim cihazı yok" : `${p.push_devices} cihaz`);
  if (p.chat_overrides > 0) parts.push(`${p.chat_overrides} sohbet özel`);
  return parts.join(" · ");
}

/** Seçili kişilere toplu işlem: rol ver/al, hesabı kapat/aç. Sunucu her kişiyi
 *  ayrı doğrular (son yönetici, yönetici kapatma kuralları); başarısızlar sayılır. */
function BulkBar({ v, selected, onClear }: { v: AdminView; selected: Set<string>; onClear: () => void }) {
  const m = useAdminWrite();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const people = v.people.filter((p) => selected.has(p.id));
  const apply = async (label: string, op: (p: AdminPerson) => UserOp | null) => {
    setBusy(true);
    let ok = 0, failed = 0;
    for (const p of people) {
      const o = op(p);
      if (o === null) continue;
      try {
        await m.mutateAsync(adminOps.user(p.id, o));
        ok += 1;
      } catch {
        failed += 1;
      }
    }
    setBusy(false);
    toast({ text: `${label}: ${ok} kişi tamam${failed > 0 ? `, ${failed} kişide yapılamadı` : ""}.`, error: failed > 0 });
  };
  return (
    <div className={s.bulkBar} role="region" aria-label="Toplu işlemler">
      <b>{people.length} kişi seçili</b>
      <Grant label="Rol ver" empty="Rol yok." options={v.roles.map((r) => ({ value: r.id, label: r.name }))}
        onPick={(id) => void apply("Rol verildi", (p) => (p.role_ids.includes(id) ? null : { op: "grant_role", value: id }))} />
      <Grant label="Rol al" empty="Rol yok." options={v.roles.map((r) => ({ value: r.id, label: r.name }))}
        onPick={(id) => void apply("Rol alındı", (p) => (p.role_ids.includes(id) ? { op: "revoke_role", value: id } : null))} />
      <Button size="sm" disabled={busy}
        onClick={() => void apply("Hesap kapatıldı", (p) => (p.is_active ? { op: "active", value: false } : null))}>Hesapları kapat</Button>
      <Button size="sm" disabled={busy}
        onClick={() => void apply("Hesap açıldı", (p) => (p.is_active ? null : { op: "active", value: true }))}>Hesapları aç</Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={onClear}>Seçimi temizle</Button>
    </div>
  );
}

/** Duzenleme taslagi: kaydedilene kadar yalniz burada; kayitli durum sunucudan gelir. */
type Draft = { name: string; scopes: string[]; roles: Uuid[]; nodes: Uuid[] };

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
const diff = (next: string[], prev: string[]) => ({
  added: next.filter((x) => !prev.includes(x)),
  removed: prev.filter((x) => !next.includes(x)),
});

function PersonRow({ p, v, roleById, checked, onCheck }: {
  p: AdminPerson; v: AdminView; roleById: Map<string, AdminRole>; checked: boolean; onCheck: (on: boolean) => void;
}) {
  const L = useLookup();
  const toast = useToast();
  const m = useAdminWrite();
  const rename = useRenameUser();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const canName = L.can("edit_user_names");
  const run = (op: UserOp) =>
    m.mutate(adminOps.user(p.id, op), { onError: (e) => toast({ text: errorText(e), error: true }) });
  // Rolden gelenler sunucuda birlikte gelir; burada yalniz gosterim ve secicide haric tutma.
  const held = v.roles.filter((r) => p.role_ids.includes(r.id));
  const roleScopes = new Set(held.flatMap((r) => r.scopes));
  const roleNodes = new Set(held.flatMap((r) => r.node_ids));
  const savedScopes = p.scopes.filter((r) => r.direct).map((r) => r.name);
  const visibleScopes = savedScopes.filter((k) => !roleScopes.has(k));
  const saved: Draft = { name: p.name, scopes: savedScopes, roles: p.role_ids, nodes: p.node_ids };
  const cur = draft ?? saved;
  const edit = (change: (d: Draft) => Draft) => setDraft((prev) => change(prev ?? saved));
  const nameOk = cur.name.trim() !== "";
  const dirty = draft !== null && (draft.name.trim() !== p.name || !sameSet(draft.scopes, savedScopes)
    || !sameSet(draft.roles, p.role_ids) || !sameSet(draft.nodes, p.node_ids));

  // Ad once, sonra kapsam/rol/dal farki; sirayla gider. Basarisizlar sayilir, tasla kalir.
  const save = async () => {
    if (draft === null) return;
    const name = draft.name.trim();
    const sc = diff(draft.scopes, savedScopes);
    const rl = diff(draft.roles, p.role_ids);
    const nd = diff(draft.nodes, p.node_ids);
    const plan: Array<() => Promise<unknown>> = [
      ...(canName && name !== "" && name !== p.name ? [() => rename.mutateAsync({ id: p.id, name })] : []),
      ...sc.removed.map((k) => () => m.mutateAsync(adminOps.user(p.id, { op: "revoke_scope", value: k }))),
      ...sc.added.map((k) => () => m.mutateAsync(adminOps.user(p.id, { op: "grant_scope", value: k }))),
      ...rl.removed.map((id) => () => m.mutateAsync(adminOps.user(p.id, { op: "revoke_role", value: id }))),
      ...rl.added.map((id) => () => m.mutateAsync(adminOps.user(p.id, { op: "grant_role", value: id }))),
      ...nd.removed.map((id) => () => m.mutateAsync(adminOps.user(p.id, { op: "revoke_node", value: id }))),
      ...nd.added.map((id) => () => m.mutateAsync(adminOps.user(p.id, { op: "grant_node", value: id }))),
    ];
    setBusy(true);
    let failed = 0;
    for (const step of plan) {
      try {
        await step();
      } catch {
        failed += 1;
      }
    }
    setBusy(false);
    if (failed === 0) {
      setDraft(null);
      toast({ text: `${name || p.name} kaydedildi.`, error: false });
    } else {
      toast({ text: `${failed} değişiklik yapılamadı.`, error: true });
    }
  };

  return (
    <li className={s.person}>
      <div className={s.personHead}>
        <input type="checkbox" checked={checked} onChange={(e) => onCheck(e.target.checked)}
          aria-label={`${p.name} seç`} />
        {p.id === L.me.id
          ? <EditableAvatar user={L.me} size={32} />
          : <AdminAvatar user={L.user(p.id) ?? { ...L.me, id: p.id, name: p.name, color: p.color, avatar_id: null }} size={32}
              busy={m.isPending} onPick={(a) => run({ op: "avatar", value: a })} />}
        <div>
          <b>{p.name}</b> <span className={s.dim}>{p.email}</span>
          <div className={s.dim}>
            {p.last_seen_at === null ? "hiç girmedi" : `son görülme ${ago(p.last_seen_at)}`}
          </div>
          <div className={s.dim}>{notifySummary(p)}</div>
        </div>
        {p.is_admin && <Tag tone="info">Yönetici</Tag>}
        {!p.is_active && <Tag tone="critical">Kapalı</Tag>}
      </div>

      <div className={s.chips}>
        {held.map((role) => (
          <span key={role.id} className={s.chip} style={{ borderColor: role.color }}>
            <span className={s.roleDot} style={{ backgroundColor: role.color }} />
            {role.name}
          </span>
        ))}
        {p.is_admin ? (
          <span className={s.dim}>Yönetici bütün kapsamlara sahip.</span>
        ) : (
          visibleScopes.map((k) => (
            <span key={k} className={s.chip} title={SCOPE[k] ?? k}>{k}</span>
          ))
        )}
        {!p.is_admin && held.length === 0 && visibleScopes.length === 0 && <span className={s.dim}>Kapsam yok.</span>}
      </div>

      <details className={s.personEdit}>
        <summary>Düzenle</summary>

        <div className={s.adminRow}>
          <span className={s.adminKey}>Ad</span>
          {canName ? (
            <input className={ui.input} aria-label={`${p.name} adı`} value={cur.name} maxLength={200} disabled={busy}
              onChange={(e) => edit((d) => ({ ...d, name: e.target.value }))} />
          ) : (
            <span>{p.name}</span>
          )}
        </div>

        <div className={s.adminRow}>
          <span className={s.adminKey}>Kapsam</span>
          <div className={s.chips}>
            {cur.scopes.filter((k) => !roleScopes.has(k)).map((k) => (
              <span key={k} className={s.chip} title={SCOPE[k] ?? k}>
                {k}
                <button type="button" className={s.chipX} aria-label={`${k} kapsamını kaldır`}
                  onClick={() => edit((d) => ({ ...d, scopes: d.scopes.filter((x) => x !== k) }))}><Icon name="x" size={12} /></button>
              </span>
            ))}
            <Grant label="Kapsam ver" empty="Verilecek kapsam yok."
              options={v.scopes.filter((k) => !cur.scopes.includes(k) && !roleScopes.has(k)).map((k) => ({ value: k, label: k, desc: SCOPE[k] ?? "" }))}
              onPick={(k) => edit((d) => ({ ...d, scopes: [...d.scopes, k] }))} />
          </div>
        </div>

        {cur.scopes.some((k) => roleScopes.has(k)) && (
          <div className={s.adminRow}>
            <span className={s.adminKey}>Rolde de olan doğrudan kapsam</span>
            <div className={s.chips}>
              {cur.scopes.filter((k) => roleScopes.has(k)).map((k) => (
                <span key={k} className={s.chip}>
                  {k}
                  <button type="button" className={s.chipX} aria-label={`${k} doğrudan kapsamını al`}
                    onClick={() => edit((d) => ({ ...d, scopes: d.scopes.filter((x) => x !== k) }))}><Icon name="x" size={12} /></button>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className={s.adminRow}>
          <span className={s.adminKey}>Roller</span>
          <div className={s.chips}>
            {cur.roles.map((id) => {
              const role = roleById.get(id);
              return (
                <span key={id} className={s.chip} style={{ borderColor: role?.color ?? undefined }}>
                  {role?.color !== null && role?.color !== undefined &&
                    <span className={s.roleDot} style={{ backgroundColor: role.color }} />}
                  {role?.name ?? "?"}
                  <button type="button" className={s.chipX} aria-label={`${role?.name ?? "?"} rolünü al`}
                    onClick={() => edit((d) => ({ ...d, roles: d.roles.filter((x) => x !== id) }))}><Icon name="x" size={12} /></button>
                </span>
              );
            })}
            <Grant label="Rol ver" empty="Verilecek rol yok."
              options={v.roles.filter((r) => !cur.roles.includes(r.id)).map((r) => ({ value: r.id, label: r.name }))}
              onPick={(id) => edit((d) => ({ ...d, roles: [...d.roles, id] }))} />
          </div>
        </div>

        <div className={s.adminRow}>
          <span className={s.adminKey}>Dal izni</span>
          <div className={s.chips}>
            {cur.nodes.map((id) => (
              <span key={id} className={s.chip}>
                {L.path(id).join(" › ")}
                <button type="button" className={s.chipX} aria-label="Dal iznini al"
                  onClick={() => edit((d) => ({ ...d, nodes: d.nodes.filter((x) => x !== id) }))}><Icon name="x" size={12} /></button>
              </span>
            ))}
            <NodeTreePicker rootKey="units" look="chip" label="Dal izni ver" value={null}
              disabled={busy} exclude={(n) => cur.nodes.includes(n.id) || roleNodes.has(n.id)}
              onChange={(id) => edit((d) => ({ ...d, nodes: [...d.nodes, id] }))}>
              <Icon name="plus" size={13} /> Dal izni ver
            </NodeTreePicker>
          </div>
        </div>
        <span className={s.dim}>Yapı kapsamları yalnız izinli dalda ve altında geçer.</span>
        <div className={s.adminActs}>
          {(v.is_admin || !p.is_admin) && (
            <Button size="sm" variant={p.is_active ? "danger" : "default"} onClick={() => run({ op: "active", value: !p.is_active })}>
              {p.is_active ? "Hesabı kapat" : "Hesabı aç"}
            </Button>
          )}
          {v.is_admin && (
            <Button size="sm" onClick={() => run({ op: "admin", value: !p.is_admin })}>
              {p.is_admin ? "Yöneticiliği al" : "Yönetici yap"}
            </Button>
          )}
          <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
            <Button size="sm" disabled={draft === null || busy} onClick={() => setDraft(null)}>Vazgeç</Button>
            <Button size="sm" variant="primary" disabled={!dirty || !nameOk || busy} onClick={() => void save()}>
              {busy ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </div>
        </div>
      </details>
    </li>
  );
}

/** "+ Ver" cipi: listeden secmek = vermek (ayri "Ver" dugmesi yok). Secenek
 *  yoksa ipucu metni. */
function Grant(props: {
  label: string;
  empty: string;
  options: Option<string>[];
  onPick: (v: string) => void;
}) {
  if (props.options.length === 0) return <span className={s.dim}>{props.empty}</span>;
  return (
    <UiPicker look="chip" label={props.label} value={""} options={props.options} onChange={props.onPick} search>
      <Icon name="plus" size={13} /> {props.label}
    </UiPicker>
  );
}

function Roles({ v }: { v: AdminView }) {
  const L = useLookup();
  const members = (r: AdminRole) => v.people.filter((p) => p.role_ids.includes(r.id)).length;
  return (
    <>
      {v.roles.length === 0 ? (
        <Empty title="Henüz rol yok.">Kullanıcılara kapsamları tek tek ver, ya da bir rol tanımla.</Empty>
      ) : (
        <ul className={`${s.surface} ${s.adminList}`}>
          {v.roles.map((r) => (
            <li key={r.id} className={s.person}>
              <div className={s.personHead}>
                <b className={s.roleBadge} style={{ borderColor: r.color ?? undefined }}>
                  {r.color !== null && <span className={s.roleDot} style={{ backgroundColor: r.color }} />}
                  {r.name}
                </b>
                <span className={s.dim}>{members(r)} kişi</span>
              </div>
              <div className={s.chips}>
                {r.scopes.length === 0 ? <span className={s.dim}>Kapsam yok.</span> : r.scopes.map((k) => (
                  <span key={k} className={s.chip} title={SCOPE[k] ?? k}>{k}</span>
                ))}
                {r.node_ids.map((id) => (
                  <span key={id} className={s.chip} title="Dal izni">{L.path(id).join(" › ")}</span>
                ))}
              </div>
              {v.is_admin && (
                <details className={s.personEdit}>
                  <summary>Düzenle</summary>
                  <RoleForm v={v} role={r} members={members(r)} />
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
      {v.is_admin && (
        <details className={s.personEdit}>
          <summary>Yeni rol</summary>
          <RoleForm v={v} role={null} members={0} />
        </details>
      )}
    </>
  );
}

function RoleForm({ v, role, members }: { v: AdminView; role: AdminRole | null; members: number }) {
  const L = useLookup();
  const m = useAdminWrite();
  const [name, setName] = useState(role?.name ?? "");
  const [color, setColor] = useState(role?.color ?? "#5b8cff");
  const [scopes, setScopes] = useState<ReadonlySet<string>>(() => new Set(role?.scopes ?? []));
  const [nodeIds, setNodeIds] = useState<ReadonlySet<string>>(() => new Set(role?.node_ids ?? []));
  const [err, setErr] = useState<string | null>(null);
  const done = { onError: (x: unknown) => setErr(errorText(x)) };
  return (
    <form
      className={ui.formStack}
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        const list = [...scopes];
        const nodes = [...nodeIds];
        m.mutate(role === null
          ? adminOps.createRole(name, color, list, nodes)
          : adminOps.patchRole(role.id, name, color, list, nodes), {
          ...done,
          onSuccess: () => {
            if (role === null) {
              setName("");
              setColor("#5b8cff");
              setScopes(new Set());
              setNodeIds(new Set());
            }
          },
        });
      }}
    >
      {err !== null && <p className={ui.error} role="alert">{err}</p>}
      <label className={ui.field}>
        <span>Rol adı<Req /></span>
        <input className={ui.input} value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} />
      </label>
      <label className={ui.field}>
        <span>Rol rengi</span>
        <input className={ui.input} type="color" value={color} onChange={(e) => setColor(e.target.value)} />
      </label>
      <fieldset className={`${ui.field} ${s.scopeSet}`}>
        <legend>Kapsamlar <span className={ui.fieldHint}>— {scopes.size} / {v.scopes.length} seçili</span></legend>
        <div className={ui.checks}>
          {v.scopes.map((k) => (
            <label key={k} className={ui.check}>
              <input type="checkbox" checked={scopes.has(k)} onChange={() => setScopes((prev) => {
                const next = new Set(prev);
                if (next.has(k)) next.delete(k);
                else next.add(k);
                return next;
              })} />
              <span>
                {k}
                {SCOPE[k] !== undefined && <small>{SCOPE[k]}</small>}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className={s.adminRow}>
        <span className={s.adminKey}>Dal izinleri</span>
        <div className={s.chips}>
          {[...nodeIds].map((id) => (
            <span key={id} className={s.chip}>
              {L.path(id).join(" › ")}
              <button type="button" className={s.chipX} aria-label="Rol dal iznini al"
                onClick={() => setNodeIds((prev) => {
                  const next = new Set(prev);
                  next.delete(id);
                  return next;
                })}><Icon name="x" size={12} /></button>
            </span>
          ))}
          <NodeTreePicker rootKey="units" look="chip" label="Rol dal izni ver" value={null}
            disabled={m.isPending} exclude={(n) => nodeIds.has(n.id)}
            onChange={(id) => setNodeIds((prev) => new Set(prev).add(id))}>
            <Icon name="plus" size={13} /> Dal izni ekle
          </NodeTreePicker>
        </div>
      </div>
      <div className={ui.dact}>
        {role !== null && (
          <Button variant="danger" onClick={() => {
            const ok = window.confirm(`${role.name} silinecek. ${members} kişi bu rolden gelen kapsamları kaybedecek (tek tek verilmiş olanlar kalır). Emin misin?`);
            if (ok) m.mutate(adminOps.deleteRole(role.id), done);
          }}>Sil</Button>
        )}
        <Button type="submit" variant="primary" aria-busy={m.isPending} disabled={m.isPending || name.trim() === ""}>
          {m.isPending ? "Kaydediliyor…" : role === null ? "Oluştur" : "Kaydet"}
        </Button>
      </div>
    </form>
  );
}
