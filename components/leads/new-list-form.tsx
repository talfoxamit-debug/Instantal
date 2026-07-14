"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createList } from "@/lib/leads/actions";

export function NewListForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          try {
            await createList(formData);
            toast.success("List created");
            router.refresh();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not create list");
          }
        })
      }
      className="grid gap-4"
    >
      <div className="grid gap-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="description">
          Description
          <span className="text-muted-foreground"> (optional)</span>
        </Label>
        <Input id="description" name="description" />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={isPending}>
          Create list
        </Button>
      </div>
    </form>
  );
}
