"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Check, X } from "lucide-react";
import { toast } from "sonner";

import type { ChecklistItem } from "@/lib/campaigns/checklist";
import {
  duplicateCampaign,
  launchCampaign,
  setCampaignStatus,
} from "@/lib/campaigns/actions";
import { Button } from "@/components/ui/button";

export function LaunchPanel({
  campaignId,
  status,
  items,
  passes,
  eligibleLeadCount,
}: {
  campaignId: string;
  status: string;
  items: ChecklistItem[];
  passes: boolean;
  eligibleLeadCount: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const run = (fn: () => Promise<void>, msg: string) =>
    startTransition(async () => {
      try {
        await fn();
        toast.success(msg);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Action failed");
      }
    });

  const isActive = status === "active";

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.key} className="flex items-start gap-2 text-sm">
            <span
              className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full ${
                item.ok
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                  : "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
              }`}
            >
              {item.ok ? <Check className="size-3" /> : <X className="size-3" />}
            </span>
            <div className="flex flex-col">
              <span className={item.ok ? "" : "font-medium"}>
                {item.label}
                {!item.required ? (
                  <span className="text-muted-foreground"> (auto)</span>
                ) : null}
              </span>
              {item.detail ? (
                <span className="text-xs text-muted-foreground">
                  {item.detail}
                </span>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        {isActive ? (
          <Button
            variant="outline"
            disabled={isPending}
            onClick={() =>
              run(
                () => setCampaignStatus(campaignId, "paused"),
                "Campaign paused",
              )
            }
          >
            Pause campaign
          </Button>
        ) : (
          <Button
            disabled={isPending || !passes}
            onClick={() =>
              run(
                () => launchCampaign(campaignId),
                `Launched — ${eligibleLeadCount} leads queued`,
              )
            }
          >
            {status === "paused" ? "Resume / launch" : "Launch campaign"}
          </Button>
        )}
        <Button
          variant="ghost"
          disabled={isPending}
          onClick={() =>
            run(() => duplicateCampaign(campaignId), "Duplicated")
          }
        >
          Duplicate
        </Button>
        {!passes && !isActive ? (
          <span className="text-xs text-muted-foreground">
            Resolve the red items above to launch.
          </span>
        ) : null}
      </div>
    </div>
  );
}
