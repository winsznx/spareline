"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useScenarios } from "@/lib/queries";

import { ButtonLink, ErrorState, PageHeader, Spinner } from "./ui";

export function RecoveryIndex() {
  const router = useRouter();
  const list = useScenarios();
  const first = list.data?.find((s) => s.curated) ?? list.data?.[0];

  useEffect(() => {
    if (first) router.replace(`/app/recovery/${first.id}${first.latest_run_id ? `?run=${first.latest_run_id}` : ""}`);
  }, [first, router]);

  if (list.isError) return <ErrorState title="Scenarios could not be loaded." error={list.error} onRetry={() => void list.refetch()} />;
  if (list.data && !first) {
    return (
      <div className="space-y-4">
        <PageHeader title="Recovery desk" />
        <p className="text-sm text-ink-2">Choose a historical route group to start a replay.</p>
        <ButtonLink href="/app/scenarios">Open scenarios</ButtonLink>
      </div>
    );
  }
  return <Spinner label="Opening the recovery desk…" />;
}
