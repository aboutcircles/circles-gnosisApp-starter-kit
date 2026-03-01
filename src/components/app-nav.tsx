"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const links = [
  { href: "/game", label: "Game" }
];

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-2 rounded-full border border-ink/10 bg-white/80 p-1 text-xs font-semibold uppercase tracking-[0.2em] text-ink/70">
      {links.map((item) => {
        const active = pathname === item.href;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-full px-3 py-1.5 transition",
              active ? "bg-marine text-white" : "hover:bg-ink/5"
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
