"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { InputWithLabel } from "@/components/inputs/InputWithLabel";
import { useAction } from "next-safe-action/hooks";
import {
  insertDepartmentSchema,
  InsertDepartmentSchemaType,
} from "@/zod-schemas/department";
import {
  saveDepartmentAction,
  updateDepartmentAction,
  deleteDepartmentAction,
} from "@/app/actions/saveConstantAction";

export default function DepartmentCodeForm({
  selectedDepartment,
  onResetSelection,
  onRefresh,
}: {
  selectedDepartment?: InsertDepartmentSchemaType | null;
  onResetSelection?: () => void;
  onRefresh?: () => void;
}) {
  const form = useForm<InsertDepartmentSchemaType>({
    resolver: zodResolver(insertDepartmentSchema),
    defaultValues: {
      id: selectedDepartment?.id ?? 0,
      name: selectedDepartment?.name ?? "",
      code: selectedDepartment?.code ?? "",
    },
  });

  // 🔹 Add new department
  const { execute: save, isExecuting: saving, reset: resetSave } = useAction(
    saveDepartmentAction,
    {
      onSuccess: () => {
        console.log("✅ Department added");
        form.reset();
        onResetSelection?.();
        onRefresh?.();
      },
      onError: (error) => console.error("❌ Add error:", error),
    }
  );

  // 🔹 Update existing department
  const { execute: update, isExecuting: updating, reset: resetUpdate } =
    useAction(updateDepartmentAction, {
      onSuccess: () => {
        console.log("✅ Department updated");
        form.reset();
        onResetSelection?.();
        onRefresh?.();
      },
      onError: (error) => console.error("❌ Update error:", error),
    });

  // 🔹 Delete existing department
  const { execute: remove, isExecuting: deleting } = useAction(
    deleteDepartmentAction,
    {
      onSuccess: () => {
        console.log("🗑️ Department deleted");
        form.reset({
          id: 0,
          name: "",
          code: "",
        }); // 👈 clear fields properly
        onResetSelection?.(); // also clear selected state in page.tsx
        onRefresh?.();        // reload table
      },
      onError: (error) => console.error("❌ Delete error:", error),
    }
  );

  // Load department into form when selected
  useEffect(() => {
    if (selectedDepartment) {
      form.reset(selectedDepartment);
    }
  }, [selectedDepartment, form]);

  // Handle form submit
  const submitForm = (data: InsertDepartmentSchemaType) => {
    if (data.id === 0) {
      save(data); // Add new
    } else {
      update(data); // Update existing
    }
  };

  // Handle delete
  const handleDelete = () => {
    if (!selectedDepartment?.id) return;
    if (confirm("Are you sure you want to delete this department?")) {
      remove({ id: selectedDepartment.id });
    }
  };

  // Handle cancel/reset
  const handleCancel = () => {
    form.reset({
      id: 0,
      name: "",
      code: "",
    });
    onResetSelection?.();
    resetSave();
    resetUpdate();
  };

  return (
    <div className="flex flex-col gap-1 sm:px-8">
      <h2 className="text-2xl font-bold">Department Code</h2>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(submitForm)}
          className="flex flex-col md:flex-row gap-4 md:gap-8"
        >
          {/* Inputs */}
          <div className="flex flex-col gap-4 w-full max-w-xs">
            <InputWithLabel<InsertDepartmentSchemaType>
              fieldTitle="Name"
              nameInSchema="name"
              register={form.register}
            />
          </div>
          <div className="flex flex-col gap-4 w-full max-w-xs">
            <InputWithLabel<InsertDepartmentSchemaType>
              fieldTitle="Code"
              nameInSchema="code"
              register={form.register}
            />
          </div>

          {/* Buttons */}
          <div className="flex flex-col gap-2 w-full max-w-xs">
            <Button type="submit" disabled={saving || updating}>
              {saving
                ? "Saving..."
                : updating
                ? "Updating..."
                : selectedDepartment
                ? "Update"
                : "Add"}
            </Button>

            {selectedDepartment && (
              <Button
                type="button"
                variant="destructive"
                disabled={deleting}
                onClick={handleDelete}
              >
                {deleting ? "Deleting..." : "Delete"}
              </Button>
            )}

            <Button type="button" variant="outline" onClick={handleCancel}>
              {selectedDepartment ? "Cancel" : "Reset"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
