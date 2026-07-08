"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { InputWithLabel } from "@/components/inputs/InputWithLabel";
import { SelectWithLabel } from "@/components/inputs/SelectWithLabel";
import { TextAreaWithLabel } from "@/components/inputs/TextAreaWithLabel";
import { DateRangeWithLabel } from "@/components/inputs/DateRangeWithLabel";
import { Button } from "@/components/ui/button";
import { differenceInCalendarDays } from "date-fns";
import {
  employeeLeaveFormSchema,
  EmployeeLeaveFormSchemaType,
} from "./schema";
import type { EmployeeLeaveRecord } from "./types";
import {
  createEmployeeLeaveRecord,
  deleteEmployeeLeaveRecord,
  getEmployeeLeaveUsageByYear,
  updateEmployeeLeaveRecord,
} from "@/app/actions/leaveAction";
import { useToast } from "@/hooks/use-toast";

type Props = {
  initialData?: EmployeeLeaveRecord | null;
  selectedYear: number;
  onCancelEdit: () => void;
  onSuccess: () => Promise<void>;
  employeeDisplayName: string;
  leaveTypeOptions: LeaveTypeOption[];
};

type LeaveTypeOption = {
  id: string;
  name: string;
};

const dayPartOptions = [
  { id: "FullDay", name: "Full day" },
  { id: "AM", name: "AM half day" },
  { id: "PM", name: "PM half day" },
] as const;

