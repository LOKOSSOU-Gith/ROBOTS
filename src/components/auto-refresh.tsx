"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Rafraîchit les données serveur à intervalle régulier. `router.refresh()`
 * conserve l'état de navigation et ne recharge pas le JavaScript.
 */
export function AutoRefresh({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), seconds * 1000);
    return () => window.clearInterval(timer);
  }, [router, seconds]);
  return null;
}
