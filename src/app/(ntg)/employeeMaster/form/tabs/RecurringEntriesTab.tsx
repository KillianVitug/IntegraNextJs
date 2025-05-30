"use client";

import React, { useEffect, useState } from "react";
import {
  useFormContext,
  useWatch,
  UseFormReturn,
  useForm,
  useFieldArray,
} from "react-hook-form";
import { Form } from "@/components/ui/form";
import { enumToSelectOptions } from "@/utils/enumHelpers";
import { frequencyEnum, statusEnum } from "@/db/schema";

import { InputWithLabel } from "@/components/inputs/InputWithLabel";
import { SelectWithLabel } from "@/components/inputs/SelectWithLabel";
import { DateWithLabel } from "@/components/inputs/DateWithLabel";
import { TextAreaWithLabel } from "@/components/inputs/TextAreaWithLabel";
import { Button } from "@/components/ui/button";
import RecurringEntriesTable from "./RecurringEntriesTable";
import {
  InsertEmployeeSchemaType,
  SelectEmployeeWithRelationsSchemaType,
} from "@/zod-schemas/employee";
import type { RecurringEntry } from "./RecurringEntriesTable";
import {
  createRecurringEntry,
  deleteRecurringEntry,
  getRecurringEntriesByEmployee,
} from "@/app/actions/recurrigEntryAction";
import {
  insertEmployeeRecurringEntriesSchema,
  SelectEmployeeRecurringEntriesSchemaType,
  type InsertEmployeeRecurringEntriesSchemaType,
  type selectEmployeeRecurringEntriesSchema,
} from "@/zod-schemas/employeeRecurringEntries";
import { zodResolver } from "@hookform/resolvers/zod";

type Props = {
  employee: SelectEmployeeWithRelationsSchemaType; // <- ? Add this prop
  entry?: SelectEmployeeRecurringEntriesSchemaType;
  isEditable?: boolean;
};

