// Supabase connection config.
//
// NEXT_PUBLIC_* vars are inlined at BUILD time (Next replaces each direct
// `process.env.NEXT_PUBLIC_*` access with a literal), so they must be set in the
// environment BEFORE the build — adding them to Vercel and redeploying from
// cache won't pick them up. New Supabase projects issue sb_publishable_* keys;
// legacy anon keys work as the same value.
//
// These are LAZY getters, not eagerly-evaluated consts: they validate only when
// a client is actually constructed (request time), never at module load. That
// keeps `next build` page-data collection from failing on a not-yet-configured
// project, while a genuinely missing var still throws a clear, named error at
// runtime instead of Supabase's opaque "URL and key are required".
function required(value: string | undefined, ...names: string[]): string {
  if (!value) {
    throw new Error(
      `${names.join(" / ")} is not set (NEXT_PUBLIC_* are inlined at build time — set it before building).`,
    );
  }
  return value;
}

export function getSupabaseUrl(): string {
  return required(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    "NEXT_PUBLIC_SUPABASE_URL",
  );
}

export function getSupabasePublishableKey(): string {
  return required(
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  );
}
