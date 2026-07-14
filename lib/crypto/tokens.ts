import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

// Symmetric encryption for OAuth refresh tokens at rest (inboxes
// .oauth_refresh_token_enc). AES-256-GCM: confidentiality + integrity, so a
// tampered ciphertext fails to decrypt rather than yielding garbage.
//
// Key: TOKEN_ENCRYPTION_KEY, a base64-encoded 32-byte key. Generate with:
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
// Rotating the key invalidates existing stored tokens (re-connect the inbox).

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard nonce length
const KEY_BYTES = 32; // AES-256
const VERSION = "v1";

function getKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY is not set (base64-encoded 32-byte key).",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}.`,
    );
  }
  return key;
}

// Returns "v1:<iv b64>:<authTag b64>:<ciphertext b64>".
export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

export function decryptToken(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 4) {
    throw new Error("Malformed encrypted token.");
  }
  const [version, ivB64, tagB64, dataB64] = parts;
  // Constant-time version check (avoids leaking via early return timing;
  // cheap and keeps the format strict).
  const vBuf = Buffer.from(version);
  const expBuf = Buffer.from(VERSION);
  if (vBuf.length !== expBuf.length || !timingSafeEqual(vBuf, expBuf)) {
    throw new Error(`Unsupported token version: ${version}`);
  }
  const key = getKey();
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const ciphertext = Buffer.from(dataB64, "base64");
  if (iv.length !== IV_BYTES) {
    throw new Error("Malformed encrypted token (iv).");
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  // .final() throws if the auth tag doesn't verify (tampered/wrong key).
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
