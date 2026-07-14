"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateLeadStage } from "@/lib/leads/actions";
import { PIPELINE_STAGES, type PipelineStage } from "@/lib/types";

export function LeadStageSelect({
  leadId,
  stage,
}: {
  leadId: string;
  stage: PipelineStage;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Select
      value={stage}
      disabled={isPending}
      onValueChange={(value) =>
        startTransition(async () => {
          try {
            await updateLeadStage(leadId, value as PipelineStage);
            router.refresh();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not update stage");
          }
        })
      }
    >
      <SelectTrigger size="sm" className="w-[160px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PIPELINE_STAGES.map((s) => (
          <SelectItem key={s} value={s}>
            {s}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
