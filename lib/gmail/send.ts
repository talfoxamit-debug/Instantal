import { buildMimeMessage, toBase64Url, type MimeOptions } from "@/lib/gmail/mime";

const GMAIL_SEND_URL =
  "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const GMAIL_GET_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages";

export interface SentMessage {
  id: string; // Gmail message id
  threadId: string;
  rfcMessageId?: string; // RFC Message-ID header, for threading follow-ups
}

// Thrown when a send fails. `retryable` is true ONLY when we KNOW the message
// was not delivered (Gmail returned a 4xx/5xx before accepting), so a retry is
// safe. A network error or a failure reading the response leaves delivery
// uncertain — retryable is false, and the worker treats it as at-most-once to
// avoid double-sending a cold email.
export class GmailSendError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "GmailSendError";
  }
}

export async function sendGmailMessage(
  accessToken: string,
  mime: MimeOptions,
  threadId?: string,
): Promise<SentMessage> {
  const raw = toBase64Url(buildMimeMessage(mime));
  const body: Record<string, unknown> = { raw };
  if (threadId) body.threadId = threadId;

  let res: Response;
  try {
    res = await fetch(GMAIL_SEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    // Network error: the request may or may not have reached Gmail. Uncertain
    // delivery → not retryable.
    throw new GmailSendError(
      `Gmail send network error: ${e instanceof Error ? e.message : "unknown"}`,
      false,
    );
  }

  if (!res.ok) {
    // Gmail rejected the message; it was NOT delivered → safe to retry.
    throw new GmailSendError(
      `Gmail send failed (${res.status}): ${await res.text().catch(() => "")}`,
      true,
    );
  }

  // 2xx = accepted/delivered. Read the ids best-effort; a parse failure here
  // must NOT look like a send failure (the message already went out).
  let json: { id?: string; threadId?: string } = {};
  try {
    json = (await res.json()) as { id?: string; threadId?: string };
  } catch {
    json = {};
  }
  const rfcMessageId = json.id
    ? await fetchRfcMessageId(accessToken, json.id)
    : undefined;
  return {
    id: json.id ?? "",
    threadId: json.threadId ?? threadId ?? "",
    rfcMessageId,
  };
}

async function fetchRfcMessageId(
  accessToken: string,
  messageId: string,
): Promise<string | undefined> {
  try {
    const url = `${GMAIL_GET_URL}/${messageId}?format=metadata&metadataHeaders=Message-ID`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return undefined;
    const json = (await res.json()) as {
      payload?: { headers?: { name: string; value: string }[] };
    };
    const header = json.payload?.headers?.find(
      (h) => h.name.toLowerCase() === "message-id",
    );
    return header?.value;
  } catch {
    return undefined;
  }
}
