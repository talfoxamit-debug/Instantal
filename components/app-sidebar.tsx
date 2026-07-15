import Link from "next/link";
import {
  BarChart3,
  Columns3,
  Inbox,
  LayoutDashboard,
  Send,
  Settings,
  Users,
} from "lucide-react";

import { Logo } from "@/components/logo";

// Placeholder items unlock as their build phase ships
// (OUTREACH-BUILD-PLAN.md Section 7).
const NAV_ITEMS = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Leads", href: "/leads", icon: Users },
  { label: "Campaigns", href: "/campaigns", icon: Send },
  { label: "Inbox", href: "/inbox", icon: Inbox },
  { label: "Pipeline", href: "/pipeline", icon: Columns3 },
  { label: "Analytics", href: "/analytics", icon: BarChart3 },
  { label: "Settings", href: "/settings/inboxes", icon: Settings },
] as const;

export function AppSidebar() {
  return (
    <aside className="hidden w-56 shrink-0 border-r bg-sidebar md:flex md:flex-col">
      <div className="flex h-14 items-center border-b px-4">
        <Link href="/dashboard">
          <Logo />
        </Link>
      </div>
      <nav className="flex flex-1 flex-col gap-1 p-2">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
          >
            <item.icon className="size-4" />
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
