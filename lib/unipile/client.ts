// Unipile client — the unified messaging API Instantal uses to reach LinkedIn
// (which has no official automation API). Everything the LinkedIn worker + UI
// need goes through this interface, so the vendor is swappable and the worker
// is testable against a fake. The concrete HttpUnipileClient targets Unipile's
// documented v1 API; verify exact paths/fields against the current docs (an
// account-specific DSN subdomain + X-API-KEY auth).
//
// Config: UNIPILE_DSN (e.g. "api8.unipile.com:13xxx") + UNIPILE_API_KEY.

export interface UnipileProfile {
  provider_id: string; // LinkedIn member id used to invite/message
  name: string | null;
  public_identifier: string | null;
}

export interface UnipileSentMessage {
  chat_id: string | null;
  message_id: string | null;
}

export interface UnipileInboundMessage {
  chat_id: string;
  message_id: string;
  text: string;
  from_provider_id: string | null;
  is_sender: boolean; // true if WE sent it (skip those on ingest)
  timestamp: string; // ISO
}

export interface UnipileClient {
  // Hosted-auth link the operator opens to connect a LinkedIn account. On
  // success Unipile POSTs `notifyUrl` with the new account_id + our `name`.
  createHostedAuthLink(opts: {
    successUrl: string;
    failureUrl: string;
    notifyUrl: string;
    name: string;
  }): Promise<{ url: string }>;
  // Resolve a LinkedIn profile URL/identifier to a provider_id we can act on.
  resolveProfile(accountId: string, identifier: string): Promise<UnipileProfile | null>;
  // Send a connection request.
  sendInvitation(
    accountId: string,
    providerId: string,
    message?: string,
  ): Promise<{ invitationId: string | null }>;
  // Start a chat / send a DM (message or inmail).
  sendMessage(
    accountId: string,
    providerId: string,
    text: string,
  ): Promise<UnipileSentMessage>;
  // Recent inbound messages across chats, for reply ingestion.
  listInboundMessages(
    accountId: string,
    afterIso: string | null,
  ): Promise<UnipileInboundMessage[]>;
}

function baseUrl(): string {
  const dsn = process.env.UNIPILE_DSN;
  if (!dsn) throw new Error("UNIPILE_DSN is not set.");
  return `https://${dsn}/api/v1`;
}
function apiKey(): string {
  const key = process.env.UNIPILE_API_KEY;
  if (!key) throw new Error("UNIPILE_API_KEY is not set.");
  return key;
}

export function unipileConfigured(): boolean {
  return Boolean(process.env.UNIPILE_DSN && process.env.UNIPILE_API_KEY);
}

// Extract the LinkedIn public identifier from a profile URL, e.g.
// https://www.linkedin.com/in/pat-doe/ -> "pat-doe".
export function linkedinPublicId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]) : null;
}

export class HttpUnipileClient implements UnipileClient {
  private async req<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${baseUrl()}${path}`, {
      method,
      headers: {
        "X-API-KEY": apiKey(),
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Unipile ${method} ${path} failed (${res.status}). ${detail.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  async createHostedAuthLink(opts: {
    successUrl: string;
    failureUrl: string;
    notifyUrl: string;
    name: string;
  }): Promise<{ url: string }> {
    const json = await this.req<{ url: string }>("POST", "/hosted/accounts/link", {
      type: "create",
      providers: ["LINKEDIN"],
      api_url: `https://${process.env.UNIPILE_DSN}`,
      success_redirect_url: opts.successUrl,
      failure_redirect_url: opts.failureUrl,
      notify_url: opts.notifyUrl,
      name: opts.name,
    });
    return { url: json.url };
  }

  async resolveProfile(
    accountId: string,
    identifier: string,
  ): Promise<UnipileProfile | null> {
    try {
      const json = await this.req<{
        provider_id?: string;
        name?: string;
        public_identifier?: string;
      }>("GET", `/users/${encodeURIComponent(identifier)}?account_id=${accountId}`);
      if (!json.provider_id) return null;
      return {
        provider_id: json.provider_id,
        name: json.name ?? null,
        public_identifier: json.public_identifier ?? identifier,
      };
    } catch {
      return null;
    }
  }

  async sendInvitation(
    accountId: string,
    providerId: string,
    message?: string,
  ): Promise<{ invitationId: string | null }> {
    const json = await this.req<{ invitation_id?: string }>("POST", "/users/invite", {
      account_id: accountId,
      provider_id: providerId,
      message: message || undefined,
    });
    return { invitationId: json.invitation_id ?? null };
  }

  // POST /chats is multipart/form-data (verified). Starting a chat with an
  // attendee sends the first message; the response carries the new chat id.
  async sendMessage(
    accountId: string,
    providerId: string,
    text: string,
  ): Promise<UnipileSentMessage> {
    const form = new FormData();
    form.append("account_id", accountId);
    form.append("attendees_ids", providerId);
    form.append("text", text);
    const res = await fetch(`${baseUrl()}/chats`, {
      method: "POST",
      headers: { "X-API-KEY": apiKey() }, // no Content-Type: fetch sets the boundary
      body: form,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Unipile POST /chats failed (${res.status}). ${detail.slice(0, 200)}`);
    }
    const json = (await res.json()) as { chat_id?: string; id?: string; message_id?: string };
    return {
      chat_id: json.chat_id ?? json.id ?? null,
      message_id: json.message_id ?? null,
    };
  }

  // Ingest inbound replies: list recent chats for the account, then read each
  // chat's newest messages, keeping only inbound ones after `afterIso`. Bounded
  // so a big mailbox can't run away in one poll.
  async listInboundMessages(
    accountId: string,
    afterIso: string | null,
  ): Promise<UnipileInboundMessage[]> {
    const chats = await this.req<{ items?: { id?: string }[] }>(
      "GET",
      `/chats?account_id=${accountId}&limit=50`,
    );
    const out: UnipileInboundMessage[] = [];
    for (const chat of (chats.items ?? []).slice(0, 50)) {
      if (!chat.id) continue;
      const msgs = await this.req<{
        items?: {
          id?: string;
          provider_id?: string;
          text?: string;
          is_sender?: boolean | number;
          sender_id?: string;
          timestamp?: string;
        }[];
      }>("GET", `/chats/${chat.id}/messages?limit=20`);
      for (const m of msgs.items ?? []) {
        if (!m.id) continue;
        const isSender = m.is_sender === true || m.is_sender === 1;
        if (isSender) continue;
        const ts = m.timestamp ?? new Date(0).toISOString();
        if (afterIso && ts <= afterIso) continue;
        out.push({
          chat_id: chat.id,
          message_id: m.id,
          text: m.text ?? "",
          from_provider_id: m.sender_id ?? null,
          is_sender: false,
          timestamp: ts,
        });
      }
    }
    return out;
  }
}

export function getUnipileClient(): UnipileClient {
  return new HttpUnipileClient();
}
