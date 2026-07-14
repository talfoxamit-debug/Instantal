import type { Metadata } from "next";
import Link from "next/link";

import { NewListForm } from "@/components/leads/new-list-form";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getLeadLists } from "@/lib/leads/data";

export const metadata: Metadata = { title: "Lists" };

export default async function ListsPage() {
  const lists = await getLeadLists();

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>New list</CardTitle>
        </CardHeader>
        <CardContent>
          <NewListForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lists</CardTitle>
        </CardHeader>
        <CardContent>
          {lists.length === 0 ? (
            <div className="text-sm text-muted-foreground">No lists yet.</div>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lists.map((list) => (
                    <TableRow key={list.id}>
                      <TableCell>
                        <Link
                          href={`/leads?list=${list.id}`}
                          className="font-medium hover:underline"
                        >
                          {list.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {list.description || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
