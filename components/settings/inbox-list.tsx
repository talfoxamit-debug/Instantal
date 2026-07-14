"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  activateInbox,
  pauseInbox,
  startWarmup,
  deleteInbox,
} from "@/lib/inboxes/actions";
import type { InboxView } from "@/lib/inboxes/data";

function StatusBadge({ status }: { status: string }) {
  let className =
    "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium";

  if (status === "active") {
    className +=
      " bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
  } else if (status === "paused") {
    className +=
      " bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
  } else if (status === "burned") {
    className +=
      " bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300";
  }

  return (
    <span className={className}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export function InboxList({ inboxes }: { inboxes: InboxView[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

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

  return (
    <div className="flex flex-col gap-3">
      <Button asChild className="w-fit">
        <a href="/api/oauth/google/start">Connect an inbox</a>
      </Button>

      {inboxes.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          No inboxes connected yet. Connect a Google inbox to start sending.
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Domain</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Ramp / cap</TableHead>
                <TableHead>Sent today</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inboxes.map((inbox) => (
                <TableRow key={inbox.id}>
                  <TableCell>
                    <div className="font-medium">{inbox.email}</div>
                    {inbox.display_name && (
                      <div className="text-xs text-muted-foreground">
                        {inbox.display_name}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {inbox.domain || "—"}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={inbox.status} />
                  </TableCell>
                  <TableCell>
                    {inbox.ramp_cap} / {inbox.daily_cap}
                  </TableCell>
                  <TableCell>{inbox.sent_today}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {inbox.status !== "active" ? (
                        inbox.connected ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isPending}
                            onClick={() =>
                              run(
                                () => activateInbox(inbox.id),
                                `Activated ${inbox.email}`,
                              )
                            }
                          >
                            Activate
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            Not connected
                          </span>
                        )
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isPending}
                          onClick={() =>
                            run(
                              () => pauseInbox(inbox.id),
                              `Paused ${inbox.email}`,
                            )
                          }
                        >
                          Pause
                        </Button>
                      )}

                      {inbox.warmup_started_at === null ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isPending}
                          onClick={() =>
                            run(
                              () => startWarmup(inbox.id),
                              "Warmup started",
                            )
                          }
                        >
                          Start warmup
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Warming since{" "}
                          {new Date(inbox.warmup_started_at).toLocaleDateString()}
                        </span>
                      )}

                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={isPending}
                        onClick={() =>
                          run(
                            () => deleteInbox(inbox.id),
                            "Inbox removed",
                          )
                        }
                      >
                        Remove
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
