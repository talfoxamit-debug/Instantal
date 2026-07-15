"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  resetRampConfig,
  updateRampConfig,
} from "@/lib/inboxes/actions";
import {
  DEFAULT_RAMP_CONFIG,
  validateRampConfig,
  type RampConfig,
} from "@/lib/sending/ramp";

// Editor for the 3-tier ramp curve (Section 9.2 default: day 10 -> 10/day,
// day 17 -> 15/day, day 24 -> 30/day, day 31 -> the inbox's own daily_cap).
// Only the day thresholds and the three intermediate caps are editable — the
// final step always resolves to whatever daily_cap is set to elsewhere, so
// raising the cap later never requires touching the schedule.
export function RampScheduleDialog({
  inboxId,
  email,
  dailyCap,
  config,
}: {
  inboxId: string;
  email: string;
  dailyCap: number;
  config: RampConfig | null;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<RampConfig>(config ?? DEFAULT_RAMP_CONFIG);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const field = (key: keyof RampConfig, label: string) => (
    <div className="grid gap-1.5">
      <Label htmlFor={key} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={key}
        type="number"
        min={0}
        value={form[key]}
        onChange={(e) =>
          setForm((f) => ({ ...f, [key]: Number(e.target.value) }))
        }
        disabled={isPending}
      />
    </div>
  );

  const save = () => {
    const error = validateRampConfig(form);
    if (error) {
      toast.error(error);
      return;
    }
    startTransition(async () => {
      try {
        await updateRampConfig(inboxId, form);
        toast.success(`Ramp schedule updated for ${email}`);
        setOpen(false);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to save.");
      }
    });
  };

  const resetToDefault = () => {
    startTransition(async () => {
      try {
        await resetRampConfig(inboxId);
        toast.success(`Reverted ${email} to the default ramp schedule`);
        setForm(DEFAULT_RAMP_CONFIG);
        setOpen(false);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to reset.");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Ramp schedule{config ? " (custom)" : ""}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ramp schedule — {email}</DialogTitle>
          <DialogDescription>
            How fast volume ramps after warmup starts. Caps below are clamped
            to this inbox&apos;s daily cap ({dailyCap}/day, set in the row
            above). After the last day, sends are limited only by the daily
            cap — raising it later doesn&apos;t require editing this schedule.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            {field("tier1Day", "Tier 1 — day")}
            {field("tier1Cap", "Tier 1 — cap/day")}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {field("tier2Day", "Tier 2 — day")}
            {field("tier2Cap", "Tier 2 — cap/day")}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {field("tier3Day", "Tier 3 — day")}
            {field("tier3Cap", "Tier 3 — cap/day")}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="fullCapDay" className="text-xs text-muted-foreground">
              Full daily cap applies from day
            </Label>
            <Input
              id="fullCapDay"
              type="number"
              min={0}
              value={form.fullCapDay}
              onChange={(e) =>
                setForm((f) => ({ ...f, fullCapDay: Number(e.target.value) }))
              }
              disabled={isPending}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={resetToDefault}
            disabled={isPending || !config}
          >
            Reset to default
          </Button>
          <Button type="button" onClick={save} disabled={isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
