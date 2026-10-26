"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { apiFetch } from "@/lib/client-api";

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function logout() {
    setPending(true);
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh();
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={logout}
      disabled={pending}
      className="btn btn-ghost px-2 py-1.5 text-xs"
      title="Déconnexion"
    >
      <LogOut className="h-3.5 w-3.5" aria-hidden />
      <span className="hidden sm:inline">Déconnexion</span>
    </button>
  );
}
