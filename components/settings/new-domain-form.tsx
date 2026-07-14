"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSendingDomain } from "@/lib/inboxes/actions";

export function NewDomainForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          try {
            await createSendingDomain(formData);
            toast.success("Domain added");
            router.refresh();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not add domain");
          }
        })
      }
      className="grid gap-4"
    >
      <div className="grid gap-2">
        <Label htmlFor="domain">Domain</Label>
        <Input
          id="domain"
          name="domain"
          placeholder="getfoxstays.com"
          required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="tracking_domain">
          Tracking domain
          <span className="text-muted-foreground"> (optional)</span>
        </Label>
        <Input
          id="tracking_domain"
          name="tracking_domain"
          placeholder="t.getfoxstays.com"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={isPending}>
          Add domain
        </Button>
      </div>
    </form>
  );
}
