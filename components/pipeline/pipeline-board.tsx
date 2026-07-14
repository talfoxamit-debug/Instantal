"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { setLeadStage } from "@/lib/replies/actions";
import { PIPELINE_STAGES, type PipelineCard } from "@/lib/replies/types";

interface PipelineBoardProps {
  board: Record<string, PipelineCard[]>;
}

export function PipelineBoard({ board }: PipelineBoardProps) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {PIPELINE_STAGES.map((stage) => (
        <PipelineColumn
          key={stage}
          stage={stage}
          cards={board[stage] ?? []}
        />
      ))}
    </div>
  );
}

function PipelineColumn({
  stage,
  cards,
}: {
  stage: string;
  cards: PipelineCard[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleStageChange = (cardId: string, newStage: string) => {
    startTransition(async () => {
      try {
        await setLeadStage(cardId, newStage);
        toast.success("Stage updated");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to update stage");
      }
    });
  };

  return (
    <div className="min-w-[240px] flex flex-col gap-3">
      {/* Column header */}
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-sm">{stage}</h3>
        <span className="text-xs text-muted-foreground">{cards.length}</span>
      </div>

      {/* Cards */}
      {cards.length === 0 ? (
        <div className="text-center text-sm text-muted-foreground py-8">
          —
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {cards.map((card) => (
            <Card key={card.id} className="p-3">
              <div className="flex flex-col gap-2">
                {/* Name / Email */}
                <p className="font-medium text-sm">
                  {card.name || card.email}
                </p>

                {/* Company */}
                {card.company && (
                  <p className="text-xs text-muted-foreground">{card.company}</p>
                )}

                {/* Stage select */}
                <Select
                  value={card.stage}
                  disabled={isPending}
                  onValueChange={(newStage) => handleStageChange(card.id, newStage)}
                >
                  <SelectTrigger size="sm" className="w-full">
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
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
