import { createHmac, timingSafeEqual } from "node:crypto";

// HMAC-signed opaque payloads (OAuth `state`). Not encryption — just tamper
// evidence + expiry so the callback can trust what the start route put there.

function secret(): string {
  const s =
    process.env.OAUTH_STATE_SECRET ??
    process.env.CRON_SECRET ??
    process.env.TOKEN_ENCRYPTION_KEY;
  if (!s) {
    throw new Error(
      "No signing secret (set OAUTH_STATE_SECRET, CRON_SECRET, or TOKEN_ENCRYPTION_KEY).",
    );
  }
  return s;
}

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function hmac(data: string): string {
  return b64url(createHmac("sha256", secret()).update(data).digest());
}

// Sign an arbitrary JSON-serializable payload with a TTL (seconds). `nowMs` is
// injectable so the logic is testable without a wall clock.
export function signState(
  payload: Record<string, unknown>,
  ttlSeconds: number,
  nowMs: number,
): string {
  const body = { ...payload, exp: nowMs + ttlSeconds * 1000 };
  const encoded = b64url(Buffer.from(JSON.stringify(body), "utf8"));
  return `${encoded}.${hmac(encoded)}`;
}

// Verify signature + expiry; returns the payload or null if invalid/expired.
export function verifyState<T = Record<string, unknown>>(
  token: string,
  nowMs: number,
): T | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expected = hmac(encoded);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const body = JSON.parse(
      Buffer.from(encoded, "base64").toString("utf8"),
    ) as { exp?: number } & T;
    if (typeof body.exp !== "number" || body.exp < nowMs) return null;
    return body;
  } catch {
    return null;
  }
}
