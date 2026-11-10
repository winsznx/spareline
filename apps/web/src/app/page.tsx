import Link from "next/link";

import { Wordmark } from "@/components/brand";
import { DeskDecision, DeskMap, Evidence, FailingMoment, HeroReplay, HowItWorks } from "@/components/landing-live";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonClass } from "@/components/ui";

const WRAP = "mx-auto w-full max-w-[1328px] px-5 md:px-8 xl:px-16";

export default function LandingPage() {
  return (
    <div className="bg-canvas">
      <section aria-labelledby="hero-title" className="screen relative flex flex-col">
        <header className="absolute inset-x-0 top-0 z-20">
          <div className={`${WRAP} flex h-16 items-center gap-6`}>
            <Wordmark />
            <nav aria-label="Site" className="ml-auto hidden items-center gap-1 text-sm text-ink-2 md:flex">
              <a className="rounded-md px-3 py-2 hover:text-ink" href="#how">
                How it works
              </a>
              <a className="rounded-md px-3 py-2 hover:text-ink" href="#evidence">
                Evidence
              </a>
              <Link className="rounded-md px-3 py-2 hover:text-ink" href="/app/methodology">
                Methodology
              </Link>
            </nav>
            <div className="ml-auto md:ml-0">
              <ThemeToggle />
            </div>
          </div>
        </header>
        <div className={`${WRAP} grid flex-1 items-center gap-8 pt-20 pb-8 md:gap-10 md:pt-24 md:pb-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:pt-20 lg:pb-14`}>
          <div className="max-w-[680px]">
            <p className="font-mono text-[12px] tracking-[0.06em] text-ink-2">DELIVERY OPERATIONS / RECOVERY</p>
            <h1 id="hero-title" className="mt-5 text-[40px] leading-[1.07] font-semibold tracking-[-0.055em] text-balance md:text-[52px] xl:text-[64px]">
              When a route falls behind, know exactly what to move.
            </h1>
            <p className="mt-5 max-w-[540px] text-[16px] md:mt-6 md:text-[17px] leading-[1.55] text-ink-2">
              Spareline finds a practical rescue: who can take the packages, where drivers meet, and whether the transfer actually helps.
            </p>
            <div className="mt-7 flex flex-wrap gap-3 md:mt-8">
              <Link className={buttonClass("primary", "lg")} href="/app">
                Open the recovery desk
              </Link>
              <a className={buttonClass("secondary", "lg")} href="#how">
                See the process
              </a>
            </div>
            <p className="mt-5 text-[13px] text-ink-3 md:mt-6">Research replay using historical delivery routes. Delays are simulated.</p>
          </div>
          <div className="h-[190px] min-w-0 sm:h-[380px] lg:h-[min(560px,calc(100svh-200px))]">
            <HeroReplay />
          </div>
        </div>
      </section>

      <section aria-labelledby="moment-title" className="screen flex flex-col justify-center bg-surface py-16">
        <div className={WRAP}>
          <h2 id="moment-title" className="max-w-[760px] text-[36px] leading-[1.1] font-semibold tracking-[-0.045em] md:text-[48px]">
            One van is late. The help has a cost.
          </h2>
          <div className="mt-6">
            <FailingMoment />
          </div>
        </div>
      </section>

      <section id="how" aria-labelledby="how-title" className="screen flex flex-col justify-center py-16">
        <div className={WRAP}>
          <h2 id="how-title" className="mb-10 text-[28px] leading-[1.2] font-semibold tracking-[-0.035em]">
            How a rescue works
          </h2>
          <HowItWorks />
        </div>
      </section>

      <section aria-labelledby="desk-title" className="screen relative flex flex-col bg-graphite lg:block">
        <div className="relative h-[56svh] lg:absolute lg:inset-0 lg:h-auto">
          <DeskMap />
        </div>
        <div className="pointer-events-none relative z-10 flex flex-1 flex-col lg:absolute lg:inset-0 lg:flex-row lg:items-end lg:justify-between lg:p-8">
          <h2
            id="desk-title"
            className="pointer-events-auto order-first px-5 pt-6 text-[28px] leading-[1.15] font-semibold tracking-[-0.035em] text-white lg:absolute lg:top-8 lg:left-8 lg:max-w-[360px] lg:rounded-[12px] lg:bg-graphite/90 lg:px-5 lg:py-4"
          >
            Inside the recovery desk
            <span className="mt-2 block text-[14px] leading-relaxed font-normal tracking-normal text-[#A7B2BD]">
              Real 2018 routes from one depot on one day. The late van is solid, the helper dashed, the copper node is the handoff.
            </span>
          </h2>
          <div className="pointer-events-auto m-5 rounded-[16px] border border-line bg-raised p-5 lg:m-0 lg:ml-auto lg:w-[380px]">
            <DeskDecision />
          </div>
        </div>
      </section>

      <section id="evidence" aria-labelledby="evidence-title" className="screen flex flex-col justify-center py-16">
        <div className={WRAP}>
          <h2 id="evidence-title" className="text-[36px] leading-[1.1] font-semibold tracking-[-0.045em] md:text-[48px]">
            Measured, not promised
          </h2>
          <p className="mt-3 max-w-[700px] text-[16px] leading-relaxed text-ink-2">
            Research evaluation, not field performance. Every policy is scored on the same predeclared scenarios with the same clock, and abstentions are counted.
          </p>
          <div className="mt-10">
            <Evidence />
          </div>
        </div>
      </section>

      <section aria-labelledby="close-title" className="screen flex flex-col bg-graphite text-white">
        <div className={`${WRAP} flex flex-1 flex-col justify-center py-16`}>
          <h2 id="close-title" className="max-w-[820px] text-[44px] leading-[1.05] font-semibold tracking-[-0.05em] md:text-[72px]">
            See the route. Find the rescue.
          </h2>
          <div className="mt-10 flex flex-wrap gap-3">
            <Link className="inline-flex h-12 items-center rounded-[8px] bg-[#C1875B] px-5 text-[15px] font-medium text-[#131920] hover:brightness-105" href="/app/scenarios">
              Try a real replay
            </Link>
            <Link className="inline-flex h-12 items-center rounded-[8px] border border-white/25 px-5 text-[15px] font-medium text-white hover:bg-white/10" href="/app/methodology">
              Read the methodology
            </Link>
          </div>
        </div>
        <footer className="border-t border-white/10 text-[#A7B2BD]">
          <div className={`${WRAP} grid gap-6 py-8 text-[13px] leading-relaxed md:grid-cols-2`}>
            <p className="max-w-[460px]">
              Spareline is a research replay tool for late-route rescue decisions. It does not track or dispatch real drivers. Cross-route travel times are
              estimated, and uncertain rescues are withheld.
            </p>
            <p className="max-w-[460px]">
              Data: Amazon Last Mile Routing Research Challenge (Amazon and MIT CTL, 2018 routes),{" "}
              <a className="underline underline-offset-2 hover:text-white" href="https://registry.opendata.aws/amazon-last-mile-challenges/" target="_blank" rel="noreferrer">
                Registry of Open Data on AWS
              </a>
              ,{" "}
              <a className="underline underline-offset-2 hover:text-white" href="https://creativecommons.org/licenses/by-nc/4.0/" target="_blank" rel="noreferrer">
                CC BY-NC 4.0
              </a>
              . Map © OpenFreeMap, © OpenStreetMap contributors. DataNova 2026, DN-OR-01.
            </p>
          </div>
        </footer>
      </section>
    </div>
  );
}
