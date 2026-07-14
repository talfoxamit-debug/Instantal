"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

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
import { addSuppression } from "@/lib/suppression/actions";

export function SuppressionAddForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [scope, setScope] = useState<"global" | "workspace">("global");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        // Capture the form node now: e.currentTarget is null by the time the
        // async callback resumes after await.
        const form = e.currentTarget;
        const formData = new FormData(form);
        formData.set("scope", scope);
        startTransition(async () => {
          try {
            await addSuppression(formData);
            toast.success("Added to suppression");
            router.refresh();
            form.reset();
            setScope("global");
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not add to suppression");
          }
        });
      }}
      className="grid gap-4"
    >
      <div className="grid gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          placeholder="example@company.com"
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="scope">Scope</Label>
        <Select value={scope} onValueChange={(v) => setScope(v as "global" | "workspace")}>
          <SelectTrigger id="scope">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="global">Global — all ventures</SelectItem>
            <SelectItem value="workspace">This workspace only</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="reason">
          Reason <span className="text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="reason"
          name="reason"
          placeholder="e.g. unsubscribe"
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={isPending}>
          Add to suppression
        </Button>
      </div>
    </form>
  );
}
