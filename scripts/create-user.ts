// Admin user provisioning. Instantal has NO self-serve signup (CLAUDE.md), so
// the first login — and every teammate's — is created here with the Supabase
// service-role key. The user is created already email-confirmed so they can sign
// in immediately with the password you set; on first login they land on
// /onboarding to create (or are added to) a workspace.
//
// Usage (from the repo root, with the app's env available):
//   node --experimental-strip-types scripts/create-user.ts <email> [password]
//   npm run create-user -- <email> [password]
//
// If no password is given, a strong one is generated and printed once. Requires
// NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SECRET_KEY in the env
// (e.g. `export $(grep -v '^#' .env.local | xargs)` or a hosting env).

import { randomBytes } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

function env(...names: string[]): string {
  for (const n of names) {
    const v = process.env[n];
    if (v) return v;
  }
  throw new Error(`Missing required env var (one of: ${names.join(", ")}).`);
}

function generatePassword(): string {
  // 24 url-safe chars — comfortably above Supabase's 6-char minimum.
  return randomBytes(18).toString("base64url");
}

async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();
  const password = process.argv[3] ?? generatePassword();
  const generated = !process.argv[3];

  if (!email || !email.includes("@")) {
    console.error(
      "Usage: node --experimental-strip-types scripts/create-user.ts <email> [password]",
    );
    process.exit(1);
  }

  const url = env("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL");
  const secret = env("SUPABASE_SECRET_KEY");
  const admin = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // no confirmation email needed; can log in at once
  });

  if (error) {
    // Most common: the user already exists. Surface it clearly.
    console.error(`Failed to create user ${email}: ${error.message}`);
    process.exit(1);
  }

  console.log(`\n✓ Created user ${email} (id: ${data.user?.id})`);
  if (generated) {
    console.log(`  Password (shown once, store it now): ${password}`);
  }
  console.log(
    "  They can sign in at /login, then create a workspace on /onboarding.\n",
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
