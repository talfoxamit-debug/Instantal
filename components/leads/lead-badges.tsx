import { Badge } from "@/components/ui/badge";
import type { PipelineStage, VerifyStatus } from "@/lib/types";

const VERIFY_VARIANT: Record<
  VerifyStatus,
  { label: string; className: string }
> = {
  valid: { label: "Valid", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  invalid: { label: "Invalid", className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
  risky: { label: "Risky", className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  unknown: { label: "Unknown", className: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
  pending: { label: "Pending", className: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300" },
  unverified: { label: "Unverified", className: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" },
};

export function VerifyBadge({ status }: { status: VerifyStatus }) {
  const v = VERIFY_VARIANT[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${v.className}`}
    >
      {v.label}
    </span>
  );
}

export function StageBadge({ stage }: { stage: PipelineStage }) {
  return (
    <Badge variant="outline" className="font-normal">
      {stage}
    </Badge>
  );
}
