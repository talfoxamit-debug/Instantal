import type { Metadata } from "next";

import { PipelineBoard } from "@/components/pipeline/pipeline-board";
import { getPipeline } from "@/lib/replies/data";

export const metadata: Metadata = { title: "Pipeline" };

export default async function PipelinePage() {
  const board = await getPipeline();

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Manage leads across pipeline stages
      </p>

      <PipelineBoard board={board} />
    </div>
  );
}
