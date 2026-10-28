/*
 * React page for /loki.
 * Uses local component state, browser APIs, and Triff.Tools backend endpoints to render the page workflow.
 */

import React, { useMemo, useRef } from "react";
import { motion, useInView, useScroll, useTransform } from "framer-motion";

type Fit = {
    name: string;
    role: string;
    tags: string[];
    blurb: string;
    dnaOrText: string;
};

function cx(...classes: Array<string | false | undefined | null>) {
    return classes.filter(Boolean).join(" ");
}

function Section({
    children,
    className,
    id,
}: {
    children: React.ReactNode;
    className?: string;
    id?: string;
}) {
    return (
        <section id={id} className={cx("relative w-full", className)}>
            <div className="mx-auto w-full max-w-6xl px-6">{children}</div>
        </section>
    );
}

function GlowBackdrop() {
    return (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -top-48 left-1/2 h-[560px] w-[980px] -translate-x-1/2 rounded-full bg-white/10 blur-3xl" />
            <div className="absolute top-52 left-16 h-[420px] w-[420px] rounded-full bg-white/6 blur-3xl" />
            <div className="absolute bottom-0 right-10 h-[520px] w-[520px] rounded-full bg-white/6 blur-3xl" />
            <div className="absolute inset-0 bg-gradient-to-b from-black via-zinc-950 to-black" />
        </div>
    );
}

function Kicker({ children }: { children: React.ReactNode }) {
    return (
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-semibold tracking-wide text-white/70">
            {children}
        </div>
    );
}

function StoryPanel({
    imageSrc,
    imageAlt,
    kicker,
    title,
    body,
    bullets,
    flip = false,
}: {
    imageSrc: string;
    imageAlt: string;
    kicker: string;
    title: string;
    body: string;
    bullets?: string[];
    flip?: boolean;
}) {
    const ref = useRef<HTMLDivElement | null>(null);
    const inView = useInView(ref, { margin: "-15% 0px -15% 0px" });

    return (
        <div ref={ref} className="py-16 sm:py-20">
            <div className={cx("grid items-center gap-10 lg:gap-12", "lg:grid-cols-2", flip && "lg:[&>*:first-child]:order-2")}>
                <motion.div
                    initial={{ opacity: 0, y: 18 }}
                    animate={inView ? { opacity: 1, y: 0 } : { opacity: 0.2, y: 18 }}
                    transition={{ duration: 0.55, ease: "easeOut" }}
                    className="relative"
                >
                    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]">
                        <div className="absolute inset-0 bg-gradient-to-b from-white/[0.06] to-transparent" />
                        <img
                            src={imageSrc}
                            alt={imageAlt}
                            className="h-[340px] w-full object-cover sm:h-[420px] lg:h-[520px]"
                            loading="lazy"
                        />
                    </div>
                    <div className="mt-4 flex items-center justify-between text-xs text-white/45">
                        <span>triff.tools / loki</span>
                        <span className="rounded-full border border-white/10 bg-black/40 px-3 py-1">URSA internal</span>
                    </div>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 18 }}
                    animate={inView ? { opacity: 1, y: 0 } : { opacity: 0.2, y: 18 }}
                    transition={{ duration: 0.55, ease: "easeOut", delay: 0.06 }}
                    className="rounded-3xl border border-white/10 bg-white/[0.03] p-8 sm:p-10"
                >
                    <Kicker>{kicker}</Kicker>
                    <h2 className="mt-5 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                        {title}
                    </h2>
                    <p className="mt-5 text-base leading-relaxed text-white/60 sm:text-lg">
                        {body}
                    </p>

                    {bullets?.length ? (
                        <ul className="mt-6 space-y-3 text-sm text-white/65 sm:text-base">
                            {bullets.map((b, i) => (
                                <li key={i} className="flex gap-3">
                                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-white/40" />
                                    <span>{b}</span>
                                </li>
                            ))}
                        </ul>
                    ) : null}
                </motion.div>
            </div>
        </div>
    );
}

