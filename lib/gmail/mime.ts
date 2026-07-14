// Pure RFC-822/2045 MIME assembly for Gmail messages.send. No network here so
// it is unit-testable; the encoding + header rules are what deliverability and
// threading depend on.

export interface MimeOptions {
  fromName?: string;
  fromEmail: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  // Threading (follow-ups land in the same Gmail thread): the RFC Message-ID
  // of the message being replied to, plus the accumulated References chain.
  inReplyTo?: string;
  references?: string;
  // One-click unsubscribe (RFC 8058). httpsUrl is required for compliance.
  listUnsubscribeUrl: string;
  listUnsubscribeMailto?: string;
}

// Encode a header value that may contain non-ASCII per RFC 2047, else pass
// through. Keeps subjects/display-names correct without mangling ASCII.
function encodeHeaderWord(value: string): string {
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function formatFrom(name: string | undefined, email: string): string {
  if (!name) return email;
  return `${encodeHeaderWord(name)} <${email}>`;
}

// base64url without padding, as Gmail's `raw` field expects.
export function toBase64Url(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function randomBoundary(seed: string): string {
  // Deterministic-ish boundary from a seed (message id / lead) so the builder
  // stays pure; only needs to not collide with body content.
  return `=_instantal_${Buffer.from(seed).toString("hex").slice(0, 24)}`;
}

export function buildMimeMessage(opts: MimeOptions): string {
  const headers: string[] = [];
  headers.push(`From: ${formatFrom(opts.fromName, opts.fromEmail)}`);
  headers.push(`To: ${opts.to}`);
  headers.push(`Subject: ${encodeHeaderWord(opts.subject)}`);
  headers.push("MIME-Version: 1.0");

  if (opts.inReplyTo) headers.push(`In-Reply-To: ${opts.inReplyTo}`);
  if (opts.references) headers.push(`References: ${opts.references}`);

  const unsubValues = [`<${opts.listUnsubscribeUrl}>`];
  if (opts.listUnsubscribeMailto) {
    unsubValues.push(`<mailto:${opts.listUnsubscribeMailto}>`);
  }
  headers.push(`List-Unsubscribe: ${unsubValues.join(", ")}`);
  headers.push("List-Unsubscribe-Post: List-Unsubscribe=One-Click");

  if (opts.html) {
    const boundary = randomBoundary(opts.to + opts.subject);
    headers.push(
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
    );
    const parts = [
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      opts.text,
      "",
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      opts.html,
      "",
      `--${boundary}--`,
      "",
    ];
    return `${headers.join("\r\n")}\r\n\r\n${parts.join("\r\n")}`;
  }

  // Plain-text-first (Section 5.2): text/plain is the deliverability-friendly
  // default when no HTML variant is supplied.
  headers.push("Content-Type: text/plain; charset=UTF-8");
  headers.push("Content-Transfer-Encoding: 8bit");
  return `${headers.join("\r\n")}\r\n\r\n${opts.text}`;
}
