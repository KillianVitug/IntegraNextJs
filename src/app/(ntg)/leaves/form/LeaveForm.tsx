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
import {
  leaveFormSchema,
  LeaveFormSchemaType,
  LeaveEditPayload,
} from "@/zod-schemas/SickandLeaveSchema";

import {
  createLeaveRecord,
  updateLeaveRecord,
  deleteLeaveRecord,
} from "@/app/actions/leaveAction";
import { useToast } from "@/hooks/use-toast";
import { getActiveEmployees } from "@/app/actions/employeeAction";

interface LeaveFormProps {
  onSubmitSuccess: () => void;
  initialData?: LeaveEditPayload | null;
  onCancelEdit: () => void;
}


type Employee = {
  id: string;
  employeeNo: string;
  firstName: string;
  lastName: string;
};


export function LeaveForm({
  onSubmitSuccess,
  initialData,
  onCancelEdit,
}: LeaveFormProps) {
  const { toast } = useToast();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const form = useForm<LeaveFormSchemaType>({
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

  const defaultFormValues: LeaveFormSchemaType = {
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
      const { id, ...formValues } = initialData;
      form.reset(formValues);
    }
  }, [initialData]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const onSubmit = async (data: LeaveFormSchemaType) => {
    const result = initialData
      ? await updateLeaveRecord({ ...data, id: initialData.id })
      : await createLeaveRecord(data);
  
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
  
    onSubmitSuccess();
    form.reset();
  };
  

  const handleDelete = async () => {
    if (!initialData) return;
    if (!window.confirm("Delete this leave request?")) return;
    await deleteLeaveRecord(initialData.id);
    onSubmitSuccess();
    form.reset();
    onCancelEdit();
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
