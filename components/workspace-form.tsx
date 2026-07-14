import { createWorkspace } from "@/lib/workspaces/actions";
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
import { TIMEZONES, VENTURES } from "@/lib/types";

// Shared by /onboarding (first workspace) and /workspaces/new (the rest).
// originPath tells the server action where to send validation errors.
export function WorkspaceForm({
  originPath,
  error,
}: {
  originPath: "/onboarding" | "/workspaces/new";
  error?: string;
}) {
  return (
    <form action={createWorkspace} className="grid gap-4">
      <input type="hidden" name="origin_path" value={originPath} />
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-2">
        <Label htmlFor="name">Workspace name</Label>
        <Input id="name" name="name" placeholder="FoxStays Outreach" required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="venture">Venture</Label>
        <Select name="venture" defaultValue={VENTURES[0]} required>
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
          placeholder="123 Main St, Suite 4, Miami, FL 33101"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="default_timezone">Default timezone</Label>
        <Select name="default_timezone" defaultValue={TIMEZONES[0]}>
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
      <Button type="submit" className="w-full">
        Create workspace
      </Button>
    </form>
  );
}
