// Gmail OAuth for connecting sending inboxes. This is an INTERNAL-use OAuth
// app on your own Google Workspace (keep it internal to skip Google's app
// review — Section 9.4). Scopes: send (Phase 2) + readonly (reply polling,
// Phase 4).

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
];

function clientId(): string {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!id) throw new Error("GOOGLE_OAUTH_CLIENT_ID is not set.");
  return id;
}

function clientSecret(): string {
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!secret) throw new Error("GOOGLE_OAUTH_CLIENT_SECRET is not set.");
  return secret;
}

// The callback URL must be registered in the Google Cloud console. Derived
// from the request origin so it works across localhost/preview/prod.
export function redirectUri(origin: string): string {
  return `${origin}/api/oauth/google/callback`;
}

// Build the consent URL. `state` carries a signed/opaque value we verify on
// callback (CSRF + which workspace/inbox to attach). access_type=offline +
// prompt=consent forces a refresh_token every time.
export function buildAuthUrl(origin: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
  id_token?: string;
}

export async function exchangeCode(
  code: string,
  origin: string,
): Promise<GoogleTokens> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: redirectUri(origin),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed: ${await res.text()}`);
  }
  return (await res.json()) as GoogleTokens;
}

// Exchange a stored refresh token for a fresh access token at send time.
export async function refreshAccessToken(
  refreshToken: string,
): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId(),
      client_secret: clientSecret(),
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token refresh failed: ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  return json;
}

// Fetch the connected account's email address (to confirm which mailbox was
// authorized). Uses the OpenID userinfo endpoint.
export async function fetchGoogleEmail(accessToken: string): Promise<string> {
  const res = await fetch(
    "https://openidconnect.googleapis.com/v1/userinfo",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    throw new Error(`Google userinfo failed: ${await res.text()}`);
  }
  const json = (await res.json()) as { email?: string };
  if (!json.email) throw new Error("Google userinfo returned no email.");
  return json.email.toLowerCase();
}
