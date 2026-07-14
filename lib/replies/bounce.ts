// Pure bounce classification (Section 5.4: "mailer-daemon parsing for hard vs
// soft bounce"). Kept free of any Gmail/network dependency so it is exhaustively
// unit-testable: the reply-worker fetches a message, hands the extracted
// headers + text here, and acts on the verdict.
//
// A hard bounce (permanent failure) means the address is dead — suppress it
// globally. A soft bounce (transient: full mailbox, greylist, rate limit) is
// NOT a reason to suppress; the sequence simply retries later. When we can see
// the DSN status code we trust it (RFC 3463: 5.x.x permanent, 4.x.x transient);
// otherwise we fall back to diagnostic-text heuristics, and when genuinely
// ambiguous we return 'soft' — never suppress on a guess.

export interface BounceInput {
  fromHeader: string; // raw From header of the notification
  subject: string;
  bodyText: string; // decoded text/plain (and/or delivery-status part) body
  // Optional structured hints some providers expose as headers:
  failedRecipientsHeader?: string; // X-Failed-Recipients
}

export interface BounceResult {
  isBounce: boolean;
  type: "hard" | "soft" | null;
  recipient: string | null; // the address that failed, lowercased
}

const NOT_A_BOUNCE: BounceResult = {
  isBounce: false,
  type: null,
  recipient: null,
};

// Deliberately does NOT include no-reply@ / noreply@ — ordinary marketing mail
// comes from those and would be misread as daemon mail. Detection still needs a
// bounce SUBJECT or a DSN body (see classifyBounce), so this is one signal of two.
const DAEMON_SENDER =
  /(mailer-daemon|postmaster|mail delivery (subsystem|system))@|<?mailer-daemon@|delivery status notification/i;

const BOUNCE_SUBJECT =
  /(delivery status notification|undelivered|delivery failure|delivery has failed|returned mail|mail delivery failed|failure notice|undeliverable)/i;

// RFC 3463 enhanced status code, e.g. "5.1.1" (permanent) or "4.2.2" (transient).
// Capture the FULL code — the class (first digit) decides permanence, and a few
// specific subcodes are known-transient even under class 5.
const DSN_STATUS = /\bstatus\s*[:=]?\s*(([245])\.\d{1,3}\.\d{1,3})\b/i;
// Bare enhanced code appearing in diagnostic text (without the "Status:" label).
const BARE_ENHANCED = /\b(([245])\.\d{1,3}\.\d{1,3})\b/;
// Classic SMTP reply code near failure wording.
const SMTP_5XX = /\b5\d{2}\b/;
const SMTP_4XX = /\b4\d{2}\b/;

// Enhanced subcodes that are transient even when the server (mis)uses class 5:
// 5.2.2 mailbox full, 5.2.3 message too large for mailbox. Treat as soft so a
// live prospect with a temporarily-full mailbox is never GLOBALLY, permanently
// suppressed across every venture.
const SOFT_ENHANCED_SUBCODES = new Set(["5.2.2", "5.2.3"]);

// Explicit over-quota / mailbox-full wording — the only phrases allowed to
// soften a class-5 code (a full mailbox is transient). Generic wrapper wording
// like "try again" is intentionally excluded: it appears in permanent DSNs too
// and must NOT downgrade an authoritative 5.x.x hard failure.
const QUOTA_FULL_PHRASES =
  /(over ?quota|quota exceeded|mailbox (is )?full|insufficient (system )?storage|user is over quota)/i;

