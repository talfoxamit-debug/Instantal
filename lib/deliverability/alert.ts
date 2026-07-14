// Ops alerting for deliverability events (Section 5.5 auto-pause "alert").
// Posts to a Slack-compatible incoming webhook when SLACK_ALERT_WEBHOOK_URL is
// set; otherwise it is a no-op (logs to the worker output). These are INTERNAL
// operator alerts — never cold outreach — so a webhook is fine and keeps us off
// Resend / revenue domains entirely.

export interface AlertResult {
  sent: boolean;
  reason?: string;
}

export async function sendOpsAlert(
  text: string,
  context?: Record<string, unknown>,
): Promise<AlertResult> {
  const url = process.env.SLACK_ALERT_WEBHOOK_URL;
  if (!url) {
    console.warn(`[ops-alert:no-webhook] ${text}`, context ?? "");
    return { sent: false, reason: "no_webhook" };
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      return { sent: false, reason: `webhook_${res.status}` };
    }
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: e instanceof Error ? e.message : "error" };
  }
}
