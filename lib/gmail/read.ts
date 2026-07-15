// Gmail read client for the reply-worker (Section 5.4: poll every 5 min for new
// replies + bounce notifications). Uses the same Bearer access token minted from
// the inbox's stored refresh token as the send client. Two poll strategies:
//   * incremental via the History API (users.history.list) when we have a
//     stored historyId — cheap, only returns what changed;
//   * a bounded time query (q=after:<epoch>) for the first poll or when the
//     stored historyId has expired (Gmail returns 404 after ~a week).
// Message bodies are decoded to text so the bounce parser and Claude classifier
// operate on plain strings.

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  historyId: string;
  labelIds: string[];
  fromHeader: string;
  toHeader: string;
  subject: string;
  rfcMessageId: string;
  inReplyTo: string;
  references: string;
  failedRecipientsHeader?: string;
  bodyText: string;
  internalDate: number; // epoch ms
}

async function authedGet(
  accessToken: string,
  path: string,
): Promise<Response> {
  return fetch(`${GMAIL_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// The current mailbox historyId — the baseline cursor to store when an inbox is
// first connected, so the first poll only sees mail that arrives after connect.
export async function getProfileHistoryId(
  accessToken: string,
): Promise<string | null> {
  const res = await authedGet(accessToken, "/profile");
  if (!res.ok) return null;
  const json = (await res.json()) as { historyId?: string };
  return json.historyId ?? null;
}

export interface MessageIdPage {
  ids: string[];
  newestHistoryId: string | null;
  // historyId expired (404): the caller must fall back to a time query.
  historyExpired: boolean;
}

// Incremental: everything added to the mailbox since startHistoryId.
export async function listHistoryMessageIds(
  accessToken: string,
  startHistoryId: string,
): Promise<MessageIdPage> {
  const ids = new Set<string>();
  let pageToken: string | undefined;
  let newestHistoryId: string | null = null;

  do {
    const params = new URLSearchParams({
      startHistoryId,
      historyTypes: "messageAdded",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await authedGet(accessToken, `/history?${params.toString()}`);
    if (res.status === 404) {
      // Stored cursor is too old; Gmail purged that history window.
      return { ids: [], newestHistoryId: null, historyExpired: true };
    }
    if (!res.ok) {
      throw new Error(`Gmail history.list failed (${res.status}).`);
    }
    const json = (await res.json()) as {
      history?: { messagesAdded?: { message?: { id?: string } }[] }[];
      historyId?: string;
      nextPageToken?: string;
    };
    if (json.historyId) newestHistoryId = json.historyId;
    for (const h of json.history ?? []) {
      for (const added of h.messagesAdded ?? []) {
        if (added.message?.id) ids.add(added.message.id);
      }
    }
    pageToken = json.nextPageToken;
  } while (pageToken);

  return { ids: [...ids], newestHistoryId, historyExpired: false };
}

// Fallback: inbox messages received at or after afterEpochSec. Capped so a long
// gap can't fetch an unbounded backlog in one tick.
export async function listRecentMessageIds(
  accessToken: string,
  afterEpochSec: number,
  maxPages = 4,
): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    const params = new URLSearchParams({
      q: `after:${Math.floor(afterEpochSec)}`,
      labelIds: "INBOX",
      maxResults: "100",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await authedGet(accessToken, `/messages?${params.toString()}`);
    if (!res.ok) throw new Error(`Gmail messages.list failed (${res.status}).`);
    const json = (await res.json()) as {
      messages?: { id?: string }[];
      nextPageToken?: string;
    };
    for (const m of json.messages ?? []) if (m.id) ids.push(m.id);
    pageToken = json.nextPageToken;
    pages += 1;
  } while (pageToken && pages < maxPages);
  return ids;
}

// Search a mailbox by Gmail query (e.g. `subject:"tok-abc"`). Includes spam +
// trash — essential for placement testing, where the whole point is to detect
// a message that landed in the spam folder (which messages.list hides by
// default). Returns matching message ids (bounded).
export async function searchMessageIds(
  accessToken: string,
  query: string,
  maxResults = 10,
): Promise<string[]> {
  const params = new URLSearchParams({
    q: query,
    includeSpamTrash: "true",
    maxResults: String(maxResults),
  });
  const res = await authedGet(accessToken, `/messages?${params.toString()}`);
  if (!res.ok) throw new Error(`Gmail search failed (${res.status}).`);
  const json = (await res.json()) as { messages?: { id?: string }[] };
  return (json.messages ?? []).map((m) => m.id).filter((id): id is string => !!id);
}

function headerValue(headers: GmailHeader[], name: string): string {
  const h = headers.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

function base64UrlDecode(data: string): string {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64, "base64").toString("utf8");
}

interface GmailPart {
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
}

// Walk the MIME tree collecting text. Prefer text/plain; fall back to a crude
// text extraction from text/html. Also captures the message/delivery-status
// part verbatim (the bounce parser reads its DSN fields).
function extractText(part: GmailPart | undefined): {
  plain: string;
  html: string;
  dsn: string;
} {
  let plain = "";
  let html = "";
  let dsn = "";
  const walk = (p?: GmailPart) => {
    if (!p) return;
    const mime = (p.mimeType ?? "").toLowerCase();
    const data = p.body?.data ? base64UrlDecode(p.body.data) : "";
    if (mime === "text/plain") plain += data;
    else if (mime === "text/html") html += data;
    else if (mime.startsWith("message/") || mime === "text/rfc822-headers") {
      dsn += data;
    }
    for (const child of p.parts ?? []) walk(child);
  };
  walk(part);
  return { plain, html, dsn };
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function getMessage(
  accessToken: string,
  id: string,
): Promise<GmailMessage> {
  const res = await authedGet(accessToken, `/messages/${id}?format=full`);
  if (!res.ok) throw new Error(`Gmail messages.get failed (${res.status}).`);
  const json = (await res.json()) as {
    id?: string;
    threadId?: string;
    historyId?: string;
    labelIds?: string[];
    internalDate?: string;
    payload?: GmailPart & { headers?: GmailHeader[] };
  };
  const headers = json.payload?.headers ?? [];
  const { plain, html, dsn } = extractText(json.payload);
  const bodyText = [plain.trim() || htmlToText(html), dsn.trim()]
    .filter(Boolean)
    .join("\n\n");

  return {
    id: json.id ?? id,
    threadId: json.threadId ?? "",
    historyId: json.historyId ?? "",
    labelIds: json.labelIds ?? [],
    fromHeader: headerValue(headers, "From"),
    toHeader: headerValue(headers, "To"),
    subject: headerValue(headers, "Subject"),
    rfcMessageId: headerValue(headers, "Message-ID"),
    inReplyTo: headerValue(headers, "In-Reply-To"),
    references: headerValue(headers, "References"),
    failedRecipientsHeader:
      headerValue(headers, "X-Failed-Recipients") || undefined,
    bodyText,
    internalDate: json.internalDate ? Number(json.internalDate) : 0,
  };
}

// The sender's bare email address, lowercased, from a raw From header like
// `"Pat Doe" <pat@acme.com>`.
export function parseFromAddress(fromHeader: string): string | null {
  const angle = fromHeader.match(/<([^>]+)>/);
  const raw = angle ? angle[1] : fromHeader;
  const m = raw.match(/([^\s<>"]+@[^\s<>"]+)/);
  return m ? m[1].trim().toLowerCase() : null;
}
