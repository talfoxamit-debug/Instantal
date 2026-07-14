// DNS + blacklist checks for the daily health-worker (Section 5.5: "DNS still
// valid (SPF/DKIM/DMARC), blacklist spot checks, tracking domain resolving").
//
// The record PARSERS are pure so they can be unit-tested without a resolver; the
// lookup functions wrap node:dns/promises. All lookups are best-effort — a
// resolver hiccup must degrade to "unknown", never a false "regressed" that
// would pause a healthy domain.

import { promises as dns } from "node:dns";

// Google Workspace publishes DKIM under the `google` selector by default
// (docs/DNS-SETUP.md); override if a domain uses a different one.
export const DEFAULT_DKIM_SELECTOR = "google";

// Domain-based blocklists (DBLs) queried with the bare domain, not an IP.
export const DEFAULT_DBL_ZONES = ["dbl.spamhaus.org", "multi.surbl.org"];

// ----- pure parsers -----------------------------------------------------------

// resolveTxt returns each record as an array of string chunks; join them.
export function joinTxt(records: string[][]): string[] {
  return records.map((chunks) => chunks.join(""));
}

export function spfPresent(txts: string[]): boolean {
  return txts.some((t) => /^v=spf1\b/i.test(t.trim()));
}

export function dmarcPresent(txts: string[]): boolean {
  return txts.some((t) => /^v=dmarc1\b/i.test(t.trim()));
}

export function dkimPresent(txts: string[]): boolean {
  // A DKIM TXT is either an explicit v=DKIM1 or at least carries a public key.
  return txts.some(
    (t) => /^v=dkim1\b/i.test(t.trim()) || /(^|;)\s*p=[A-Za-z0-9+/]/.test(t),
  );
}

// A DBL "hit" is any A record in 127.0.0.0/8 (list-response space). Some zones
// return 127.255.255.254 for "query blocked / too big" — that is NOT a listing.
export function interpretDnsblAnswer(addrs: string[]): boolean {
  return addrs.some(
    (a) => a.startsWith("127.") && a !== "127.255.255.254" && a !== "127.0.0.1",
  );
}

// ----- lookups (best-effort) --------------------------------------------------

async function resolveTxtSafe(host: string): Promise<string[] | null> {
  try {
    return joinTxt(await dns.resolveTxt(host));
  } catch (e) {
    // NXDOMAIN / ENODATA => the record is genuinely absent (return []). Any
    // other error (timeout, SERVFAIL) => unknown (return null, don't act).
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOTFOUND" || code === "ENODATA") return [];
    return null;
  }
}

export interface DnsCheck {
  spf: boolean | null; // null = lookup failed / unknown
  dkim: boolean | null;
  dmarc: boolean | null;
}

export async function checkDomainDns(
  domain: string,
  dkimSelector = DEFAULT_DKIM_SELECTOR,
): Promise<DnsCheck> {
  const [root, dkim, dmarc] = await Promise.all([
    resolveTxtSafe(domain),
    resolveTxtSafe(`${dkimSelector}._domainkey.${domain}`),
    resolveTxtSafe(`_dmarc.${domain}`),
  ]);
  return {
    spf: root === null ? null : spfPresent(root),
    dkim: dkim === null ? null : dkimPresent(dkim),
    dmarc: dmarc === null ? null : dmarcPresent(dmarc),
  };
}

// Query domain blocklists. Returns the zones that list the domain; a lookup
// error for a zone is ignored (best-effort spot check, not authoritative).
export async function checkDomainBlacklists(
  domain: string,
  zones: string[] = DEFAULT_DBL_ZONES,
): Promise<string[]> {
  const listed: string[] = [];
  await Promise.all(
    zones.map(async (zone) => {
      try {
        const addrs = await dns.resolve4(`${domain}.${zone}`);
        if (interpretDnsblAnswer(addrs)) listed.push(zone);
      } catch {
        // NXDOMAIN = not listed; any other error = skip this zone.
      }
    }),
  );
  return listed;
}

// Does a hostname resolve at all (used for the tracking subdomain check)?
export async function hostResolves(host: string): Promise<boolean | null> {
  try {
    await dns.resolve4(host);
    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOTFOUND" || code === "ENODATA") return false;
    return null; // unknown
  }
}
