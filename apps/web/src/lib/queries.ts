"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "./api";
import { isTerminal } from "./format";

export const keys = {
  scenarios: ["scenarios"] as const,
  scenario: (id: string) => ["scenario", id] as const,
  run: (id: string) => ["run", id] as const,
  dispatch: (id: string) => ["dispatch", id] as const,
  manifest: (id: string, role: "donor" | "helper") => ["manifest", id, role] as const,
  evaluationSummary: ["evaluation-summary"] as const,
  evaluationResults: ["evaluation-results"] as const,
  methodology: ["methodology"] as const,
  ready: ["ready"] as const,
};

export function useScenarios() {
  return useQuery({ queryKey: keys.scenarios, queryFn: api.scenarios });
}

export function useScenario(id: string | null | undefined) {
  return useQuery({
    queryKey: keys.scenario(id ?? ""),
    queryFn: () => api.scenario(id as string),
    enabled: Boolean(id),
  });
}

export function useRun(runId: string | null | undefined) {
  return useQuery({
    queryKey: keys.run(runId ?? ""),
    queryFn: () => api.run(runId as string),
    enabled: Boolean(runId),
    refetchInterval: (query) => (isTerminal(query.state.data?.state) ? false : 700),
  });
}

export function useDispatch(runId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: keys.dispatch(runId ?? ""),
    queryFn: () => api.dispatch(runId as string),
    enabled: Boolean(runId) && enabled,
  });
}

export function useManifest(runId: string | null | undefined, role: "donor" | "helper", enabled = true) {
  return useQuery({
    queryKey: keys.manifest(runId ?? "", role),
    queryFn: () => api.manifest(runId as string, role),
    enabled: Boolean(runId) && enabled,
  });
}

export function useEvaluationSummary() {
  return useQuery({ queryKey: keys.evaluationSummary, queryFn: api.evaluationSummary, staleTime: 60_000 });
}

export function useEvaluationResults(enabled = true) {
  return useQuery({
    queryKey: keys.evaluationResults,
    queryFn: () => api.evaluationResults(500),
    enabled,
    staleTime: 60_000,
  });
}

export function useMethodology() {
  return useQuery({ queryKey: keys.methodology, queryFn: api.methodology, staleTime: 300_000 });
}

export function useReady() {
  return useQuery({ queryKey: keys.ready, queryFn: api.ready, staleTime: 30_000 });
}
