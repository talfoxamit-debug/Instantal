// NEXT_PUBLIC_* vars are inlined at BUILD time (Next replaces each direct
// `process.env.NEXT_PUBLIC_*` access with a literal), so they must be set in the
// environment BEFORE the build — adding them to Vercel and redeploying from
// cache won't pick them up. New Supabase projects issue sb_publishable_* keys;
// legacy anon keys work as the same value.
//
// Guarded (not a bare `!`) so a missing var throws a clear, named error at
// import instead of surfacing later as Supabase's generic "URL and key are
// required" 500 on every page — matching every other env reader in the repo.
function required(value: string | undefined, ...names: string[]): string {
  if (!value) {
    throw new Error(
      `${names.join(" / ")} is not set (NEXT_PUBLIC_* are inlined at build time — set it before building).`,
    );
  }
  return value;
}

export const supabaseUrl = required(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  "NEXT_PUBLIC_SUPABASE_URL",
);

export const supabasePublishableKey = required(
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
);
