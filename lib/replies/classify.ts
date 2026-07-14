// Reply classifier (Section 5.4: "Claude API classifies new replies"). Called
// only for genuine human replies — bounces are filtered out by the DSN parser
// first. Uses the Anthropic SDK's structured-output helper so the label is
// schema-validated, never free-text we have to post-parse.
//
// Cost model (Section 8): a few dollars a month, so this defaults to Haiku 4.5
// (cheap, supports structured outputs). Override with ANTHROPIC_CLASSIFY_MODEL
// to escalate a hard workload to a stronger model without a code change.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

// Labels must be a subset of the replies.classification CHECK constraint
// (Phase 1 migration). 'bounce' is intentionally absent — bounces never reach
// the classifier.
export const REPLY_LABELS = [
  "interested",
  "not_interested",
  "ooo",
  "referral",
  "unsubscribe_request",
  "other",
] as const;

export type ReplyLabel = (typeof REPLY_LABELS)[number];

const ClassificationSchema = z.object({
  classification: z.enum(REPLY_LABELS),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("0-1 certainty in the chosen label"),
  reasoning: z.string().describe("one short sentence justifying the label"),
});

export type ReplyClassification = z.infer<typeof ClassificationSchema>;

const DEFAULT_MODEL = "claude-haiku-4-5";

const SYSTEM_PROMPT = `You classify replies to COLD OUTREACH sales emails into exactly one label. The reader is a busy operator; be decisive.

Labels:
- interested: wants to learn more, asks a question about the offer, requests a call/demo, positive engagement, or asks for pricing.
- not_interested: declines, "not a fit", "no thanks", "remove me from consideration" (without demanding suppression), or "we already use X".
- ooo: an automated out-of-office / vacation autoresponder. The person is away; this is NOT a real answer. Look for "out of office", "on leave", "will return", "annual leave", auto-reply wording.
- referral: says they are not the right person and points to someone else, or forwards you along.
- unsubscribe_request: explicitly demands to stop being emailed — "unsubscribe", "stop emailing me", "take me off your list", "do not contact", "GDPR", legal threat about email. When in doubt between not_interested and unsubscribe_request, only pick unsubscribe_request if they clearly demand no further contact.
- other: anything else — bounced-message text that slipped through, spam, gibberish, or a reply whose intent is genuinely unclear.

Only pick 'ooo' for genuine automated auto-replies, not a human saying they are busy. Output your single best label with a calibrated confidence.`;

// Trim a reply to the part that matters — the top of the message, before quoted
// history — and cap length so a giant forwarded thread can't blow up cost.
export function trimReplyBody(body: string, maxChars = 4000): string {
  let text = body ?? "";
  // Cut common quoted-history markers so the model sees the new content.
  const markers = [
    /^On .+ wrote:$/m,
    /^-{2,}\s*Original Message\s*-{2,}/im,
    /^_{5,}/m,
    /^From:\s.+$/m,
    /^>{1,}/m,
  ];
  for (const re of markers) {
    const m = text.match(re);
    if (m && m.index !== undefined && m.index > 40) {
      text = text.slice(0, m.index);
    }
  }
  text = text.trim();
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

export interface ClassifyOptions {
  apiKey?: string;
  model?: string;
  subject?: string;
}

// Classify one reply. Throws on API/validation failure so the worker can leave
// the reply unhandled (classification null) and retry on the next tick rather
// than record a wrong label.
export async function classifyReply(
  body: string,
  opts: ClassifyOptions = {},
): Promise<ReplyClassification> {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
  const model =
    opts.model ?? process.env.ANTHROPIC_CLASSIFY_MODEL ?? DEFAULT_MODEL;

  const client = new Anthropic({ apiKey });
  const trimmed = trimReplyBody(body);
  const userContent = [
    opts.subject ? `Subject: ${opts.subject}` : null,
    "Reply body:",
    trimmed || "(empty)",
  ]
    .filter(Boolean)
    .join("\n");

  const response = await client.messages.parse({
    model,
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
    output_config: { format: zodOutputFormat(ClassificationSchema) },
  });

  const parsed = response.parsed_output;
  if (!parsed) {
    throw new Error("Reply classification returned no structured output.");
  }
  return parsed;
}
