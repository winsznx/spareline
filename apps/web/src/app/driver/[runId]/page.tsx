import { Suspense } from "react";

import { DriverManifest } from "@/components/driver-manifest";

export const metadata = { title: "Driver manifest" };

export default async function DriverPage({ params }: PageProps<"/driver/[runId]">) {
  const { runId } = await params;
  return (
    <Suspense fallback={null}>
      <DriverManifest runId={runId} />
    </Suspense>
  );
}
