"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { InputWithLabel } from "@/components/inputs/InputWithLabel";
import { useAction } from "next-safe-action/hooks";
import {
  insertPositionSchema,
  InsertPositionSchemaType,
} from "@/zod-schemas/position";
import {
  savePositionAction,
  updatePositionAction,
  deletePositionAction,
} from "@/app/actions/saveConstantAction";

export default function PositionCodeForm({
  selectedPosition,
  onResetSelection,
  onRefresh,
}: {
  selectedPosition?: InsertPositionSchemaType | null;
  onResetSelection?: () => void;
  onRefresh?: () => void;
}) {
  const form = useForm<InsertPositionSchemaType>({
    resolver: zodResolver(insertPositionSchema),
    defaultValues: {
        id: 0,
        name: "",
      },
  });

  // 🔹 Add new department
  const { execute: save, isExecuting: saving, reset: resetSave } = useAction(
    savePositionAction,
    {
      onSuccess: () => {
        console.log("✅ Position added");
        form.reset();
        onResetSelection?.();
        onRefresh?.();
      },
      onError: (error) => console.error("❌ Add error:", error),
    }
  );

  // 🔹 Update existing department
  const { execute: update, isExecuting: updating, reset: resetUpdate } =
    useAction(updatePositionAction, {
      onSuccess: () => {
        console.log("✅ Position updated");
        form.reset();
        onResetSelection?.();
        onRefresh?.();
      },
      onError: (error) => console.error("❌ Update error:", error),
    });

  // 🔹 Delete existing department
  const { execute: remove, isExecuting: deleting } = useAction(
    deletePositionAction,
    {
      onSuccess: () => {
        console.log("🗑️ Position deleted");
        form.reset({
          id: 0,
          name: "",
        }); // 👈 clear fields properly
        onResetSelection?.(); // also clear selected state in page.tsx
        onRefresh?.();        // reload table
      },
      onError: (error) => console.error("❌ Delete error:", error),
    }
  );

  // Load department into form when selected
  useEffect(() => {
    if (selectedPosition) {
      form.reset(selectedPosition);
    } else {
      form.reset({
        id: 0,
        name: "",
      });
    }
  }, [selectedPosition]);

  // Handle form submit
  const submitForm = (data: InsertPositionSchemaType) => {
    if (data.id === 0) {
      save(data); // Add new
    } else {
      update(data); // Update existing
    }
  };

  // Handle delete
  const handleDelete = () => {
    if (!selectedPosition?.id) return;
    if (confirm("Are you sure you want to delete this department?")) {
      remove({ id: selectedPosition.id });
    }
  };

  // Handle cancel/reset
  const handleCancel = () => {
    form.reset({
      id: 0,
      name: "",
    });
    onResetSelection?.();
    resetSave();
    resetUpdate();
  };
  const id = form.watch("id");
  return (
    <div className="flex flex-col gap-1 sm:px-8">
      <h2 className="text-2xl font-bold">Positions</h2>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(submitForm)}
          className="flex flex-col md:flex-row gap-4 md:gap-8"
        >
          {/* Inputs */}
          <div className="flex flex-col gap-4 w-full max-w-xs">
            <InputWithLabel<InsertPositionSchemaType>
              fieldTitle="Name"
              nameInSchema="name"
              register={form.register}
            />
          </div>


          {/* Buttons */}
          <div className="flex flex-col gap-2 w-full max-w-xs">
          <Button type="submit" disabled={saving || updating}>
            {id === 0 ? "Add" : "Update"}
        </Button>

            {selectedPosition && (
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
              {selectedPosition ? "Cancel" : "Reset"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
