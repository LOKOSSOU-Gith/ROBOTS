import { Activity } from "lucide-react";
import type { ReactNode } from "react";

import { LogoutButton } from "@/components/logout-button";
import { NavLinks } from "@/components/nav-links";
import { requirePageUser } from "@/server/auth/session";
import { assertServerConfig } from "@/server/config";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  assertServerConfig();
  const user = await requirePageUser();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b bg-[hsl(var(--background))]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-3 py-2.5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <Activity className="h-4 w-4" aria-hidden />
              </span>
              <div className="leading-tight">
                <p className="text-sm font-semibold tracking-tight">MT5 Control</p>
                <p className="text-[10px] uppercase tracking-widest text-muted">
                  Centre de contrôle
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 lg:hidden">
              <LogoutButton />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <NavLinks />
            <div className="hidden items-center gap-3 lg:flex">
              <span className="text-xs text-muted" title={user.email}>
                {user.displayName ?? user.email}
              </span>
              <LogoutButton />
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-3 py-6 sm:px-6 sm:py-8">{children}</main>

      <footer className="mx-auto max-w-6xl px-4 pb-8 pt-2 text-[11px] leading-relaxed text-muted sm:px-6">
        Les performances passées ne préjugent pas des performances futures. Aucun robot ne
        garantit un profit ; le mode réel exige une validation explicite et une surveillance.
      </footer>
    </div>
  );
}
