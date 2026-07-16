"use client";

import { useRouter } from "next/navigation";
import { useTransition, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  deleteLinkedinAccount,
  setLinkedinCaps,
  startLinkedinConnect,
} from "@/lib/linkedin/actions";
import type { LinkedinAccountView } from "@/lib/linkedin/data";

function StatusBadge({ status }: { status: string }) {
  let className =
    "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium";

  if (status === "connected") {
    className +=
      " bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
  } else if (status === "pending") {
    className +=
      " bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
  } else {
    // error, disconnected, or other
    className +=
      " bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300";
  }

  return (
    <span className={className}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function ConnectDialog({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [displayName, setDisplayName] = useState("");
  const [open, setOpen] = useState(false);

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

  const handleConnect = async () => {
    const result = await startLinkedinConnect(displayName);
    window.open(result.url, "_blank");
    toast.success("Opening LinkedIn connect…");
    setOpen(false);
    setDisplayName("");
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={disabled}>Connect LinkedIn account</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect LinkedIn account</DialogTitle>
          <DialogDescription>
            Enter a display name to identify this account in your workspace.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="display-name">Display name</Label>
            <Input
              id="display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g., Primary LinkedIn"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() =>
                run(
                  handleConnect,
                  "Connecting LinkedIn account…",
                )
              }
              disabled={isPending || !displayName.trim()}
            >
              Get connect link
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CapsEditor({
  accountId,
  inviteCap,
  messageCap,
}: {
  accountId: string;
  inviteCap: number;
  messageCap: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [inviteValue, setInviteValue] = useState(String(inviteCap));
  const [messageValue, setMessageValue] = useState(String(messageCap));
  const [isEditing, setIsEditing] = useState(false);

  const run = (fn: () => Promise<void>, successMsg: string) => {
    startTransition(async () => {
      try {
        await fn();
        toast.success(successMsg);
        router.refresh();
        setIsEditing(false);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Action failed");
      }
    });
  };

  const handleSave = async () => {
    const invite = parseInt(inviteValue, 10);
    const message = parseInt(messageValue, 10);

    if (!Number.isFinite(invite) || !Number.isFinite(message)) {
      toast.error("Please enter valid numbers");
      return;
    }

    await setLinkedinCaps(accountId, invite, message);
  };

  if (!isEditing) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm">
          {inviteCap} / day · {messageCap} / day
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsEditing(true)}
          disabled={isPending}
        >
          Edit
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        min="0"
        max="100"
        value={inviteValue}
        onChange={(e) => setInviteValue(e.target.value)}
        className="w-16 h-8"
        disabled={isPending}
      />
      <span className="text-xs text-muted-foreground">/</span>
      <Input
        type="number"
        min="0"
        max="200"
        value={messageValue}
        onChange={(e) => setMessageValue(e.target.value)}
        className="w-16 h-8"
        disabled={isPending}
      />
      <Button
        variant="ghost"
        size="sm"
        onClick={() =>
          run(
            handleSave,
            "Caps updated",
          )
        }
        disabled={isPending}
      >
        Save
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setInviteValue(String(inviteCap));
          setMessageValue(String(messageCap));
          setIsEditing(false);
        }}
        disabled={isPending}
      >
        Cancel
      </Button>
    </div>
  );
}

export function LinkedinAccounts({
  accounts,
  configured,
}: {
  accounts: LinkedinAccountView[];
  configured: boolean;
}) {
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

  const formatLastActivity = (inviteAt: string | null, messageAt: string | null): string => {
    if (!inviteAt && !messageAt) return "—";
    const dates = [inviteAt, messageAt].filter(Boolean);
    const latest = dates.sort().reverse()[0];
    if (!latest) return "—";
    return new Date(latest).toLocaleDateString();
  };

  return (
    <div className="flex flex-col gap-3">
      <ConnectDialog disabled={!configured} />

      {accounts.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          No LinkedIn accounts connected yet.
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Caps</TableHead>
                <TableHead>Last activity</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((account) => (
                <TableRow key={account.id}>
                  <TableCell>
                    <div className="font-medium">
                      {account.name || "Unnamed account"}
                    </div>
                    {account.last_error && (
                      <div className="text-xs text-red-600 dark:text-red-400">
                        {account.last_error}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={account.status} />
                  </TableCell>
                  <TableCell>
                    {account.status === "connected" ? (
                      <CapsEditor
                        accountId={account.id}
                        inviteCap={account.daily_invite_cap}
                        messageCap={account.daily_message_cap}
                      />
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        {account.daily_invite_cap} / day · {account.daily_message_cap} / day
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatLastActivity(account.last_invite_at, account.last_message_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={isPending}
                      onClick={() =>
                        run(
                          () => deleteLinkedinAccount(account.id),
                          "Account removed",
                        )
                      }
                    >
                      Remove
                    </Button>
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
