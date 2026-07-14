// NEXT_PUBLIC_* vars are inlined at build time, so both lookups must be
// direct property accesses. New Supabase projects issue sb_publishable_*
// keys; legacy anon keys work as the same value.
export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

export const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