function FitCard({ fit }: { fit: Fit }) {
    const ref = useRef<HTMLDivElement | null>(null);
    const inView = useInView(ref, { margin: "-15% 0px -15% 0px" });

    return (
        <motion.div
            ref={ref}
            initial={{ opacity: 0, y: 16 }}
            animate={inView ? { opacity: 1, y: 0 } : { opacity: 0.2, y: 16 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
            className="h-full rounded-3xl border border-white/10 bg-white/[0.03] p-7 sm:p-8 flex flex-col"
        >
            <div className="flex flex-wrap items-center gap-2">
                <div className="text-lg font-semibold tracking-tight text-white">{fit.name}</div>
                <div className="rounded-full border border-white/10 bg-black/50 px-3 py-1 text-xs font-medium text-white/70">
                    {fit.role}
                </div>
                <div className="ml-auto flex flex-wrap gap-2">
                    {fit.tags.map((t) => (
                        <span
                            key={t}
                            className="rounded-full border border-white/10 bg-white/[0.02] px-3 py-1 text-xs text-white/60"
                        >
                            {t}
                        </span>
                    ))}
                </div>
            </div>

            <p className="mt-4 text-sm leading-relaxed text-white/60 sm:text-base">{fit.blurb}</p>

            <div className="mt-5 flex-1 rounded-2xl border border-white/10 bg-black/40 p-5 flex flex-col">
                <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold tracking-widest text-white/60">COPY/PASTE</div>
                    <button
                        onClick={() => navigator.clipboard.writeText(fit.dnaOrText)}
                        className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white/70 hover:bg-white/[0.07]"
                    >
                        Copy
                    </button>
                </div>
                <pre className="mt-3 flex-1 min-h-[180px] max-h-60 overflow-auto rounded-xl border border-white/10 bg-black/60 p-4 text-[11px] leading-relaxed text-white/70">
                    {fit.dnaOrText}
                </pre>
            </div>
        </motion.div>
    );
}

export default function Loki() {
    const images = useMemo(
        () => Array.from({ length: 10 }, (_, i) => `/static/og/loki${i + 1}.png`),
        []
    );

    const fits: Fit[] = useMemo(
        () => [
            {
                name: "Loki — Fleet Utility / Logi",
                role: "Fleet Utility / Logi",
                tags: ["Logi", "Remote Shield", "Cap Stable", "Anchor"],
                blurb:
                    "The backbone af a fleet. Remote shield reps with a fat buffer and strong capacitor profile—keeps everyone alive even through jams and cap-war. Fitting at comfortably below 1b (https://www.triff.tools/appraisals/VjJTsU), the logi Loki reps like a basi that doesn't have triple-A batteries for a capcitor, while still being fast enough and tanky enough to handle the enemy fleet. ",
                dnaOrText:
                    `[Loki, Logi Loki]
Damage Control II
True Sansha Capacitor Power Relay
True Sansha Capacitor Power Relay
True Sansha Capacitor Power Relay
True Sansha Capacitor Power Relay

50MN Quad LiF Restrained Microwarpdrive
Republic Fleet Large Shield Extender
Multispectrum Shield Hardener II
Republic Fleet Large Cap Battery
Multispectrum Shield Hardener II

Medium Ancillary Remote Shield Booster
Pithum C-Type Medium Remote Shield Booster
Pithum C-Type Medium Remote Shield Booster
Pithum C-Type Medium Remote Shield Booster
Pithum C-Type Medium Remote Shield Booster
Pithum C-Type Medium Remote Shield Booster

Medium Core Defense Field Extender II
Medium Core Defense Field Extender II
Medium Capacitor Control Circuit II

Loki Core - Augmented Nuclear Reactor
Loki Defensive - Augmented Durability
Loki Offensive - Support Processor
Loki Propulsion - Wake Limiter

Warrior II x5
Hornet EC-300 x5

Navy Cap Booster 50 x109
`,
            },
            {
                name: "Loki — Nano Gang Terror",
                role: "Nano / Control",
                tags: ["Nano", "100MN AB", "Probes", "HM", "tight fitting"],
                blurb:
                    "Fast, oppressive, and impossible to ignore. Long point + web control with heavy missiles for constant pressure, the nano Loki is one of the easiest to fit and most enjoyable to fly. With a low skill floor and a high ceiling, there's room for every level of nano pilot. Blinging the fit and pod has real value in small scale fights too, offering fits for every wallet.",
                dnaOrText:
                    `[Loki, 100mn HM]

Nanofiber Internal Structure II
Ballistic Control System II
Ballistic Control System II

Federation Navy 100MN Afterburner
'Thurifer' Large Cap Battery
Republic Fleet Warp Disruptor
Multispectrum Shield Hardener II
Shadow Serpentis Stasis Webifier
Multispectrum Shield Hardener II
Pithum B-Type Medium Shield Booster

Heavy Missile Launcher II, Caldari Navy Scourge Heavy Missile
Expanded Probe Launcher II
Heavy Missile Launcher II, Caldari Navy Scourge Heavy Missile
Heavy Missile Launcher II, Caldari Navy Scourge Heavy Missile
Heavy Missile Launcher II, Caldari Navy Scourge Heavy Missile
Compact Interdiction Nullifier
Heavy Missile Launcher II, Caldari Navy Scourge Heavy Missile

Medium Ancillary Current Router II
Medium Ancillary Current Router I
Medium Ancillary Current Router II

Loki Core - Immobility Drivers
Loki Defensive - Adaptive Defense Node
Loki Offensive - Launcher Efficiency Configuration
Loki Propulsion - Wake Limiter

Hobgoblin II x3
Hobgoblin II x5

Mjolnir Fury Heavy Missile x1000
Nova Fury Heavy Missile x930
Caldari Navy Inferno Heavy Missile x1000
Caldari Navy Mjolnir Heavy Missile x1000
Caldari Navy Nova Heavy Missile x1000
Caldari Navy Scourge Heavy Missile x1000
Nanite Repair Paste x250
Sisters Combat Scanner Probe x16
`,
            },
            {
                name: "Loki — Brawl / U2 Line",
                role: "Brawler",
                tags: ["Brawl", "HAM", "Triple LSE", "Nos", "fleet line"],
                blurb:
                    "The commit button. Triple extender buffer, dual hardeners, and HAM pressure with nos to stay nasty on grid and go toe to toe with the other brawling comps. Replace this with cloaky hunters, scanners, instalockers, heavy tackle or any other role in the fleet and you'll see, the Loki provides. What it struggles to fill in brawls is made up for by its utility and versatility.",
                dnaOrText:
                    `[Loki, U2 SHIELD]
Damage Control II
Ballistic Control System II
Ballistic Control System II

Caldari Navy Large Shield Extender
Caldari Navy Large Shield Extender
Caldari Navy Large Shield Extender
50MN Y-T8 Compact Microwarpdrive
Caldari Navy Stasis Webifier
Multispectrum Shield Hardener II
Multispectrum Shield Hardener II

Small Ghoul Compact Energy Nosferatu
Small Ghoul Compact Energy Nosferatu
Heavy Assault Missile Launcher II
Heavy Assault Missile Launcher II
Heavy Assault Missile Launcher II
Heavy Assault Missile Launcher II
Heavy Assault Missile Launcher II

Medium Ancillary Current Router I
Medium Warhead Calefaction Catalyst I
Medium Core Defense Field Extender II

Loki Core - Immobility Drivers
Loki Defensive - Augmented Durability
Loki Offensive - Launcher Efficiency Configuration
Loki Propulsion - Wake Limiter

Warrior II x8

Inferno Rage Heavy Assault Missile x2500
Mjolnir Rage Heavy Assault Missile x2830
Mjolnir Javelin Heavy Assault Missile x2500
Missile Range Script x1
Guristas Scourge Heavy Assault Missile x2500
Nanite Repair Paste x175
Core Scanner Probe I x8
Missile Precision Script x1
Synth Crash Booster x1
Agency 'Pyrolancea' DB7 Dose III x1
Loki Defensive - Covert Reconfiguration x1
Core Probe Launcher I x8
Enduring Interdiction Nullifier x1
Mobile Depot x1
`,
            },
        ],
        []
    );

    const heroRef = useRef<HTMLDivElement | null>(null);
    const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
    const heroY = useTransform(scrollYProgress, [0, 1], [0, -60]);
    const heroOpacity = useTransform(scrollYProgress, [0, 0.75, 1], [1, 0.65, 0.15]);

    return (
        <div className="relative min-h-screen text-white">
            { }
            <div className="relative isolate overflow-hidden" ref={heroRef}>
                <GlowBackdrop />

                <div className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
                    <div className="flex items-center gap-3">
                        <img
                            src="https://images.evetech.net/types/29990/icon?size=64"
                            alt="Loki icon"
                            className="h-8 w-8 rounded-xl border border-white/10 bg-white/[0.05] object-cover"
                        />
                        <div className="text-sm font-semibold tracking-tight text-white/80">
                            triff.tools / loki
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <a
                            href="/"
                            className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-semibold text-white/70 hover:bg-white/[0.07]"
                        >
                            Back to Tools
                        </a>
                    </div>
                </div>

                <Section className="relative z-10 pt-12 pb-10 sm:pt-16 sm:pb-14">
                    <motion.div style={{ y: heroY, opacity: heroOpacity }}>
                        <Kicker>URSA Doctrine Proposal • Loki T3C Platform</Kicker>

                        <h1 className="mt-6 text-5xl font-semibold tracking-tight sm:text-6xl md:text-7xl">
                            Loki.
                            <span className="block text-white/70">The wormhole ship.</span>
                        </h1>

                        <p className="mt-6 max-w-2xl text-base leading-relaxed text-white/60 sm:text-lg">
                            Stop getting dunked on by every corp that isn't scared to field T3C's, and being reluctant to field nano comps. Adopt the best ship in the game, today!
                        </p>
                    </motion.div>

                    <div className="mt-10 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]">
                        <div className="absolute inset-0" />
                        <img
                            src={images[0]}
                            alt="Loki hero image"
                            className="h-[360px] w-full object-cover sm:h-[460px] lg:h-[560px]"
                        />
                    </div>
                </Section>
            </div>

            { }
            <div id="why" className="relative border-t border-white/10 bg-zinc-950">
                <Section className="py-10 sm:py-14">
                    <div className="max-w-3xl">
                        <div className="text-xs font-semibold tracking-widest text-white/60">WHY THE LOKI</div>
                        <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
                            Wormholes reward the ship that can adapt to any situation.
                        </h2>
                        <p className="mt-4 text-base leading-relaxed text-white/60 sm:text-lg">
                            In URSA, you rarely get perfect intel. The Loki is built for that environment:
                            it enters the unknown and still decides the terms of the fight. It doesn't matter if you're dropping on nano scum, marauder balls or a brawl, the loki has the damage, tank, speed and utility to match it.
                        </p>
                    </div>

                    <StoryPanel
                        imageSrc={images[1]}
                        imageAlt="Loki image 2"
                        kicker="Uncertainty tolerance"
                        title="Unknown grid? The Loki still has a plan."
                        body="Cloak + probes + flexible control means you stay relevant whether you're hunting, scouting, tackling, or pivoting into brawl."
                        bullets={[
                            "You can show up first without instantly committing.",
                            "You can reposition without losing the engagement.",
                            "You can force the fight you want — or deny the fight you don’t.",
                        ]}
                    />

                    <StoryPanel
                        imageSrc={images[2]}
                        imageAlt="Loki image 3"
                        kicker="Control wins fights"
                        title="In wormholes, control is damage."
                        body="Raw DPS is great, but range, webs, speed, and application are what turns a ping into a BR."
                        bullets={[
                            "Targets die when they can’t leave, not when you do theoretical DPS.",
                            "Range control + webs create panic — panic creates mistakes.",
                            "The Loki punishes mistakes like no other ship.",
                        ]}
                        flip
                    />

                    <StoryPanel
                        imageSrc={images[3]}
                        imageAlt="Loki image 4"
                        kicker="Versatility without confusion"
                        title="A doctrine hull that doesn’t feel like a cage."
                        body="Standardize roles and subsystems, allow minor fitting flex, and you get doctrine coherence without forcing every pilot into the same brawl ship."
                        bullets={[
                            "Doctrine-tight where it matters, flexible where it helps pilots perform.",
                            "Same hull supports multiple roles across the same fight.",
                            "Less reshipping = more pressure = better results.",
                        ]}
                    />

                    <StoryPanel
                        imageSrc={images[4]}
                        imageAlt="Loki image 5"
                        kicker="Scaling"
                        title="Solo menace → small gang core → fleet backbone."
                        body="The Loki scales better than any other hull. That matters for URSA because our ops aren’t always the same size — but the hull can be."
                        bullets={[
                            "The hull remains useful regardless of who logs in.",
                            "You can build comps faster and field something coherent.",
                            "Opponents have to guess what your Lokis are doing.",
                        ]}
                        flip
                    />
                </Section>
            </div>

            { }
            <div id="fits" className="relative border-t border-white/10 bg-black">
                <Section className="py-14 sm:py-20">
                    <div className="grid items-end gap-8 lg:grid-cols-2">
                        <div>
                            <div className="text-xs font-semibold tracking-widest text-white/60">FITS</div>
                            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
                                Keep it simple: a few roles, a few fits, lots of fights.
                            </h2>
                            <p className="mt-4 text-base leading-relaxed text-white/60 sm:text-lg">
                                The Loki can fill every role, from nano to logi.
                            </p>
                        </div>

                        <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]">
                            <img
                                src={images[5]}
                                alt="Loki image 6"
                                className="h-[260px] w-full object-cover sm:h-[320px] lg:h-[360px]"
                                loading="lazy"
                            />
                        </div>
                    </div>

                    <div className="mt-10 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                        {fits.map((fit) => (
                            <FitCard key={fit.name} fit={fit} />
                        ))}
                    </div>
                </Section>
            </div>

            { }
            <div id="cta" className="relative border-t border-white/10 bg-zinc-950">
                <Section className="py-16 sm:py-20">
                    <div className="grid items-center gap-10 lg:grid-cols-2">
                        <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-9 sm:p-10">
                            <div className="text-xs font-semibold tracking-widest text-white/70">CALL TO ACTION</div>
                            <h2 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
                                Add Loki to URSA doctrine.
                            </h2>
                            <p className="mt-5 text-base leading-relaxed text-white/65 sm:text-lg">
                                Standardize the hull. Start fielding it. The Loki has turned the tide of a battle against us too many times to ignore.
                            </p>

                            <div className="mt-8 flex flex-wrap gap-3">
                                <button
                                    onClick={() =>
                                        navigator.clipboard.writeText(
                                            "The Loki is the best and most versatile ship in wormhole space, if you can't fly it, you can't compete."
                                        )
                                    }
                                    className="rounded-2xl border border-white/10 bg-white/[0.10] px-5 py-3 text-sm font-semibold text-white/90 hover:bg-white/[0.13]"
                                >
                                    Copy proposal TL;DR
                                </button>

                                <a
                                    href="#fits"
                                    className="rounded-2xl border border-white/10 bg-black/40 px-5 py-3 text-sm font-semibold text-white/75 hover:bg-white/[0.06]"
                                >
                                    Review fits
                                </a>
                            </div>

                            <div className="mt-8 rounded-2xl border border-white/10 bg-black/40 p-5 text-sm text-white/65">
                                Dropping the Nighthawk requirement saves our members 1.9m SP in Caldari BC V and command ships IV alone, and asking them to still train the Basi means they can reasonably fly a Tengu with caldari cruiser V. A U2 Tengu still has a utility high and mid, dumps out over 900dps with HAMs and clocks over 100k ehp, a very comfortable replacement for brawling at a similar price. Skilling our members into the Loki and Tengu also unlocks recon ships and HAC's in both Minmatar and Caldari for more support roles and more fun comps in the future. Alternatively, dropping the Basi requirement and adding the Loki lets us keep U2 untouched and still have access to vagas, munins, huggins and rapiers.
                            </div>
                        </div>

                        <div className="space-y-6">
                            <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]">
                                <img
                                    src={images[6]}
                                    alt="Loki image 7"
                                    className="h-[300px] w-full object-cover sm:h-[360px] lg:h-[420px]"
                                    loading="lazy"
                                />
                            </div>

                            <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]">
                                <img
                                    src={images[7]}
                                    alt="Loki image 8"
                                    className="h-[220px] w-full object-cover sm:h-[260px] lg:h-[300px]"
                                    loading="lazy"
                                />
                            </div>
                        </div>
                    </div>
                </Section>

                <footer className="border-t border-white/10 bg-black py-10">
                    <div className="mx-auto flex max-w-6xl items-center justify-between px-6 text-xs text-white/40">
                        <div>triff.tools / loki — internal doctrine pitch</div>
                        <div>URSA</div>
                    </div>
                </footer>
            </div>
        </div>
    );
}
