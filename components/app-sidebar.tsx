import Link from "next/link";
import {
  BarChart3,
  Inbox,
  LayoutDashboard,
  Send,
  Settings,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";

// Placeholder items unlock as their build phase ships
// (OUTREACH-BUILD-PLAN.md Section 7).
const NAV_ITEMS = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Leads", href: "/leads", icon: Users },
  { label: "Campaigns", icon: Send, phase: "P3" },
  { label: "Inbox", icon: Inbox, phase: "P4" },
  { label: "Analytics", icon: BarChart3, phase: "P5" },
  { label: "Settings", icon: Settings, phase: "P2" },
] as const;

export function AppSidebar() {
  return (
    <aside className="hidden w-56 shrink-0 border-r bg-sidebar md:flex md:flex-col">
      <div className="flex h-14 items-center border-b px-4">
        <Link href="/dashboard" className="font-semibold tracking-tight">
          Instantal
        </Link>
      </div>
      <nav className="flex flex-1 flex-col gap-1 p-2">
        {NAV_ITEMS.map((item) =>
          "href" in item ? (
            <Link
              key={item.label}
              href={item.href}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
            >
              <item.icon className="size-4" />
              {item.label}
            </Link>
          ) : (
            <span
              key={item.label}
              className="flex cursor-not-allowed items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground/60"
              title={`Ships in phase ${item.phase.slice(1)}`}
            >
              <item.icon className="size-4" />
              {item.label}
              <Badge variant="outline" className="ml-auto text-[10px]">
                {item.phase}
              </Badge>
            </span>
          ),
        )}
      </nav>
    </aside>
  );
}
