// Server-free analytics/health types, shared by the data layer and the client
// dashboard components (so the latter never import the server data module).

export interface CampaignRollup {
  campaignId: string;
  name: string;
  status: string;
  sent: number;
  delivered: number;
  bounced: number;
  replies: number;
  positive: number;
  bounceRate: number; // bounced / sent
  replyRate: number; // replies / sent
  positiveRate: number; // positive / sent — the A/B decider
}

export interface VariantStat {
  stepNo: number;
  variantGroup: string;
  stepId: string;
  sent: number;
  delivered: number;
  bounced: number;
  replies: number;
  positive: number;
  positiveRate: number;
  replyRate: number;
}

export interface InboxHealthRow {
  inboxId: string;
  email: string;
  status: string;
  warmupStatus: string;
  pauseReason: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  sendsToday: number;
  effectiveCap: number; // ramp-limited cap for today
  dailyCap: number;
  bounceRate7d: number;
  replyRate7d: number;
  sent7d: number;
}

export interface DomainHealthRow {
  domainId: string;
  domain: string;
  status: string;
  dnsSpf: boolean;
  dnsDkim: boolean;
  dnsDmarc: boolean;
  dnsVerifiedAt: string | null;
  pauseReason: string | null;
  bounceCount: number;
  sent7d: number;
  bounceRate7d: number;
}

export function rate(num: number, denom: number): number {
  return denom > 0 ? num / denom : 0;
}
