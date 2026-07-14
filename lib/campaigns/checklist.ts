// Launch checklist gate (Section 5.2). A campaign cannot launch unless every
// required item is green. Pure computation over data the caller assembles, so
// it is unit-testable and the same result drives both the UI panel and the
// launch action's hard gate.

export interface ChecklistInput {
  hasPhysicalAddress: boolean;
  stepCount: number;
  firstStepComplete: boolean; // step 1 has subject + a body
  hasSendDays: boolean; // at least one weekday selected
  listSelected: boolean;
  verifiedLeadCount: number;
  unverifiedLeadCount: number;
  inboxCount: number; // inboxes selected on the campaign
  allInboxesConnected: boolean;
  activeInboxCount: number;
  allInboxesRamping: boolean; // warmup_started_at set on each
  domainsDnsVerified: boolean; // spf+dkim+dmarc verified on each domain
  oldestDomainAgeDays: number | null; // min age across selected domains
  minDomainAgeDays: number; // required, default 14
}

export interface ChecklistItem {
  key: string;
  label: string;
  ok: boolean;
  required: boolean;
  detail?: string;
}

export function computeChecklist(input: ChecklistInput): ChecklistItem[] {
  const items: ChecklistItem[] = [];

  items.push({
    key: "steps",
    label: "Sequence has at least one complete step",
    ok: input.stepCount > 0 && input.firstStepComplete,
    required: true,
    detail:
      input.stepCount === 0
        ? "Add a step with a subject and body."
        : input.firstStepComplete
          ? undefined
          : "The first step needs a subject and a body.",
  });

  items.push({
    key: "list",
    label: "A list with verified leads is selected",
    ok: input.listSelected && input.verifiedLeadCount > 0,
    required: true,
    detail: !input.listSelected
      ? "Select a lead list."
      : input.verifiedLeadCount === 0
        ? "No verified leads in this list — verification marks who is safe to email."
        : input.unverifiedLeadCount > 0
          ? `${input.verifiedLeadCount} verified · ${input.unverifiedLeadCount} unverified will be skipped.`
          : `${input.verifiedLeadCount} verified leads.`,
  });

  items.push({
    key: "inboxes",
    label: "Inboxes are connected and active",
    ok:
      input.inboxCount > 0 &&
      input.allInboxesConnected &&
      input.activeInboxCount > 0,
    required: true,
    detail:
      input.inboxCount === 0
        ? "Select at least one inbox."
        : !input.allInboxesConnected
          ? "Every selected inbox must be connected to Google."
          : input.activeInboxCount === 0
            ? "Activate at least one selected inbox."
            : undefined,
  });

  items.push({
    key: "ramp",
    label: "Ramp is active on all inboxes",
    ok: input.inboxCount > 0 && input.allInboxesRamping,
    required: true,
    detail: input.allInboxesRamping
      ? undefined
      : "Start warmup on each inbox so the ramp schedule governs volume.",
  });

  items.push({
    key: "dns",
    label: "DNS (SPF, DKIM, DMARC) verified on sending domains",
    ok: input.inboxCount > 0 && input.domainsDnsVerified,
    required: true,
    detail: input.domainsDnsVerified
      ? undefined
      : "Verify SPF/DKIM/DMARC for every sending domain (docs/DNS-SETUP.md).",
  });

  const ageOk =
    input.oldestDomainAgeDays !== null &&
    input.oldestDomainAgeDays >= input.minDomainAgeDays;
  items.push({
    key: "domain_age",
    label: `Sending domains aged ≥ ${input.minDomainAgeDays} days`,
    ok: input.inboxCount > 0 && ageOk,
    required: true,
    detail: ageOk
      ? undefined
      : input.oldestDomainAgeDays === null
        ? "No sending domain found for the selected inboxes."
        : `Youngest domain is ${input.oldestDomainAgeDays} day(s) old. Let it age to ${input.minDomainAgeDays}.`,
  });

  items.push({
    key: "send_days",
    label: "At least one send day is selected",
    ok: input.hasSendDays,
    required: true,
    detail: input.hasSendDays
      ? undefined
      : "Pick the weekdays to send on (Settings) — with none selected the campaign can never deliver.",
  });

  items.push({
    key: "physical_address",
    label: "Workspace has a physical mailing address",
    ok: input.hasPhysicalAddress,
    required: true,
    detail: input.hasPhysicalAddress
      ? undefined
      : "Required in every footer (CAN-SPAM). Set it in the workspace.",
  });

  // Unsubscribe is injected into every send automatically — informational.
  items.push({
    key: "unsubscribe",
    label: "One-click unsubscribe on every send",
    ok: true,
    required: false,
    detail: "Added automatically (footer + List-Unsubscribe).",
  });

  return items;
}

export function checklistPasses(items: ChecklistItem[]): boolean {
  return items.every((i) => !i.required || i.ok);
}
