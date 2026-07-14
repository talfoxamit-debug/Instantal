import type { Metadata } from "next";

import { InboxView } from "@/components/inbox/inbox-view";
import { getInboxCounts, listReplies, type ReplyClassificationLabel } from "@/lib/replies/data";

export const metadata: Metadata = { title: "Inbox" };

const PAGE_SIZE = 50;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filterParam = first(sp.filter);
  const page = Math.max(0, Number(first(sp.page) ?? "0") || 0);

  // Map filter param to data layer filters
  const validClassifications: ReplyClassificationLabel[] = [
    "interested",
    "not_interested",
    "ooo",
    "referral",
    "unsubscribe_request",
    "bounce",
    "other",
  ];

  let filters = {};
  let activeFilter = "all";

  if (filterParam === "unhandled") {
    filters = { handled: false };
    activeFilter = "unhandled";
  } else if (filterParam && (validClassifications as string[]).includes(filterParam)) {
    filters = { classification: filterParam as ReplyClassificationLabel };
    activeFilter = filterParam;
  }

  const [{ replies, count }, counts] = await Promise.all([
    listReplies(filters, page),
    getInboxCounts(),
  ]);

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {counts.total.toLocaleString()} conversation{counts.total === 1 ? "" : "s"}
      </p>

      <InboxView
        replies={replies}
        counts={counts}
        activeFilter={activeFilter}
        page={page}
        totalPages={totalPages}
      />
    </div>
  );
}
