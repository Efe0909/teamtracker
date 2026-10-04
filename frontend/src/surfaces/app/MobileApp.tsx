// app. yuzu: ust cubuk + besli alt gezinme. Masaustu yuze baglanti yok.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { errorText, upload } from "../../api/client";
import { useInbox, useMyActions, useNotifications, useSendMessage } from "../../api/hooks";
import type { Attachment } from "../../api/types";
import { NotifySettings } from "../../features/profile/NotifySettings";
import { ProfileDialog } from "../../features/profile/ProfileDialog";
import { useLookup } from "../../lib/lookup";
import { navigate, useLocation } from "../../lib/router";
import { setTheme, useTheme, type Theme } from "../../lib/theme";
import { Icon, type IconName } from "../../ui/icons";
import { Avatar, Button, cx, Dialog, Empty, Link, Loading, Menu, MenuItem, MenuLabel, MenuRadio, MenuSep, ui } from "../../ui/ui";
import { ErrorScreen } from "../errors/ErrorScreen";
import { signOut } from "../Session";
import s from "./app.module.css";
import { ActionsPage, ChatsPage, NewPage, NotificationsPage, SearchPage, TeamsListPage } from "./pages";
import { RecordPage, TeamPage } from "./RecordPage";
import { href, parse, type Route } from "./routes";

export default function MobileApp() {
  const route = parse(useLocation());
  return <div className={s.app}><Page route={route} /><Tabs route={route} /></div>;
}

function Page({ route }: { route: Route }) {
  switch (route.name) {
    case "actions": return <ActionsPage />;
    case "teams": return <TeamsListPage />;
    case "chats": return <ChatsPage />;
    case "search": return <SearchPage q={route.q} />;
    case "notifications": return <NotificationsPage />;
    case "record": return <RecordPage key={route.id} id={route.id} />;
    case "team": return <TeamPage key={route.id} id={route.id} />;
    case "new": return <NewPage />;
    case "notFound": return <><TopBar title="Bulunamadı" /><ErrorScreen code="not_found" /></>;
  }
}

const THEME_OPTS: { value: Theme; label: string; icon: IconName }[] = [
  { value: "light", label: "Açık", icon: "sun" },
  { value: "dark", label: "Koyu", icon: "moon" },
  { value: "system", label: "Sistem", icon: "system" },
];

function MobileUserMenu() {
  const L = useLookup();
  const theme = useTheme();
  const [profileOpen, setProfileOpen] = useState(!L.meta.me.profile_complete);
  const [notifyOpen, setNotifyOpen] = useState(false);
  return <>
    <Menu align="end" side="bottom" trigger={<button type="button" className={ui.iconBtn} aria-label="Hesap menüsü"><Avatar user={L.me} size={30} /></button>}>
      <MenuLabel>{L.me.name}</MenuLabel>
      <MenuItem icon="user" onSelect={() => setProfileOpen(true)}>Profilim</MenuItem>
      <MenuItem icon="bell" onSelect={() => setNotifyOpen(true)}>Bildirimler</MenuItem>
      <MenuSep /><MenuLabel>Tema</MenuLabel>
      <MenuRadio value={theme} onChange={setTheme} options={THEME_OPTS} />
      <MenuSep /><MenuItem icon="logout" onSelect={() => void signOut()}>Çıkış yap</MenuItem>
    </Menu>
    <NotifySettings open={notifyOpen} onClose={() => setNotifyOpen(false)} />
    <ProfileDialog open={profileOpen} onClose={() => setProfileOpen(false)} />
  </>;
}

/** Ust cubuk. Gecmis yoksa geri dugmesi ana listeyi acar. */
export function TopBar({ title, back, right }: { title: string; back?: boolean; right?: ReactNode }) {
  useEffect(() => { document.title = `${title} — EkipTakip`; }, [title]);
  return <header className={s.top}>
    <span className={s.slot}>{back === true && <button type="button" className={ui.iconBtn} aria-label="Geri" onClick={() => history.length > 1 ? history.back() : navigate("/")}><Icon name="back" size={22} /></button>}</span>
    <h1>{title}</h1><span className={s.slot}>{right ?? <MobileUserMenu />}</span>
  </header>;
}