export default function RecurringEntriesTab({
  employee,
  entry,
  isEditable = true,
}: Props) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const { control, register } = useFormContext<InsertEmployeeSchemaType>();

  const form = useForm<InsertEmployeeRecurringEntriesSchemaType>({
    mode: "onBlur",
    resolver: zodResolver(insertEmployeeRecurringEntriesSchema),
    defaultValues: {
      id: entry?.id ?? "(New)",
      employeeId: employee.id,
      accountCode: "",
      amount: "",
      description: "",
      frequency: frequencyEnum.enumValues[0],
      status: statusEnum.enumValues[0],
      startDate: "",
      endDate: "",
    },
  });

  const {
    fields: entries,
    replace, // <-- Needed to replace initial field array content
  } = useFieldArray({
    control,
    name: "recurringEntries",
    keyName: "key", // use unique keys for rendering
  });

  useEffect(() => {
    fetchRecurringEntries();
  }, [employee]);

  const fetchRecurringEntries = async () => {
    if (!employee) return;
    try {
      const res = await getRecurringEntriesByEmployee({
        employeeId: employee.id,
      });
      const entries = res?.data?.entries;
      if (!Array.isArray(entries)) {
        console.warn("No entries or invalid shape:", res);
        return;
      }
      const formatted = entries.map((entry) => ({
        id: entry.id,
        employeeId: employee.id,
        accountCode: entry.accountCode,
        description: entry.description,
        amount: entry.amount,
        frequency:
          entry.frequency as InsertEmployeeRecurringEntriesSchemaType["frequency"],
        status:
          entry.status as InsertEmployeeRecurringEntriesSchemaType["status"],
        startDate: entry.startDate ?? "",
        endDate: entry.endDate ?? "",
      }));

      replace(formatted);
    } catch (error) {
      console.error("Failed to fetch recurring entries:", error);
    }
  };

  const handleSelectEntry = (entry: RecurringEntry, index: number) => {
    form.reset({
      id: entry.id,
      employeeId: employee.id,
      accountCode: entry.accountCode ?? "",
      description: entry.description ?? "",
      amount: entry.amount ?? "",
      frequency:
        entry.frequency as InsertEmployeeRecurringEntriesSchemaType["frequency"],
      status:
        entry.status as InsertEmployeeRecurringEntriesSchemaType["status"],
      startDate: entry.startDate ?? "",
      endDate: entry.endDate ?? "",
    });
    setEditingIndex(index); // ?? necessary for updating or deleting
    setIsEditing(true);
  };

  const onAddEntry = async (data: InsertEmployeeRecurringEntriesSchemaType) => {
    console.log("Saving entry with data:", data); // ?? Check what's actually passed
    if (editingIndex !== null) return; // Prevent adding while editing
    const res = await createRecurringEntry({
      ...data,
      employeeId: employee.id,
    });

    if (res?.data && "message" in res?.data) {
      await fetchRecurringEntries(); // Refresh from server
      resetForm();
    }
  };

  const onSaveEntry = async (
    data: InsertEmployeeRecurringEntriesSchemaType
  ) => {
    console.log("Saving entry with data:", data); // ?? Check what's actually passed
    if (editingIndex === null) return;
    const res = await createRecurringEntry({
      ...data,
      employeeId: employee.id,
    });

    if (res?.data && "message" in res?.data) {
      await fetchRecurringEntries(); // Refresh from server
      resetForm();
    }
  };

  const onDeleteEntry = async () => {
    if (editingIndex === null) return;
    const confirmed = window.confirm(
      "Are you sure you want to delete this recurring entry?"
    );
    if (!confirmed) return; // User cancelled
    const entry = entries[editingIndex];
    await deleteRecurringEntry({ ...entry, employeeId: employee.id });
    await fetchRecurringEntries(); // Refresh from server
    resetForm();
  };

  const handleCancelEdit = () => {
    resetForm();
  };
  const resetForm = () => {
    setEditingIndex(null);
    setIsEditing(false);
    form.reset({
      id: "(New)",
      accountCode: "",
      description: "",
      amount: "",
      frequency: frequencyEnum.enumValues[0],
      status: statusEnum.enumValues[0],
      startDate: "",
      endDate: "",
      employeeId: employee.id,
    });
  };

  return (
    <div className="p-4 space-y-6">
      <Form {...form}>
        <div className="grid grid-cols-2 gap-4">
          <div className="grid grid-cols-2 gap-4">
            <input type="hidden" {...form.register("id")} />
            <InputWithLabel
              fieldTitle="Account Code"
              nameInSchema="accountCode"
              register={form.register}
            />
            <InputWithLabel
              fieldTitle="Amount"
              nameInSchema="amount"
              placeholder="0.00"
              register={form.register}
              step="any" // Allow decimal inputs
            />
            <SelectWithLabel
              fieldTitle="Frequency"
              nameInSchema="frequency"
              control={form.control}
              data={enumToSelectOptions(frequencyEnum.enumValues)}
            />
            <SelectWithLabel
              fieldTitle="Status"
              nameInSchema="status"
              control={form.control}
              data={enumToSelectOptions(statusEnum.enumValues)}
            />
            <DateWithLabel
              fieldTitle="Start Date"
              nameInSchema="startDate"
              control={form.control}
            />
            <DateWithLabel
              fieldTitle="End Date"
              nameInSchema="endDate"
              control={form.control}
            />
          </div>
          <div>
            <TextAreaWithLabel
              className="col-start-3 row-span-2"
              fieldTitle="Description"
              nameInSchema="description"
              // register={form.register}
            />
          </div>
        </div>

        {
          <div className="flex gap-2">
            {!isEditing && (
              <Button onClick={form.handleSubmit(onAddEntry)}>Add Entry</Button>
            )}
            {isEditing && (
              <>
                <Button onClick={form.handleSubmit(onSaveEntry)}>Save</Button>
                <Button variant="outline" onClick={handleCancelEdit}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={onDeleteEntry}>
                  Delete
                </Button>
              </>
            )}
          </div>
        }

        {entries.length === 0 ? (
          <div>No recurring entries found.</div>
        ) : (
          <RecurringEntriesTable
            entries={entries.map((entry) => ({
              id: entry.id,
              employeeId: entry.employeeId ?? "",
              accountCode: entry.accountCode ?? "",
              description: entry.description ?? "",
              amount: entry.amount ?? "",
              frequency: entry.frequency ?? "Once",
              status: entry.status ?? "Active",
              startDate: entry.startDate ?? "",
              endDate: entry.endDate ?? "",
            }))}
            onSelectEntry={handleSelectEntry}
          />
        )}
      </Form>
    </div>
  );
}
