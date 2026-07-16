// LinkedIn pacing (roadmap P2b). LinkedIn aggressively restricts automated
// accounts, so conservative throttling is a CORRECTNESS requirement, not a
// nicety: exceeding safe limits gets the account warning-flagged or banned.
// Pure + injectable clock so the worker's decisions are unit-testable.
//
// Two limits per account, per action type:
//   * a daily cap (invites/day, messages/day) — the hard ceiling;
//   * a minimum spacing between actions — bursts look robotic.
// Safe defaults (2026 guidance): ~20 invites/day, ~40 messages/day, several
// minutes between actions. These are the schema defaults on linkedin_accounts.

export type LinkedinAction = "connect" | "message" | "inmail";

// Randomized spacing between LinkedIn actions from one account: 6-16 min.
// Longer than the email gap — LinkedIn scrutinizes cadence more than email does.
const GAP_MIN_MS = 6 * 60_000;
const GAP_MAX_MS = 16 * 60_000;

export function randomLinkedinGapMs(rand: () => number = Math.random): number {
  return Math.floor(GAP_MIN_MS + rand() * (GAP_MAX_MS - GAP_MIN_MS));
}

export function gapSatisfied(
  lastActionAt: Date | null,
  now: Date,
  gapMs: number,
): boolean {
  if (!lastActionAt) return true;
  return now.getTime() - lastActionAt.getTime() >= gapMs;
}

export interface ThrottleInput {
  action: LinkedinAction;
  dailyInviteCap: number;
  dailyMessageCap: number;
  invitesSentToday: number;
  messagesSentToday: number;
  lastActionAt: Date | null; // last invite OR message, whichever is later
  now: Date;
  gapMs: number;
}

export interface ThrottleDecision {
  canSend: boolean;
  reason: "ok" | "daily_cap" | "gap";
}

// Connection requests count against the invite cap; messages + inmail count
// against the message cap. The spacing gap applies across ALL action types
// from the account (LinkedIn watches total activity, not per-type cadence).
export function throttleDecision(input: ThrottleInput): ThrottleDecision {
  const isInvite = input.action === "connect";
  const cap = isInvite ? input.dailyInviteCap : input.dailyMessageCap;
  const sentToday = isInvite ? input.invitesSentToday : input.messagesSentToday;

  if (cap - sentToday <= 0) return { canSend: false, reason: "daily_cap" };
  if (!gapSatisfied(input.lastActionAt, input.now, input.gapMs)) {
    return { canSend: false, reason: "gap" };
  }
  return { canSend: true, reason: "ok" };
}

// The later of two nullable timestamps (last invite vs last message).
export function latest(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}