export function CameraFlow({ file, onClose }: { file: File; onClose: () => void }) {
  const q = useInbox();
  const sendMessage = useSendMessage();
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [sent, setSent] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState("");
  const attachments = useRef(new Map<string, string>());
  const sending = useRef(false);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const targets = q.data?.filter((c) => c.can_post) ?? [];
  const send = async () => {
    const pending = selected.filter((id) => !sent.includes(id) && targets.some((chat) => chat.chat_id === id));
    if (sending.current || pending.length === 0) return;
    sending.current = true;
    setBusy(true);
    const failures: Record<string, string> = {};
    try {
      for (const chatId of pending) {
        try {
          let attachmentId = attachments.current.get(chatId);
          if (attachmentId === undefined) {
            attachmentId = (await upload<Attachment>(file)).id;
            attachments.current.set(chatId, attachmentId);
          }
          await sendMessage.mutateAsync({ chat: chatId, body: description.trim(), reply_to_id: null, attachment_ids: [attachmentId] });
          setSent((prev) => [...prev, chatId]);
        } catch (error) { failures[chatId] = errorText(error); }
      }
      setErrors(failures);
      if (Object.keys(failures).length === 0) onClose();
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  return <Dialog open onClose={() => { if (!sending.current) onClose(); }} title="Fotoğraf gönder" hint="Bir veya birkaç konuşma seç. Fotoğraf her konuşmaya ayrı gönderilir.">
    <form className={ui.formStack} onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <img src={preview} alt="Gönderilecek fotoğraf" className={s.cameraPreview} />
      <label className={ui.field}>Açıklama<textarea className={ui.input} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} disabled={busy || sent.length > 0} placeholder="Açıklama ekle…" /></label>
      <fieldset className={ui.field} disabled={busy}>
        <legend>Gönderilecek konuşmalar</legend>
        {q.error !== null ? <p role="alert">{errorText(q.error)}</p> : q.data === undefined ? <Loading /> : targets.length === 0 ? <Empty title="Yazabileceğin konuşma yok">Takım veya kayıt sohbetine katıldıktan sonra tekrar dene.</Empty> : targets.map((c) => <div key={c.chat_id}>
          <label className={s.cameraTarget}>
            <input type="checkbox" checked={selected.includes(c.chat_id)} disabled={sent.includes(c.chat_id)} onChange={(e) => setSelected((prev) => e.target.checked ? [...prev, c.chat_id] : prev.filter((id) => id !== c.chat_id))} />
            <span className={s.cardBody}><b>{c.title}</b><span className={s.cardPath}>{c.kind === "team" ? "Takım" : "Kayıt"}{sent.includes(c.chat_id) && " · Gönderildi"}</span></span>
          </label>
          {errors[c.chat_id] !== undefined && <p role="alert" className={ui.error}>{errors[c.chat_id]}</p>}
        </div>)}
      </fieldset>
      {sent.length > 0 && <p role="status">{sent.length} konuşmaya gönderildi. Tekrar deneme yalnız gönderilemeyen konuşmaları gönderir.</p>}
      <Button type="submit" variant="primary" aria-busy={busy} disabled={busy || !selected.some((id) => !sent.includes(id))}>{busy ? "Gönderiliyor…" : Object.keys(errors).length > 0 ? "Gönderilemeyenleri tekrar dene" : "Gönder"}</Button>
    </form>
  </Dialog>;
}

function FabMenu({ onFile }: { onFile: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return <>
    <Menu align="start" side="top" trigger={<button type="button" className={s.fabButton} aria-label="Ekle"><Icon name="plus" size={28} /></button>}>
      <MenuItem icon="search" onSelect={() => navigate(href({ name: "search", q: "" }))}>Arama</MenuItem>
      <MenuItem icon="plus" onSelect={() => navigate(href({ name: "new" }))}>Yeni kayıt</MenuItem>
      <MenuItem icon="camera" onSelect={() => input.current?.click()}>Fotoğraf çek / seç</MenuItem>
    </Menu>
    <input ref={input} type="file" accept="image/*" capture="environment" hidden aria-label="Fotoğraf seç" onChange={(e) => {
      const file = e.target.files?.[0];
      if (file !== undefined) onFile(file);
      e.target.value = "";
    }} />
  </>;
}

function Tabs({ route }: { route: Route }) {
  const notes = useNotifications();
  const acts = useMyActions();
  const [cameraFile, setCameraFile] = useState<File | null>(null);
  const items: { r: Route; icon: IconName; label: string; on: boolean; badge?: number }[] = [
    { r: { name: "actions" }, icon: "bolt", label: "Eylemler", on: route.name === "actions", badge: acts.data?.length ?? 0 },
    { r: { name: "teams" }, icon: "teams", label: "Takımlar", on: route.name === "teams" || route.name === "team" },
    { r: { name: "chats" }, icon: "inbox", label: "Konuşmalar", on: route.name === "chats" },
    { r: { name: "notifications" }, icon: "bell", label: "Bildirim", on: route.name === "notifications", badge: notes.data?.unread ?? 0 },
  ];
  const tab = (item: (typeof items)[number]) => <Link key={item.label} href={href(item.r)} className={cx(s.tab, item.on && s.tabOn)} aria-current={item.on ? "page" : undefined}>
    <Icon name={item.icon} size={24} />{item.label}
    {item.badge !== undefined && item.badge > 0 && <span className={s.badge}>{item.badge > 99 ? "99+" : item.badge}</span>}
  </Link>;
  return <>
    <nav className={s.tabs} aria-label="Sekmeler"><div className={s.tabsIn}>
      {items.slice(0, 2).map(tab)}<span className={s.fab}><FabMenu onFile={setCameraFile} /></span>{items.slice(2).map(tab)}
    </div></nav>
    {cameraFile !== null && <CameraFlow file={cameraFile} onClose={() => setCameraFile(null)} />}
  </>;
}
