// Yonetim paneli (R3-F01..F06): kisiler + roller. Kaynak: e02d71d
// `fragments/admin_main.html`. Yetki SUNUCUDA; `is_admin` yalniz admin'e
// ozel dugmeleri (admin yap, rol tanimi) gostermek icin. Duzenleme kontrolleri
// yerel <details> icinde: satir kapaliyken liste taranabilir kalir.

import { useEffect, useState } from "react";
import { ApiError, errorText } from "../../api/client";
import { adminOps, useAdmin, useAdminWrite } from "../../api/hooks";
import type { AdminPerson, AdminRole, AdminView, UserOp } from "../../api/types";
import { ago, SCOPE } from "../../lib/labels";
import { useLookup } from "../../lib/lookup";
import { Avatar, Button, Empty, Loading, Tag, ui, useToast } from "../../ui/ui";
import { ErrorScreen } from "../errors/ErrorScreen";
import s from "./dashboard.module.css";

export function Admin() {
  const q = useAdmin();
  useEffect(() => {
    document.title = "Yönetim — EkipTakip";
  }, []);
  if (q.error !== null)
    return <ErrorScreen code={q.error instanceof ApiError && q.error.code === "forbidden" ? "forbidden" : "network"} />;
  if (q.data === undefined) return <Loading />;
  return <AdminScreen v={q.data} />;
}

function AdminScreen({ v }: { v: AdminView }) {
  const roleName = new Map(v.roles.map((r) => [r.id, r.name]));
  return (
    <div className={s.page}>
      <div className={s.pageHead}>
        <h1>Yönetim</h1>
      </div>
      <AddUser />
      <h2 className={s.sectionTitle}>Kullanıcılar</h2>
      {v.people.length === 0 ? (
        <Empty title="Liste boş.">Yukarıdan ilk kullanıcıyı ekle.</Empty>
      ) : (
        <ul className={s.adminList}>
          {v.people.map((p) => (
            <PersonRow key={p.id} p={p} v={v} roleName={roleName} />
          ))}
        </ul>
      )}
      <h2 className={s.sectionTitle}>Roller</h2>
      <p className={s.lead}>
        Rol bir kapsam demeti. Rolün kapsamlarını değiştirmek sahiplerine anında yansır. Oluşturma ve silme yalnız
        yöneticide.
      </p>
      <Roles v={v} />
    </div>
  );
}