// Permanent-failure phrases (hard) — used only when NO enhanced code is present.
const HARD_PHRASES =
  /(no such (user|mailbox|recipient|address)|user unknown|unknown user|does ?n['o]?t exist|mailbox (unavailable|not found|does not exist)|recipient (address )?rejected|address (rejected|unknown)|account (has been )?(disabled|deactivated|closed|suspended)|invalid recipient|user (is )?(unknown|disabled)|550[ -]?5\.|not our customer|relay(ing)? denied|domain not found)/i;

// Transient-failure phrases (soft) — used only when NO enhanced code is present.
const SOFT_PHRASES =
  /(over ?quota|mailbox (is )?full|quota exceeded|insufficient (system )?storage|temporar(il|)y|try again|greylist|rate ?limit|too many|deferred|timed? ?out|connection (timed out|refused|reset)|service unavailable|452|421|throttl)/i;

// Extract the failed recipient. Prefer the structured DSN fields, then the
// X-Failed-Recipients header, then any address in the body.
function extractRecipient(input: BounceInput): string | null {
  const { bodyText, failedRecipientsHeader } = input;

  const finalRcpt = bodyText.match(
    /(?:final|original)-recipient:\s*(?:rfc822|x400)?\s*;?\s*<?([^\s<>;]+@[^\s<>;]+)>?/i,
  );
  if (finalRcpt) return normalizeAddr(finalRcpt[1]);

  if (failedRecipientsHeader) {
    const m = failedRecipientsHeader.match(/([^\s<>,;]+@[^\s<>,;]+)/);
    if (m) return normalizeAddr(m[1]);
  }

  // Diagnostic wording like "<foo@bar.com>: host ... said: 550 ...".
  const diag = bodyText.match(
    /<([^\s<>]+@[^\s<>]+)>\s*(?::|\bhost\b|\bsaid\b|\bfailed\b)/i,
  );
  if (diag) return normalizeAddr(diag[1]);

  // No structured recipient found. Deliberately NO "first email in the body"
  // fallback: in a real DSN the first address is often the ORIGINAL SENDER (our
  // own inbox) or a quoted header, and returning it would globally suppress the
  // wrong — often live — address. A null recipient means the caller simply does
  // not suppress, which is the safe failure mode.
  return null;
}

function normalizeAddr(raw: string): string {
  return raw.trim().replace(/[.,;]+$/, "").toLowerCase();
}

export function classifyBounce(input: BounceInput): BounceResult {
  const looksLikeDaemon =
    DAEMON_SENDER.test(input.fromHeader) || BOUNCE_SUBJECT.test(input.subject);
  const hasDsnBody =
    /content-type:\s*message\/delivery-status/i.test(input.bodyText) ||
    /(final|original)-recipient:/i.test(input.bodyText) ||
    /diagnostic-code:/i.test(input.bodyText);

  if (!looksLikeDaemon && !hasDsnBody) return NOT_A_BOUNCE;

  const recipient = extractRecipient(input);
  const body = input.bodyText;

  // 1) Trust the enhanced status code when present — it is authoritative.
  const statusMatch = body.match(DSN_STATUS) ?? body.match(BARE_ENHANCED);
  if (statusMatch) {
    const code = statusMatch[1]; // full code, e.g. "5.1.1"
    const cls = statusMatch[2]; // class digit
    if (cls === "5") {
      // Permanent — EXCEPT the known-transient mailbox-full subcodes, or an
      // explicit over-quota/mailbox-full message (a full mailbox is temporary).
      // Generic wording never downgrades a class-5 code, so a real dead address
      // (e.g. 5.1.1 "no such user, try again later") is still suppressed.
      if (SOFT_ENHANCED_SUBCODES.has(code) || QUOTA_FULL_PHRASES.test(body)) {
        return { isBounce: true, type: "soft", recipient };
      }
      return { isBounce: true, type: "hard", recipient };
    }
    // 4.x.x (and the rare 2.x.x in a DSN) → transient.
    return { isBounce: true, type: "soft", recipient };
  }

  // 2) No enhanced code: use diagnostic phrases.
  if (HARD_PHRASES.test(body) && !SOFT_PHRASES.test(body)) {
    return { isBounce: true, type: "hard", recipient };
  }
  if (SOFT_PHRASES.test(body)) {
    return { isBounce: true, type: "soft", recipient };
  }

  // 3) Classic SMTP code as a weak signal.
  if (SMTP_5XX.test(body) && !SMTP_4XX.test(body)) {
    return { isBounce: true, type: "hard", recipient };
  }

  // 4) It's a bounce but we can't prove permanence → soft (never suppress on a
  // guess).
  return { isBounce: true, type: "soft", recipient };
}
