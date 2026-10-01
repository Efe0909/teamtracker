// ⌘K komut paleti: sayfalara git, takima git, kayit ara (sunucuda), yeni
// kayit, tema. Klavyeyle her yere iki tusla. cmdk: liste + suzme + ok tuslari.

import { Command } from "cmdk";
import { useEffect, useState } from "react";
import { useRecords } from "../../api/hooks";
import { NewRecordForm } from "../../features/record/NewRecordForm";
import { useLookup } from "../../lib/lookup";
import { navigate } from "../../lib/router";
import { setTheme } from "../../lib/theme";
import { Icon, type IconName } from "../../ui/icons";
import { Dialog, KindTag, Status } from "../../ui/ui";
import s from "./dashboard.module.css";
import { href, type Route } from "./routes";

const PAGES: { label: string; icon: IconName; route: Route; keys: string[] }[] = [
  { label: "Panolar", icon: "home", route: { name: "home" }, keys: ["ana sayfa", "home"] },
  { label: "Görevler", icon: "tasks", route: { name: "tasks", query: {} }, keys: ["kayıtlar", "liste"] },
  { label: "Geciken kayıtlar", icon: "alert", route: { name: "tasks", query: { quick: "overdue" } }, keys: ["gecikme"] },
  { label: "Açık eylemlerim", icon: "bolt", route: { name: "tasks", query: { quick: "my_actions" } }, keys: ["benim"] },
  { label: "Takımlar", icon: "teams", route: { name: "teams" }, keys: ["ekip"] },
  { label: "Pillar'lar", icon: "pin", route: { name: "pillars" }, keys: ["pillar", "alan"] },
  { label: "Veri yönetimi", icon: "tree", route: { name: "tree" }, keys: ["ağaç", "düğüm", "birim"] },
];

export function Palette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const L = useLookup();
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const term = q.trim();
  const found = useRecords({ search: term }, open && term.length >= 2);
  useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  const go = (r: Route) => {
    onOpenChange(false);
    navigate(href(r));
  };
  const admin = L.meta.me.is_admin || L.can("manage_users");

  return (
    <>
      <Command.Dialog
        open={open}
        onOpenChange={onOpenChange}
        label="Komut paleti"
        overlayClassName={s.palOverlay}
        contentClassName={s.pal}
        loop
      >
        <div className={s.palHead}>
          <Icon name="search" size={16} />
          <Command.Input value={q} onValueChange={setQ} placeholder="Sayfa, takım ya da kayıt ara…" className={s.palInput} />
        </div>
        <Command.List className={s.palList}>
          <Command.Empty className={s.palEmpty}>{found.isFetching ? "Aranıyor…" : "Sonuç yok"}</Command.Empty>

          <Command.Group heading="Eylemler" className={s.palGroup}>
            <Command.Item className={s.palItem} keywords={["yeni", "kayıt", "aç", "oluştur"]}
              onSelect={() => { onOpenChange(false); setCreating(true); }}>
              <Icon name="plus" /> Yeni kayıt aç
            </Command.Item>
          </Command.Group>

          {term.length >= 2 && (found.data?.length ?? 0) > 0 && (
            <Command.Group heading="Kayıtlar" className={s.palGroup}>
              {found.data?.slice(0, 8).map((r) => (
                <Command.Item key={r.id} value={`rec-${r.id}`} keywords={[r.title, term]} className={s.palItem}
                  onSelect={() => go({ name: "record", id: r.id })}>
                  <Status status={r.status} />
                  <span className={s.palTitle}>{r.title}</span>
                  <KindTag kind={r.kind} />
                </Command.Item>
              ))}
            </Command.Group>
          )}

          <Command.Group heading="Git" className={s.palGroup}>
            {PAGES.map((p) => (
              <Command.Item key={p.label} keywords={p.keys} className={s.palItem} onSelect={() => go(p.route)}>
                <Icon name={p.icon} /> {p.label}
              </Command.Item>
            ))}
            {admin && (
              <Command.Item keywords={["admin", "kullanıcı", "rol", "kapsam"]} className={s.palItem} onSelect={() => go({ name: "admin" })}>
                <Icon name="lock" /> Yönetim
              </Command.Item>
            )}
          </Command.Group>

          {L.pillars.length > 0 && (
            <Command.Group heading="Pillar'lar" className={s.palGroup}>
              {L.pillars.map((p) => (
                <Command.Item key={p.id} value={`pillar-${p.id}`} keywords={[p.name, "pillar"]} className={s.palItem}
                  onSelect={() => go({ name: "pillar", id: p.id })}>
                  <span className={s.pillarDot} style={p.color !== null ? { background: p.color } : undefined} aria-hidden="true" />
                  {p.name}
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {L.plainTeams.length > 0 && (
            <Command.Group heading="Takımlar" className={s.palGroup}>
              {L.plainTeams.map((t) => (
                <Command.Item key={t.id} value={`team-${t.id}`} keywords={[t.name, "takım"]} className={s.palItem}
                  onSelect={() => go({ name: "team", id: t.id })}>
                  <span className={s.teamDot} style={t.color !== null ? { background: t.color } : undefined} aria-hidden="true" />
                  {t.name}
                </Command.Item>
              ))}
            </Command.Group>
          )}

          <Command.Group heading="Tema" className={s.palGroup}>
            <Command.Item keywords={["tema", "açık", "light"]} className={s.palItem} onSelect={() => { setTheme("light"); onOpenChange(false); }}>
              <Icon name="sun" /> Açık tema
            </Command.Item>
            <Command.Item keywords={["tema", "koyu", "dark", "gece"]} className={s.palItem} onSelect={() => { setTheme("dark"); onOpenChange(false); }}>
              <Icon name="moon" /> Koyu tema
            </Command.Item>
            <Command.Item keywords={["tema", "sistem", "otomatik"]} className={s.palItem} onSelect={() => { setTheme("system"); onOpenChange(false); }}>
              <Icon name="system" /> Sistem teması
            </Command.Item>
          </Command.Group>
        </Command.List>
        <div className={s.palFoot}>
          <span>↑↓ gez</span>
          <span>↵ seç</span>
          <span>esc kapat</span>
        </div>
      </Command.Dialog>

      <Dialog open={creating} onClose={() => setCreating(false)} title="Yeni kayıt" wide>
        <NewRecordForm
          onCancel={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            navigate(href({ name: "record", id }));
          }}
        />
      </Dialog>
    </>
  );
}
