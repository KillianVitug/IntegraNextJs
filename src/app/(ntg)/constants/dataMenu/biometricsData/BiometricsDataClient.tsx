"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { LoaderCircle, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  deleteBiometricsImportsForPeriodAction,
  revertBiometricsImportBatchAction,
} from "@/app/actions/biometricsDataAction";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type BiometricsData = Awaited<
  ReturnType<
    typeof import("@/app/actions/biometricsDataAction").getBiometricsDataPageData
  >
>;

type Props = {
  data: BiometricsData;
};

const DELETE_SELECTED_PERIOD_CONFIRMATION =
  "DELETE_SELECTED_PERIOD_BIOMETRICS_IMPORTS";

function formatDate(value: string | null | undefined) {
  if (!value) return "-";

  return value;
}

function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString();
}

function formatImportedFileCount(count: number) {
  return `${count} imported file${count === 1 ? "" : "s"}`;
}

export default function BiometricsDataClient({ data }: Props) {
  const router = useRouter();
  const [revertingBatchId, setRevertingBatchId] = useState<string | null>(null);
  const selectedPeriod = data.selectedPeriod;
  const selectedPeriodImportCount =
    data.periods.find((period) => period.id === data.selectedPeriodId)
      ?.importedFileCount ?? data.batches.length;
  const selectedPeriodLabel = selectedPeriod
    ? `${selectedPeriod.code} (${selectedPeriod.startDate} to ${selectedPeriod.endDate}, ${formatImportedFileCount(
        selectedPeriodImportCount
      )})`
    : "No payroll period selected";
  const totalRows = useMemo(
    () => data.batches.reduce((total, batch) => total + batch.totalRows, 0),
    [data.batches]
  );

  const {
    execute: revertBatch,
    isExecuting: isReverting,
  } = useAction(revertBiometricsImportBatchAction, {
    onSuccess: ({ data: result }) => {
      setRevertingBatchId(null);
      toast.success("Biometrics import reverted.", {
        description: result
          ? `${result.sourceFileName}: ${result.rawLogCount} raw log(s), ${result.summaryCount} summary row(s).`
          : undefined,
      });
      router.refresh();
    },
    onError: ({ error }) => {
      setRevertingBatchId(null);
      toast.error("Unable to revert biometrics import.", {
        description: error.serverError ?? "Please try again.",
      });
    },
  });
  const {
    execute: deletePeriodImports,
    isExecuting: isDeletingPeriod,
  } = useAction(deleteBiometricsImportsForPeriodAction, {
    onSuccess: ({ data: result }) => {
      toast.success(result?.message ?? "Biometrics imports deleted.", {
        description: result
          ? `${result.rawLogCount} raw log(s), ${result.summaryCount} summary row(s).`
          : undefined,
      });
      router.refresh();
    },
    onError: ({ error }) => {
      toast.error("Unable to delete biometrics imports.", {
        description: error.serverError ?? "Please try again.",
      });
    },
  });

  function updateRoute(next: { year?: number; periodId?: string | null }) {
    const params = new URLSearchParams();
    const year = next.year ?? data.selectedYear;
    const periodId =
      next.periodId === undefined ? data.selectedPeriodId : next.periodId;

    params.set("year", String(year));
    if (periodId) params.set("periodId", periodId);

    router.push(`/constants/dataMenu/biometricsData?${params.toString()}`);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Payroll Period</CardTitle>
          <CardDescription>
            Imported DTR/Biometrics files are listed for the selected period.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[160px_minmax(260px,420px)_1fr]">
          <div className="space-y-1">
            <label className="text-sm font-medium">Year</label>
            <Select
              value={String(data.selectedYear)}
              onValueChange={(value) =>
                updateRoute({ year: Number(value), periodId: null })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Year" />
              </SelectTrigger>
              <SelectContent>
                {data.availableYears.map((year) => (
                  <SelectItem key={year} value={String(year)}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Payroll Period</label>
            <Select
              value={data.selectedPeriodId ?? ""}
              onValueChange={(periodId) => updateRoute({ periodId })}
              disabled={data.periods.length === 0}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select period" />
              </SelectTrigger>
              <SelectContent>
                {data.periods.map((period) => (
                  <SelectItem
                    key={period.id}
                    value={period.id}
                    itemDescription={`${period.startDate} to ${period.endDate}`}
                  >
                    {period.code} ({formatImportedFileCount(period.importedFileCount)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <div className="rounded-md border bg-muted/30 px-3 py-2">
              <p className="text-xs text-muted-foreground">Imported files</p>
              <p className="text-lg font-semibold tabular-nums">
                {data.batches.length}
              </p>
            </div>
            <div className="rounded-md border bg-muted/30 px-3 py-2">
              <p className="text-xs text-muted-foreground">Total rows</p>
              <p className="text-lg font-semibold tabular-nums">{totalRows}</p>
            </div>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={
                    !data.selectedPeriodId ||
                    data.batches.length === 0 ||
                    data.isRevertBlocked ||
                    isDeletingPeriod ||
                    isReverting
                  }
                >
                  {isDeletingPeriod ? (
                    <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="mr-2 h-4 w-4" />
                  )}
                  Delete All Imported Files
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Delete all imported files for this period?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    This reverts every DTR/Biometrics import batch for{" "}
                    {selectedPeriodLabel}. Existing payroll safety checks still
                    apply.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={isDeletingPeriod}>
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    disabled={isDeletingPeriod || !data.selectedPeriodId}
                    onClick={() => {
                      if (!data.selectedPeriodId) return;
                      deletePeriodImports({
                        payrollPeriodId: data.selectedPeriodId,
                        confirmation: DELETE_SELECTED_PERIOD_CONFIRMATION,
                      });
                    }}
                  >
                    {isDeletingPeriod ? "Deleting..." : "Delete Imports"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          {data.revertBlockedReason ? (
            <p className="md:col-span-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {data.revertBlockedReason}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Imported DTR/Biometrics Files</CardTitle>
          <CardDescription>{selectedPeriodLabel}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Payroll Period</TableHead>
                <TableHead>File</TableHead>
                <TableHead>Format</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Matched</TableHead>
                <TableHead>Unmatched</TableHead>
                <TableHead>Duplicates</TableHead>
                <TableHead>Imported</TableHead>
                <TableHead>Posted By</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.batches.map((batch) => (
                <TableRow key={batch.id}>
                  <TableCell className="whitespace-nowrap">
                    {batch.payrollPeriod?.code ?? "-"}
                    <span className="block text-xs text-muted-foreground">
                      {formatDate(batch.payrollPeriod?.startDate)} to{" "}
                      {formatDate(batch.payrollPeriod?.endDate)}
                    </span>
                  </TableCell>
                  <TableCell className="min-w-56 font-medium">
                    {batch.sourceFileName}
                  </TableCell>
                  <TableCell>{batch.sourceFormat}</TableCell>
                  <TableCell>
                    <span className="inline-flex rounded-full bg-muted px-2 py-1 text-xs font-medium">
                      {batch.status}
                    </span>
                  </TableCell>
                  <TableCell>{batch.totalRows}</TableCell>
                  <TableCell>{batch.matchedRows}</TableCell>
                  <TableCell>{batch.unmatchedRows}</TableCell>
                  <TableCell>{batch.duplicateRows}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDateTime(batch.importedAt)}
                  </TableCell>
                  <TableCell className="min-w-56">
                    <span>{batch.postedBy}</span>
                    <span className="block text-xs text-muted-foreground">
                      {batch.postedByType}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={
                        !batch.canRevert ||
                        isDeletingPeriod ||
                        isReverting ||
                        revertingBatchId === batch.id
                      }
                      onClick={() => {
                        const confirmed = window.confirm(
                          `Revert biometrics import "${batch.sourceFileName}"?`
                        );

                        if (!confirmed) return;
                        setRevertingBatchId(batch.id);
                        revertBatch({ batchId: batch.id });
                      }}
                    >
                      {revertingBatchId === batch.id ? (
                        <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <RotateCcw className="mr-2 h-4 w-4" />
                      )}
                      {revertingBatchId === batch.id ? "Reverting..." : "Revert"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {data.batches.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={11}
                    className="py-10 text-center text-muted-foreground"
                  >
                    No imported DTR/Biometrics files found for the selected
                    payroll period.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
