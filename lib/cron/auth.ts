import { timingSafeEqual } from "node:crypto";

// Shared-secret gate for /api/cron/* (pg_cron sends this). Constant-time
// compare so the secret can't be probed byte-by-byte.
export function isAuthorizedCron(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ")
    ? header.slice("Bearer ".length)
    : (request.headers.get("x-cron-secret") ?? "");

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