export default function EmployeeLeaveForm({
  initialData,
  selectedYear,
  onCancelEdit,
  onSuccess,
  employeeDisplayName,
  leaveTypeOptions,
}: Props) {
  const { toast } = useToast();
  const [availableBalance, setAvailableBalance] = useState<number | null>(null);
  const defaultLeaveTypeCode = leaveTypeOptions[0]?.id ?? "";

  const form = useForm<EmployeeLeaveFormSchemaType>({
    resolver: zodResolver(employeeLeaveFormSchema),
    defaultValues: {
      dateFiled: new Date().toISOString().split("T")[0],
      leaveStartDate: new Date().toISOString().split("T")[0],
      leaveEndDate: "",
      leaveType: defaultLeaveTypeCode,
      dayPart: "FullDay",
      noOfDays: 1,
      reason: "",
    },
  });

  const defaultFormValues = useMemo<EmployeeLeaveFormSchemaType>(
    () => ({
      dateFiled: new Date().toISOString().split("T")[0],
      leaveStartDate: new Date().toISOString().split("T")[0],
      leaveEndDate: "",
      leaveType: defaultLeaveTypeCode,
      dayPart: "FullDay",
      noOfDays: 1,
      reason: "",
    }),
    [defaultLeaveTypeCode]
  );

  const leaveStartDate = form.watch("leaveStartDate");
  const leaveEndDate = form.watch("leaveEndDate");
  const dayPart = form.watch("dayPart");
  const leaveType = form.watch("leaveType");

  useEffect(() => {
    if (!leaveStartDate) {
      form.setValue("noOfDays", 0);
      return;
    }

    const start = new Date(leaveStartDate);
    const end = leaveEndDate ? new Date(leaveEndDate) : start;
    const diff = differenceInCalendarDays(end, start) + 1;
    const baseDays = diff > 0 ? diff : 1;
    const days = dayPart === "FullDay" ? baseDays : 0.5;

    const currentDays = Number(form.getValues("noOfDays"));
    if (currentDays !== days) {
      form.setValue("noOfDays", days);
    }
  }, [form, leaveStartDate, leaveEndDate, dayPart]);

  useEffect(() => {
    if (initialData) {
      if (initialData.leaveStatus !== "Pending") {
        onCancelEdit();
        return;
      }

      const recordYear = new Date(initialData.dateFiled).getFullYear();
      if (recordYear !== selectedYear) {
        onCancelEdit();
        return;
      }

      form.reset({
        dateFiled: initialData.dateFiled,
        leaveStartDate: initialData.leaveStartDate ?? initialData.dateFiled,
        leaveEndDate: initialData.leaveEndDate ?? "",
        leaveType: initialData.leaveType,
        dayPart: initialData.dayPart ?? "FullDay",
        noOfDays: initialData.noOfDays,
        reason: initialData.reason ?? "",
      });
    } else {
      form.reset(defaultFormValues);
    }
  }, [defaultFormValues, form, initialData, onCancelEdit, selectedYear]);

  useEffect(() => {
    let active = true;

    const loadBalance = async () => {
      if (!leaveStartDate || !leaveType) {
        setAvailableBalance(null);
        return;
      }

      const year = new Date(leaveStartDate).getFullYear();
      const result = await getEmployeeLeaveUsageByYear(year);
      if (!active) return;

      const usage = result.data;
      if (!usage) {
        setAvailableBalance(null);
        return;
      }

      if (leaveType === "SL") {
        setAvailableBalance(usage.entitledSickLeave - usage.usedSickLeave);
        return;
      }

      if (leaveType === "VL") {
        setAvailableBalance(
          usage.entitledVacationLeave - usage.usedVacationLeave
        );
        return;
      }

      setAvailableBalance(null);
    };

    void loadBalance();

    return () => {
      active = false;
    };
  }, [leaveStartDate, leaveType]);

  const onSubmit = async (data: EmployeeLeaveFormSchemaType) => {
    const result = initialData
      ? await updateEmployeeLeaveRecord({ ...data, id: initialData.id })
      : await createEmployeeLeaveRecord(data);

    if (result?.error) {
      toast({ title: "Error", description: result.error, variant: "destructive" });
      return;
    }

    toast({
      title: "Success",
      description: initialData
        ? "Leave request updated successfully"
        : "Leave request submitted successfully",
    });

    await onSuccess();
    form.reset(defaultFormValues);
    onCancelEdit();
  };

  const handleDelete = async () => {
    if (!initialData) return;
    if (initialData.leaveStatus !== "Pending") return;
    if (!window.confirm("Delete this leave request?")) return;

    const result = await deleteEmployeeLeaveRecord(initialData.id);
    if (result?.error) {
      toast({ title: "Error", description: result.error, variant: "destructive" });
      return;
    }

    await onSuccess();
    form.reset(defaultFormValues);
    onCancelEdit();
  };

  const handleCancelEdit = () => {
    form.reset(defaultFormValues);
    onCancelEdit();
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-2">Employee</label>
            <Input value={employeeDisplayName} readOnly />
          </div>
          <InputWithLabel
            fieldTitle="Date Filed"
            nameInSchema="dateFiled"
            readOnly
          />
          <SelectWithLabel
            fieldTitle="Leave Type"
            nameInSchema="leaveType"
            control={form.control}
            data={leaveTypeOptions}
          />
          <SelectWithLabel
            fieldTitle="Day Portion"
            nameInSchema="dayPart"
            control={form.control}
            data={[...dayPartOptions]}
          />
          <InputWithLabel
            fieldTitle="Chargeable Days"
            nameInSchema="noOfDays"
            type="number"
            step="0.5"
            min="0.5"
            register={form.register}
            readOnly
          />
          <div>
            <label className="block text-sm font-medium mb-2">Available Balance</label>
            <Input
              value={availableBalance == null ? "-" : availableBalance.toFixed(2)}
              readOnly
            />
          </div>
          <DateRangeWithLabel
            fieldTitle="Leave Duration"
            startName="leaveStartDate"
            endName="leaveEndDate"
            control={form.control}
          />
          <div>
            <label className="block text-sm font-medium mb-2 ">Status</label>
            <Input value="Pending" readOnly />
          </div>
          <TextAreaWithLabel fieldTitle="Reason" nameInSchema="reason" />
        </div>
        <div className="flex gap-2">
          {initialData && (
            <>
              <Button
                type="button"
                onClick={handleCancelEdit}
                variant="secondary"
              >
                Cancel Edit
              </Button>
              <Button
                type="button"
                onClick={handleDelete}
                variant="destructive"
              >
                Delete Request
              </Button>
            </>
          )}
          <Button type="submit">
            {initialData ? "Update Request" : "Submit Request"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
