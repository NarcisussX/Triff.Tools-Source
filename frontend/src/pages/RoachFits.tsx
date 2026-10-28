/*
 * React page for /RoachFits.
 * Uses local component state, browser APIs, and Triff.Tools backend endpoints to render the page workflow.
 */

import React, { useMemo, useState } from "react";
import { ToolChrome, ToolEmptyState } from "../components/tool-ui";

import Golem5n from "../assets/fits/Golem5n.png";
import Golem4n from "../assets/fits/Golem4n.png";
import Golem5y from "../assets/fits/Golem5y.png";
import Golem4y from "../assets/fits/Golem4y.png";

import Vargur5n from "../assets/fits/Vargur5n.png";
import Vargur4n from "../assets/fits/Vargur4n.png";
import Vargur5y from "../assets/fits/Vargur5y.png";
import Vargur4y from "../assets/fits/Vargur4y.png";

import Paladin5n from "../assets/fits/Paladin5n.png";
import Paladin4n from "../assets/fits/Paladin4n.png";
import Paladin5y from "../assets/fits/Paladin5y.png";
import Paladin4y from "../assets/fits/Paladin4y.png";

import Kronos5n from "../assets/fits/Kronos5n.png";
import Kronos4n from "../assets/fits/Kronos4n.png";
import Kronos5y from "../assets/fits/Kronos5y.png";
import Kronos4y from "../assets/fits/Kronos4y.png";

type Marauder = "Golem" | "Vargur" | "Paladin" | "Kronos";
type YesNo = "yes" | "no";

type FitEntry = {
    image: string;
    fitText: string;
    notes: string;
};

type SharedFitLinkResponse = {
    ok: boolean;
    path?: string;
    url?: string;
    message?: string;
    error?: string;
};

type MarauderFitMap = Record<
    Marauder,
    {
        "5n": FitEntry;
        "5y": FitEntry;
        "4n": FitEntry;
        "4y": FitEntry;
    }
>;

const marauders: Marauder[] = ["Golem", "Vargur", "Paladin", "Kronos"];

