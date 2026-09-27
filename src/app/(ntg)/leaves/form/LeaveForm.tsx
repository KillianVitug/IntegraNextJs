"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { InputWithLabel } from "@/components/inputs/InputWithLabel";
import { SelectWithLabel } from "@/components/inputs/SelectWithLabel";
import { DateWithLabel } from "@/components/inputs/DateWithLabel";
import { DateRangeWithLabel } from "@/components/inputs/DateRangeWithLabel";
import { TextAreaWithLabel } from "@/components/inputs/TextAreaWithLabel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { FormActions, FormGrid } from "@/components/layout/page-layout";
import { differenceInCalendarDays } from "date-fns";
import { Textarea } from "@/components/ui/textarea";
import { Check, ChevronDown, Search } from "lucide-react";
import {
  leaveFormSchema,
  LeaveFormSchemaType,
  LeaveEditPayload,
} from "@/zod-schemas/SickandLeaveSchema";

import {
  createLeaveRecord,
  approveLeaveRequest,
  deleteLeaveRecord,
  denyLeaveRequest,
  getLeaveBalanceSummary,
  updateLeaveRecord,
  voidApprovedLeaveRequest,
} from "@/app/actions/leaveAction";
import { useToast } from "@/hooks/use-toast";
import {
  formatEmployeeNoDisplay,
  formatEmployeePickerLabel,
  getEmployeeTypeDisplay,
  sortEmployeesByLastName,
} from "@/utils/employeeDisplay";
import { cn } from "@/lib/utils";

interface LeaveFormProps {
  initialData?: LeaveEditPayload | null;
  selectedYear: number;
  onCancelEdit: () => void;
  onSuccess: () => Promise<void>;
  employees: Employee[];
  leaveTypeOptions: LeaveTypeOption[];
  initialEmployeeId?: string | null;
}

