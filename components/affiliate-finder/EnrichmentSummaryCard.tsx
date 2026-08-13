"use client";

import { Download } from "lucide-react";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/shared/card";
import { Button } from "@/components/shared/button";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { formatFollowers, formatMoney } from "@/lib/affiliate-finder/format";
import type { ContactField, CreatorDetail } from "@/lib/affiliate-finder/types";

function ContactCell({ field }: { field: ContactField }) {
  if (field.found) {
    return <span className="text-emerald-500">{field.value}</span>;
  }
  return <span className="text-destructive">Not found — needs manual outreach</span>;
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function downloadCsv(details: CreatorDetail[]) {
  const headers = [
    "Username",
    "Display Name",
    "Profile URL",
    "Email",
    "Viber",
    "Mobile",
    "Followers",
    "GMV (estimated)",
  ];
  const rows = details.map((d) => [
    d.username,
    d.displayName,
    d.profileUrl,
    d.email.found ? d.email.value : "",
    d.viber.found ? d.viber.value : "",
    d.mobile.found ? d.mobile.value : "",
    String(d.followers),
    String(d.gmv),
  ]);
  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => csvEscape(cell)).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "affiliate-shortlist.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function EnrichmentSummaryCard({ details }: { details: CreatorDetail[] }) {
  const columns: DataTableColumn<CreatorDetail>[] = [
    {
      key: "username",
      header: "Username",
      cell: (row) => <span className="font-semibold text-foreground">{row.username}</span>,
    },
    {
      key: "displayName",
      header: "Name",
      cell: (row) => row.displayName,
    },
    {
      key: "profileUrl",
      header: "Profile",
      cell: (row) => (
        <a
          href={row.profileUrl}
          target="_blank"
          rel="noreferrer"
          className="text-primary underline-offset-2 hover:underline"
        >
          {row.profileUrl}
        </a>
      ),
    },
    { key: "email", header: "Email", cell: (row) => <ContactCell field={row.email} /> },
    { key: "viber", header: "Viber", cell: (row) => <ContactCell field={row.viber} /> },
    { key: "mobile", header: "Mobile", cell: (row) => <ContactCell field={row.mobile} /> },
    {
      key: "followers",
      header: "Followers",
      align: "right",
      cell: (row) => formatFollowers(row.followers),
    },
    {
      key: "gmv",
      header: "GMV (estimated)",
      align: "right",
      cell: (row) => formatMoney(row.gmv),
    },
  ];

  return (
    <div className="flex justify-start">
      <Card className="w-full max-w-full">
        <CardHeader>
          <CardTitle>Shortlist summary</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} rows={details} rowKey={(row) => row.id} />
        </CardContent>
        <CardFooter>
          <Button onClick={() => downloadCsv(details)}>
            <Download className="h-4 w-4 shrink-0" />
            Export CSV
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
