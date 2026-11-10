import { Suspense } from "react";

import { RecoveryDesk } from "@/components/recovery-desk";
import { Spinner } from "@/components/ui";

export const metadata = { title: "Recovery desk" };

export default async function RecoveryPage({ params }: PageProps<"/app/recovery/[scenarioId]">) {
  const { scenarioId } = await params;
  return (
    <Suspense fallback={<Spinner label="Loading scenario…" />}>
      <RecoveryDesk scenarioId={scenarioId} />
    </Suspense>
  );
}
