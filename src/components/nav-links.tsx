"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  Gauge,
  History,
  KeyRound,
  ScrollText,
} from "lucide-react";

import { cn } from "@/lib/cn";

const LINKS = [
  { href: "/", label: "Tableau de bord", icon: Gauge },
  { href: "/robots", label: "Robots", icon: Bot },
  { href: "/compte", label: "Compte MT5", icon: KeyRound },
  { href: "/historique", label: "Historique", icon: History },
  { href: "/journaux", label: "Journaux", icon: ScrollText },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav aria-label="Navigation principale" className="flex items-center gap-1 overflow-x-auto">
      {LINKS.map((link) => {
        const active =
          link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
        const Icon = link.icon;
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted hover:bg-white/5 hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            <span>{link.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