function AddUser() {
  const m = useAdminWrite();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className={s.adminForm}
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        m.mutate(adminOps.addUser(email, name), {
          onSuccess: () => {
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
          E-posta
          <input className={ui.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
            placeholder="ad@ornek.com" autoComplete="off" />
        </label>
        <label className={ui.field}>
          Ad
          <input className={ui.input} value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} />
        </label>
      </div>
      <p className={s.dim}>Eklenen kişi bu e-postanın Google hesabıyla girer. Listede olmayan e-posta giremez.</p>
      <div className={ui.dact}>
        <Button type="submit" variant="primary" disabled={m.isPending}>Kullanıcı ekle</Button>
      </div>
    </form>
  );
}

function PersonRow({ p, v, roleName }: { p: AdminPerson; v: AdminView; roleName: Map<string, string> }) {
  const L = useLookup();
  const toast = useToast();
  const m = useAdminWrite();
  const run = (op: UserOp) =>
    m.mutate(adminOps.user(p.id, op), { onError: (e) => toast({ text: errorText(e), error: true }) });
  const direct = new Set(p.scopes.filter((r) => r.direct).map((r) => r.name));
  const grantable = v.scopes.filter((k) => !direct.has(k));
  const assignable = v.roles.filter((r) => !p.role_ids.includes(r.id));
  const branches = L.meta.nodes.filter((n) => !p.node_ids.includes(n.id));

  return (
    <li className={s.person}>
      <div className={s.personHead}>
        <Avatar user={{ name: p.name, color: p.color, last_seen_at: p.last_seen_at }} size={32} />
        <div>
          <b>{p.name}</b> <span className={s.dim}>{p.email}</span>
          <div className={s.dim}>
            {p.last_seen_at === null ? "hiç girmedi" : `son görülme ${ago(p.last_seen_at)}`}
          </div>
        </div>
        {p.is_admin && <Tag tone="info">Yönetici</Tag>}
        {!p.is_active && <Tag tone="critical">Kapalı</Tag>}
      </div>

      <div className={s.chips}>
        {p.is_admin ? (
          <span className={s.dim}>Yönetici bütün kapsamlara sahip.</span>
        ) : p.scopes.length === 0 ? (
          <span className={s.dim}>Kapsam yok.</span>
        ) : (
          p.scopes.map((r) => (
            <span key={r.name} className={s.chip} title={SCOPE[r.name] ?? r.name}>
              {r.name}
              {r.via_roles.length > 0 && (
                <span className={s.dim}>· {r.via_roles.map((id) => roleName.get(id) ?? "?").join(", ")} rolünden</span>
              )}
              {r.direct && (
                <button type="button" className={s.chipX} aria-label={`${r.name} kapsamını al`}
                  onClick={() => run({ op: "revoke_scope", value: r.name })}>✕</button>
              )}
            </span>
          ))
        )}
      </div>

      <details className={s.personEdit}>
        <summary>Düzenle</summary>
        <div className={ui.dact}>
          {(v.is_admin || !p.is_admin) && (
            <Button onClick={() => run({ op: "active", value: !p.is_active })}>{p.is_active ? "Kapat" : "Aç"}</Button>
          )}
          {v.is_admin && (
            <Button onClick={() => run({ op: "admin", value: !p.is_admin })}>
              {p.is_admin ? "Yöneticiliği al" : "Yönetici yap"}
            </Button>
          )}
        </div>

        <Picker label="Kapsam ver (tek tek)" empty="Bütün kapsamlar zaten doğrudan verilmiş."
          options={grantable.map((k) => ({ value: k, label: `${k} — ${SCOPE[k] ?? ""}` }))}
          onPick={(k) => run({ op: "grant_scope", value: k })} />

        <div className={s.chips}>
          {p.role_ids.map((id) => (
            <span key={id} className={s.chip}>
              {roleName.get(id) ?? "?"}
              <button type="button" className={s.chipX} aria-label="Rolü al"
                onClick={() => run({ op: "revoke_role", value: id })}>✕</button>
            </span>
          ))}
        </div>
        <Picker label="Rol ver" empty="Verilecek rol yok."
          options={assignable.map((r) => ({ value: r.id, label: r.name }))}
          onPick={(id) => run({ op: "grant_role", value: id })} />

        <div className={s.chips}>
          {p.node_ids.map((id) => (
            <span key={id} className={s.chip}>
              {L.path(id).join(" › ")}
              <button type="button" className={s.chipX} aria-label="Dal iznini al"
                onClick={() => run({ op: "revoke_node", value: id })}>✕</button>
            </span>
          ))}
        </div>
        <Picker label="Dal izni ver — yapı kapsamları yalnız izinli dalda ve altında geçer" empty="Ağaçta düğüm yok."
          options={branches.map((n) => ({ value: n.id, label: `${"  ".repeat(n.depth)}${n.name}` }))}
          onPick={(id) => run({ op: "grant_node", value: id })} />
      </details>
    </li>
  );
}

/** Tek secim + "Ver". Secenek yoksa ipucu metni. */
function Picker(props: {
  label: string;
  empty: string;
  options: { value: string; label: string }[];
  onPick: (v: string) => void;
}) {
  const [pick, setPick] = useState("");
  if (props.options.length === 0) return <p className={s.dim}>{props.empty}</p>;
  return (
    <label className={ui.field}>
      {props.label}
      <span className={s.pickRow}>
        <select className={ui.input} value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">— seç —</option>
          {props.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <Button disabled={pick === ""} onClick={() => { props.onPick(pick); setPick(""); }}>Ver</Button>
      </span>
    </label>
  );
}

function Roles({ v }: { v: AdminView }) {
  const members = (r: AdminRole) => v.people.filter((p) => p.role_ids.includes(r.id)).length;
  return (
    <>
      {v.roles.length === 0 ? (
        <Empty title="Henüz rol yok.">Kullanıcılara kapsamları tek tek ver, ya da bir rol tanımla.</Empty>
      ) : (
        <ul className={s.adminList}>
          {v.roles.map((r) => (
            <li key={r.id} className={s.person}>
              <div className={s.personHead}>
                <b>{r.name}</b>
                <span className={s.dim}>{members(r)} kişi</span>
              </div>
              <div className={s.chips}>
                {r.scopes.length === 0 ? <span className={s.dim}>Kapsam yok.</span> : r.scopes.map((k) => (
                  <span key={k} className={s.chip} title={SCOPE[k] ?? k}>{k}</span>
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
  const m = useAdminWrite();
  const [name, setName] = useState(role?.name ?? "");
  const [scopes, setScopes] = useState<ReadonlySet<string>>(() => new Set(role?.scopes ?? []));
  const [err, setErr] = useState<string | null>(null);
  const done = { onError: (x: unknown) => setErr(errorText(x)) };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        const list = [...scopes];
        m.mutate(role === null ? adminOps.createRole(name, list) : adminOps.patchRole(role.id, name, list), {
          ...done,
          onSuccess: () => {
            if (role === null) {
              setName("");
              setScopes(new Set());
            }
          },
        });
      }}
    >
      {err !== null && <p className={ui.error} role="alert">{err}</p>}
      <label className={ui.field}>
        Rol adı
        <input className={ui.input} value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} />
      </label>
      <fieldset className={s.scopeSet}>
        <legend>Kapsamlar</legend>
        {v.scopes.map((k) => (
          <label key={k}>
            <input type="checkbox" checked={scopes.has(k)} onChange={() => setScopes((prev) => {
              const next = new Set(prev);
              if (next.has(k)) next.delete(k);
              else next.add(k);
              return next;
            })} /> {k} — {SCOPE[k] ?? ""}
          </label>
        ))}
      </fieldset>
      <div className={ui.dact}>
        {role !== null && (
          <Button variant="danger" onClick={() => {
            const ok = window.confirm(`${role.name} silinecek. ${members} kişi bu rolden gelen kapsamları kaybedecek (tek tek verilmiş olanlar kalır). Emin misin?`);
            if (ok) m.mutate(adminOps.deleteRole(role.id), done);
          }}>Sil</Button>
        )}
        <Button type="submit" variant="primary" disabled={m.isPending || name.trim() === ""}>
          {role === null ? "Oluştur" : "Kaydet"}
        </Button>
      </div>
    </form>
  );
}
