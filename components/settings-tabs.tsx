"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const TABS = [
  { label: "Inboxes", href: "/settings/inboxes" },
  { label: "Sending domains", href: "/settings/domains" },
  { label: "LinkedIn", href: "/settings/linkedin" },
  { label: "Deliverability test", href: "/settings/placement" },
  { label: "Workspace", href: "/settings/workspace" },
  { label: "Members", href: "/settings/members" },
] as const;

export function SettingsTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 border-b">
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
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