const FIT_DATA: MarauderFitMap = {
    Golem: {
        "5n": {
            image: Golem5n,
            fitText: `[Golem, Golem Marauders V No Dread]

Capacitor Flux Coil II
Capacitor Flux Coil II
Ballistic Control System II
Ballistic Control System II

Republic Fleet Large Cap Battery
Republic Fleet Large Cap Battery
Target Painter II
Cap Recharger II
Pith X-Type X-Large Shield Booster
Cap Recharger II
Pithum C-Type Multispectrum Shield Hardener

Medium Energy Nosferatu II
Torpedo Launcher II, Mjolnir Rage Torpedo
Torpedo Launcher II, Mjolnir Rage Torpedo
Torpedo Launcher II, Mjolnir Rage Torpedo
Torpedo Launcher II, Mjolnir Rage Torpedo
Bastion Module I
Imperial Navy Large EMP Smartbomb
Imperial Navy Large EMP Smartbomb

Large Capacitor Control Circuit II
Large Capacitor Control Circuit II

Mid-grade Crystal Alpha
Mid-grade Crystal Beta
Mid-grade Crystal Gamma
Mid-grade Crystal Delta
Mid-grade Crystal Epsilon
Zainou 'Snapshot' Torpedoes TD-603
Zainou 'Deadeye' Missile Bombardment MB-703
Zainou 'Deadeye' Guided Missile Precision GP-803
Zainou 'Deadeye' Target Navigation Prediction TN-903
Zainou 'Deadeye' Rapid Launch RL-1003

Inferno Rage Torpedo x7000
Mjolnir Javelin Torpedo x3840
Mjolnir Rage Torpedo x5000
Caldari Navy Mjolnir Torpedo x6500
Mobile Tractor Unit x1`,
            notes:
                `You only need to run crystals in your pod if you are doing Core Strongholds. If you skip Strongholds, Crystals are NOT needed. The other implants in the fit are worthwhile still.

The NOS is only necessary on the drifter, and only if you're solo boxing the site and will be the only thing targetted by his neuts.

Only reload to faction torps for cruisers if you are solo. If there are multiple marauders running the site, focus your DPS on the battleships and let your friends/alts kill the smaller things.

USING SYNTH DRUGS is almost always worthwhile. While these fits are designed not to need them, synth mindflood to add some capacitor, or exile/blue pill for tank, along with frentix/crash for tracking and application are all extremely cheap and make a noticable difference. It is encouraged to run these drugs when you're getting the hang of a new fit, and even beyond that.`,
        },
        "5y": {
            image: Golem5y,
            fitText: `[Golem, Marauders V With Dread]

Capacitor Flux Coil II
Capacitor Flux Coil II
Capacitor Flux Coil II
Ballistic Control System II

Republic Fleet Large Cap Battery
Republic Fleet Large Cap Battery
Target Painter II
True Sansha Cap Recharger
Pith X-Type X-Large Shield Booster
True Sansha Cap Recharger
Pithum C-Type Multispectrum Shield Hardener

Corpum A-Type Medium Energy Nosferatu
Torpedo Launcher II, Mjolnir Rage Torpedo
Torpedo Launcher II, Mjolnir Rage Torpedo
Torpedo Launcher II, Mjolnir Rage Torpedo
Torpedo Launcher II, Mjolnir Rage Torpedo
Bastion Module I
Imperial Navy Large EMP Smartbomb
Imperial Navy Large EMP Smartbomb

Large Capacitor Control Circuit II
Large Capacitor Control Circuit II

Mid-grade Crystal Alpha
Mid-grade Crystal Beta
Mid-grade Crystal Gamma
Mid-grade Crystal Delta
Mid-grade Crystal Epsilon
Zainou 'Snapshot' Torpedoes TD-603
Zainou 'Deadeye' Missile Bombardment MB-703
Zainou 'Deadeye' Guided Missile Precision GP-803
Zainou 'Deadeye' Target Navigation Prediction TN-903
Zainou 'Deadeye' Rapid Launch RL-1003

Inferno Rage Torpedo x7000
Mjolnir Javelin Torpedo x3840
Mjolnir Rage Torpedo x5000
Caldari Navy Mjolnir Torpedo x6500
Mobile Tractor Unit x1`,
            notes:
                `You only need to run crystals in your pod if you are doing Core Strongholds. If you skip Strongholds, Crystals are NOT needed. The other implants in the fit are worthwhile still.

The NOS is only necessary on the drifter, and only if you're being targetted by his neuts.

Only reload to faction torps for cruisers if you are the only marauder on site. If there are multiple marauders running the site, focus your DPS on the battleships and let your friends/alts kill the smaller things.

USING SYNTH DRUGS is almost always worthwhile. While these fits are designed not to need them, synth mindflood to add some capacitor, or exile/blue pill for tank, along with frentix/crash for tracking and application are all extremely cheap and make a noticable difference. It is encouraged to run these drugs when you're getting the hang of a new fit, and even beyond that.`,
        },
        "4n": {
            image: Golem4n,
            fitText: `[Golem, Marauders IV No Dread]

Capacitor Flux Coil II
Capacitor Flux Coil II
Ballistic Control System II
Ballistic Control System II

Republic Fleet Large Cap Battery
Republic Fleet Large Cap Battery
Target Painter II
Cap Recharger II
Pith X-Type X-Large Shield Booster
Cap Recharger II
Pithum C-Type Multispectrum Shield Hardener

Medium Energy Nosferatu II
Torpedo Launcher II, Mjolnir Rage Torpedo
Torpedo Launcher II, Mjolnir Rage Torpedo
Torpedo Launcher II, Mjolnir Rage Torpedo
Torpedo Launcher II, Mjolnir Rage Torpedo
Bastion Module I
Imperial Navy Large EMP Smartbomb
Imperial Navy Large EMP Smartbomb

Large Capacitor Control Circuit II
Large Capacitor Control Circuit II

Mid-grade Crystal Alpha
Mid-grade Crystal Beta
Mid-grade Crystal Gamma
Mid-grade Crystal Delta
Mid-grade Crystal Epsilon
Zainou 'Snapshot' Torpedoes TD-603
Zainou 'Deadeye' Missile Bombardment MB-703
Zainou 'Deadeye' Guided Missile Precision GP-803
Zainou 'Deadeye' Target Navigation Prediction TN-903
Zainou 'Deadeye' Rapid Launch RL-1003

Inferno Rage Torpedo x7000
Mjolnir Javelin Torpedo x3840
Mjolnir Rage Torpedo x5000
Caldari Navy Mjolnir Torpedo x6500
Mobile Tractor Unit x1`,
            notes:
                `HIGHLY RECOMMEND SYNTH BLUE PILL IF YOU ARE SOLO ON LAST WAVE OF STRONGHOLD.

You only need to run crystals in your pod if you are doing Core Strongholds. If you skip Strongholds, Crystals and synth blue pill are NOT needed. The other implants in the fit are worthwhile still.

The NOS is only necessary on the drifter, and only if you're solo boxing the site and will be the only thing targetted by his neuts.

Only reload to faction torps for cruisers if you are solo. If there are multiple marauders running the site, focus your DPS on the battleships and let your friends/alts kill the smaller things.

USING SYNTH DRUGS is almost always worthwhile. Synth mindflood to add some capacitor, or exile/blue pill for tank, along with frentix/crash for tracking and application are all extremely cheap and make a noticable difference. It is encouraged to run these drugs when you're getting the hang of a new fit, and even beyond that.`,
        },
        "4y": {
            image: Golem4y,
            fitText: `[Golem, Marauders IV With Dread]

Capacitor Flux Coil II
Capacitor Flux Coil II
Capacitor Flux Coil II
Ballistic Control System II

Republic Fleet Large Cap Battery
Republic Fleet Large Cap Battery
Target Painter II
True Sansha Cap Recharger
Pith X-Type X-Large Shield Booster
True Sansha Cap Recharger
Pithum C-Type Multispectrum Shield Hardener

Corpum A-Type Medium Energy Nosferatu
Torpedo Launcher II, Mjolnir Rage Torpedo
Torpedo Launcher II, Mjolnir Rage Torpedo
Torpedo Launcher II, Mjolnir Rage Torpedo
Torpedo Launcher II, Mjolnir Rage Torpedo
Bastion Module I
Imperial Navy Large EMP Smartbomb
Imperial Navy Large EMP Smartbomb

Large Capacitor Control Circuit II
Large Capacitor Control Circuit II

Mid-grade Crystal Alpha
Mid-grade Crystal Beta
Mid-grade Crystal Gamma
Mid-grade Crystal Delta
Mid-grade Crystal Epsilon
Zainou 'Snapshot' Torpedoes TD-603
Zainou 'Deadeye' Missile Bombardment MB-703
Zainou 'Deadeye' Guided Missile Precision GP-803
Zainou 'Deadeye' Target Navigation Prediction TN-903
Zainou 'Deadeye' Rapid Launch RL-1003

Inferno Rage Torpedo x7000
Mjolnir Javelin Torpedo x3840
Mjolnir Rage Torpedo x5000
Caldari Navy Mjolnir Torpedo x6500
Mobile Tractor Unit x1`,
            notes:
                `HIGHLY RECOMMEND SYNTH BLUE PILL IF SOLO ON LAST WAVE OF STRONGHOLD.

You only need to run crystals in your pod if you are doing Core Strongholds. If you skip Strongholds, Crystals are NOT needed. The other implants in the fit are worthwhile still.

The NOS is only necessary on the drifter, and only if you're being targetted by his neuts.

Only reload to faction torps for cruisers if you are the only marauder on site. If there are multiple marauders running the site, focus your DPS on the battleships and let your friends/alts kill the smaller things.

USING SYNTH DRUGS is almost always worthwhile. Synth mindflood to add some capacitor, or exile/blue pill for tank, along with frentix/crash for tracking and application are all extremely cheap and make a noticable difference. It is encouraged to run these drugs when you're getting the hang of a new fit, and even beyond that.`,
        },
    },

    Vargur: {
        "5n": {
            image: Vargur5n,
            fitText: `[Vargur, Marauder V No Dread]

Capacitor Flux Coil II
Capacitor Flux Coil II
Capacitor Flux Coil II
Gyrostabilizer II
Gyrostabilizer II
Gyrostabilizer II

Compact Multispectrum Shield Hardener
Compact Multispectrum Shield Hardener
Republic Fleet Large Cap Battery
Republic Fleet Large Cap Battery
Pith X-Type X-Large Shield Booster
Cap Recharger II

800mm Repeating Cannon II, Hail L
800mm Repeating Cannon II, Hail L
800mm Repeating Cannon II, Hail L
800mm Repeating Cannon II, Hail L
Federation Navy Large Plasma Smartbomb
Federation Navy Large Plasma Smartbomb
Bastion Module I

Large Capacitor Control Circuit II
Large Capacitor Control Circuit I

Mid-grade Crystal Alpha
Mid-grade Crystal Beta
Mid-grade Crystal Gamma
Mid-grade Crystal Delta
Mid-grade Crystal Epsilon
Eifyr and Co. 'Gunslinger' Motion Prediction MR-703
Inherent Implants 'Squire' Capacitor Management EM-803
Eifyr and Co. 'Gunslinger' Surgical Strike SS-903
Eifyr and Co. 'Gunslinger' Large Projectile Turret LP-1003

Barrage L x7824
Hail L x11840
Republic Fleet Phased Plasma L x8000`,
            notes:
                `You only need to run crystals in your pod if you are doing Core Strongholds. If you skip Strongholds, Crystals are NOT needed. The other implants in the fit are worthwhile still.

This is the cheapest way to rat C5 sites out of all the marauders. Blinging the tank (dual Pith C-Type multispecs) or the DPS (Faction Gyros) is not necessary, but will help if ganked or if you spawn a wave early.

You will struggle to apply DPS to the final wave of a stronghold due to the orbit distance of the ships and your applied damage with Barrage. While it is possible, it will be very slow and boring. Bring a friend, or an alt.

USING SYNTH DRUGS is almost always worthwhile. While these fits are designed not to need them, synth mindflood to add some capacitor, or exile/blue pill for tank, along with frentix/crash for tracking and application are all extremely cheap and make a noticable difference. It is encouraged to run these drugs when you're getting the hang of a new fit, and even beyond that.`,
        },
        "5y": {
            image: Vargur5y,
            fitText: `[Vargur, Marauder V With Dread]

Capacitor Flux Coil II
Capacitor Flux Coil II
Capacitor Flux Coil II
Capacitor Flux Coil II
Gyrostabilizer II
Gyrostabilizer II

Compact Multispectrum Shield Hardener
Compact Multispectrum Shield Hardener
Republic Fleet Large Cap Battery
Republic Fleet Large Cap Battery
Pith X-Type X-Large Shield Booster
True Sansha Cap Recharger

800mm Repeating Cannon II, Hail L
800mm Repeating Cannon II, Hail L
800mm Repeating Cannon II, Hail L
800mm Repeating Cannon II, Hail L
Federation Navy Large Plasma Smartbomb
Federation Navy Large Plasma Smartbomb
Bastion Module I

Large Capacitor Control Circuit II
Large Capacitor Control Circuit I

Mid-grade Crystal Alpha
Mid-grade Crystal Beta
Mid-grade Crystal Gamma
Mid-grade Crystal Delta
Mid-grade Crystal Epsilon
Eifyr and Co. 'Gunslinger' Motion Prediction MR-703
Inherent Implants 'Squire' Capacitor Management EM-803
Eifyr and Co. 'Gunslinger' Surgical Strike SS-903
Eifyr and Co. 'Gunslinger' Large Projectile Turret LP-1003

Barrage L x7824
Hail L x11840
Republic Fleet Phased Plasma L x8000`,
            notes:
                `You only need to run crystals in your pod if you are doing Core Strongholds. If you skip Strongholds, Crystals are NOT needed. The other implants in the fit are worthwhile still.

This is the cheapest way to rat C5 sites out of all the marauders. Blinging the tank (dual Pith C-Type multispecs) or the DPS (Faction Gyros) is not necessary, but will help if ganked or if you spawn a wave early.

You will struggle to apply DPS to the final wave of a stronghold due to the orbit distance of the ships and your applied damage with Barrage. While it is possible, it will be very slow and boring. Bring a friend, or an alt.

USING SYNTH DRUGS is almost always worthwhile. While these fits are designed not to need them, synth mindflood to add some capacitor, or exile/blue pill for tank, along with frentix/crash for tracking and application are all extremely cheap and make a noticable difference. It is encouraged to run these drugs when you're getting the hang of a new fit, and even beyond that.`,
        },
        "4n": {
            image: Vargur4n,
            fitText: `[Vargur, Marauder IV No Dread]

Capacitor Flux Coil II
Capacitor Flux Coil II
Capacitor Flux Coil II
Gyrostabilizer II
Gyrostabilizer II
Gyrostabilizer II

Compact Multispectrum Shield Hardener
Compact Multispectrum Shield Hardener
Republic Fleet Large Cap Battery
Republic Fleet Large Cap Battery
Pith X-Type X-Large Shield Booster
Cap Recharger II

800mm Repeating Cannon II, Hail L
800mm Repeating Cannon II, Hail L
800mm Repeating Cannon II, Hail L
800mm Repeating Cannon II, Hail L
Federation Navy Large Plasma Smartbomb
Federation Navy Large Plasma Smartbomb
Bastion Module I

Large Capacitor Control Circuit II
Large Capacitor Control Circuit I

Mid-grade Crystal Alpha
Mid-grade Crystal Beta
Mid-grade Crystal Gamma
Mid-grade Crystal Delta
Mid-grade Crystal Epsilon
Eifyr and Co. 'Gunslinger' Motion Prediction MR-703
Inherent Implants 'Squire' Capacitor Management EM-803
Eifyr and Co. 'Gunslinger' Surgical Strike SS-903
Eifyr and Co. 'Gunslinger' Large Projectile Turret LP-1003

Barrage L x7824
Hail L x11840
Republic Fleet Phased Plasma L x8000`,
            notes:
                `You only need to run crystals in your pod if you are doing Core Strongholds. If you skip Strongholds, Crystals are NOT needed. The other implants in the fit are worthwhile still.

This is the cheapest way to rat C5 sites out of all the marauders. Blinging the tank (dual Pith C-Type multispecs) or the DPS (Faction Gyros) is not necessary, but will help if ganked or if you spawn a wave early.

You will struggle to apply DPS to the final wave of a stronghold due to the orbit distance of the ships and your applied damage with Barrage. While it is possible, it will be very slow and boring. Bring a friend, or an alt.

USING SYNTH DRUGS is almost always worthwhile. While these fits are designed not to need them, synth mindflood to add some capacitor, or exile/blue pill for tank, along with frentix/crash for tracking and application are all extremely cheap and make a noticable difference. It is encouraged to run these drugs when you're getting the hang of a new fit, and even beyond that.`,
        },
        "4y": {
            image: Vargur4y,
            fitText: `[Vargur, Marauder IV With Dread]

Capacitor Flux Coil II
Capacitor Flux Coil II
Capacitor Flux Coil II
Capacitor Flux Coil II
Gyrostabilizer II
Gyrostabilizer II

Compact Multispectrum Shield Hardener
Compact Multispectrum Shield Hardener
Republic Fleet Large Cap Battery
Republic Fleet Large Cap Battery
Pith X-Type X-Large Shield Booster
True Sansha Cap Recharger

800mm Repeating Cannon II, Hail L
800mm Repeating Cannon II, Hail L
800mm Repeating Cannon II, Hail L
800mm Repeating Cannon II, Hail L
Federation Navy Large Plasma Smartbomb
Federation Navy Large Plasma Smartbomb
Bastion Module I

Large Capacitor Control Circuit II
Large Capacitor Control Circuit I

Mid-grade Crystal Alpha
Mid-grade Crystal Beta
Mid-grade Crystal Gamma
Mid-grade Crystal Delta
Mid-grade Crystal Epsilon
Eifyr and Co. 'Gunslinger' Motion Prediction MR-703
Inherent Implants 'Squire' Capacitor Management EM-803
Eifyr and Co. 'Gunslinger' Surgical Strike SS-903
Eifyr and Co. 'Gunslinger' Large Projectile Turret LP-1003

Barrage L x7824
Hail L x11840
Republic Fleet Phased Plasma L x8000`,
            notes:
                `You only need to run crystals in your pod if you are doing Core Strongholds. If you skip Strongholds, Crystals are NOT needed. The other implants in the fit are worthwhile still.

This is the cheapest way to rat C5 sites out of all the marauders. Blinging the tank (dual Pith C-Type multispecs) or the DPS (Faction Gyros) is not necessary, but will help if ganked or if you spawn a wave early.

You will struggle to apply DPS to the final wave of a stronghold due to the orbit distance of the ships and your applied damage with Barrage. While it is possible, it will be very slow and boring. Bring a friend, or an alt.

USING SYNTH DRUGS is almost always worthwhile. While these fits are designed not to need them, synth mindflood to add some capacitor, or exile/blue pill for tank, along with frentix/crash for tracking and application are all extremely cheap and make a noticable difference. It is encouraged to run these drugs when you're getting the hang of a new fit, and even beyond that.`,
        },
    },

    Paladin: {
        "5n": {
            image: Paladin5n,
            fitText: `[Paladin, Marauders V No Dread]

Centum C-Type Multispectrum Energized Membrane
Centum C-Type Multispectrum Energized Membrane
Imperial Navy Heat Sink
Imperial Navy Heat Sink
True Sansha Large Armor Repairer
True Sansha Large Armor Repairer
Dark Blood Capacitor Power Relay

Republic Fleet Large Cap Battery
Republic Fleet Large Cap Battery
Imperial Navy Cap Recharger
Imperial Navy Cap Recharger

Bastion Module I
Mega Pulse Laser II, Conflagration L
Mega Pulse Laser II, Conflagration L
Mega Pulse Laser II, Conflagration L
Mega Pulse Laser II, Conflagration L
Heavy Knave Scoped Energy Nosferatu
Federation Navy Large Plasma Smartbomb
Federation Navy Large Plasma Smartbomb

Large Capacitor Control Circuit II
Large Capacitor Control Circuit II

Hobgoblin II x10
Hornet EC-300 x5

Mid-grade Asklepian Alpha
Mid-grade Asklepian Beta
Mid-grade Asklepian Gamma
Mid-grade Asklepian Delta
Mid-grade Asklepian Epsilon
Inherent Implants 'Noble' Repair Systems RS-603
Inherent Implants 'Lancer' Controlled Bursts CB-703
Inherent Implants 'Squire' Capacitor Management EM-803
Eifyr and Co. 'Gunslinger' Surgical Strike SS-903
Inherent Implants 'Lancer' Large Energy Turret LE-1003

Conflagration L x12
Scorch L x8
Imperial Navy Multifrequency L x8`,
            notes:
                `You only need to run Asklepians in your pod if you are doing Core Strongholds. If you skip Strongholds, Asklepians are NOT needed. The other implants in the fit are worthwhile still.

This is the The only marauder that excels at the core stronghold due to your long range application.

The NOS is only necessary on the drifter, and only if you're solo boxing the site and will be the only thing targetted by his neuts.

USING SYNTH DRUGS is almost always worthwhile. While these fits are designed not to need them, synth mindflood to add some capacitor, or exile/blue pill for tank, along with frentix/crash for tracking and application are all extremely cheap and make a noticable difference. It is encouraged to run these drugs when you're getting the hang of a new fit, and even beyond that.`,
        },
        "5y": {
            image: Paladin5y,
            fitText: `[Paladin, Marauders V With Dread]

Centum C-Type Multispectrum Energized Membrane
Centum C-Type Multispectrum Energized Membrane
Dark Blood Capacitor Power Relay
Imperial Navy Heat Sink
True Sansha Large Armor Repairer
True Sansha Large Armor Repairer
Dark Blood Capacitor Power Relay

Republic Fleet Large Cap Battery
Republic Fleet Large Cap Battery
Imperial Navy Cap Recharger
Imperial Navy Cap Recharger

Bastion Module I
Mega Pulse Laser II, Conflagration L
Mega Pulse Laser II, Conflagration L
Mega Pulse Laser II, Conflagration L
Mega Pulse Laser II, Conflagration L
Heavy Knave Scoped Energy Nosferatu
Federation Navy Large Plasma Smartbomb
Federation Navy Large Plasma Smartbomb

Large Capacitor Control Circuit II
Large Capacitor Control Circuit II

Hobgoblin II x10
Hornet EC-300 x5

Mid-grade Asklepian Alpha
Mid-grade Asklepian Beta
Mid-grade Asklepian Gamma
Mid-grade Asklepian Delta
Mid-grade Asklepian Epsilon
Inherent Implants 'Noble' Repair Systems RS-603
Inherent Implants 'Lancer' Controlled Bursts CB-703
Inherent Implants 'Squire' Capacitor Management EM-803
Eifyr and Co. 'Gunslinger' Surgical Strike SS-903
Inherent Implants 'Lancer' Large Energy Turret LE-1003

Conflagration L x12
Scorch L x8
Imperial Navy Multifrequency L x8`,
            notes:
                `You only need to run Asklepians in your pod if you are doing Core Strongholds. If you skip Strongholds, Asklepians are NOT needed. The other implants in the fit are worthwhile still.

This is the The only marauder that excels at the core stronghold due to your long range application.

The NOS is only necessary on the drifter, and only if you're the only thing targetted by his neuts.

USING SYNTH DRUGS is almost always worthwhile. While these fits are designed not to need them, synth mindflood to add some capacitor, or exile/blue pill for tank, along with frentix/crash for tracking and application are all extremely cheap and make a noticable difference. It is encouraged to run these drugs when you're getting the hang of a new fit, and even beyond that.`,
        },
        "4n": {
            image: Paladin4n,
            fitText: `[Paladin, Marauders IV No Dread]

Centum C-Type Multispectrum Energized Membrane
Centum C-Type Multispectrum Energized Membrane
Imperial Navy Heat Sink
Imperial Navy Heat Sink
True Sansha Large Armor Repairer
True Sansha Large Armor Repairer
Dark Blood Capacitor Power Relay

Republic Fleet Large Cap Battery
Republic Fleet Large Cap Battery
Imperial Navy Cap Recharger
Imperial Navy Cap Recharger

Bastion Module I
Mega Pulse Laser II, Conflagration L
Mega Pulse Laser II, Conflagration L
Mega Pulse Laser II, Conflagration L
Mega Pulse Laser II, Conflagration L
Heavy Knave Scoped Energy Nosferatu
Federation Navy Large Plasma Smartbomb
Federation Navy Large Plasma Smartbomb

Large Capacitor Control Circuit II
Large Capacitor Control Circuit II

Hobgoblin II x10
Hornet EC-300 x5

Mid-grade Asklepian Alpha
Mid-grade Asklepian Beta
Mid-grade Asklepian Gamma
Mid-grade Asklepian Delta
Mid-grade Asklepian Epsilon
Inherent Implants 'Noble' Repair Systems RS-603
Inherent Implants 'Lancer' Controlled Bursts CB-703
Inherent Implants 'Squire' Capacitor Management EM-803
Eifyr and Co. 'Gunslinger' Surgical Strike SS-903
Inherent Implants 'Lancer' Large Energy Turret LE-1003

Conflagration L x12
Scorch L x8
Imperial Navy Multifrequency L x8`,
            notes:
                `You only need to run Asklepians in your pod if you are doing Core Strongholds. If you skip Strongholds, Asklepians are NOT needed. The other implants in the fit are worthwhile still.

This is the The only marauder that excels at the core stronghold due to your long range application.

The NOS is only necessary on the drifter, and only if you're solo boxing the site and will be the only thing targetted by his neuts.

USING SYNTH DRUGS is almost always worthwhile. While these fits are designed not to need them, synth mindflood to add some capacitor, or exile/blue pill for tank, along with frentix/crash for tracking and application are all extremely cheap and make a noticable difference. It is encouraged to run these drugs when you're getting the hang of a new fit, and even beyond that.`,
        },
        "4y": {
            image: Paladin4y,
            fitText: `[Paladin, Marauders IV With Dread]

Centum C-Type Multispectrum Energized Membrane
Centum C-Type Multispectrum Energized Membrane
Dark Blood Capacitor Power Relay
Imperial Navy Heat Sink
True Sansha Large Armor Repairer
True Sansha Large Armor Repairer
Dark Blood Capacitor Power Relay

Republic Fleet Large Cap Battery
Republic Fleet Large Cap Battery
Imperial Navy Cap Recharger
Imperial Navy Cap Recharger

Bastion Module I
Mega Pulse Laser II, Conflagration L
Mega Pulse Laser II, Conflagration L
Mega Pulse Laser II, Conflagration L
Mega Pulse Laser II, Conflagration L
Heavy Knave Scoped Energy Nosferatu
Federation Navy Large Plasma Smartbomb
Federation Navy Large Plasma Smartbomb

Large Capacitor Control Circuit II
Large Capacitor Control Circuit II

Hobgoblin II x10
Hornet EC-300 x5

Mid-grade Asklepian Alpha
Mid-grade Asklepian Beta
Mid-grade Asklepian Gamma
Mid-grade Asklepian Delta
Mid-grade Asklepian Epsilon
Inherent Implants 'Noble' Repair Systems RS-603
Inherent Implants 'Lancer' Controlled Bursts CB-703
Inherent Implants 'Squire' Capacitor Management EM-803
Eifyr and Co. 'Gunslinger' Surgical Strike SS-903
Inherent Implants 'Lancer' Large Energy Turret LE-1003

Conflagration L x12
Scorch L x8
Imperial Navy Multifrequency L x8`,
            notes:
                `You only need to run Asklepians in your pod if you are doing Core Strongholds. If you skip Strongholds, Asklepians are NOT needed. The other implants in the fit are worthwhile still.

This is the The only marauder that excels at the core stronghold due to your long range application.

The NOS is only necessary on the drifter, and only if you're the only thing targetted by his neuts.

USING SYNTH DRUGS is almost always worthwhile. While these fits are designed not to need them, synth mindflood to add some capacitor, or exile/blue pill for tank, along with frentix/crash for tracking and application are all extremely cheap and make a noticable difference. It is encouraged to run these drugs when you're getting the hang of a new fit, and even beyond that.`,
        },
    },

    Kronos: {
        "5n": {
            image: Kronos5n,
            fitText: `[Kronos, Marauders V No Dread]

Capacitor Power Relay II
Corpii A-Type Explosive Coating
Corpii C-Type Multispectrum Coating
Federation Navy Magnetic Field Stabilizer
Federation Navy Magnetic Field Stabilizer
Core X-Type Large Armor Repairer
Core X-Type Large Armor Repairer

Republic Fleet Large Cap Battery
Republic Fleet Large Cap Battery
Shadow Serpentis Tracking Computer, Optimal Range Script
Cap Recharger II
Cap Recharger II

Neutron Blaster Cannon II, Void L
Neutron Blaster Cannon II, Void L
Neutron Blaster Cannon II, Void L
Neutron Blaster Cannon II, Void L
Bastion Module I
Imperial Navy Large EMP Smartbomb
Imperial Navy Large EMP Smartbomb

Large Capacitor Control Circuit II
Large Capacitor Control Circuit II

Mid-grade Asklepian Alpha
Mid-grade Asklepian Beta
Mid-grade Asklepian Gamma
Mid-grade Asklepian Delta
Mid-grade Asklepian Epsilon
Inherent Implants 'Noble' Repair Systems RS-603
Zainou 'Deadeye' Trajectory Analysis TA-703
Inherent Implants 'Squire' Capacitor Management EM-803
Eifyr and Co. 'Gunslinger' Surgical Strike SS-903
Zainou 'Deadeye' Large Hybrid Turret LH-1003

Synth Frentix Booster

Null L x8900
Void L x19941`,
            notes:
                `You only need to run Asklepians in your pod if you are doing Core Strongholds. If you skip Strongholds, Asklepians are NOT needed. The other implants in the fit are worthwhile still.

The Kronos struggles with long range application more than any other marauder. The Synth Frentix is almost non-negotiable, especially on strongholds.

You have the highest raw DPS and tracking of any marauder, but also the most expensive to fit (barely) and hardest to hit metrics with. Very rewarding to fly, especially on Garrisons.

USING SYNTH DRUGS is almost always worthwhile. While these fits are designed not to need them, synth mindflood to add some capacitor, or exile/blue pill for tank, along with frentix/crash for tracking and application are all extremely cheap and make a noticable difference. It is encouraged to run these drugs when you're getting the hang of a new fit, and even beyond that.`,
        },
        "5y": {
            image: Kronos5y,
            fitText: `[Kronos, Marauders V With Dread]

True Sansha Capacitor Power Relay
Corpii A-Type Explosive Coating
Corpii C-Type Multispectrum Coating
True Sansha Capacitor Power Relay
Federation Navy Magnetic Field Stabilizer
Core X-Type Large Armor Repairer
Core X-Type Large Armor Repairer

Republic Fleet Large Cap Battery
Republic Fleet Large Cap Battery
Shadow Serpentis Tracking Computer, Optimal Range Script
True Sansha Cap Recharger
True Sansha Cap Recharger

Neutron Blaster Cannon II, Void L
Neutron Blaster Cannon II, Void L
Neutron Blaster Cannon II, Void L
Neutron Blaster Cannon II, Void L
Bastion Module I
Imperial Navy Large EMP Smartbomb
Imperial Navy Large EMP Smartbomb

Large Capacitor Control Circuit II
Large Capacitor Control Circuit II

Mid-grade Asklepian Alpha
Mid-grade Asklepian Beta
Mid-grade Asklepian Gamma
Mid-grade Asklepian Delta
Mid-grade Asklepian Epsilon
Inherent Implants 'Noble' Repair Systems RS-603
Zainou 'Deadeye' Trajectory Analysis TA-703
Inherent Implants 'Squire' Capacitor Management EM-803
Eifyr and Co. 'Gunslinger' Surgical Strike SS-903
Zainou 'Deadeye' Large Hybrid Turret LH-1003

Synth Frentix Booster

Null L x8900
Void L x19941`,
            notes:
                `You only need to run Asklepians in your pod if you are doing Core Strongholds. If you skip Strongholds, Asklepians are NOT needed. The other implants in the fit are worthwhile still.

The Kronos struggles with long range application more than any other marauder. The Synth Frentix is almost non-negotiable, especially on strongholds.

You have the highest raw DPS and tracking of any marauder, but also the most expensive to fit (barely) and hardest to hit metrics with. Very rewarding to fly, especially on Garrisons.

USING SYNTH DRUGS is almost always worthwhile. While these fits are designed not to need them, synth mindflood to add some capacitor, or exile/blue pill for tank, along with frentix/crash for tracking and application are all extremely cheap and make a noticable difference. It is encouraged to run these drugs when you're getting the hang of a new fit, and even beyond that.`,
        },
        "4n": {
            image: Kronos4n,
            fitText: `[Kronos, Marauders IV No Dread]

Capacitor Power Relay II
Corpii A-Type Explosive Coating
Corpii C-Type Multispectrum Coating
Federation Navy Magnetic Field Stabilizer
Federation Navy Magnetic Field Stabilizer
Core X-Type Large Armor Repairer
Core X-Type Large Armor Repairer

Republic Fleet Large Cap Battery
Republic Fleet Large Cap Battery
Shadow Serpentis Tracking Computer, Optimal Range Script
Cap Recharger II
Cap Recharger II

Neutron Blaster Cannon II, Void L
Neutron Blaster Cannon II, Void L
Neutron Blaster Cannon II, Void L
Neutron Blaster Cannon II, Void L
Bastion Module I
Imperial Navy Large EMP Smartbomb
Imperial Navy Large EMP Smartbomb

Large Capacitor Control Circuit II
Large Capacitor Control Circuit II

Mid-grade Asklepian Alpha
Mid-grade Asklepian Beta
Mid-grade Asklepian Gamma
Mid-grade Asklepian Delta
Mid-grade Asklepian Epsilon
Inherent Implants 'Noble' Repair Systems RS-603
Zainou 'Deadeye' Trajectory Analysis TA-703
Inherent Implants 'Squire' Capacitor Management EM-803
Eifyr and Co. 'Gunslinger' Surgical Strike SS-903
Zainou 'Deadeye' Large Hybrid Turret LH-1003

Synth Frentix Booster

Null L x8900
Void L x19941`,
            notes:
                `You only need to run Asklepians in your pod if you are doing Core Strongholds. If you skip Strongholds, Asklepians are NOT needed. The other implants in the fit are worthwhile still.

The Kronos struggles with long range application more than any other marauder. The Synth Frentix is almost non-negotiable, especially on strongholds.

You have the highest raw DPS and tracking of any marauder, but also the most expensive to fit (barely) and hardest to hit metrics with. Very rewarding to fly, especially on Garrisons.

USING SYNTH DRUGS is almost always worthwhile. While these fits are designed not to need them, synth mindflood to add some capacitor, or exile/blue pill for tank, along with frentix/crash for tracking and application are all extremely cheap and make a noticable difference. It is encouraged to run these drugs when you're getting the hang of a new fit, and even beyond that.`,
        },
        "4y": {
            image: Kronos4y,
            fitText: `[Kronos, Marauders IV With Dread]

True Sansha Capacitor Power Relay
Corpii A-Type Explosive Coating
Corpii C-Type Multispectrum Coating
True Sansha Capacitor Power Relay
Federation Navy Magnetic Field Stabilizer
Core X-Type Large Armor Repairer
Core X-Type Large Armor Repairer

Republic Fleet Large Cap Battery
Republic Fleet Large Cap Battery
Shadow Serpentis Tracking Computer, Optimal Range Script
True Sansha Cap Recharger
True Sansha Cap Recharger

Neutron Blaster Cannon II, Void L
Neutron Blaster Cannon II, Void L
Neutron Blaster Cannon II, Void L
Neutron Blaster Cannon II, Void L
Bastion Module I
Imperial Navy Large EMP Smartbomb
Imperial Navy Large EMP Smartbomb

Large Capacitor Control Circuit II
Large Capacitor Control Circuit II

Mid-grade Asklepian Alpha
Mid-grade Asklepian Beta
Mid-grade Asklepian Gamma
Mid-grade Asklepian Delta
Mid-grade Asklepian Epsilon
Inherent Implants 'Noble' Repair Systems RS-603
Zainou 'Deadeye' Trajectory Analysis TA-703
Inherent Implants 'Squire' Capacitor Management EM-803
Eifyr and Co. 'Gunslinger' Surgical Strike SS-903
Zainou 'Deadeye' Large Hybrid Turret LH-1003

Synth Frentix Booster

Null L x8900
Void L x19941`,
            notes:
                `You only need to run Asklepians in your pod if you are doing Core Strongholds. If you skip Strongholds, Asklepians are NOT needed. The other implants in the fit are worthwhile still.

The Kronos struggles with long range application more than any other marauder. The Synth Frentix is almost non-negotiable, especially on strongholds.

You have the highest raw DPS and tracking of any marauder, but also the most expensive to fit (barely) and hardest to hit metrics with. Very rewarding to fly, especially on Garrisons.

USING SYNTH DRUGS is almost always worthwhile. While these fits are designed not to need them, synth mindflood to add some capacitor, or exile/blue pill for tank, along with frentix/crash for tracking and application are all extremely cheap and make a noticable difference. It is encouraged to run these drugs when you're getting the hang of a new fit, and even beyond that.`,
        },
    },
};

