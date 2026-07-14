"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { setLeadStage, setReplyHandled, sendReply } from "@/lib/replies/actions";
import { PIPELINE_STAGES, type InboxCounts, type InboxReply } from "@/lib/replies/types";

interface InboxViewProps {
  replies: InboxReply[];
  counts: InboxCounts;
  activeFilter: string;
  page: number;
  totalPages: number;
}

export function InboxView({
  replies,
  counts,
  activeFilter,
  page,
  totalPages,
}: InboxViewProps) {
  // Build filter links preserving the current filter
  const buildFilterLink = (filter: string) => {
    const q = new URLSearchParams();
    if (filter !== "all") q.set("filter", filter);
    return `/inbox?${q.toString()}`;
  };

  // Build pagination links preserving the current filter
  const buildPageLink = (p: number) => {
    const q = new URLSearchParams();
    if (activeFilter !== "all") q.set("filter", activeFilter);
    if (p > 0) q.set("page", String(p));
    return `/inbox?${q.toString()}`;
  };

  const classificationFilters: Array<{ label: string; value: string; count: number }> = [
    { label: "Interested", value: "interested", count: counts.byClassification["interested"] ?? 0 },
    { label: "Not interested", value: "not_interested", count: counts.byClassification["not_interested"] ?? 0 },
    { label: "OOO", value: "ooo", count: counts.byClassification["ooo"] ?? 0 },
    { label: "Referral", value: "referral", count: counts.byClassification["referral"] ?? 0 },
    { label: "Unsubscribe request", value: "unsubscribe_request", count: counts.byClassification["unsubscribe_request"] ?? 0 },
    { label: "Bounce", value: "bounce", count: counts.byClassification["bounce"] ?? 0 },
    { label: "Other", value: "other", count: counts.byClassification["other"] ?? 0 },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
        <Button
          asChild
          variant={activeFilter === "all" ? "default" : "outline"}
          size="sm"
        >
          <Link href={buildFilterLink("all")}>All</Link>
        </Button>

        <Button
          asChild
          variant={activeFilter === "unhandled" ? "default" : "outline"}
          size="sm"
        >
          <Link href={buildFilterLink("unhandled")}>
            Unhandled ({counts.unhandled})
          </Link>
        </Button>

        {classificationFilters.map(({ label, value, count }) =>
          count > 0 ? (
            <Button
              key={value}
              asChild
              variant={activeFilter === value ? "default" : "outline"}
              size="sm"
            >
              <Link href={buildFilterLink(value)}>
                {label} ({count})
              </Link>
            </Button>
          ) : null,
        )}
      </div>

      {/* Replies list */}
      {replies.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          No replies yet. Replies from prospects will appear here once the reply-worker polls your inboxes.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {replies.map((reply) => (
            <ReplyCard
              key={reply.id}
              reply={reply}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 ? (
        <div className="flex items-center justify-between">
          <Button
            asChild
            variant="outline"
            size="sm"
            disabled={page <= 0}
            aria-disabled={page <= 0}
          >
            <Link href={buildPageLink(Math.max(0, page - 1))}>Previous</Link>
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page + 1} of {totalPages}
          </span>
          <Button
            asChild
            variant="outline"
            size="sm"
            disabled={page >= totalPages - 1}
            aria-disabled={page >= totalPages - 1}
          >
            <Link href={buildPageLink(Math.min(totalPages - 1, page + 1))}>Next</Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ReplyCard({
  reply,
}: {
  reply: InboxReply;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [replyText, setReplyText] = useState("");
  const [isReplyDialogOpen, setIsReplyDialogOpen] = useState(false);

  const run = (fn: () => Promise<void>, successMsg: string) => {
    startTransition(async () => {
      try {
        await fn();
        toast.success(successMsg);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Action failed");
      }
    });
  };

  const classificationBgColor = (classification: string | null): string => {
    switch (classification) {
      case "interested":
        return "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300";
      case "not_interested":
      case "unsubscribe_request":
        return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300";
      case "ooo":
        return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-900/40 dark:text-gray-300";
    }
  };

  const truncateText = (text: string | null, maxLength: number = 240): string => {
    if (!text) return "";
    return text.length > maxLength ? text.substring(0, maxLength) + "…" : text;
  };

  return (
    <Card className="p-4">
      <div className="flex flex-col gap-3">
        {/* Header: name/email, company, classification badge, confidence */}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-medium">
              {reply.lead_name || reply.lead_email || "Unknown"}
            </p>
            {reply.lead_company && (
              <p className="text-sm text-muted-foreground">{reply.lead_company}</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {reply.classification && (
              <Badge className={classificationBgColor(reply.classification)}>
                {reply.classification.replace(/_/g, " ")}
              </Badge>
            )}

            {reply.confidence !== null && (
              <Badge variant="outline">
                {Math.round(reply.confidence * 100)}%
              </Badge>
            )}
          </div>
        </div>

        {/* Metadata: received_at, handled status */}
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{new Date(reply.received_at).toLocaleString()}</span>
          {reply.handled && (
            <Badge variant="outline" className="bg-green-100/40 text-green-700 dark:bg-green-900/20 dark:text-green-400">
              Handled
            </Badge>
          )}
        </div>

        {/* Body text preview */}
        {reply.body_text && (
          <p className="text-sm text-muted-foreground">{truncateText(reply.body_text, 240)}</p>
        )}

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <Dialog open={isReplyDialogOpen} onOpenChange={setIsReplyDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={isPending}>
                Reply
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Reply to {reply.lead_name || reply.lead_email}</DialogTitle>
              </DialogHeader>
              <Textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Type your reply…"
                rows={6}
              />
              <DialogFooter>
                <Button
                  onClick={() => {
                    run(
                      () => sendReply(reply.id, replyText),
                      "Reply sent",
                    );
                    setReplyText("");
                    setIsReplyDialogOpen(false);
                  }}
                  disabled={isPending || !replyText.trim()}
                >
                  Send
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() =>
              run(
                () => setReplyHandled(reply.id, !reply.handled),
                reply.handled ? "Reopened" : "Marked as handled",
              )
            }
          >
            {reply.handled ? "Reopen" : "Mark done"}
          </Button>

          {reply.lead_id && (
            <Select
              value={reply.lead_stage || "New"}
              disabled={isPending}
              onValueChange={(stage) =>
                run(() => setLeadStage(reply.lead_id!, stage), "Stage updated")
              }
            >
              <SelectTrigger size="sm" className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PIPELINE_STAGES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>
    </Card>
  );
}
