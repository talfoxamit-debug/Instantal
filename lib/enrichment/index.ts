// Lead enrichment: fill missing fields on a lead — most importantly the EMAIL
// for a lead you only have a name + company for — plus firmographic data
// (title, website, LinkedIn). This mirrors lib/verification: the app stays
// provider-agnostic and calls getEnrichmentProvider(); the concrete vendor is
// wired when chosen (FindyMail / LeadMagic / Apollo / Hunter / …).
//
// "Waterfall": the leaders cascade across several providers and stop at the
// first hit. This module models that with an ordered list of providers — the
// first that returns an email wins, and firmographic fields merge across all.
//
// With no vendor configured it falls back to a NO-OP provider that finds
// nothing — enrichment must never fabricate an email, since a made-up address
// would sail into the send path. A found email is written back as `unverified`
// so it is re-checked before it can ever be sent (Section 5.1).

export interface EnrichmentInput {
  first_name?: string | null;
  last_name?: string | null;
  company?: string | null;
  domain?: string | null; // company domain, if known
  email?: string | null; // already-known email (used to enrich firmographics)
}

export interface EnrichmentResult {
  email: string | null;
  title: string | null;
  company: string | null;
  website: string | null;
  linkedin_url: string | null;
  phone: string | null;
  provider: string; // which provider produced the hit ("none" if no match)
}

const EMPTY: Omit<EnrichmentResult, "provider"> = {
  email: null,
  title: null,
  company: null,
  website: null,
  linkedin_url: null,
  phone: null,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function wellFormed(email: string | null | undefined): boolean {
  return !!email && EMAIL_RE.test(email.trim());
}

export interface EnrichmentProvider {
  readonly name: string;
  enrich(input: EnrichmentInput): Promise<EnrichmentResult>;
}

// Default when no vendor is configured. Finds nothing — never invents data.
class NoopEnrichmentProvider implements EnrichmentProvider {
  readonly name = "none";
  async enrich(): Promise<EnrichmentResult> {
    return { ...EMPTY, provider: "none" };
  }
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// Prospeo /enrich-person (verified contract). Auth is the custom `X-KEY` header
// (NOT Bearer). Returns a found email plus person + company firmographics; 1
// credit per email found, nothing charged on no-match.
class ProspeoEnrichmentProvider implements EnrichmentProvider {
  readonly name = "prospeo";
  private readonly apiKey: string;
  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }
  async enrich(input: EnrichmentInput): Promise<EnrichmentResult> {
    const data: Record<string, string> = {};
    if (input.email) data.email = input.email;
    if (input.first_name) data.first_name = input.first_name;
    if (input.last_name) data.last_name = input.last_name;
    const domain = input.domain ?? undefined;
    if (domain) data.company_website = domain;
    else if (input.company) data.company_name = input.company;
    try {
      const res = await fetch("https://api.prospeo.io/enrich-person", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-KEY": this.apiKey },
        body: JSON.stringify({ data, only_verified_email: true }),
      });
      if (!res.ok) return { ...EMPTY, provider: this.name };
      const body = (await res.json()) as {
        error?: boolean;
        person?: {
          email?: { email?: string; status?: string };
          current_job_title?: string;
          linkedin_url?: string;
          mobile?: { mobile_international?: string };
        };
        company?: { name?: string; website?: string; domain?: string };
      };
      if (body.error) return { ...EMPTY, provider: this.name };
      const email = str(body.person?.email?.email);
      return {
        email: wellFormed(email) ? email!.toLowerCase() : null,
        title: str(body.person?.current_job_title),
        company: str(body.company?.name),
        website: str(body.company?.website ?? body.company?.domain),
        linkedin_url: str(body.person?.linkedin_url),
        phone: str(body.person?.mobile?.mobile_international),
        provider: this.name,
      };
    } catch {
      return { ...EMPTY, provider: this.name };
    }
  }
}

