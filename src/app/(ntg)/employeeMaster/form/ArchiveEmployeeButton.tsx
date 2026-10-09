"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { archiveEmployeeAction } from "@/app/actions/archiveEmployeeAction";
import { Button } from "@/components/ui/button";

export default function ArchiveEmployeeButton({
  employeeId,
  disabled = false,
}: {
  employeeId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const { executeAsync, isPending } = useAction(archiveEmployeeAction);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);

  async function archive() {
    if (submitting.current || !confirm("Archive this employee?")) return;
    submitting.current = true;
    setError(null);
    try {
      const result = await executeAsync(employeeId);
      if (result?.data?.success !== true) {
        setError(result?.data?.message || result?.serverError || "The employee was not archived. Please try again.");
        return;
      }
      router.refresh();
      router.push("/employeeMaster");
    } catch {
      setError("We could not confirm the archive. Please try again.");
    } finally {
      submitting.current = false;
    }
  }

  return (
    <div className="col-span-4 min-w-0">
      <Button
        type="button"
        variant="destructive"
        className="w-full leading-none"
        disabled={disabled || isPending}
        onClick={archive}
      >
        {isPending ? "Archiving..." : "Archive Employee"}
      </Button>
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}
