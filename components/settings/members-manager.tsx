"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  addMemberByEmail,
  removeMember,
} from "@/lib/workspaces/actions";

export function MembersManager({
  members,
  canManage,
}: {
  members: { userId: string; email: string; role: string }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();

  const handleRemoveMember = (userId: string) => {
    startTransition(async () => {
      try {
        await removeMember(userId);
        toast.success("Member removed");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to remove member");
      }
    });
  };

  const handleAddMember = (formData: FormData) => {
    startTransition(async () => {
      try {
        await addMemberByEmail(formData);
        toast.success("Member added");
        router.refresh();
        if (formRef.current) formRef.current.reset();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to add member");
      }
    });
  };

  return (
    <div className="flex flex-col gap-6">
      {canManage ? (
        <Card>
          <div className="p-6">
            <div className="grid gap-4">
              <div>
                <h2 className="text-lg font-semibold">Add a member</h2>
                <p className="text-sm text-muted-foreground">
                  The person must already have a login — create one with{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                    npm run create-user -- their@email.com
                  </code>
                </p>
              </div>
              <form
                ref={formRef}
                action={handleAddMember}
                className="flex flex-col gap-4 sm:flex-row sm:gap-2"
              >
                <div className="flex-1">
                  <Label htmlFor="email" className="sr-only">
                    Email
                  </Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="member@example.com"
                    disabled={isPending}
                    required
                  />
                </div>
                <Button type="submit" disabled={isPending}>
                  Add
                </Button>
              </form>
            </div>
          </div>
        </Card>
      ) : (
        <div className="text-sm text-muted-foreground">
          Only owners can add or remove members.
        </div>
      )}

      <Card>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                {canManage ? <TableHead className="text-right">Action</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.userId}>
                  <TableCell>{member.email}</TableCell>
                  <TableCell>
                    <Badge variant={member.role === "owner" ? "default" : "secondary"}>
                      {member.role}
                    </Badge>
                  </TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleRemoveMember(member.userId)}
                        disabled={isPending}
                      >
                        Remove
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
