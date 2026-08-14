"use client";

import { Download } from "lucide-react";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/shared/card";
import { Button } from "@/components/shared/button";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { formatFollowers, formatMoney } from "@/lib/affiliate-finder/format";
import type { ContactField, CreatorDetail } from "@/lib/affiliate-finder/types";

// Biocostech is the only brand this tool ever discovers for — see BRAND_CONTEXT
// in lib/affiliate-finder/discoveryClient.ts.
const BRAND_NAME = "Biocostech";

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

// Column order/names mirror the `affiliate_list` table in the ecom-affiliate-project
// portal (lib/db/schema/affiliate_list.ts) so this file can be dragged straight into
// its bulk importer (lib/affiliates/import.ts) with every column auto-mapped — that
// importer normalizes headers (lowercased, non-alphanumeric stripped) before matching
// against its alias table, so "Full Name" / "Contact No" / "TikTok Live" etc. all
// resolve correctly as long as the words themselves match.
//
// Mapping notes:
// - brandname is fixed to Biocostech — this tool never discovers for any other brand.
// - contact_no takes mobile first, falling back to viber, since the portal has one
//   generic contact-number column rather than separate mobile/viber fields.
// - followers/gmv/items_sold are varchar columns holding pre-formatted display text
//   in that schema (e.g. "747.9K", "₱10K+", "5.78K") — followers and items_sold use
//   the same plain K/M suffix, gmv adds the ₱ prefix — so we export formatted
//   strings matching that convention rather than raw numbers.
// - status is left blank; the importer defaults any missing/invalid status to
//   "in_progress".
function downloadCsv(details: CreatorDetail[]) {
  const headers = [
    "brandname",
    "fullname",
    "username",
    "email",
    "contact_no",
    "tiktok_live",
    "followers",
    "gmv",
    "items_sold",
    "status",
  ];
  const rows = details.map((d) => [
    BRAND_NAME,
    d.displayName,
    d.username,
    d.email.found ? d.email.value : "",
    d.mobile.found ? d.mobile.value : d.viber.found ? d.viber.value : "",
    d.profileUrl,
    formatFollowers(d.followers),
    formatMoney(d.gmv),
    formatFollowers(d.itemsSold),
    "",
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
