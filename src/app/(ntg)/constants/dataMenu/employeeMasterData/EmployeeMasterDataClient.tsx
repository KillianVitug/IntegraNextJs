"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { LoaderCircle, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { deleteAllRegularEmployeesAction } from "@/app/actions/employeeMasterDataAction";
import { DELETE_EMPLOYEE_MASTER_DATA_CONFIRMATION } from "@/constants/employeeMasterData";
import { Button } from "@/components/ui/button";
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Props = {
  regularEmployeeCount: number;
};

type EmployeeCsvImportResponse = {
  success?: boolean;
  error?: string;
  errors?: string[];
  summary?: {
    totalRows: number;
    createdEmployees: number;
    updatedEmployees: number;
    createdDepartments: number;
    createdPositions: number;
  };
};

function formatCsvImportError(payload: EmployeeCsvImportResponse | null) {
  if (!payload) return "CSV import failed.";

  const errors = payload.errors?.filter(Boolean) ?? [];
  if (!errors.length) return payload.error || "CSV import failed.";

  const visibleErrors = errors.slice(0, 6);
  const remainingCount = errors.length - visibleErrors.length;

  return [
    payload.error || "CSV import failed.",
    ...visibleErrors,
    ...(remainingCount > 0 ? [`...and ${remainingCount} more error(s).`] : []),
  ].join("\n");
}

function formatImportSummary(summary: EmployeeCsvImportResponse["summary"]) {
  if (!summary) return null;

  return [
    `${summary.totalRows} row(s) processed`,
    `${summary.createdEmployees} created`,
    `${summary.updatedEmployees} updated`,
    `${summary.createdDepartments} department(s) created`,
    `${summary.createdPositions} position(s) created`,
  ].join(", ");
}

export default function EmployeeMasterDataClient({
  regularEmployeeCount,
}: Props) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [employeeCount, setEmployeeCount] = useState(regularEmployeeCount);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<string | null>(null);

  useEffect(() => {
    setEmployeeCount(regularEmployeeCount);
  }, [regularEmployeeCount]);

  const { execute: deleteEmployees, isExecuting: isDeleting } = useAction(
    deleteAllRegularEmployeesAction,
    {
      onSuccess: ({ data }) => {
        const deletedCount = data?.deletedCount ?? 0;

        setEmployeeCount(0);
        setImportError(null);
        setImportSummary(null);
        toast.success(
          data?.message ??
            `Deleted ${deletedCount} regular employee record(s).`
        );
        router.refresh();
      },
      onError: () => {
        toast.error("Failed to delete employee master data.");
      },
    }
  );

  async function handleCsvUpload(file: File) {
    try {
      setIsImporting(true);
      setImportError(null);
      setImportSummary(null);

      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/employees/import", {
        method: "POST",
        body: formData,
      });

      const payload = (await res
        .json()
        .catch(() => null)) as EmployeeCsvImportResponse | null;

      if (!res.ok) {
        throw new Error(formatCsvImportError(payload));
      }

      const summaryText = formatImportSummary(payload?.summary);
      setImportSummary(summaryText ?? "Employee CSV import completed.");
      toast.success("Employee CSV import completed.");
      router.refresh();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown import error.";

      setImportError(message);
      toast.error("Employee CSV import failed.");
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
      <Card>
        <CardHeader>
          <CardTitle>Current Employee Records</CardTitle>
          <CardDescription>
            Regular employee rows are reset here. Admin employee records are not
            included.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border bg-muted/30 p-4">
            <p className="text-sm text-muted-foreground">
              Regular employee records
            </p>
            <p className="mt-1 text-3xl font-semibold tabular-nums">
              {employeeCount}
            </p>
          </div>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="destructive"
                disabled={isDeleting || employeeCount === 0}
              >
                {isDeleting ? (
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-2 h-4 w-4" />
                )}
                Delete All Current Employees
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Delete all regular employee records?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This hard-deletes regular employee records and relies on the
                  database to cascade linked employee-specific rows. Admin
                  employee records are kept.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isDeleting}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={isDeleting}
                  onClick={() =>
                    deleteEmployees({
                      confirmation:
                        DELETE_EMPLOYEE_MASTER_DATA_CONFIRMATION,
                    })
                  }
                >
                  {isDeleting ? "Deleting..." : "Delete Employees"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Import Updated Employees</CardTitle>
          <CardDescription>
            Upload the refreshed employee CSV after the reset is complete.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            type="button"
            variant="outline"
            disabled={isImporting}
            onClick={() => fileInputRef.current?.click()}
          >
            {isImporting ? (
              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            {isImporting ? "Importing CSV..." : "Import Employees CSV"}
          </Button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleCsvUpload(file);
            }}
          />

          {importSummary ? (
            <p className="text-sm text-green-700 dark:text-green-400">
              {importSummary}
            </p>
          ) : null}

          {importError ? (
            <p className="whitespace-pre-line text-sm text-destructive">
              {importError}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
