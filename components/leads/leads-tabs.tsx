"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const TABS = [
  { label: "Leads", href: "/leads", match: (p: string) => p === "/leads" || p.startsWith("/leads/") && !isOtherTab(p) },
  { label: "Lists", href: "/leads/lists", match: (p: string) => p.startsWith("/leads/lists") },
  { label: "Suppression", href: "/leads/suppression", match: (p: string) => p.startsWith("/leads/suppression") },
  { label: "Import", href: "/leads/import", match: (p: string) => p.startsWith("/leads/import") },
] as const;

function isOtherTab(pathname: string): boolean {
  return (
    pathname.startsWith("/leads/lists") ||
    pathname.startsWith("/leads/suppression") ||
    pathname.startsWith("/leads/import")
  );
}

export function LeadsTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 border-b">
      {TABS.map((tab) => {
        const active = tab.match(pathname);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
