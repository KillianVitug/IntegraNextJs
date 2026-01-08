"use client";

import React, { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form } from "@/components/ui/form";
import { InputWithLabel } from "@/components/inputs/InputWithLabel";
import { SelectWithLabel } from "@/components/inputs/SelectWithLabel";
import { DateWithLabel } from "@/components/inputs/DateWithLabel";
import { TextAreaWithLabel } from "@/components/inputs/TextAreaWithLabel";
import { Button } from "@/components/ui/button";
import { leaveTypeEnum, leaveStatusEnum } from "@/db/schema";
import { enumToSelectOptions } from "@/utils/enumHelpers";
import { z } from "zod";
import {
  createLeaveRecord,
  updateLeaveRecord,
  deleteLeaveRecord,
} from "@/app/actions/leaveAction";
import { useToast } from "@/hooks/use-toast";
import { getActiveEmployees } from "@/app/actions/employeeAction";

interface LeaveFormProps {
  onSubmitSuccess: () => void;
  initialData?: Partial<LeaveFormData> | null;
  onCancelEdit: () => void;
}

type Employee = {
  id: string;
  employeeNo: string;
  firstName: string;
  lastName: string;
};

const leaveFormSchema = z.object({
  employeeId: z.string().uuid(),
  dateFiled: z.string(),
  leaveType: z.enum(leaveTypeEnum.enumValues),
  noOfDays: z.number().min(1, "Number of days must be at least 1"),
  reason: z.string().min(1, "Reason is required"),
  leaveStatus: z.enum(leaveStatusEnum.enumValues),
});

type LeaveFormData = z.infer<typeof leaveFormSchema>;

export function LeaveForm({
  onSubmitSuccess,
  initialData,
  onCancelEdit,
}: LeaveFormProps) {
  const { toast } = useToast();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const form = useForm<LeaveFormData>({
    resolver: zodResolver(leaveFormSchema),
    defaultValues: {
      employeeId: "",
      dateFiled: new Date().toISOString().split("T")[0],
      leaveType: leaveTypeEnum.enumValues[0],
      noOfDays: 1,
      reason: "",
      leaveStatus: leaveStatusEnum.enumValues[0],
    },
  });

  const defaultFormValues: LeaveFormData = {
    employeeId: "",
    dateFiled: new Date().toISOString().split("T")[0],
    leaveType: leaveTypeEnum.enumValues[0],
    noOfDays: 1,
    reason: "",
    leaveStatus: leaveStatusEnum.enumValues[0],
  };

  useEffect(() => {
    fetchEmployees();
    if (initialData) {
      form.reset(initialData);
    }
  }, [initialData]);

  const fetchEmployees = async () => {
    try {
      const result = await getActiveEmployees();
      if (result.error) {
        toast({
          title: "Error",
          description: result.error,
          variant: "destructive",
        });
        return;
      }
      setEmployees(result.data || []);
    } catch (error) {
      console.error("Error fetching employees:", error);
      toast({
        title: "Error",
        description: "Failed to fetch employees",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const onSubmit = async (data: LeaveFormData) => {
    try {
      let result;
      if (initialData && (initialData as any).id) {
        // Update mode
        result = await updateLeaveRecord({
          ...data,
          id: (initialData as any).id,
        });
      } else {
        // Create mode
        result = await createLeaveRecord(data);
      }

      if (result.error) {
        toast({
          title: "Error",
          description: result.error,
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Success",
        description:
          initialData && (initialData as any).id
            ? "Leave request updated successfully"
            : "Leave request submitted successfully",
      });
      if (onSubmitSuccess) onSubmitSuccess();
      form.reset();
    } catch (error) {
      console.error("Error submitting leave request:", error);
      toast({
        title: "Error",
        description: "Failed to submit leave request",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async () => {
    if (initialData && (initialData as any).id) {
      const confirmDelete = window.confirm(
        "Are you sure you want to delete this leave request?"
      );
      if (!confirmDelete) return;
      const result = await deleteLeaveRecord((initialData as any).id);
      if (result.error) {
        toast({
          title: "Error",
          description: result.error,
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Deleted",
        description: "Leave request deleted successfully",
      });
      if (onSubmitSuccess) onSubmitSuccess();
      form.reset(defaultFormValues); // Reset to default values
      onCancelEdit();
    }
  };

  const handleCancelEdit = () => {
    form.reset(defaultFormValues); // Reset to default values
    onCancelEdit(); // Reset selected record in parent
  };

  const employeeOptions = employees.map((emp) => ({
    id: emp.id,
    name: `${emp.lastName}, ${emp.firstName} (${emp.employeeNo})`,
  }));

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <SelectWithLabel
            fieldTitle="Employee"
            nameInSchema="employeeId"
            control={form.control}
            data={employeeOptions}
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
            data={enumToSelectOptions(leaveTypeEnum.enumValues)}
          />
          <InputWithLabel
            fieldTitle="Number of Days"
            nameInSchema="noOfDays"
            type="number"
            step="1"
            min="1"
            register={form.register}
          />
          <TextAreaWithLabel fieldTitle="Reason" nameInSchema="reason" />
          <SelectWithLabel
            fieldTitle="Status"
            nameInSchema="leaveStatus"
            control={form.control}
            data={enumToSelectOptions(leaveStatusEnum.enumValues)}
          />
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
          <Button type="submit">Submit Request</Button>
        </div>
      </form>
    </Form>
  );
}
