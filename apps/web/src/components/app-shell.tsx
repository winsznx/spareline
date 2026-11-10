"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { Wordmark } from "./brand";
import { ThemeToggle } from "./theme-toggle";

const NAV = [
  { href: "/app", label: "Overview", match: (p: string) => p === "/app" },
  { href: "/app/recovery", label: "Recovery Desk", match: (p: string) => p.startsWith("/app/recovery") || p.startsWith("/app/manifests") },
  { href: "/app/scenarios", label: "Scenarios", match: (p: string) => p.startsWith("/app/scenarios") },
  { href: "/app/results", label: "Results", match: (p: string) => p.startsWith("/app/results") },
  { href: "/app/methodology", label: "Methodology", match: (p: string) => p.startsWith("/app/methodology") },
  { href: "/app/help", label: "Help", match: (p: string) => p.startsWith("/app/help") },
];

function NavIcon({ label }: { label: string }) {
  const common = { width: 16, height: 16, viewBox: "0 0 16 16", "aria-hidden": true, fill: "none", stroke: "currentColor", strokeWidth: 1.5 } as const;
  switch (label) {
    case "Overview":
      return (
        <svg {...common}>
          <path d="M2 4h12M2 8h12M2 12h7" strokeLinecap="round" />
        </svg>
      );
    case "Recovery Desk":
      return (
        <svg {...common}>
          <path d="M2 4h3.5q1.5 0 2.3 1.6L9 8q.7 1.5 2.3 1.5H14M2 12h3.5q1.5 0 2.3-1.6L9 8q.7-1.5 2.3-1.5H14" strokeLinecap="round" />
        </svg>
      );
    case "Scenarios":
      return (
        <svg {...common}>
          <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
          <path d="M5 6h6M5 9h4" strokeLinecap="round" />
        </svg>
      );
    case "Results":
      return (
        <svg {...common}>
          <path d="M2.5 13.5h11M4.5 11V8M8 11V4.5M11.5 11V6.5" strokeLinecap="round" />
        </svg>
      );
    case "Methodology":
      return (
        <svg {...common}>
          <path d="M3 2.5h7l3 3v8H3z" strokeLinejoin="round" />
          <path d="M5.5 8h5M5.5 10.5h3.5" strokeLinecap="round" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.5" />
          <path d="M6.6 6.4a1.5 1.5 0 1 1 2 1.4c-.5.2-.6.5-.6 1v.4M8 11.2v.1" strokeLinecap="round" />
        </svg>
      );
  }
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <ul className="flex flex-col gap-0.5">
      {NAV.map((item) => {
        const active = item.match(pathname);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={`flex h-10 items-center gap-3 rounded-[8px] px-3 text-sm ${
                active ? "bg-raised font-medium text-ink shadow-[0_0_0_1px_var(--line)]" : "text-ink-2 hover:bg-raised hover:text-ink"
              }`}
            >
              <NavIcon label={item.label} />
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-dvh bg-canvas">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-raised focus:px-3 focus:py-2">
        Skip to content
      </a>
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-[240px] flex-col border-r border-line bg-surface px-4 py-5 lg:flex">
        <div className="px-2">
          <Wordmark href="/" />
        </div>
        <nav aria-label="Primary" className="mt-8">
          <NavList />
        </nav>
        <div className="mt-auto rounded-[10px] border border-line px-3 py-3 text-[12px] leading-relaxed text-ink-2">
          Historical Amazon routes (2018) with simulated disruptions. Nothing here dispatches real drivers.
        </div>
      </aside>

      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button type="button" className="absolute inset-0 bg-graphite/40" aria-label="Close navigation" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[260px] border-r border-line bg-surface px-4 py-5">
            <div className="flex items-center justify-between px-2">
              <Wordmark href="/" />
              <button type="button" onClick={() => setOpen(false)} className="h-10 w-10 rounded-[8px] text-ink-2 hover:bg-raised" aria-label="Close navigation">
                ✕
              </button>
            </div>
            <nav aria-label="Primary" className="mt-6">
              <NavList onNavigate={() => setOpen(false)} />
            </nav>
          </div>
        </div>
      ) : null}

      <div className="lg:pl-[240px]">
        <header className="no-print sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-canvas/95 px-4 backdrop-blur md:px-6">
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-[8px] border border-line text-ink-2 lg:hidden"
            onClick={() => setOpen(true)}
            aria-label="Open navigation"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <div className="lg:hidden">
            <Wordmark href="/" size={24} />
          </div>
          <div className="hidden items-center gap-2 text-sm text-ink-2 lg:flex">
            <span className="font-medium text-ink">Spareline</span>
            <span aria-hidden="true" className="text-ink-3">/</span>
            <span>Dispatch recovery</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden h-7 items-center rounded-full border border-warning/50 px-3 text-[12px] font-medium text-warning-ink sm:inline-flex">
              Research replay
            </span>
            <Link href="/app/help" className="hidden h-10 items-center rounded-[8px] px-3 text-sm text-ink-2 hover:bg-surface hover:text-ink sm:inline-flex">
              Help
            </Link>
            <ThemeToggle />
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1640px] px-4 py-6 md:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}
