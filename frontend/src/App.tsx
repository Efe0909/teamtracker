// Host'un ilk etiketi yuzu secer (KNOW-79). Her yuz ayri paket (lazy):
// telefondaki uygulama masaustu tablosunun kodunu indirmez.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { ApiError } from "./api/client";
import { currentSurface } from "./api/session";
import { ErrorScreen } from "./surfaces/errors/ErrorScreen";
import { Session } from "./surfaces/Session";
import { Entry } from "./surfaces/welcome/Entry";
import { Welcome } from "./surfaces/welcome/Welcome";
import { ToastProvider } from "./ui/ui";

const Dashboard = lazy(() => import("./surfaces/dashboard/Dashboard"));
const MobileApp = lazy(() => import("./surfaces/app/MobileApp"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      // 4xx tekrar denenmez: yetki ya da bulunamadi, ikinci deneme ayni sonuc.
      retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2,
    },
  },
});

export function App() {
  const surface = currentSurface();
  if (surface === "welcome") return location.pathname === "/welcome" ? <Welcome /> : <Entry />;
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <Session>
          <Suspense fallback={<ErrorScreen code="loading" />}>
            {surface === "dashboard" ? <Dashboard /> : <MobileApp />}
          </Suspense>
        </Session>
      </ToastProvider>
    </QueryClientProvider>
  );
}
