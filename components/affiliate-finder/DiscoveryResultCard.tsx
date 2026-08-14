"use client";

import { Download } from "lucide-react";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/shared/card";
import { Button } from "@/components/shared/button";
import { Checkbox } from "@/components/shared/checkbox";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { formatFollowers, formatMoney, formatPercent } from "@/lib/affiliate-finder/format";
import type { Category, CreatorSummary } from "@/lib/affiliate-finder/types";

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// Exports the full top-10 discovery list as-is — deliberately available
// whether or not the user has selected/confirmed anything, since a brand
// user may just want the raw shortlist without running contact enrichment.
function downloadDiscoveryCsv(category: Category, candidates: CreatorSummary[]) {
  const headers = [
    "Username",
    "Display Name",
    "Profile URL",
    "Followers",
    "Engagement Rate",
    "GMV (estimated)",
    "Items Sold (estimated)",
  ];
  const rows = candidates.map((c) => [
    c.username,
    c.displayName,
    c.profileUrl,
    String(c.followers),
    String(c.engagementRate),
    String(c.gmv),
    String(c.itemsSold),
  ]);
  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => csvEscape(cell)).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `top10-${category}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function DiscoveryResultCard({
  category,
  candidates,
  selectedIds,
  confirmed,
  onToggle,
  onConfirm,
}: {
  category: Category;
  candidates: CreatorSummary[];
  selectedIds: Set<string>;
  confirmed: boolean;
  onToggle: (id: string) => void;
  onConfirm: () => void;
}) {
  const columns: DataTableColumn<CreatorSummary>[] = [
    {
      key: "select",
      header: "",
      cell: (row) => (
        <Checkbox
          checked={selectedIds.has(row.id)}
          onCheckedChange={() => onToggle(row.id)}
          disabled={confirmed}
          aria-label={`Select ${row.username}`}
        />
      ),
    },
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
    {
      key: "followers",
      header: "Followers",
      align: "right",
      cell: (row) => formatFollowers(row.followers),
    },
    {
      key: "engagement",
      header: "Engagement Rate",
      align: "right",
      cell: (row) => formatPercent(row.engagementRate),
    },
    {
      key: "gmv",
      header: "GMV (estimated)",
      align: "right",
      cell: (row) => formatMoney(row.gmv),
    },
    {
      key: "itemsSold",
      header: "Items Sold (estimated)",
      align: "right",
      cell: (row) => row.itemsSold,
    },
  ];

  return (
    <div className="flex justify-start">
      <Card className="w-full max-w-full">
        <CardHeader>
          <CardTitle>
            Top 10 — {category[0].toUpperCase() + category.slice(1)}
          </CardTitle>
          <span className="text-sm font-semibold tabular-nums" style={{ color: "var(--chart-5)" }}>
            {selectedIds.size} selected
          </span>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            rows={candidates}
            rowKey={(row) => row.id}
          />
        </CardContent>
        <CardFooter className="flex items-center justify-between gap-3">
          {confirmed ? (
            <span className="text-sm text-muted-foreground">
              {selectedIds.size} creator{selectedIds.size === 1 ? "" : "s"} selected
            </span>
          ) : (
            <Button onClick={onConfirm} disabled={selectedIds.size === 0}>
              Confirm selection
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => downloadDiscoveryCsv(category, candidates)}
          >
            <Download className="h-4 w-4 shrink-0" />
            Export CSV
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
