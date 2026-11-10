import type { RunState } from "./api-types";

const pad = (n: number): string => String(n).padStart(2, "0");

export function utcTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

export function utcDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

export function minutesBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
}

export function num(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function signed(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const s = num(Math.abs(value), digits);
  if (value > 0) return `+${s}`;
  if (value < 0) return `−${s}`;
  return s;
}

export function litres(cm3: number | null | undefined): string {
  if (cm3 === null || cm3 === undefined) return "—";
  return `${num(cm3 / 1000, 0)} L`;
}

export function shortId(id: string, len = 8): string {
  const stripped = id.replace(/^(RouteID_|PackageID_)/, "");
  return stripped.slice(0, len);
}

const STAGES: Record<string, string> = {
  queued: "Waiting for a solver slot",
  reconstructing_routes: "Rebuilding where each van is at the cutoff",
  scoring_no_intervention: "Projecting arrivals if nobody helps",
  scoring_nearest_feasible_helper: "Testing the nearest available helper",
  generating_candidates: "Checking what each driver can still carry",
  optimizing_handoff: "Sequencing the handoff with OR-Tools",
  robustness_check: "Re-checking under slower transfer travel",
  done: "Finalizing the decision",
};

export function stageLabel(stage: string | null | undefined): string {
  if (!stage) return "Calculating arrival times across both routes…";
  return STAGES[stage] ?? stage.replace(/_/g, " ");
}

const REASONS: Record<string, string> = {
  NO_HELPER_AVAILABLE: "No other van is available to help.",
  NO_AT_RISK_WORK: "No deliveries are projected to be missed, so no transfer is needed.",
  HELPER_CAPACITY_EXCEEDED: "The helper van does not have room for the packages.",
  HELPER_WOULD_BE_LATE: "The transfer would make the helper miss its own deliveries.",
  HELPER_SHIFT_EXCEEDED: "The helper would run past its shift limit.",
  GAIN_DISAPPEARS_UNDER_CONSERVATIVE_TRAVEL: "The benefit disappears when transfer travel is slower than average.",
  HELPER_LATE_UNDER_CONSERVATIVE_TRAVEL: "With slower transfer travel, the helper would become late.",
  MEETING_OUTSIDE_CALIBRATED_RANGE: "The meeting distance is outside the range the travel estimate was calibrated on.",
  NO_TRANSFER_IMPROVES_OUTCOME: "No tested transfer saves any delivery.",
  TIME_LIMIT_REACHED: "The solver reached its time limit; the best verified option is shown.",
  CONSERVATION_VIOLATED: "A package would be lost or duplicated.",
  HANDOFF_BEFORE_ARRIVAL: "The handoff would start before both vans arrive.",
  TRANSFER_STOP_SERVED_BEFORE_HANDOFF: "A transferred stop would be delivered before the handoff.",
  CAPACITY_EXCEEDED: "A van would exceed its load capacity.",
  PEAK_LOAD_EXCEEDED: "A van would exceed its load capacity at the handoff.",
};

export function reasonLabel(code: string): string {
  const key = code.split(" ")[0];
  return REASONS[key] ?? key.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export const TERMINAL_STATES: RunState[] = ["recommended", "no_safe_rescue", "low_confidence", "timed_out", "error"];

export function isTerminal(state: RunState | undefined): boolean {
  return state !== undefined && TERMINAL_STATES.includes(state);
}

export const POLICY_LABEL: Record<string, string> = {
  no_intervention: "Do nothing",
  nearest_feasible: "Nearest feasible helper",
  spareline: "Spareline",
};