function getVariantKey(maraudersV: YesNo, dread: YesNo): "5n" | "5y" | "4n" | "4y" {
    if (maraudersV === "yes" && dread === "no") return "5n";
    if (maraudersV === "yes" && dread === "yes") return "5y";
    if (maraudersV === "no" && dread === "no") return "4n";
    return "4y";
}

function ChoiceButton({
    active,
    onClick,
    children,
}: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={[
                "px-3 py-1.5 text-[10px] uppercase tracking-widest border transition-colors",
                active
                    ? "border-[#53b6ff] bg-[#0b1622] text-slate-100 shadow-[inset_0_0_0_1px_rgba(83,182,255,0.2)]"
                    : "border-[#3a3c40] bg-[#0b0d11] text-slate-300 hover:bg-[#101319]",
            ].join(" ")}
        >
            {children}
        </button>
    );
}

function HullButton({
    hull,
    selected,
    onClick,
}: {
    hull: Marauder;
    selected: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={[
                "group w-full border px-3 py-4 text-left transition-colors",
                selected
                    ? "border-[#53b6ff] bg-[#0b1622] shadow-[inset_0_0_0_1px_rgba(83,182,255,0.22)]"
                    : "border-[#3a3c40] bg-[#0b0d11] hover:bg-[#101319]",
            ].join(" ")}
        >
            <div className="flex items-center justify-between gap-3">
                <div>
                    <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-100">
                        {hull}
                    </div>
                    <div className="mt-1 text-[9px] text-slate-400 uppercase tracking-wide">
                        Select Hull
                    </div>
                </div>

                <div
                    className={[
                        "h-3 w-3 border",
                        selected
                            ? "border-[#53b6ff] bg-[#53b6ff] shadow-[0_0_8px_rgba(83,182,255,0.7)]"
                            : "border-[#3a3c40] bg-[#05070b]",
                    ].join(" ")}
                />
            </div>
        </button>
    );
}

