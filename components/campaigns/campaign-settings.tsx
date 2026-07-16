"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CampaignDetail } from "@/lib/campaigns/data";
import {
  updateCampaignSettings,
  type CampaignSettingsInput,
} from "@/lib/campaigns/actions";
import type { InboxView } from "@/lib/inboxes/data";
import type { LinkedinAccountView } from "@/lib/linkedin/data";
import { TIMEZONES, type LeadList } from "@/lib/types";

const DAYS_OF_WEEK = [
  { label: "Monday", value: 1 },
  { label: "Tuesday", value: 2 },
  { label: "Wednesday", value: 3 },
  { label: "Thursday", value: 4 },
  { label: "Friday", value: 5 },
  { label: "Saturday", value: 6 },
  { label: "Sunday", value: 7 },
];

export function CampaignSettings({
  campaign,
  lists,
  inboxes,
  linkedinAccounts,
}: {
  campaign: CampaignDetail;
  lists: LeadList[];
  inboxes: InboxView[];
  linkedinAccounts: LinkedinAccountView[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState(campaign.name);
  const [listId, setListId] = useState<string | null>(campaign.list_id ?? null);
  const [inboxIds, setInboxIds] = useState<string[]>(campaign.inbox_ids ?? []);
  const [linkedinAccountIds, setLinkedinAccountIds] = useState<string[]>(
    campaign.linkedin_account_ids ?? [],
  );
  const [sendWindowStart, setSendWindowStart] = useState(
    campaign.send_window_start.slice(0, 5)
  );
  const [sendWindowEnd, setSendWindowEnd] = useState(
    campaign.send_window_end.slice(0, 5)
  );
  const [sendDays, setSendDays] = useState<number[]>(campaign.send_days ?? []);
  const [timezoneMode, setTimezoneMode] = useState(
    campaign.timezone_mode ?? "lead"
  );
  const [fixedTimezone, setFixedTimezone] = useState(
    campaign.fixed_timezone ?? ""
  );
  const [trackOpens, setTrackOpens] = useState(campaign.track_opens);
  const [trackClicks, setTrackClicks] = useState(campaign.track_clicks);
  const [stopOnReply, setStopOnReply] = useState(campaign.stop_on_reply);
  const [dailyLimit, setDailyLimit] = useState(
    campaign.daily_limit?.toString() ?? ""
  );

  const toggleDay = (day: number) => {
    setSendDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const toggleInbox = (inboxId: string) => {
    setInboxIds((prev) =>
      prev.includes(inboxId)
        ? prev.filter((id) => id !== inboxId)
        : [...prev, inboxId]
    );
  };

  const toggleLinkedinAccount = (accountId: string) => {
    setLinkedinAccountIds((prev) =>
      prev.includes(accountId)
        ? prev.filter((id) => id !== accountId)
        : [...prev, accountId]
    );
  };

  const handleSubmit = () => {
    startTransition(async () => {
      try {
        const input: CampaignSettingsInput = {
          name: name.trim(),
          list_id: listId,
          inbox_ids: inboxIds,
          linkedin_account_ids: linkedinAccountIds,
          send_window_start: sendWindowStart + ":00",
          send_window_end: sendWindowEnd + ":00",
          send_days: sendDays,
          timezone_mode: timezoneMode as "lead" | "fixed",
          fixed_timezone:
            timezoneMode === "fixed" && fixedTimezone ? fixedTimezone : null,
          track_opens: trackOpens,
          track_clicks: trackClicks,
          stop_on_reply: stopOnReply,
          daily_limit: dailyLimit ? parseInt(dailyLimit, 10) : null,
        };
        await updateCampaignSettings(campaign.id, input);
        toast.success("Settings saved");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not save settings");
      }
    });
  };

  return (
    <div className="grid gap-6">
      {/* Name */}
      <div className="grid gap-2">
        <Label htmlFor="name">Campaign name</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      {/* List */}
      <div className="grid gap-2">
        <Label htmlFor="list">Lead list</Label>
        <Select value={listId ?? "__none__"} onValueChange={(v) => setListId(v === "__none__" ? null : v)}>
          <SelectTrigger id="list">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">No list</SelectItem>
            {lists.map((list) => (
              <SelectItem key={list.id} value={list.id}>
                {list.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Inboxes */}
      <div className="grid gap-3">
        <Label>Sending inboxes</Label>
        <div className="space-y-2">
          {inboxes.map((inbox) => (
            <div key={inbox.id} className="flex items-center space-x-2">
              <Checkbox
                id={`inbox-${inbox.id}`}
                checked={inboxIds.includes(inbox.id)}
                onCheckedChange={() => toggleInbox(inbox.id)}
              />
              <Label
                htmlFor={`inbox-${inbox.id}`}
                className="text-sm font-normal cursor-pointer"
              >
                {inbox.email}
                {inbox.status !== "active" && (
                  <span className="text-muted-foreground ml-2">
                    ({inbox.status})
                  </span>
                )}
              </Label>
            </div>
          ))}
        </div>
      </div>

      {/* LinkedIn accounts (only relevant when the sequence has a LinkedIn step) */}
      <div className="grid gap-3">
        <Label>LinkedIn accounts</Label>
        {linkedinAccounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No LinkedIn accounts connected. Connect one under Settings › LinkedIn
            to send LinkedIn steps.
          </p>
        ) : (
          <div className="space-y-2">
            {linkedinAccounts.map((account) => (
              <div key={account.id} className="flex items-center space-x-2">
                <Checkbox
                  id={`li-${account.id}`}
                  checked={linkedinAccountIds.includes(account.id)}
                  onCheckedChange={() => toggleLinkedinAccount(account.id)}
                />
                <Label
                  htmlFor={`li-${account.id}`}
                  className="text-sm font-normal cursor-pointer"
                >
                  {account.name ?? "Unnamed account"}
                  {account.status !== "connected" && (
                    <span className="text-muted-foreground ml-2">
                      ({account.status})
                    </span>
                  )}
                </Label>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Send Window */}
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="send-start">Send window start</Label>
          <Input
            id="send-start"
            type="time"
            value={sendWindowStart}
            onChange={(e) => setSendWindowStart(e.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="send-end">Send window end</Label>
          <Input
            id="send-end"
            type="time"
            value={sendWindowEnd}
            onChange={(e) => setSendWindowEnd(e.target.value)}
          />
        </div>
      </div>

      {/* Send Days */}
      <div className="grid gap-3">
        <Label>Send on these days</Label>
        <div className="grid grid-cols-2 gap-2">
          {DAYS_OF_WEEK.map((day) => (
            <div key={day.value} className="flex items-center space-x-2">
              <Checkbox
                id={`day-${day.value}`}
                checked={sendDays.includes(day.value)}
                onCheckedChange={() => toggleDay(day.value)}
              />
              <Label
                htmlFor={`day-${day.value}`}
                className="text-sm font-normal cursor-pointer"
              >
                {day.label}
              </Label>
            </div>
          ))}
        </div>
      </div>

      {/* Timezone Mode */}
      <div className="grid gap-2">
        <Label htmlFor="timezone-mode">Timezone mode</Label>
        <Select value={timezoneMode} onValueChange={setTimezoneMode}>
          <SelectTrigger id="timezone-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="lead">Use the workspace timezone</SelectItem>
            <SelectItem value="fixed">Use fixed timezone</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Fixed Timezone (conditional) */}
      {timezoneMode === "fixed" && (
        <div className="grid gap-2">
          <Label htmlFor="fixed-timezone">Timezone</Label>
          <Select value={fixedTimezone} onValueChange={setFixedTimezone}>
            <SelectTrigger id="fixed-timezone">
              <SelectValue placeholder="Select timezone" />
            </SelectTrigger>
            <SelectContent>
              {TIMEZONES.map((tz) => (
                <SelectItem key={tz} value={tz}>
                  {tz}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Tracking Toggles */}
      <div className="space-y-3 border-t pt-4">
        <div className="flex items-center space-x-2">
          <Checkbox
            id="track-opens"
            checked={trackOpens}
            onCheckedChange={(checked) => setTrackOpens(checked === true)}
          />
          <Label htmlFor="track-opens" className="text-sm font-normal cursor-pointer">
            Track opens
            <span className="text-muted-foreground ml-2">
              (off by default; slightly hurts placement)
            </span>
          </Label>
        </div>
        <div className="flex items-center space-x-2">
          <Checkbox
            id="track-clicks"
            checked={trackClicks}
            onCheckedChange={(checked) => setTrackClicks(checked === true)}
          />
          <Label htmlFor="track-clicks" className="text-sm font-normal cursor-pointer">
            Track clicks
          </Label>
        </div>
        <div className="flex items-center space-x-2">
          <Checkbox
            id="stop-on-reply"
            checked={stopOnReply}
            onCheckedChange={(checked) => setStopOnReply(checked === true)}
          />
          <Label htmlFor="stop-on-reply" className="text-sm font-normal cursor-pointer">
            Stop on reply
          </Label>
        </div>
      </div>

      {/* Daily Limit */}
      <div className="grid gap-2">
        <Label htmlFor="daily-limit">
          Daily limit
          <span className="text-muted-foreground"> (optional)</span>
        </Label>
        <Input
          id="daily-limit"
          type="number"
          min="0"
          value={dailyLimit}
          onChange={(e) => setDailyLimit(e.target.value)}
          placeholder="No limit"
        />
      </div>

      {/* Save Button */}
      <div className="flex justify-end gap-2 border-t pt-4">
        <Button disabled={isPending} onClick={handleSubmit}>
          Save settings
        </Button>
      </div>
    </div>
  );
}
