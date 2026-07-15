// Ramp schedule (OUTREACH-BUILD-PLAN.md Section 9.2). The worker enforces this
// so nobody can get impatient and torch a domain. Pure + injectable clock for
// testing.
//
// Default platform schedule:
//   days 0-9   : 0     (domain aging — zero sends)
//   days 10-16 : 10    (weeks 2-3: 5-15/day, manual+platform ramp)
//   days 17-23 : 15
//   days 24-30 : 30    (week 4: 25-35/day)
//   day  31+   : daily_cap (week 5+: 40-50/day steady state)
//
// Every tier is clamped to the inbox's configured daily_cap, so a
// conservatively-capped inbox never exceeds its own ceiling. An operator can
// override the day thresholds and the three ramp caps per inbox (Settings ->
// Inboxes -> Ramp schedule) — the final tier always resolves to the inbox's
// own daily_cap, never a fixed number, so raising daily_cap later doesn't
// require editing the schedule too.

export interface RampTier {
  day: number; // inbox age (days since warmup started) when this cap begins
  cap: number; // sends/day from this day until the next tier (clamped to daily_cap)
}

// The three ramp-up steps + when the inbox's own daily_cap fully applies.
// This is the shape stored per-inbox and edited in the UI; rampConfigToSchedule
// expands it into the RampTier[] rampCap() actually walks.
export interface RampConfig {
  tier1Day: number;
  tier1Cap: number;
  tier2Day: number;
  tier2Cap: number;
  tier3Day: number;
  tier3Cap: number;
  fullCapDay: number; // day the ramp stops constraining volume below daily_cap
}

export const DEFAULT_RAMP_CONFIG: RampConfig = {
  tier1Day: 10,
  tier1Cap: 10,
  tier2Day: 17,
  tier2Cap: 15,
  tier3Day: 24,
  tier3Cap: 30,
  fullCapDay: 31,
};

// MAX_SAFE_INTEGER as the final tier's cap means "not limited by the ramp" —
// the Math.min(dailyCap, ...) below then always resolves to daily_cap.
export function rampConfigToSchedule(config: RampConfig): RampTier[] {
  return [
    { day: 0, cap: 0 },
    { day: config.tier1Day, cap: config.tier1Cap },
    { day: config.tier2Day, cap: config.tier2Cap },
    { day: config.tier3Day, cap: config.tier3Cap },
    { day: config.fullCapDay, cap: Number.MAX_SAFE_INTEGER },
  ];
}

const DEFAULT_SCHEDULE = rampConfigToSchedule(DEFAULT_RAMP_CONFIG);

// Validate an operator-edited ramp config before it's stored. Returns an error
// message, or null if valid. Days must be non-negative and strictly ascending
// (a non-monotonic schedule is always a config mistake, not a real ramp), and
// caps must be non-negative.
export function validateRampConfig(config: RampConfig): string | null {
  const { tier1Day, tier2Day, tier3Day, fullCapDay } = config;
  const { tier1Cap, tier2Cap, tier3Cap } = config;
  for (const [label, v] of [
    ["Tier 1 day", tier1Day],
    ["Tier 2 day", tier2Day],
    ["Tier 3 day", tier3Day],
    ["Full cap day", fullCapDay],
    ["Tier 1 cap", tier1Cap],
    ["Tier 2 cap", tier2Cap],
    ["Tier 3 cap", tier3Cap],
  ] as const) {
    if (!Number.isFinite(v) || v < 0) return `${label} must be a non-negative number.`;
  }
  if (!(tier1Day < tier2Day && tier2Day < tier3Day && tier3Day < fullCapDay)) {
    return "Days must strictly increase: tier 1 < tier 2 < tier 3 < full cap.";
  }
  if (!(tier1Cap <= tier2Cap && tier2Cap <= tier3Cap)) {
    return "Caps should not decrease from tier 1 to tier 3.";
  }
  return null;
}

export function rampCap(
  warmupStartedAt: Date | null,
  dailyCap: number,
  now: Date,
  schedule: RampTier[] = DEFAULT_SCHEDULE,
): number {
  if (!warmupStartedAt) return 0;
  const days = Math.floor(
    (now.getTime() - warmupStartedAt.getTime()) / 86_400_000,
  );
  if (days < 0) return 0;

  const tiers = schedule.length > 0 ? schedule : DEFAULT_SCHEDULE;
  const sorted = [...tiers].sort((a, b) => a.day - b.day);

  let cap = 0;
  for (const tier of sorted) {
    if (days >= tier.day) cap = tier.cap;
    else break;
  }
  return Math.min(Math.max(0, dailyCap), Math.max(0, cap));
}

// Randomized 4-12 minute gap between sends from one inbox (Section 5.2).
const GAP_MIN_MS = 4 * 60_000;
const GAP_MAX_MS = 12 * 60_000;

export function randomGapMs(rand: () => number = Math.random): number {
  return Math.floor(GAP_MIN_MS + rand() * (GAP_MAX_MS - GAP_MIN_MS));
}

// True if enough time has passed since this inbox's last send to send again.
export function gapSatisfied(
  lastSendAt: Date | null,
  now: Date,
  gapMs: number,
): boolean {
  if (!lastSendAt) return true;
  return now.getTime() - lastSendAt.getTime() >= gapMs;
}
