"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useHistoryModalStore } from "@/utils/historyModalStore";
import RateHistoryTable from "./tables/RateHistoryTable";
import CustomPayrollHistoryTable from "./tables/CustomPayrollHistoryTable";

export default function SalaryHistoryDialog() {
  const { open, closeModal, type, employeeId } =
    useHistoryModalStore();

  if (!type || !employeeId) return null;

  return (
    <Dialog open={open} onOpenChange={closeModal}>
      <DialogContent className="w-[98vw] max-w-none h-[90vh] p-6 overflow-hidden overflow-x-auto">
        <div className="flex flex-col w-full">

          <DialogHeader>
            <DialogTitle>
              {type === "RATE"
                ? "Salary Adjustment History"
                : "Custom Payroll History"}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 mt-4 overflow-hidden">
            {type === "RATE" && (
              <RateHistoryTable employeeId={employeeId} />
            )}

            {type === "CUSTOM_PAYROLL" && (
              <CustomPayrollHistoryTable employeeId={employeeId} />
            )}
          </div>

        </div>
      </DialogContent>

    </Dialog>
  );
}
