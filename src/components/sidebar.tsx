"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Smartphone,
  Users,
  ImageIcon,
  Flame,
  Send,
  ListChecks,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

type NavItem = {
  href: string;
  label: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  hint?: string;
};

const items: NavItem[] = [
  { href: "/devices", label: "Devices", Icon: Smartphone },
  { href: "/accounts", label: "Accounts", Icon: Users },
  { href: "/media", label: "Media", Icon: ImageIcon },
  { href: "/warmup", label: "Warmup", Icon: Flame },
  { href: "/posts", label: "Posts", Icon: Send },
  { href: "/jobs", label: "Jobs", Icon: ListChecks },
];

export function Sidebar({ userEmail }: { userEmail: string | null }) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <aside className="flex h-screen w-[220px] flex-col border-r border-border bg-bg-surface">
      <div className="flex h-[52px] items-center gap-2 border-b border-border px-4">
        <div className="h-1.5 w-1.5 rounded-full bg-accent" />
        <span className="font-display text-[15px] font-semibold tracking-tight">
          Clicker
        </span>
      </div>

      <nav className="flex-1 px-2 py-3">
        <ul className="space-y-0.5">
          {items.map(({ href, label, Icon }) => {
            const active =
              pathname === href || pathname.startsWith(`${href}/`);
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={cn(
                    "flex h-8 items-center gap-2.5 rounded px-2.5 text-[13px] transition-colors",
                    active
                      ? "bg-bg-surface-3 text-fg"
                      : "text-fg-muted hover:bg-bg-surface-2 hover:text-fg"
                  )}
                >
                  <Icon
                    size={15}
                    className={active ? "text-accent" : ""}
                  />
                  <span>{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-border p-3">
        <div className="mb-2 truncate text-[11px] text-fg-subtle">
          {userEmail ?? "—"}
        </div>
        <button
          onClick={signOut}
          className="flex h-7 w-full items-center gap-2 rounded px-2 text-[12px] text-fg-muted hover:bg-bg-surface-2 hover:text-fg"
        >
          <LogOut size={13} />
          Sign out
        </button>
      </div>
    </aside>
  );
}
