// app. ve dashboard. kabugu: oturum -> CSRF -> sozluk -> yuz.
// Oturum yoksa karsilamaya gonderir (giris duvari apex'te, KNOW-291).

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import { ApiError, errorText, setCsrf } from "../api/client";
import { onRealtimeEvent, resyncAll, useMeta } from "../api/hooks";
import { startRealtime } from "../api/realtime";
import { fetchMe, logout, welcomeUrl } from "../api/session";
import { LookupProvider } from "../lib/lookup";
import { ErrorScreen } from "./errors/ErrorScreen";

export function Session({ children }: { children: ReactNode }) {
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe, staleTime: Infinity, retry: 1 });
  const signedIn = me.data?.user != null;
  const meta = useMeta();
  const qc = useQueryClient();

  // Oturum acikken tek soket: kayit, sohbet ve liste degisiklikleri canli gelir.
  useEffect(() => {
    if (!signedIn) return undefined;
    return startRealtime({ onEvent: (e) => onRealtimeEvent(qc, e), onResync: () => resyncAll(qc) });
  }, [signedIn, qc]);

  useEffect(() => {
    if (me.data === undefined) return;
    setCsrf(me.data.csrf);
    if (me.data.user === null) location.replace(welcomeUrl());
  }, [me.data]);

  if (me.isError) return <ErrorScreen code="network" />;
  if (!signedIn || me.data === undefined) return <ErrorScreen code="loading" />;
  if (meta.error !== null) {
    return meta.error instanceof ApiError && meta.error.code === "unauthorized"
      ? <ErrorScreen code="unauthorized" />
      : <ErrorScreen code="network" detail={errorText(meta.error)} />;
  }
  if (meta.data === undefined) return <ErrorScreen code="loading" />;
  return <LookupProvider meta={meta.data}>{children}</LookupProvider>;
}

/** Cikis: sunucu cerezi siler, karsilamaya donulur. */
export async function signOut(): Promise<void> {
  const me = await fetchMe().catch(() => null);
  if (me?.csrf != null) await logout(me.csrf).catch(() => undefined);
  location.assign(welcomeUrl());
}
