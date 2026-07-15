"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { PlacementTestView, SeedInboxView, SenderInboxOption } from "@/lib/placement/data";
import {
  runPlacementTest,
  checkPlacementTest,
  setInboxSeed,
} from "@/lib/placement/actions";

interface PlacementPillProps {
  label: string;
  count: number;
  variant: "inbox" | "promotions" | "spam" | "missing";
}

function PlacementPill({ label, count, variant }: PlacementPillProps) {
  let className =
    "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium mr-2";

  if (variant === "inbox") {
    className +=
      " bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
  } else if (variant === "promotions") {
    className +=
      " bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
  } else if (variant === "spam") {
    className += " bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300";
  } else if (variant === "missing") {
    className +=
      " bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
  }

  return (
    <span className={className}>
      {label} {count}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  let className =
    "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium";

  if (status === "sent") {
    className +=
      " bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300";
  } else if (status === "complete") {
    className +=
      " bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
  }

  return (
    <span className={className}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export function PlacementView({
  seeds,
  senders,
  tests,
}: {
  seeds: SeedInboxView[];
  senders: SenderInboxOption[];
  tests: PlacementTestView[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedSenderId, setSelectedSenderId] = useState<string>("");
  const [selectedPromoteId, setSelectedPromoteId] = useState<string>("");

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
    <div className="flex flex-col gap-4">
      {/* Seed inboxes section */}
      <Card>
        <CardHeader>
          <CardTitle>Seed inboxes</CardTitle>
          <CardDescription>Mailboxes that receive test emails to check placement.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {seeds.length === 0 ? (
            <Alert>
              <AlertDescription className="text-sm text-muted-foreground">
                No seed inboxes yet. Connect a Gmail mailbox and add it as a seed to test
                placement.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {seeds.map((seed) => (
                    <TableRow key={seed.id}>
                      <TableCell>
                        <div className="font-medium">{seed.email}</div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Badge variant="secondary">Seed</Badge>
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={isPending}
                            onClick={() =>
                              run(
                                () => setInboxSeed(seed.id, false),
                                `Removed ${seed.email} as seed`,
                              )
                            }
                          >
                            Remove as seed
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {senders.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="text-sm font-medium">Add another seed inbox</div>
              <div className="flex gap-2">
                <Select value={selectedPromoteId} onValueChange={setSelectedPromoteId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select an inbox to promote" />
                  </SelectTrigger>
                  <SelectContent>
                    {senders.map((sender) => (
                      <SelectItem key={sender.id} value={sender.id}>
                        {sender.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  disabled={!selectedPromoteId || isPending}
                  onClick={() => {
                    const sender = senders.find((s) => s.id === selectedPromoteId);
                    if (sender) {
                      run(
                        () => setInboxSeed(selectedPromoteId, true),
                        `Added ${sender.email} as seed`,
                      );
                      setSelectedPromoteId("");
                    }
                  }}
                >
                  Use as seed
                </Button>
              </div>
            </div>
          )}

          <div className="pt-2 border-t">
            <Button asChild variant="outline">
              <a href="/api/oauth/google/start">Connect another inbox</a>
            </Button>
            <div className="text-xs text-muted-foreground mt-2">
              Connect a Gmail mailbox, then add it as a seed here.
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Run a test section */}
      <Card>
        <CardHeader>
          <CardTitle>Run a placement test</CardTitle>
          <CardDescription>Send a test email from one of your sending inboxes.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {seeds.length === 0 ? (
            <Alert>
              <AlertDescription className="text-sm text-muted-foreground">
                Add a seed inbox first.
              </AlertDescription>
            </Alert>
          ) : senders.length === 0 ? (
            <Alert>
              <AlertDescription className="text-sm text-muted-foreground">
                Connect a sending inbox to run a test.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="flex gap-2">
              <Select value={selectedSenderId} onValueChange={setSelectedSenderId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a sending inbox" />
                </SelectTrigger>
                <SelectContent>
                  {senders.map((sender) => (
                    <SelectItem key={sender.id} value={sender.id}>
                      {sender.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                disabled={!selectedSenderId || isPending}
                onClick={() => {
                  run(
                    async () => {
                      await runPlacementTest(selectedSenderId);
                    },
                    "Placement test sent — check results in a minute",
                  );
                }}
              >
                Run placement test
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent tests section */}
      <Card>
        <CardHeader>
          <CardTitle>Recent tests</CardTitle>
          <CardDescription>Your recent placement test runs and results.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {tests.length === 0 ? (
            <Alert>
              <AlertDescription className="text-sm text-muted-foreground">
                No tests run yet.
              </AlertDescription>
            </Alert>
          ) : (
            tests.map((test) => (
              <Card key={test.id} className="border">
                <CardContent className="pt-4">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-medium text-sm">
                          {test.inbox_email || "Unknown sender"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(test.sent_at).toLocaleString()}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={test.status} />
                        {test.status === "complete" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isPending}
                            onClick={() => {
                              run(
                                () => checkPlacementTest(test.id),
                                "Placement check updated",
                              );
                            }}
                          >
                            Check again
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isPending}
                            onClick={() => {
                              run(
                                () => checkPlacementTest(test.id),
                                "Placement check updated",
                              );
                            }}
                          >
                            Check results
                          </Button>
                        )}
                      </div>
                    </div>

                    {test.status === "complete" && (
                      <div className="flex flex-col gap-2">
                        <div className="text-sm">
                          <PlacementPill
                            label="Inbox"
                            count={test.inbox_count}
                            variant="inbox"
                          />
                          <PlacementPill
                            label="Promotions"
                            count={test.promotions_count}
                            variant="promotions"
                          />
                          <PlacementPill
                            label="Spam"
                            count={test.spam_count}
                            variant="spam"
                          />
                          <PlacementPill
                            label="Missing"
                            count={test.missing_count}
                            variant="missing"
                          />
                        </div>

                        {test.results.length > 0 && (
                          <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                            {test.results.map((result) => (
                              <div key={result.seed_email}>
                                <span className="font-mono">{result.seed_email}:</span>{" "}
                                <span className="capitalize">{result.placement}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
