"use client";

import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/shared/card";
import { Button } from "@/components/shared/button";
import { Checkbox } from "@/components/shared/checkbox";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { formatFollowers, formatMoney, formatPercent } from "@/lib/affiliate-finder/format";
import type { Category, CreatorSummary } from "@/lib/affiliate-finder/types";

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
        <CardFooter>
          {confirmed ? (
            <span className="text-sm text-muted-foreground">
              {selectedIds.size} creator{selectedIds.size === 1 ? "" : "s"} selected
            </span>
          ) : (
            <Button onClick={onConfirm} disabled={selectedIds.size === 0}>
              Confirm selection
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
