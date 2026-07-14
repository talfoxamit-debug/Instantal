import { LeadsTabs } from "@/components/leads/leads-tabs";

export default function LeadsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">CRM</h1>
        <LeadsTabs />
      </div>
      {children}
    </div>
  );
}
