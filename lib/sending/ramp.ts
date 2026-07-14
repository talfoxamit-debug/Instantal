// Ramp schedule (OUTREACH-BUILD-PLAN.md Section 9.2). The worker enforces this
// so nobody can get impatient and torch a domain. Pure + injectable clock for
// testing.
//
//   days 0-9   : 0     (domain aging — zero sends)
//   days 10-16 : 10    (weeks 2-3: 5-15/day, manual+platform ramp)
//   days 17-23 : 15
//   days 24-30 : 30    (week 4: 25-35/day)
//   day  31+   : daily_cap (week 5+: 40-50/day steady state)
//
// Every tier is clamped to the inbox's configured daily_cap, so a
// conservatively-capped inbox never exceeds its own ceiling.
export function rampCap(
  warmupStartedAt: Date | null,
  dailyCap: number,
  now: Date,
): number {
  if (!warmupStartedAt) return 0;
  const days = Math.floor(
    (now.getTime() - warmupStartedAt.getTime()) / 86_400_000,
  );
  if (days < 0) return 0;
  if (days < 10) return 0;
  if (days < 17) return Math.min(dailyCap, 10);
  if (days < 24) return Math.min(dailyCap, 15);
  if (days < 31) return Math.min(dailyCap, 30);
  return dailyCap;
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
