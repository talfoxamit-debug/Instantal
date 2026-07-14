"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Eye, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { deleteStep, saveStep } from "@/lib/campaigns/actions";
import type { CampaignStep, SampleLead } from "@/lib/campaigns/data";
import { applyMergeTags, applySpintax } from "@/lib/sending/render";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface Draft {
  key: string;
  id?: string;
  step_no: number;
  delay_days: number;
  subject: string;
  body_text: string;
  variant_group: string;
}

function toDraft(s: CampaignStep): Draft {
  return {
    key: s.id,
    id: s.id,
    step_no: s.step_no,
    delay_days: s.delay_days,
    subject: s.subject ?? "",
    body_text: s.body_text ?? "",
    variant_group: s.variant_group,
  };
}

const MERGE_HINT = "{{first_name}}, {{company}}, {{custom.x}} · fallback: {{first_name|there}} · spintax: {Hi|Hey}";

export function StepEditor({
  campaignId,
  steps,
  sampleLead,
}: {
  campaignId: string;
  steps: CampaignStep[];
  sampleLead: SampleLead | null;
}) {
  const [drafts, setDrafts] = useState<Draft[]>([]); // unsaved (client-only) drafts

  const saved = steps.map(toDraft);
  const all = [...saved, ...drafts].sort(
    (a, b) => a.step_no - b.step_no || a.variant_group.localeCompare(b.variant_group),
  );
  const maxStepNo = all.reduce((m, s) => Math.max(m, s.step_no), 0);

  const addStep = () => {
    setDrafts((d) => [
      ...d,
      {
        key: `new-${Date.now()}`,
        step_no: maxStepNo + 1,
        delay_days: maxStepNo === 0 ? 0 : 3,
        subject: "",
        body_text: "",
        variant_group: "A",
      },
    ]);
  };

  const addVariant = (stepNo: number) => {
    const used = all
      .filter((s) => s.step_no === stepNo)
      .map((s) => s.variant_group);
    const next = ["A", "B", "C", "D"].find((v) => !used.includes(v)) ?? "B";
    setDrafts((d) => [
      ...d,
      {
        key: `new-${Date.now()}`,
        step_no: stepNo,
        delay_days: all.find((s) => s.step_no === stepNo)?.delay_days ?? 0,
        subject: "",
        body_text: "",
        variant_group: next,
      },
    ]);
  };

  const removeDraft = (key: string) =>
    setDrafts((d) => d.filter((x) => x.key !== key));

  // Group by step_no for headers.
  const byStep = new Map<number, Draft[]>();
  for (const s of all) {
    byStep.set(s.step_no, [...(byStep.get(s.step_no) ?? []), s]);
  }

  return (
    <div className="flex flex-col gap-6">
      {all.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No steps yet. Add the first email in the sequence.
        </div>
      ) : (
        Array.from(byStep.entries()).map(([stepNo, variants]) => (
          <div key={stepNo} className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                Step {stepNo}
                {stepNo > 1 ? (
                  <span className="ml-2 font-normal text-muted-foreground">
                    sends {variants[0].delay_days} day(s) after the previous step
                  </span>
                ) : (
                  <span className="ml-2 font-normal text-muted-foreground">
                    first send
                  </span>
                )}
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => addVariant(stepNo)}
              >
                <Plus className="size-3.5" />
                A/B variant
              </Button>
            </div>
            {variants.map((v) => (
              <StepCard
                key={v.key}
                campaignId={campaignId}
                draft={v}
                sampleLead={sampleLead}
                onRemoveDraft={() => removeDraft(v.key)}
              />
            ))}
          </div>
        ))
      )}

      <div>
        <Button variant="outline" onClick={addStep}>
          <Plus className="size-4" />
          Add step
        </Button>
      </div>
    </div>
  );
}

function StepCard({
  campaignId,
  draft,
  sampleLead,
  onRemoveDraft,
}: {
  campaignId: string;
  draft: Draft;
  sampleLead: SampleLead | null;
  onRemoveDraft: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [subject, setSubject] = useState(draft.subject);
  const [bodyText, setBodyText] = useState(draft.body_text);
  const [delayDays, setDelayDays] = useState(draft.delay_days);
  const [showPreview, setShowPreview] = useState(false);

  const previewData = sampleLead
    ? {
        first_name: sampleLead.first_name,
        last_name: sampleLead.last_name,
        company: sampleLead.company,
        title: sampleLead.title,
        email: sampleLead.email,
        custom: sampleLead.custom,
      }
    : { custom: {} };
  const renderedSubject = applySpintax(applyMergeTags(subject, previewData));
  const renderedBody = applySpintax(applyMergeTags(bodyText, previewData));

  const save = () =>
    startTransition(async () => {
      try {
        await saveStep(campaignId, {
          id: draft.id,
          step_no: draft.step_no,
          delay_days: draft.step_no === 1 ? 0 : delayDays,
          subject,
          body_text: bodyText,
          variant_group: draft.variant_group,
        });
        toast.success(`Step ${draft.step_no}${draft.variant_group} saved`);
        onRemoveDraft(); // if it was a draft, the refreshed data now includes it
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not save step");
      }
    });

  const remove = () =>
    startTransition(async () => {
      try {
        if (draft.id) await deleteStep(campaignId, draft.id);
        onRemoveDraft();
        toast.success("Step removed");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not remove step");
      }
    });

  return (
    <div className="rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">
          Variant {draft.variant_group}
        </span>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowPreview((s) => !s)}
          >
            <Eye className="size-3.5" />
            {showPreview ? "Edit" : "Preview"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={remove}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {showPreview ? (
        <div className="flex flex-col gap-2 text-sm">
          <div className="text-xs text-muted-foreground">
            Preview against {sampleLead?.email ?? "a sample lead"}
          </div>
          <div className="rounded border bg-muted/30 p-3">
            <div className="font-medium">{renderedSubject || "(no subject)"}</div>
            <div className="mt-2 whitespace-pre-wrap text-muted-foreground">
              {renderedBody || "(no body)"}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {draft.step_no > 1 ? (
            <div className="grid max-w-[220px] gap-1.5">
              <Label>Delay (days after previous)</Label>
              <Input
                type="number"
                min={0}
                value={delayDays}
                onChange={(e) => setDelayDays(Number(e.target.value) || 0)}
              />
            </div>
          ) : null}
          <div className="grid gap-1.5">
            <Label>Subject</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Quick question, {{first_name}}"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Body (plain text)</Label>
            <Textarea
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              rows={6}
              placeholder="Hi {{first_name|there}}, ..."
            />
            <p className="text-xs text-muted-foreground">{MERGE_HINT}</p>
          </div>
          <div className="flex justify-end">
            <Button size="sm" disabled={isPending} onClick={save}>
              Save step
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