export default function RoachFits() {
    const [selectedMarauder, setSelectedMarauder] = useState<Marauder | null>(null);
    const [maraudersV, setMaraudersV] = useState<YesNo | null>(null);
    const [dreadEscalation, setDreadEscalation] = useState<YesNo | null>(null);
    const [copied, setCopied] = useState(false);
    const [openingInFitting, setOpeningInFitting] = useState(false);
    const [openInFittingError, setOpenInFittingError] = useState("");
    const [imageModalOpen, setImageModalOpen] = useState(false);

    const resolvedFit = useMemo(() => {
        if (!selectedMarauder || !maraudersV || !dreadEscalation) return null;
        const key = getVariantKey(maraudersV, dreadEscalation);
        return FIT_DATA[selectedMarauder][key];
    }, [selectedMarauder, maraudersV, dreadEscalation]);

    const selectionSummary = useMemo(() => {
        if (!selectedMarauder || !maraudersV || !dreadEscalation) return null;

        return {
            hull: selectedMarauder,
            maraudersText: maraudersV === "yes" ? "Marauders V" : "Marauders IV",
            dreadText: dreadEscalation === "yes" ? "Dread Escalations" : "No Dread Escalations",
        };
    }, [selectedMarauder, maraudersV, dreadEscalation]);

    const handleCopy = async () => {
        if (!resolvedFit?.fitText) return;

        try {
            await navigator.clipboard.writeText(resolvedFit.fitText);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        } catch {
            setCopied(false);
        }
    };

    const handleOpenInFitting = async () => {
        if (!resolvedFit?.fitText || openingInFitting) return;

        setOpeningInFitting(true);
        setOpenInFittingError("");

        const pendingWindow = window.open("about:blank", "_blank");
        if (pendingWindow) {
            pendingWindow.document.title = "Opening TriffFits...";
            pendingWindow.document.body.innerHTML = `<div style="background:#05070b;color:#cbd5e1;font:12px monospace;min-height:100vh;display:flex;align-items:center;justify-content:center;">Opening in TriffFits...</div>`;
        }

        try {
            const response = await fetch("/api/fitting/shared-fits", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    eftText: resolvedFit.fitText,
                    source: "roachfits",
                    sourceUrl: window.location.pathname,
                }),
            });
            const data = (await response.json()) as SharedFitLinkResponse;
            if (!response.ok || !data.ok) {
                throw new Error(data.message || data.error || "Could not create TriffFits link.");
            }
            const path = data.path || data.url;
            if (!path) throw new Error("TriffFits link response did not include a URL.");
            if (pendingWindow) {
                pendingWindow.location.href = path;
            } else {
                window.location.href = path;
            }
        } catch (err) {
            if (pendingWindow) pendingWindow.close();
            setOpenInFittingError((err as Error).message || "Could not open this fit in TriffFits.");
        } finally {
            setOpeningInFitting(false);
        }
    };

    const resetQuestionsForHull = (hull: Marauder) => {
        setSelectedMarauder(hull);
        setMaraudersV(null);
        setDreadEscalation(null);
        setCopied(false);
        setOpenInFittingError("");
    };

    return (
        <div className="tt-tool-v2 tt2-reference-page tt2-roach-fits min-h-screen bg-transparent text-slate-100 leading-snug">
            <div className="mx-auto max-w-[1320px] px-2 py-3 sm:px-4 sm:py-6">
                <div className="tt2-window">
                    <ToolChrome
                        section="Wormholes"
                        title="C5 Roach Fits"
                        badge="Fit Selector"
                        context="Select Hull"
                        status="C5 Marauder Roaching"
                    />

                    <div className="space-y-4 p-2 sm:p-3">

                        <div className="border border-[#262933] bg-[#05070b]/90 px-3 py-3 sm:px-4">
                            <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                                <h1 className="text-[15px] font-semibold uppercase tracking-widest text-slate-100">
                                    C5 Ratting Marauder Fits
                                </h1>
                                <p className="text-[12px] text-slate-400">
                                    Pick your hull, then answer the skill and escalation questions to get the matching fit.
                                </p>
                            </div>
                        </div>

                        { }
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[360px_minmax(0,1fr)]">
                            { }
                            <div className="space-y-4">
                                <section className="overflow-hidden border border-[#262933] bg-[#070910]">
                                    <div className="px-3 py-2 border-b border-[#262933] bg-[#0b0d11]">
                                        <h2 className="text-[12px] font-semibold uppercase tracking-widest text-slate-200">
                                            1. Select Marauder
                                        </h2>
                                    </div>

                                    <div className="p-3 grid grid-cols-1 gap-2">
                                        {marauders.map((hull) => (
                                            <HullButton
                                                key={hull}
                                                hull={hull}
                                                selected={selectedMarauder === hull}
                                                onClick={() => resetQuestionsForHull(hull)}
                                            />
                                        ))}
                                    </div>
                                </section>

                                <section className="overflow-hidden border border-[#262933] bg-[#070910]">
                                    <div className="px-3 py-2 border-b border-[#262933] bg-[#0b0d11]">
                                        <h2 className="text-[12px] font-semibold uppercase tracking-widest text-slate-200">
                                            2. Fit Conditions
                                        </h2>
                                    </div>

                                    <div className="p-3 space-y-4">
                                        <div>
                                            <div className="mb-2 text-[10px] uppercase tracking-widest text-slate-400">
                                                Do you have Marauders V?
                                            </div>
                                            <div className="grid grid-cols-2 gap-2">
                                                <ChoiceButton
                                                    active={maraudersV === "yes"}
                                                    onClick={() => setMaraudersV("yes")}
                                                >
                                                    Yes
                                                </ChoiceButton>
                                                <ChoiceButton
                                                    active={maraudersV === "no"}
                                                    onClick={() => setMaraudersV("no")}
                                                >
                                                    No
                                                </ChoiceButton>
                                            </div>
                                        </div>

                                        <div>
                                            <div className="mb-2 text-[10px] uppercase tracking-widest text-slate-400">
                                                Will you be running dread escalations?
                                            </div>
                                            <div className="grid grid-cols-2 gap-2">
                                                <ChoiceButton
                                                    active={dreadEscalation === "yes"}
                                                    onClick={() => setDreadEscalation("yes")}
                                                >
                                                    Yes
                                                </ChoiceButton>
                                                <ChoiceButton
                                                    active={dreadEscalation === "no"}
                                                    onClick={() => setDreadEscalation("no")}
                                                >
                                                    No
                                                </ChoiceButton>
                                            </div>
                                        </div>

                                        <div className="border border-[#1f2d3d] bg-[#07111b] px-3 py-2 text-[10px] text-slate-300">
                                            <div className="uppercase tracking-widest text-[#8dcfff] mb-1">
                                                Notes
                                            </div>
                                            <p className="text-slate-400 leading-relaxed">
                                                !! IMPORTANT !! These fits assume you have relevant skills to IV/V, ESPECIALLY Armor compensations, armor and shield repair affecting skills and most importantly CAPACITOR related skills. When in doubt, ask a friend or better yet: Run in a group!
                                            </p>
                                        </div>
                                    </div>
                                </section>
                            </div>

                            { }
                            <div className="space-y-4">
                                <section className="overflow-hidden border border-[#262933] bg-[#070910]">
                                    <div className="px-3 py-2 border-b border-[#262933] bg-[#0b0d11] flex items-center justify-between gap-3">
                                        <h2 className="text-[10px] font-semibold uppercase tracking-widest text-slate-200">
                                            Recommended Fit
                                        </h2>

                                        {selectionSummary ? (
                                            <div className="flex flex-wrap justify-end gap-2 text-[8px] uppercase tracking-widest">
                                                <span className="border border-[#3a3c40] bg-[#05070b] px-2 py-1 text-slate-300">
                                                    {selectionSummary.hull}
                                                </span>
                                                <span className="border border-[#3a3c40] bg-[#05070b] px-2 py-1 text-slate-300">
                                                    {selectionSummary.maraudersText}
                                                </span>
                                                <span className="border border-[#3a3c40] bg-[#05070b] px-2 py-1 text-slate-300">
                                                    {selectionSummary.dreadText}
                                                </span>
                                            </div>
                                        ) : null}
                                    </div>

                                    {!resolvedFit ? (
                                        <div className="p-3 sm:p-5">
                                            <ToolEmptyState title="Awaiting selection">
                                                Select a marauder, then answer both fit-condition questions.
                                            </ToolEmptyState>
                                        </div>
                                    ) : (
                                        <div className="p-3 space-y-4">
                                            <div className="border border-[#262933] bg-[#05070b]">
                                                <div className="px-3 py-2 border-b border-[#262933] bg-[#0b0d11] flex items-center justify-between text-[9px] uppercase tracking-widest text-slate-400">
                                                    <span>Pyfa Preview</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => setImageModalOpen(true)}
                                                        className="px-2 py-1 border border-[#3a3c40] bg-[#101319] text-slate-200 hover:bg-[#151922]"
                                                    >
                                                        Expand
                                                    </button>
                                                </div>
                                                <div className="p-3">
                                                    <button
                                                        type="button"
                                                        onClick={() => setImageModalOpen(true)}
                                                        className="block w-full border border-[#3a3c40] bg-black/40 overflow-hidden hover:border-[#53b6ff] transition-colors"
                                                        title="Click to open full-size image"
                                                    >
                                                        <img
                                                            src={resolvedFit.image}
                                                            alt={`${selectionSummary?.hull ?? "Marauder"} fit preview`}
                                                            className="block w-full h-auto"
                                                        />
                                                    </button>
                                                </div>
                                            </div>

                                            { }
                                            <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)] gap-4">
                                                <div className="border border-[#262933] bg-[#05070b]">
                                                    <div className="px-3 py-2 border-b border-[#262933] bg-[#0b0d11] flex items-center justify-between gap-3">
                                                        <div className="text-[9px] uppercase tracking-widest text-slate-400">
                                                            Click-To-Copy Fit
                                                        </div>

                                                        <div className="flex flex-wrap justify-end gap-2">
                                                            <button
                                                                type="button"
                                                                onClick={handleOpenInFitting}
                                                                disabled={openingInFitting}
                                                                className="px-2 py-1 text-[9px] uppercase tracking-widest border border-[#46b2ff]/60 bg-[#08131d] text-[#8bd3ff] hover:bg-[#101923] disabled:cursor-not-allowed disabled:opacity-60"
                                                            >
                                                                {openingInFitting ? "Opening" : "Open In TriffFits"}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={handleCopy}
                                                                className="px-2 py-1 text-[9px] uppercase tracking-widest border border-[#3a3c40] bg-[#101319] text-slate-200 hover:bg-[#151922]"
                                                            >
                                                                {copied ? "Copied" : "Copy Fit"}
                                                            </button>
                                                        </div>
                                                    </div>

                                                    <div className="p-3">
                                                        {openInFittingError && (
                                                            <div className="mb-2 border border-[#6b2b32] bg-[#1d090b] px-2 py-1 text-[10px] text-[#ffaaaa]">
                                                                {openInFittingError}
                                                            </div>
                                                        )}
                                                        <button
                                                            type="button"
                                                            onClick={handleCopy}
                                                            className="w-full text-left border border-[#3a3c40] bg-[#070910] hover:bg-[#0c1017] transition-colors"
                                                            title="Click to copy fit"
                                                        >
                                                            <pre className="whitespace-pre-wrap break-words px-3 py-3 text-[10px] leading-relaxed text-slate-200 font-mono">
                                                                {resolvedFit.fitText}
                                                            </pre>
                                                        </button>
                                                    </div>
                                                </div>

                                                <div className="border border-[#262933] bg-[#05070b]">
                                                    <div className="px-3 py-2 border-b border-[#262933] bg-[#0b0d11] text-[10px] uppercase tracking-widest text-slate-400">
                                                        Fit Notes
                                                    </div>

                                                    <div className="p-3">
                                                        <div className="border border-[#1f2d3d] bg-[#07111b] px-3 py-3">
                                                            <p className="text-[11px] leading-relaxed text-slate-300 whitespace-pre-wrap">
                                                                {resolvedFit.notes}
                                                            </p>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </section>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            {imageModalOpen && resolvedFit && (
                <div
                    className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 px-4 py-4"
                    onClick={() => setImageModalOpen(false)}
                >
                    <div
                        className="relative max-w-[95vw] max-h-[95vh] border border-[#3a3c40] bg-[#05070b] shadow-[0_0_32px_rgba(0,0,0,0.95)]"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between px-3 py-2 border-b border-[#262933] bg-[#0b0d11]">
                            <div className="text-[9px] uppercase tracking-widest text-slate-300">
                                {selectionSummary?.hull ?? "Fit"} ▸ Full Resolution Preview
                            </div>
                            <button
                                type="button"
                                onClick={() => setImageModalOpen(false)}
                                className="px-2 py-1 text-[9px] uppercase tracking-widest border border-[#3a3c40] bg-[#101319] text-slate-200 hover:bg-[#151922]"
                            >
                                Close
                            </button>
                        </div>

                        <div className="p-3 overflow-auto max-h-[calc(95vh-42px)]">
                            <img
                                src={resolvedFit.image}
                                alt={`${selectionSummary?.hull ?? "Marauder"} fit preview full size`}
                                className="block max-w-full h-auto"
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
