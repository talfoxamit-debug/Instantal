// Email verification runs at import time. "Never send to unverified leads"
// is the single rule that protects domain reputation most (Section 5.1), so
// import routes every new address through a provider before it becomes
// sendable.
//
// The provider is a user decision (pay-per-verify vendor). This module keeps
// the rest of the app provider-agnostic: import calls getVerificationProvider()
// and works against the interface. With no API key configured it falls back to
// a syntax-only mock so the whole flow is exercisable in dev — the mock never
// claims an address is deliverable, only that it is well-formed or not.

import type { VerifyStatus } from "@/lib/types";

export interface VerificationResult {
  email: string;
  // Maps directly onto leads.verify_status.
  status: Exclude<VerifyStatus, "unverified" | "pending">;
}

export interface VerificationProvider {
  readonly name: string;
  verify(emails: string[]): Promise<VerificationResult[]>;
}

// RFC-5322-lite: good enough to reject the obvious garbage before spending a
// paid verification credit. Not a deliverability check.
const EMAIL_RE =
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isWellFormedEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

// Default provider when EMAIL_VERIFICATION_API_KEY is unset. Syntax-only:
// well-formed -> "unknown" (NOT "valid" — the mock cannot prove deliverability
// and must never green-light an address it hasn't actually checked),
// malformed -> "invalid".
class MockVerificationProvider implements VerificationProvider {
  readonly name = "mock";
  async verify(emails: string[]): Promise<VerificationResult[]> {
    return emails.map((email) => ({
      email,
      status: isWellFormedEmail(email) ? "unknown" : "invalid",
    }));
  }
}

// Real provider scaffold. Vendors differ (MillionVerifier, ZeroBounce,
// NeverBounce, …); wire the concrete request/response mapping when the vendor
// is chosen and set EMAIL_VERIFICATION_API_KEY + EMAIL_VERIFICATION_API_URL.
// Until then getVerificationProvider() returns the mock, so nothing silently
// sends to unchecked addresses claiming they were verified.
class HttpVerificationProvider implements VerificationProvider {
  readonly name = "http";
  constructor(
    private readonly apiUrl: string,
    private readonly apiKey: string,
  ) {}

  async verify(emails: string[]): Promise<VerificationResult[]> {
    // TODO(phase-1-handoff): map to the chosen vendor's batch endpoint.
    // Shape below is a common single-email GET; replace with the real one.
    const results: VerificationResult[] = [];
    for (const email of emails) {
      if (!isWellFormedEmail(email)) {
        results.push({ email, status: "invalid" });
        continue;
      }
      try {
        const url = new URL(this.apiUrl);
        url.searchParams.set("email", email);
        url.searchParams.set("api_key", this.apiKey);
        const res = await fetch(url, { method: "GET" });
        if (!res.ok) {
          results.push({ email, status: "unknown" });
          continue;
        }
        const body = (await res.json()) as { result?: string };
        results.push({ email, status: normalizeVendorResult(body.result) });
      } catch {
        results.push({ email, status: "unknown" });
      }
    }
    return results;
  }
}

// Collapse a vendor's status vocabulary into our verify_status set.
function normalizeVendorResult(
  raw: string | undefined,
): VerificationResult["status"] {
  switch ((raw ?? "").toLowerCase()) {
    case "valid":
    case "deliverable":
    case "ok":
      return "valid";
    case "invalid":
    case "undeliverable":
      return "invalid";
    case "risky":
    case "catch_all":
    case "catch-all":
    case "accept_all":
    case "unknown_deliverability":
      return "risky";
    default:
      return "unknown";
  }
}

export function getVerificationProvider(): VerificationProvider {
  const apiKey = process.env.EMAIL_VERIFICATION_API_KEY;
  const apiUrl = process.env.EMAIL_VERIFICATION_API_URL;
  if (apiKey && apiUrl) {
    return new HttpVerificationProvider(apiUrl, apiKey);
  }
  return new MockVerificationProvider();
}
