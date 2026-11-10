import { API_BASE_URL } from "./env";
import type {
  DispatchState,
  EvaluationRow,
  EvaluationSummary,
  Manifest,
  Ready,
  RouteGroup,
  RunStatus,
  Scenario,
  ScenarioCreate,
  Session,
} from "./api-types";

const SESSION_KEY = "spareline.session";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;

  constructor(status: number, code: string, message: string, requestId: string | null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

function readStoredSession(): string | null {
  try {
    return window.localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function storeSession(token: string): void {
  try {
    window.localStorage.setItem(SESSION_KEY, token);
  } catch {
    // Private mode or blocked storage: the token stays in memory for this tab only.
  }
}

let memorySession: string | null = null;
let pendingSession: Promise<string> | null = null;

async function createSession(): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/sessions`, { method: "POST" });
  } catch {
    throw new ApiError(0, "network_unreachable", "The Spareline API could not be reached.", null);
  }
  if (!res.ok) throw await toApiError(res);
  const body = (await res.json()) as Session;
  memorySession = body.session;
  storeSession(body.session);
  return body.session;
}

export async function getSession(forceNew = false): Promise<string> {
  if (!forceNew) {
    const existing = memorySession ?? (typeof window !== "undefined" ? readStoredSession() : null);
    if (existing) {
      memorySession = existing;
      return existing;
    }
  }
  if (!pendingSession) {
    pendingSession = createSession().finally(() => {
      pendingSession = null;
    });
  }
  return pendingSession;
}

async function toApiError(res: Response): Promise<ApiError> {
  const headerId = res.headers.get("x-request-id");
  try {
    const body = (await res.json()) as { code?: string; message?: string; request_id?: string; detail?: unknown };
    const message =
      body.message ?? (typeof body.detail === "string" ? body.detail : `Request failed with status ${res.status}`);
    return new ApiError(res.status, body.code ?? `http_${res.status}`, message, body.request_id ?? headerId);
  } catch {
    return new ApiError(res.status, `http_${res.status}`, `Request failed with status ${res.status}`, headerId);
  }
}

async function request<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const session = await getSession();
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        "X-Spareline-Session": session,
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(0, "network_unreachable", "The Spareline API could not be reached.", null);
  }
  if (res.status === 401 && !retried) {
    await getSession(true);
    return request<T>(path, init, true);
  }
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as T;
}

export const api = {
  ready: () => request<Ready>("/readyz"),
  groups: (params: { station?: string; date?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.station) q.set("station", params.station);
    if (params.date) q.set("date", params.date);
    q.set("limit", String(params.limit ?? 50));
    return request<{ items: RouteGroup[] }>(`/datasets/groups?${q.toString()}`);
  },
  scenarios: () => request<Scenario[]>("/scenarios"),
  scenario: (id: string) => request<Scenario>(`/scenarios/${encodeURIComponent(id)}`),
  createScenario: (body: ScenarioCreate) =>
    request<Scenario>("/scenarios", { method: "POST", body: JSON.stringify(body) }),
  startRun: (scenarioId: string, timeLimit?: number) =>
    request<RunStatus>(`/scenarios/${encodeURIComponent(scenarioId)}/run`, {
      method: "POST",
      body: JSON.stringify(timeLimit ? { solver_time_limit_seconds: timeLimit } : {}),
    }),
  run: (runId: string) => request<RunStatus>(`/runs/${encodeURIComponent(runId)}`),
  dispatch: (runId: string) => request<DispatchState>(`/runs/${encodeURIComponent(runId)}/dispatch`),
  approve: (runId: string, expectedRevision: number) =>
    request<DispatchState>(`/runs/${encodeURIComponent(runId)}/approve`, {
      method: "POST",
      body: JSON.stringify({ expected_revision: expectedRevision }),
    }),
  ack: (runId: string, role: "donor" | "helper", expectedRevision: number) =>
    request<DispatchState>(`/runs/${encodeURIComponent(runId)}/handoff-ack`, {
      method: "POST",
      body: JSON.stringify({ driver_role: role, expected_revision: expectedRevision }),
    }),
  manifest: (runId: string, role: "donor" | "helper") =>
    request<Manifest>(`/runs/${encodeURIComponent(runId)}/manifests/${role}`),
  evaluationSummary: () => request<EvaluationSummary>("/evaluations/summary"),
  evaluationResults: (limit = 500) => request<EvaluationRow[]>(`/evaluations/results?limit=${limit}`),
  methodology: () => request<Record<string, unknown>>("/methodology"),
};

export function manifestCsvUrl(runId: string, role: "donor" | "helper", session: string): string {
  return `${API_BASE_URL}/runs/${encodeURIComponent(runId)}/manifests/${role}.csv?session=${encodeURIComponent(session)}`;
}

export const EVALUATION_CSV_URL = `${API_BASE_URL}/evaluations/results.csv`;
export const METHODOLOGY_JSON_URL = `${API_BASE_URL}/evaluations/methodology.json`;

export type { EvaluationRow };
