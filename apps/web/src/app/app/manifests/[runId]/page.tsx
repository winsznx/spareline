import { HandoffPage } from "@/components/handoff";

export const metadata = { title: "Handoff and manifests" };

export default async function ManifestsPage({ params }: PageProps<"/app/manifests/[runId]">) {
  const { runId } = await params;
  return <HandoffPage runId={runId} />;
}
