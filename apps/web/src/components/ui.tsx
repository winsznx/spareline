import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import { ApiError } from "@/lib/api";
import type { Provenance, RunState } from "@/lib/api-types";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-copper-ink text-white hover:brightness-110 disabled:bg-line disabled:text-ink-3",
  secondary: "border border-line bg-raised text-ink hover:bg-surface disabled:text-ink-3",
  ghost: "text-ink-2 hover:text-ink hover:bg-surface disabled:text-ink-3",
  danger: "border border-danger text-danger hover:bg-danger-soft",
};
const SIZES: Record<Size, string> = {
  sm: "h-10 px-3 text-[13px]",
  md: "h-11 px-4 text-sm",
  lg: "h-12 px-5 text-[15px]",
};

export function buttonClass(variant: Variant = "secondary", size: Size = "md", extra = ""): string {
  return `inline-flex items-center justify-center gap-2 rounded-[8px] font-medium whitespace-nowrap transition-colors duration-200 disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${extra}`;
}

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button type="button" className={buttonClass(variant, size, className)} {...rest} />;
}

export function ButtonLink({
  href,
  children,
  variant = "secondary",
  size = "md",
  className = "",
}: {
  href: string;
  children: ReactNode;
  variant?: Variant;
  size?: Size;
  className?: string;
}) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)}>
      {children}
    </Link>
  );
}

const PROVENANCE_STYLE: Record<Provenance, string> = {
  "HISTORICAL ROUTES": "border-line text-ink-2",
  RECONSTRUCTED: "border-line text-ink-2",
  "SIMULATED DELAY": "border-warning text-warning-ink",
  "ESTIMATED TRANSFER TIME": "border-route-other text-route-other",
  "MODEL RESULT": "border-copper text-copper-ink",
};

export function ProvenanceChip({ kind, title }: { kind: Provenance; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex h-6 shrink-0 items-center rounded-[6px] border px-2 font-mono whitespace-nowrap text-[10.5px] font-medium tracking-[0.04em] ${PROVENANCE_STYLE[kind]}`}
    >
      {kind}
    </span>
  );
}

type Tone = "neutral" | "success" | "warning" | "danger" | "copper" | "info";
const TONES: Record<Tone, string> = {
  neutral: "bg-surface text-ink-2 border-line",
  success: "bg-success-soft text-success border-transparent",
  warning: "bg-warning-soft text-warning-ink border-transparent",
  danger: "bg-danger-soft text-danger border-transparent",
  copper: "bg-copper-soft text-copper-ink border-transparent",
  info: "bg-surface text-route-other border-line",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export const RUN_STATE_BADGE: Record<RunState, { tone: Tone; label: string }> = {
  queued: { tone: "neutral", label: "Queued" },
  running: { tone: "neutral", label: "Calculating" },
  recommended: { tone: "copper", label: "Rescue candidate" },
  no_safe_rescue: { tone: "danger", label: "No safe rescue" },
  low_confidence: { tone: "warning", label: "Low confidence" },
  timed_out: { tone: "warning", label: "Time limit reached" },
  error: { tone: "danger", label: "Error" },
};

export function RunStateBadge({ state }: { state: RunState }) {
  const b = RUN_STATE_BADGE[state];
  return <Badge tone={b.tone}>{b.label}</Badge>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2.5 text-sm text-ink-2" role="status" aria-live="polite">
      <svg width="16" height="16" viewBox="0 0 16 16" className="sl-spin" aria-hidden="true">
        <circle cx="8" cy="8" r="6.5" fill="none" stroke="var(--line)" strokeWidth="2" />
        <path d="M8 1.5A6.5 6.5 0 0 1 14.5 8" fill="none" stroke="var(--copper-ink)" strokeWidth="2" strokeLinecap="round" />
      </svg>
      {label}
    </span>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-[12px] border border-line bg-raised ${className}`}>{children}</section>;
}

export function ErrorState({
  error,
  onRetry,
  title = "The route could not be recalculated.",
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  const apiErr = error instanceof ApiError ? error : null;
  const message =
    apiErr?.code === "network_unreachable"
      ? "The Spareline API is not reachable right now. Check your connection and try again."
      : apiErr?.message ?? (error instanceof Error ? error.message : "Unexpected error.");
  return (
    <div role="alert" className="rounded-[12px] border border-danger/40 bg-danger-soft p-4">
      <p className="text-sm font-semibold text-danger">{title}</p>
      <p className="mt-1 text-sm text-ink-2">{message}</p>
      <p className="mt-2 font-mono text-[11px] text-ink-3">
        Request ID: {apiErr?.requestId ?? "not issued"}
        {apiErr?.status ? ` · HTTP ${apiErr.status}` : ""}
      </p>
      {onRetry ? (
        <Button className="mt-3" size="sm" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "danger" | "success" | "copper";
}) {
  const color = tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : tone === "copper" ? "text-copper-ink" : "text-ink";
  return (
    <div className="min-w-0">
      <p className="text-[12px] text-ink-2">{label}</p>
      <p className={`tnum mt-1 text-[26px] leading-none font-semibold tracking-[-0.03em] ${color}`}>{value}</p>
      {hint ? <p className="mt-1.5 text-[12px] text-ink-3">{hint}</p> : null}
    </div>
  );
}

export function PageHeader({ title, children, meta }: { title: string; children?: ReactNode; meta?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[28px] leading-[1.15] font-semibold tracking-[-0.035em] md:text-[34px]">{title}</h1>
        {meta ? <div className="mt-2 text-sm text-ink-2">{meta}</div> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}
