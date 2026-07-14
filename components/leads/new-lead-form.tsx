"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createLead } from "@/lib/leads/actions";

const FIELDS = [
  { name: "email", label: "Email", type: "email", required: true },
  { name: "first_name", label: "First name" },
  { name: "last_name", label: "Last name" },
  { name: "company", label: "Company" },
  { name: "title", label: "Title" },
  { name: "phone", label: "Phone" },
  { name: "website", label: "Website" },
  { name: "country", label: "Country" },
] as const;

export function NewLeadForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          try {
            await createLead(formData);
            toast.success("Lead created");
            router.push("/leads");
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not create lead");
          }
        })
      }
      className="grid gap-4"
    >
      {FIELDS.map((f) => (
        <div key={f.name} className="grid gap-2">
          <Label htmlFor={f.name}>
            {f.label}
            {"required" in f && f.required ? null : (
              <span className="text-muted-foreground"> (optional)</span>
            )}
          </Label>
          <Input
            id={f.name}
            name={f.name}
            type={"type" in f ? f.type : "text"}
            required={"required" in f && f.required}
          />
        </div>
      ))}
      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={isPending}>
          Create lead
        </Button>
      </div>
    </form>
  );
}
