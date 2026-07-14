// Validate a ?next= redirect target by resolving it against our origin and
// checking where it actually lands. String prefix checks are not enough:
// WHATWG URL parsing treats "/\evil.com" like "//evil.com" (protocol-relative).
export function safeNextPath(
  raw: string | null,
  origin: string,
  fallback = "/dashboard",
): string {
  if (!raw) return fallback;
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin) return fallback;
    return url.pathname + url.search;
  } catch {
    return fallback;
  }
}
