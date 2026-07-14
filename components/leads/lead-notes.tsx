"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { updateLeadNotes } from "@/lib/leads/actions";

export function LeadNotes({
  leadId,
  initialNotes,
}: {
  leadId: string;
  initialNotes: string;
}) {
  const [notes, setNotes] = useState(initialNotes);
  const [isPending, startTransition] = useTransition();
  const dirty = notes !== initialNotes;

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes about this lead…"
        rows={4}
      />
      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={!dirty || isPending}
          onClick={() =>
            startTransition(async () => {
              try {
                await updateLeadNotes(leadId, notes);
                toast.success("Notes saved");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Could not save");
              }
            })
          }
        >
          Save notes
        </Button>
      </div>
    </div>
  );
}
