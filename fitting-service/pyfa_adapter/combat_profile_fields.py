"""Versioned semantic field mappings, not fitting formulas.

Attribute names and effect IDs come from eos dogma metadata. Buff semantics match
the installed eos Fit command-bonus dispatcher; unknown buffs are not inferred.
"""

APPLICATION_FIELDS = {
    "trackingRadPerSecond": "trackingSpeed",
    "trackingReferenceSignatureRadiusM": "optimalSigRadius",
}
MISSILE_FIELDS = {
    "explosionRadiusM": "aoeCloudSize",
    "explosionVelocityMps": "aoeVelocity",
    "damageReductionFactor": "aoeDamageReductionFactor",
    "damageReductionSensitivity": "aoeDamageReductionSensitivity",
    "maxVelocityMps": "maxVelocity",
    "flightTimeMs": "explosionDelay",
    "massKg": "mass",
    "agility": "agility",
}
MODULE_HEAT_FIELDS = {
    "hp": "hp",
    "heatDamageHp": "heatDamage",
    "heatAbsorptionRateModifier": "heatAbsorbtionRateModifier",
    "overloadDamagePercent": "overloadDamageModifier",
    "overloadCyclePercent": "overloadRofBonus",
    "overloadDurationPercent": "overloadSelfDurationBonus",
    "overloadRangePercent": "overloadRangeBonus",
    "overloadSpeedPercent": "overloadSpeedFactorBonus",
    "overloadArmorRepairPercent": "overloadArmorDamageAmount",
    "overloadShieldRepairPercent": "overloadShieldBonus",
}
PROPULSION_FIELDS = {
    "speedBonusPercent": "speedFactor",
    "thrustKg": "speedBoostFactor",
    "massAdditionKg": "massAddition",
    "massBonusPercent": "massBonusPercentage",
    "signatureRadiusBonusPercent": "signatureRadiusBonus",
    "speedFactorBonusPercent": "speedFactorBonus",
    "thrustBonusPercent": "speedBoostFactorBonus",
    "maxVelocityBonusPercent": "maxVelocityBonus",
    "microwarpdriveBlockingStrength": "activationBlockedStrenght",
}
EWAR_FIELDS = {
    "maxTargetRangeBonusPercent": "maxTargetRangeBonus",
    "scanResolutionBonusPercent": "scanResolutionBonus",
    "trackingBonusPercent": "trackingSpeedBonus",
    "optimalBonusPercent": "maxRangeBonus",
    "falloffBonusPercent": "falloffBonus",
    "explosionRadiusBonusPercent": "aoeCloudSizeBonus",
    "explosionVelocityBonusPercent": "aoeVelocityBonus",
    "missileVelocityBonusPercent": "missileVelocityBonus",
    "missileFlightTimeBonusPercent": "explosionDelayBonus",
    "signatureRadiusBonusPercent": "signatureRadiusBonus",
    "gravimetricJamStrength": "scanGravimetricStrengthBonus",
    "magnetometricJamStrength": "scanMagnetometricStrengthBonus",
    "radarJamStrength": "scanRadarStrengthBonus",
    "ladarJamStrength": "scanLadarStrengthBonus",
}
EWAR_ROLES = {201: "ecm", 208: "sensor_dampener", 291: "weapon_disruptor", 379: "target_painter"}

# These are consumer-facing semantic labels. Values remain native signed percent
# bonuses, not recomputed post-stacking changes on a hypothetical recipient.
COMMAND_BUFFS = {
    10: ("shield_resonance", ["shield.resonance"]),
    11: ("shield_repair_efficiency", ["shield_repair.cycle", "shield_repair.capacitor_cost"]),
    12: ("shield_capacity", ["shield.hp"]),
    13: ("armor_resonance", ["armor.resonance"]),
    14: ("armor_repair_efficiency", ["armor_repair.cycle", "armor_repair.capacitor_cost"]),
    15: ("armor_capacity", ["armor.hp"]),
    16: ("scan_resolution", ["targeting.scan_resolution"]),
    17: ("electronic_superiority", ["ewar.range", "ewar.falloff", "ewar.strength"]),
    18: ("sensor_strength", ["targeting.sensor_strength"]),
    19: ("electronic_resistance", ["resistance.sensor_dampener", "resistance.weapon_disruptor"]),
    20: ("signature_radius", ["hull.signature_radius"]),
    21: ("tackle_range", ["stasis_web.range", "warp_disruption.range"]),
    22: ("propulsion_speed", ["propulsion.speed_factor"]),
    23: ("mining_range", ["mining.range"]),
    24: ("mining_efficiency", ["mining.cycle", "mining.capacitor_cost"]),
    25: ("mining_crystal_preservation", ["mining_charge.volatility_chance"]),
    26: ("targeting_range", ["targeting.max_range"]),
    60: ("agility", ["hull.agility"]),
}
