// Pure placement classifier — maps a Gmail message's labels to where it landed.
// Kept free of any Gmail/network dependency so it is unit-testable; the action
// fetches the seed message and hands its labelIds here.
//
// Gmail label semantics:
//   - a message in the SPAM folder carries the SPAM label
//   - the Promotions tab carries CATEGORY_PROMOTIONS (with INBOX)
//   - the primary inbox carries INBOX (often + CATEGORY_PERSONAL/UPDATES)
//   - not found at all => it was filtered out entirely or hasn't arrived yet
// Spam is checked first (worst outcome dominates), then promotions, then inbox.

export type Placement = "inbox" | "promotions" | "spam" | "missing";

export function classifyPlacement(labelIds: string[] | null | undefined): Placement {
  if (!labelIds || labelIds.length === 0) return "missing";
  const set = new Set(labelIds);
  if (set.has("SPAM") || set.has("TRASH")) return "spam";
  if (set.has("CATEGORY_PROMOTIONS")) return "promotions";
  if (set.has("INBOX")) return "inbox";
  // Delivered but not in a visible location we recognize (e.g. archived by a
  // filter) — treat as missing from the primary inbox.
  return "missing";
}

export interface PlacementSummary {
  seed_count: number;
  inbox_count: number;
  promotions_count: number;
  spam_count: number;
  missing_count: number;
}

export function summarize(
  results: { placement: Placement }[],
): PlacementSummary {
  return {
    seed_count: results.length,
    inbox_count: results.filter((r) => r.placement === "inbox").length,
    promotions_count: results.filter((r) => r.placement === "promotions").length,
    spam_count: results.filter((r) => r.placement === "spam").length,
    missing_count: results.filter((r) => r.placement === "missing").length,
  };
}
