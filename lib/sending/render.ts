// Pure template rendering for outbound mail: merge tags, spintax, and the
// compliance footer. No I/O so it is unit-testable; the worker supplies the
// lead data, the unsubscribe URL, and the workspace's physical address.

export interface LeadMergeData {
  first_name?: string | null;
  last_name?: string | null;
  company?: string | null;
  title?: string | null;
  email?: string | null;
  custom?: Record<string, unknown> | null;
}

// {{ field }} or {{ field | fallback }}; supports custom.<key>. Unknown/empty
// values use the fallback (or "" if none). Runs BEFORE spintax so merged
// values are never reinterpreted as spintax.
export function applyMergeTags(
  template: string,
  data: LeadMergeData,
): string {
  return template.replace(
    /\{\{\s*([\w.]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g,
    (_match, field: string, fallback: string | undefined) => {
      const value = resolveField(field, data);
      const resolved = value != null && String(value).trim() !== "" ? String(value) : undefined;
      return resolved ?? (fallback ?? "");
    },
  );
}

function resolveField(field: string, data: LeadMergeData): unknown {
  if (field.startsWith("custom.")) {
    const key = field.slice("custom.".length);
    return data.custom?.[key];
  }
  switch (field) {
    case "first_name":
      return data.first_name;
    case "last_name":
      return data.last_name;
    case "company":
      return data.company;
    case "title":
      return data.title;
    case "email":
      return data.email;
    default:
      return undefined;
  }
}

// {a|b|c} -> one option. Requires a pipe so stray single braces (or leftover
// {{merge}} artifacts) are left untouched. `pick(n)` chooses an index in
// [0,n); inject a seeded picker for determinism, default is uniform random.
export function applySpintax(
  template: string,
  pick: (n: number) => number = (n) => Math.floor(Math.random() * n),
): string {
  // Resolve innermost groups first so nesting works.
  const groupRe = /\{([^{}]*\|[^{}]*)\}/;
  let out = template;
  let guard = 0;
  while (groupRe.test(out) && guard < 1000) {
    out = out.replace(groupRe, (_m, body: string) => {
      const options = body.split("|");
      return options[pick(options.length)] ?? options[0];
    });
    guard++;
  }
  return out;
}

export function renderTemplate(
  template: string,
  data: LeadMergeData,
  pick?: (n: number) => number,
): string {
  return applySpintax(applyMergeTags(template, data), pick);
}

export interface FooterInput {
  unsubscribeUrl: string;
  physicalAddress?: string | null;
  trackingPixelUrl?: string | null;
}

// CAN-SPAM footer: a working unsubscribe link + the workspace's physical
// mailing address (Section 6). Appended to every send. Returns text and html
// variants; the html one also carries the open-tracking pixel when enabled.
export function buildFooter(input: FooterInput): { text: string; html: string } {
  const addr = input.physicalAddress?.trim();
  const textLines = ["", "---", `Unsubscribe: ${input.unsubscribeUrl}`];
  if (addr) textLines.push(addr);

  const htmlParts = [
    '<div style="margin-top:24px;padding-top:12px;border-top:1px solid #eee;color:#888;font-size:12px">',
    `<a href="${input.unsubscribeUrl}" style="color:#888">Unsubscribe</a>`,
    addr ? `<div>${escapeHtml(addr)}</div>` : "",
    "</div>",
  ];
  if (input.trackingPixelUrl) {
    htmlParts.push(
      `<img src="${input.trackingPixelUrl}" width="1" height="1" alt="" style="display:none" />`,
    );
  }
  return { text: textLines.join("\n"), html: htmlParts.join("") };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Deterministic picker seeded by a string (lead id + step), so re-renders of
// the same message pick the same spintax variants.
export function seededPicker(seed: string): (n: number) => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (n: number) => {
    // xorshift step, then map to [0,n)
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return Math.abs(h) % Math.max(1, n);
  };
}