type Employee = {
  id: string;
  employeeNo: string;
  employeeType?: string | null;
  firstName: string;
  middleName?: string | null;
  lastName: string;
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

const createStatusOptions = [
  { id: "Pending", name: "Pending" },
  { id: "Approved", name: "Approved" },
] as const;

type EmployeePickerOption = Employee & {
  name: string;
};

function matchesSearchTerm(
  values: Array<string | number | null | undefined>,
  searchTerm: string
) {
  const normalizedSearchTerm = searchTerm.trim().toLowerCase();
  if (!normalizedSearchTerm) return true;

  return values.some((value) =>
    String(value ?? "")
      .toLowerCase()
      .includes(normalizedSearchTerm)
  );
}

function EmployeeSearchPicker({
  value,
  employees,
  onChange,
}: {
  value: string | null | undefined;
  employees: EmployeePickerOption[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState("");

  useEffect(() => {
    if (!open) {
      setEmployeeSearch("");
    }
  }, [open]);

  const selectedEmployee =
    employees.find((employee) => employee.id === value) ?? null;
  const filteredEmployees = employees.filter((employee) =>
    matchesSearchTerm(
      [
        employee.name,
        employee.firstName,
        employee.middleName,
        employee.lastName,
        employee.employeeNo,
        formatEmployeeNoDisplay(employee.employeeNo),
        getEmployeeTypeDisplay(employee),
      ],
      employeeSearch
    )
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-auto min-h-9 w-full min-w-0 justify-between whitespace-normal px-3 py-2 text-left"
          aria-label="Search employee"
          aria-expanded={open}
        >
          <span className="min-w-0 flex-1">
            {selectedEmployee ? (
              <span className="block truncate">{selectedEmployee.name}</span>
            ) : (
              <span className="text-muted-foreground">Search employee</span>
            )}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[320px] p-0"
      >
        <div className="border-b p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={employeeSearch}
              onChange={(event) => setEmployeeSearch(event.target.value)}
              placeholder="Search employee or no..."
              aria-label="Search employees"
              className="pl-8"
            />
          </div>
        </div>
        <div className="max-h-72 overflow-auto p-1">
          {filteredEmployees.map((employee) => {
            const selected = employee.id === selectedEmployee?.id;

            return (
              <button
                key={employee.id}
                type="button"
                className="flex w-full items-start gap-2 rounded-sm px-2 py-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                onClick={() => {
                  onChange(employee.id);
                  setOpen(false);
                }}
              >
                <Check
                  className={cn(
                    "mt-0.5 h-4 w-4 shrink-0",
                    selected ? "opacity-100" : "opacity-0"
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {employee.name}
                  </span>
                </span>
              </button>
            );
          })}
          {filteredEmployees.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              No employees found.
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function LeaveForm({
  initialData,
  onCancelEdit,
  employees,
  leaveTypeOptions,
  initialEmployeeId = null,
  selectedYear,
  onSuccess,
}: LeaveFormProps) {
  const { toast } = useToast();
  const [availableBalance, setAvailableBalance] = useState<number | null>(null);
  const [approvalDecisionNote, setApprovalDecisionNote] = useState("");
  const [overrideInsufficientBalance, setOverrideInsufficientBalance] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const defaultLeaveTypeCode = leaveTypeOptions[0]?.id ?? "";
  const selectedInitialEmployeeId =
    initialEmployeeId && employees.some((employee) => employee.id === initialEmployeeId)
      ? initialEmployeeId
      : "";

  const form = useForm<LeaveFormSchemaType>({
    resolver: zodResolver(leaveFormSchema),
    defaultValues: {
      employeeId: selectedInitialEmployeeId,
      dateFiled: new Date().toISOString().split("T")[0],
      leaveStartDate: new Date().toISOString().split("T")[0],
      leaveEndDate: "",
      leaveType: defaultLeaveTypeCode,
      dayPart: "FullDay",
      noOfDays: 1,
      reason: "",
      leaveStatus: "Pending",
    },
  });

  const defaultFormValues = useMemo<LeaveFormSchemaType>(
    () => ({
      employeeId: selectedInitialEmployeeId,
      dateFiled: new Date().toISOString().split("T")[0],
      leaveStartDate: new Date().toISOString().split("T")[0],
      leaveEndDate: "",
      leaveType: defaultLeaveTypeCode,
      dayPart: "FullDay",
      noOfDays: 1,
      reason: "",
      leaveStatus: "Pending",
    }),
    [defaultLeaveTypeCode, selectedInitialEmployeeId]
  );

  const leaveStartDate = form.watch("leaveStartDate");
  const leaveEndDate = form.watch("leaveEndDate");
  const dayPart = form.watch("dayPart");
  const employeeId = form.watch("employeeId");
  const leaveType = form.watch("leaveType");
  const leaveStatus = form.watch("leaveStatus");
  const isCreateApproval = !initialData && leaveStatus === "Approved";

  const resetApprovalFields = useCallback(() => {
    setApprovalDecisionNote("");
    setOverrideInsufficientBalance(false);
    setOverrideReason("");
  }, []);

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
      const recordYear = new Date(initialData.dateFiled).getFullYear();
  
      if (recordYear !== selectedYear) {
        onCancelEdit();
        return;
      }
  
      form.reset({
        employeeId: initialData.employeeId,
        dateFiled: initialData.dateFiled,
        leaveStartDate: initialData.leaveStartDate ?? initialData.dateFiled,
        leaveEndDate: initialData.leaveEndDate ?? "",
        leaveType: initialData.leaveType,
        dayPart: initialData.dayPart ?? "FullDay",
        noOfDays: initialData.noOfDays,
        reason: initialData.reason ?? "",
        leaveStatus: initialData.leaveStatus,
      });
    } else {
      form.reset(defaultFormValues);
    }
    resetApprovalFields();
  }, [defaultFormValues, form, initialData, onCancelEdit, resetApprovalFields, selectedYear]);

  useEffect(() => {
    let active = true;

    const loadBalance = async () => {
      if (!employeeId || !leaveType || !leaveStartDate) {
        setAvailableBalance(null);
        return;
      }

      const year = new Date(leaveStartDate).getFullYear();
      const result = await getLeaveBalanceSummary(employeeId, year);
      if (!active) return;

      const selected = result.data?.find((item) => item.code === leaveType);
      setAvailableBalance(selected?.balance ?? null);
    };

    void loadBalance();

    return () => {
      active = false;
    };
  }, [employeeId, leaveType, leaveStartDate]);

  const onSubmit = async (data: LeaveFormSchemaType) => {
    if (isCreateApproval && overrideInsufficientBalance && !overrideReason.trim()) {
      toast({
        title: "Override reason required",
        description: "Enter a reason before approving with insufficient balance override.",
        variant: "destructive",
      });
      return;
    }

    const payload =
      isCreateApproval
        ? {
            ...data,
            approvalDecisionNote: approvalDecisionNote.trim() || null,
            overrideInsufficientBalance,
            overrideReason: overrideInsufficientBalance ? overrideReason.trim() : null,
          }
        : data;

    const result = initialData
      ? await updateLeaveRecord({ ...data, id: initialData.id })
      : await createLeaveRecord(payload);
  
    if (result?.error) {
      toast({ title: "Error", description: result.error, variant: "destructive" });
      return;
    }
  
    toast({
      title: "Success",
      description: initialData
        ? "Leave request updated successfully"
        : data.leaveStatus === "Approved"
          ? "Leave request approved successfully"
          : "Leave request submitted successfully",
    });
  
    await onSuccess();
    form.reset(defaultFormValues);
    resetApprovalFields();
    onCancelEdit();
  };

  const handleDelete = async () => {
    if (!initialData) return;
    if (!window.confirm("Delete this leave request?")) return;
  
    await deleteLeaveRecord(initialData.id);
    await onSuccess();
    form.reset(defaultFormValues);
    resetApprovalFields();
    onCancelEdit();
  };

  const handleApprove = async (overrideInsufficientBalance = false) => {
    if (!initialData) return;
    const decisionNote = window.prompt("Approval note (optional)") ?? "";
    let overrideReason: string | null = null;

    if (overrideInsufficientBalance) {
      overrideReason = window.prompt("Override reason") ?? "";
      if (!overrideReason.trim()) {
        toast({
          title: "Override reason required",
          description: "Enter a reason before approving with override.",
          variant: "destructive",
        });
        return;
      }
    }

    const result = await approveLeaveRequest({
      leaveId: initialData.id,
      decisionNote,
      overrideInsufficientBalance,
      overrideReason,
    });

    if (result?.error) {
      toast({ title: "Error", description: result.error, variant: "destructive" });
      return;
    }

    toast({ title: "Success", description: "Leave request approved" });
    await onSuccess();
    form.reset(defaultFormValues);
    resetApprovalFields();
    onCancelEdit();
  };

  const handleDeny = async () => {
    if (!initialData) return;
    const decisionNote = window.prompt("Denial note") ?? "";
    const result = await denyLeaveRequest({
      leaveId: initialData.id,
      decisionNote,
    });

    if (result?.error) {
      toast({ title: "Error", description: result.error, variant: "destructive" });
      return;
    }

    toast({ title: "Success", description: "Leave request denied" });
    await onSuccess();
    form.reset(defaultFormValues);
    resetApprovalFields();
    onCancelEdit();
  };

  const handleVoid = async () => {
    if (!initialData) return;
    const reason = window.prompt("Void reason");
    if (!reason?.trim()) {
      toast({
        title: "Void reason required",
        description: "Enter a reason before voiding an approved leave.",
        variant: "destructive",
      });
      return;
    }

    const result = await voidApprovedLeaveRequest({
      leaveId: initialData.id,
      reason,
    });

    if (result?.error) {
      toast({ title: "Error", description: result.error, variant: "destructive" });
      return;
    }

    toast({ title: "Success", description: "Approved leave request voided" });
    await onSuccess();
    form.reset(defaultFormValues);
    resetApprovalFields();
    onCancelEdit();
  };

  const handleCancelEdit = () => {
    form.reset(defaultFormValues);
    resetApprovalFields();
    onCancelEdit();
  };

  const employeeOptions: EmployeePickerOption[] = sortEmployeesByLastName(employees).map((emp) => ({
    ...emp,
    id: emp.id,
    name: formatEmployeePickerLabel(emp),
  }));
  const canEditRequest = !initialData || initialData.leaveStatus === "Pending";

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
        <FormGrid columns={2}>
          <FormField
            control={form.control}
            name="employeeId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Employee</FormLabel>
                <FormControl>
                  <EmployeeSearchPicker
                    value={field.value}
                    employees={employeeOptions}
                    onChange={(nextEmployeeId) => {
                      form.setValue("employeeId", nextEmployeeId, {
                        shouldDirty: true,
                        shouldTouch: true,
                        shouldValidate: true,
                      });
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <DateWithLabel
            fieldTitle="Date Filed"
            nameInSchema="dateFiled"
            control={form.control}
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
            <label className="mb-2 block text-sm font-medium">Available Balance</label>
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
          {initialData ? (
            <div>
              <label className="mb-2 block text-sm font-medium">Status</label>
              <Input value={initialData.leaveStatus} readOnly />
            </div>
          ) : (
            <SelectWithLabel
              fieldTitle="Status"
              nameInSchema="leaveStatus"
              control={form.control}
              data={[...createStatusOptions]}
            />
          )}
          <TextAreaWithLabel fieldTitle="Reason" nameInSchema="reason" />
          {isCreateApproval && (
            <div className="space-y-3 rounded-md border p-3 md:col-span-2">
              <div>
                <label className="mb-2 block text-sm font-medium">
                  Approval Note <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <Textarea
                  value={approvalDecisionNote}
                  onChange={(event) => setApprovalDecisionNote(event.target.value)}
                  placeholder="Add an approval note"
                />
              </div>
              <label className="flex items-center gap-2 text-sm font-medium">
                <Checkbox
                  checked={overrideInsufficientBalance}
                  onCheckedChange={(checked) => {
                    const enabled = checked === true;
                    setOverrideInsufficientBalance(enabled);
                    if (!enabled) {
                      setOverrideReason("");
                    }
                  }}
                />
                Allow Insufficient Balance Override
              </label>
              {overrideInsufficientBalance && (
                <div>
                  <label className="mb-2 block text-sm font-medium">Override Reason</label>
                  <Textarea
                    value={overrideReason}
                    onChange={(event) => setOverrideReason(event.target.value)}
                    placeholder="Required when approving with insufficient balance"
                  />
                </div>
              )}
            </div>
          )}
        </FormGrid>
        <FormActions align="start">
          {initialData && (
            <>
              <Button
                type="button"
                onClick={handleCancelEdit}
                variant="secondary"
              >
                Cancel Edit
              </Button>
              {initialData.leaveStatus !== "Approved" && (
                <Button
                  type="button"
                  onClick={handleDelete}
                  variant="destructive"
                >
                  Delete Request
                </Button>
              )}
              {initialData.leaveStatus === "Pending" && (
                <>
                  <Button type="button" onClick={() => handleApprove(false)}>
                    Approve
                  </Button>
                  <Button
                    type="button"
                    onClick={() => handleApprove(true)}
                    variant="secondary"
                  >
                    Approve Override
                  </Button>
                  <Button type="button" onClick={handleDeny} variant="secondary">
                    Deny
                  </Button>
                </>
              )}
              {initialData.leaveStatus === "Approved" && (
                <Button type="button" onClick={handleVoid} variant="destructive">
                  Void Approved
                </Button>
              )}
            </>
          )}
         <Button type="submit" disabled={!canEditRequest}>
          {initialData ? "Update Request" : "Submit Request"}
        </Button>
        </FormActions>
      </form>
    </Form>
  );
}
