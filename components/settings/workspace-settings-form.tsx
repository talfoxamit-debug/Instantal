"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateWorkspaceSettings } from "@/lib/workspaces/actions";
import { TIMEZONES, VENTURES } from "@/lib/types";
import type { Workspace } from "@/lib/types";

export function WorkspaceSettingsForm({
  workspace,
  canEdit,
}: {
  workspace: Workspace;
  canEdit: boolean;
}) {
  return (
    <form action={updateWorkspaceSettings} className="grid gap-4">
      {!canEdit ? (
        <div className="text-sm text-muted-foreground">
          Only workspace owners can edit settings.
        </div>
      ) : null}

      {!workspace.physical_address ? (
        <Alert>
          <AlertDescription>
            A physical mailing address is required before any campaign can send
            (CAN-SPAM compliance).
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-2">
        <Label htmlFor="name">Workspace name</Label>
        <Input
          id="name"
          name="name"
          defaultValue={workspace.name}
          required
          disabled={!canEdit}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="venture">Venture</Label>
        <Select
          name="venture"
          defaultValue={workspace.venture}
          required
          disabled={!canEdit}
        >
          <SelectTrigger id="venture" className="w-full">
            <SelectValue placeholder="Select a venture" />
          </SelectTrigger>
          <SelectContent>
            {VENTURES.map((venture) => (
              <SelectItem key={venture} value={venture}>
                {venture}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="physical_address">
          Physical mailing address{" "}
          <span className="text-muted-foreground">(CAN-SPAM footer)</span>
        </Label>
        <Input
          id="physical_address"
          name="physical_address"
          defaultValue={workspace.physical_address ?? ""}
          placeholder="123 Main St, Suite 4, Miami, FL 33101"
          disabled={!canEdit}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="default_timezone">Default timezone</Label>
        <Select
          name="default_timezone"
          defaultValue={workspace.default_timezone}
          disabled={!canEdit}
        >
          <SelectTrigger id="default_timezone" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIMEZONES.map((timezone) => (
              <SelectItem key={timezone} value={timezone}>
                {timezone}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Button type="submit" disabled={!canEdit}>
        Save changes
      </Button>
    </form>
  );
}
