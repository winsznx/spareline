import Link from "next/link";

import { PageHeader, Panel } from "@/components/ui";

export const metadata = { title: "Help" };

const STEPS = [
  {
    title: "Pick a replay",
    body: "Open Scenarios and choose one of the three curated replays, or start from the overview. Each replay is a group of real 2018 Amazon routes from one depot on one day.",
  },
  {
    title: "Set the disruption",
    body: "On the recovery desk, choose the late van and set a delay, a traffic factor or a breakdown. These are simulated and labelled as such. Changing them creates a new scenario revision.",
  },
  {
    title: "Recalculate",
    body: "Recalculate rescue runs the solver on the server. It projects every van's remaining stops, tests handoffs to each helper, and compares three policies: do nothing, the nearest helper, and Spareline.",
  },
  {
    title: "Read the decision",
    body: "A recommendation shows exactly which stops move, where the vans meet and what happens to both routes. If no transfer is safe, the reasons are listed and no manifest is issued.",
  },
  {
    title: "Approve and confirm",
    body: "Review handoff opens both driver manifests. Approving is a simulated dispatch action. Packages count as transferred only after both drivers' confirmations are recorded. CSV downloads unlock after approval.",
  },
];

export default function HelpPage() {
  return (
    <div className="max-w-[860px] space-y-5">
      <PageHeader title="How to use the recovery desk" />
      <ol className="space-y-3">
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <Panel className="flex gap-4 p-4">
              <span className="tnum mt-0.5 font-mono text-[13px] text-ink-3">{i + 1}</span>
              <div>
                <h2 className="text-[16px] font-semibold">{s.title}</h2>
                <p className="mt-1 text-sm leading-relaxed text-ink-2">{s.body}</p>
              </div>
            </Panel>
          </li>
        ))}
      </ol>
      <Panel className="p-4 text-sm leading-relaxed text-ink-2">
        <h2 className="text-[16px] font-semibold text-ink">Keyboard</h2>
        <p className="mt-1">
          Every control is reachable with Tab. Sliders move with the arrow keys. The map has a list view with every stop, ETA and coordinate, so nothing on the map
          is mouse-only.
        </p>
        <p className="mt-3">
          For the data, assumptions and limits behind each number, read the <Link className="text-route-other underline underline-offset-2" href="/app/methodology">methodology</Link>.
        </p>
      </Panel>
    </div>
  );
}