// LeadMagic /v1/people/email-finder (verified contract). Auth: X-API-Key.
// Returns primarily the located work email + status; 1 credit on a valid find.
class LeadMagicEnrichmentProvider implements EnrichmentProvider {
  readonly name = "leadmagic";
  private readonly apiKey: string;
  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }
  async enrich(input: EnrichmentInput): Promise<EnrichmentResult> {
    const domain = input.domain ?? undefined;
    try {
      const res = await fetch("https://api.leadmagic.io/v1/people/email-finder", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": this.apiKey },
        body: JSON.stringify({
          first_name: input.first_name ?? undefined,
          last_name: input.last_name ?? undefined,
          domain,
          company_name: !domain ? (input.company ?? undefined) : undefined,
        }),
      });
      if (!res.ok) return { ...EMPTY, provider: this.name };
      const body = (await res.json()) as {
        email?: string;
        status?: string;
        company_name?: string;
        job_title?: string;
      };
      const email = str(body.email);
      const valid = (body.status ?? "").toLowerCase() === "valid";
      return {
        email: valid && wellFormed(email) ? email!.toLowerCase() : null,
        title: str(body.job_title),
        company: str(body.company_name),
        website: null,
        linkedin_url: null,
        phone: null,
        provider: this.name,
      };
    } catch {
      return { ...EMPTY, provider: this.name };
    }
  }
}

// The waterfall: try each provider in order. First email hit wins; firmographic
// fields are merged (first non-null across providers). Stops early once an
// email is found to avoid spending further credits.
export class WaterfallEnrichmentProvider implements EnrichmentProvider {
  readonly name = "waterfall";
  private readonly providers: EnrichmentProvider[];
  constructor(providers: EnrichmentProvider[]) {
    this.providers = providers;
  }

  async enrich(input: EnrichmentInput): Promise<EnrichmentResult> {
    const merged: EnrichmentResult = { ...EMPTY, provider: "none" };
    for (const provider of this.providers) {
      const r = await provider.enrich(input);
      merged.title ??= r.title;
      merged.company ??= r.company;
      merged.website ??= r.website;
      merged.linkedin_url ??= r.linkedin_url;
      merged.phone ??= r.phone;
      if (!merged.email && r.email) {
        merged.email = r.email;
        merged.provider = r.provider;
        break; // email found — stop the waterfall
      }
    }
    return merged;
  }
}

// Each vendor authenticates differently against a different host (Prospeo: X-KEY;
// LeadMagic: X-API-Key), so their keys are NOT interchangeable. Resolve a
// per-provider key: a dedicated PROSPEO_API_KEY / LEADMAGIC_API_KEY if set, else
// the shared ENRICHMENT_API_KEY (fine for a single-provider setup). A waterfall
// only includes providers that actually have a usable key — so a second provider
// can never be called with the first provider's key (which would just 401).
function providerKey(name: string): string | undefined {
  if (name === "prospeo") {
    return process.env.PROSPEO_API_KEY ?? process.env.ENRICHMENT_API_KEY;
  }
  if (name === "leadmagic") {
    return process.env.LEADMAGIC_API_KEY ?? process.env.ENRICHMENT_API_KEY;
  }
  return process.env.ENRICHMENT_API_KEY;
}

// Resolve the configured enrichment provider(s) into a waterfall. ENRICHMENT_
// PROVIDER is a comma-separated order (e.g. "prospeo,leadmagic") — cheapest
// first, first email hit wins. Defaults to prospeo. With no usable key, a no-op
// that finds nothing (never fabricates an email).
export function getEnrichmentProvider(): EnrichmentProvider {
  const order = (process.env.ENRICHMENT_PROVIDER ?? "prospeo")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const providers: EnrichmentProvider[] = [];
  for (const name of order) {
    const key = providerKey(name);
    if (!key) continue; // skip a provider we can't authenticate
    if (name === "prospeo") providers.push(new ProspeoEnrichmentProvider(key));
    else if (name === "leadmagic") providers.push(new LeadMagicEnrichmentProvider(key));
  }
  if (providers.length === 0) {
    // Fall back to Prospeo if it has a key; otherwise nothing is configured.
    const key = providerKey("prospeo");
    if (!key) return new NoopEnrichmentProvider();
    providers.push(new ProspeoEnrichmentProvider(key));
  }
  return new WaterfallEnrichmentProvider(providers);
}

export function enrichmentConfigured(): boolean {
  return Boolean(
    process.env.ENRICHMENT_API_KEY ||
      process.env.PROSPEO_API_KEY ||
      process.env.LEADMAGIC_API_KEY,
  );
}

// Derive a company domain from a website URL or email, for providers that key
// off the domain. Pure helper, exported for the enrich action + tests.
export function deriveDomain(input: EnrichmentInput): string | null {
  if (input.domain) return input.domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  if (input.email && input.email.includes("@")) {
    return input.email.split("@")[1].toLowerCase();
  }
  return null;
}
