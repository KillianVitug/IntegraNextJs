"use client";

import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { v4 as uuidv4 } from "uuid";
import { InputWithLabel } from "@/components/inputs/InputWithLabel";
import { SelectWithLabel } from "@/components/inputs/SelectWithLabel";
import { InputWithLabelForFiles } from "@/components/inputs/InputWithLabelForFiles";
import {
  insertEmployeeFolderSchema,
  type InsertEmployeeFolderSchemaType,
  type SelectEmployeeFolderSchemaType,
} from "@/zod-schemas/employeeFolder";
import { getActiveEmployees } from "@/app/actions/employeeAction";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, useRef } from "react";
import {
  downloadFiles,
  downloadZip,
  downloadFolderAsZip,
} from "@/utils/downloadFiles";
import { employees, employeeFileTypeEnum } from "@/db/schema";
import { enumToSelectOptions } from "@/utils/enumHelpers";
import {
  deleteEmployeeFileAction,
  saveEmployeeFileAction,
  deleteEmployeeFolderAction,
  saveEmployeeFolderAction,
} from "@/app/actions/employeeFileAction";
import { useAction } from "next-safe-action/hooks";

type Props = {
  employeeFolder?: SelectEmployeeFolderSchemaType;
  employees: {
    id: string;
    employeeNo: string;
    firstName: string;
    lastName: string;
  }[];
};

export default function FileForm({ employeeFolder, employees }: Props) {
  const router = useRouter();
  const generatedId = uuidv4();
  const searchParams = useSearchParams();
  const hasGroupId = searchParams.has("groupId");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [previewFile, setPreviewFile] = useState<string | null>(null);

  function closePreview() {
    setPreviewFile(null);
  }

  const employeeOptions = employees.map((emp) => ({
    id: emp.id,
    name: `${emp.lastName}, ${emp.firstName} (${emp.employeeNo})`,
  }));

  const emptyValues: InsertEmployeeFolderSchemaType = {
    id: generatedId,
    employeeId: "",
    description: "",
    remarks: "",
    folderType: "Admin",
    folderName: "",
    createdAt: undefined,
    files: [],
  };

  const defaultValues: InsertEmployeeFolderSchemaType = hasGroupId
    ? {
        id: employeeFolder?.id || generatedId,
        employeeId: employeeFolder?.employeeId ?? "",
        description: employeeFolder?.description ?? "",
        remarks: employeeFolder?.remarks ?? "",
        folderType: employeeFolder?.folderType ?? "Admin",
        folderName: employeeFolder?.folderName ?? "",
        createdAt: employeeFolder?.createdAt ?? undefined,
        files: [],
      }
    : emptyValues;

  const form = useForm<InsertEmployeeFolderSchemaType>({
    mode: "onBlur",
    resolver: zodResolver(insertEmployeeFolderSchema),
    defaultValues: {
      ...defaultValues,
      files: [], // important
    },
  });

  const { execute, status, result } = useAction(saveEmployeeFileAction, {
    onSuccess: (res) => {
      if (res?.data?.message) {
        alert(res.data.message);
        router.refresh(); // refresh page or table
        form.reset(defaultValues); // reset form after success
      }
    },
    onError: (err) => {
      console.error("❌ Error creating File:", err);
      alert("Error creating File. Please check inputs or try again.");
    },
  });

  const { execute: deleteFolderExec, status: deleteFolderStatus } = useAction(
    deleteEmployeeFolderAction,
    {
      onSuccess: (res) => {
        alert(res?.data?.message);
        router.push("/employeeFiles");
        router.refresh();
      },
      onError: () => {
        alert("Error deleting folder.");
      },
    }
  );

  const { fields, append, update, remove } = useFieldArray({
    control: form.control,
    name: "files",
  });

  useEffect(() => {
    form.reset(hasGroupId ? defaultValues : defaultValues);
  }, [searchParams.get("groupId")]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submitForm(data: InsertEmployeeFolderSchemaType) {
    const isUpdate = !!employeeFolder?.id;
    let groupId = employeeFolder?.id;

    if (!isUpdate) {
      // CREATE NEW FOLDER FIRST
      const folderRes = await fetch("/api/employee-folder", {
        method: "POST",
        body: JSON.stringify({
          employeeId: data.employeeId,
          folderName: data.folderName,
          folderType: data.folderType,
          description: data.description,
          remarks: data.remarks,
        }),
      });

      const folderJson = await folderRes.json();
      groupId = folderJson?.id;
    }

    // 🔥 ALWAYS UPDATE FOLDER METADATA FOR UPDATE MODE
    if (isUpdate) {
      await saveEmployeeFolderAction({
        id: groupId!,
        employeeId: data.employeeId,
        folderName: data.folderName,
        description: data.description,
        remarks: data.remarks,
        folderType: data.folderType,
      });
    }

    // -------------------------------------
    // UPLOAD & UPDATE FILES
    // -------------------------------------
    for (const file of data.files) {
      if (file.file) {
        // NEW upload
        const formData = new FormData();
        formData.append("file", file.file);
        const uploadRes = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });
        const uploaded = await uploadRes.json();

        await execute({
          id: uuidv4(),
          groupId,
          fileName: file.fileName,
          description: file.description,
          remarks: file.remarks,
          filePath: uploaded.filePath,
          mimeType: uploaded.mime,
          fileExtension: uploaded.extension,
          fileSize: uploaded.size,
        });
      } else {
        // Just metadata update
        await execute({
          id: file.id,
          groupId,
          fileName: file.fileName,
          description: file.description ?? null,
          remarks: file.remarks ?? null,
          filePath: file.filePath,
        });
      }
    }

    router.push(`/employeeFiles?groupId=${groupId}`);
    router.refresh();
  }

  function openFileDialog() {
    fileInputRef.current?.click();
  }

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    files.forEach((file) => {
      append({
        id: uuidv4(),
        file,
        fileName: file.name,
        description: "",
        remarks: "",
        previewUrl: URL.createObjectURL(file),
      });
    });
  }

  return (
    <div className="flex flex-col gap-1 sm:px-8">
      <div>
        <h2 className="text-2xl font-bold">
          {employeeFolder?.id ? "Edit" : "New"} Employee Folder{" "}
          {employeeFolder?.id ? `#${employeeFolder.id}` : "Form"}
        </h2>
      </div>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(submitForm, (errors) => {
            console.log("❌ Validation failed, errors:", errors);
          })}
          className="flex flex-col md:flex-row gap-4 md:gap-8"
        >
          {/* Column 1 */}
          <div className="flex flex-col gap-4 w-full max-w-xs">
            <SelectWithLabel
              fieldTitle="Employee"
              nameInSchema="employeeId"
              control={form.control}
              data={employeeOptions}
            />
            <InputWithLabel<InsertEmployeeFolderSchemaType>
              fieldTitle="Description"
              nameInSchema="description"
              register={form.register}
            />
            <InputWithLabel<InsertEmployeeFolderSchemaType>
              fieldTitle="Remarks"
              nameInSchema="remarks"
              register={form.register}
            />
          </div>

          {/* Column 2 */}
          <div className="flex flex-col gap-4 w-full max-w-xs">
            <InputWithLabel<InsertEmployeeFolderSchemaType>
              fieldTitle="Folder Name"
              nameInSchema="folderName"
              register={form.register}
            />
            <SelectWithLabel<InsertEmployeeFolderSchemaType>
              fieldTitle="File Type"
              nameInSchema="folderType"
              data={enumToSelectOptions(employeeFileTypeEnum.enumValues)}
              control={form.control}
            />
            {/* <InputWithLabel<InsertEmployeeFileSchemaType>
              fieldTitle="File Extenstion"
              nameInSchema="fileExtension"
              register={form.register}
              disabled
            /> */}
            {/* <InputWithLabel<InsertEmployeeFileSchemaType>
              fieldTitle="File Size"
              nameInSchema="fileSize"
              register={form.register}
              disabled
            /> */}
          </div>

          {/* Column 3 */}
          {/* <div className="flex flex-col gap-4 w-full max-w-xs">
            <InputWithLabel<InsertEmployeeFileSchemaType>
              fieldTitle="Mime Type"
              nameInSchema="mimeType"
              register={form.register}
              disabled
            />
          </div> */}
          <div className="flex flex-col gap-4 w-full max-w-xs">
            {/* <InputWithLabel<InsertEmployeeFileSchemaType>
              fieldTitle="File Path"
              nameInSchema="filePath"
              register={form.register}
              disabled
            /> */}
            <input
              type="file"
              hidden
              accept=".pdf,.jpg,.jpeg,.png,.jfif"
              ref={fileInputRef}
              onChange={handleFileSelected}
              multiple
            />
            <div className="flex gap-2">
              <Button
                type="submit"
                className="w-3/4"
                variant="default"
                disabled={status === "executing"}
              >
                {employeeFolder?.id
                  ? status === "executing"
                    ? "Updating..."
                    : "Update"
                  : status === "executing"
                  ? "Saving..."
                  : "Submit"}
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => form.reset(defaultValues)}
              >
                Reset
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={openFileDialog}
              >
                Upload
              </Button>
            </div>
            {/* {form.getValues("filePath") && ( */}
            <div className="flex gap-2 mt-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => downloadFolderAsZip(employeeFolder?.id!)}
              >
                Download As Zip
              </Button>

              {employeeFolder?.id && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => {
                    if (
                      confirm(
                        "Delete this entire folder and all related files?"
                      )
                    ) {
                      deleteFolderExec({ groupId: employeeFolder.id });
                    }
                  }}
                  disabled={deleteFolderStatus === "executing"}
                >
                  {deleteFolderStatus === "executing"
                    ? "Deleting..."
                    : "Delete Folder"}
                </Button>
              )}
            </div>
            {/* )} */}
          </div>
        </form>

        {fields.map((item, index) => (
          <div
            key={item.id}
            className="flex items-center border rounded-lg p-4 w-full gap-4 mt-2"
          >
            {/* Preview */}

            <div className="flex-1">
              <InputWithLabelForFiles<InsertEmployeeFolderSchemaType>
                fieldTitle="File Name"
                nameInSchema={`files.${index}.fileName`}
                register={form.register}
                control={form.control} // 🔥 REQUIRED
              />
            </div>
            <div className="flex-1">
              <InputWithLabelForFiles<InsertEmployeeFolderSchemaType>
                fieldTitle="Description"
                nameInSchema={`files.${index}.description`}
                register={form.register}
                control={form.control}
              />
            </div>
            <div className="flex-1">
              <InputWithLabelForFiles<InsertEmployeeFolderSchemaType>
                fieldTitle="Remarks"
                nameInSchema={`files.${index}.remarks`}
                register={form.register}
                control={form.control}
              />
            </div>
            <div className="flex rounded-lg p-6 gap-2">
              {item.previewUrl && (
                <Button
                  type="button"
                  className="bg-blue-700 text-white"
                  variant="secondary"
                  onClick={() => setPreviewFile(item.previewUrl!)}
                >
                  Preview
                </Button>
              )}
              <Button
                type="button"
                variant="destructive"
                onClick={() => remove(index)}
              >
                Remove
              </Button>
            </div>
          </div>
        ))}
      </Form>
      {previewFile && (
        <div
          className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50"
          onClick={closePreview}
        >
          <div
            className="bg-white rounded-lg max-w-[90vw] max-h-[90vh] overflow-hidden p-5"
            onClick={(e) => e.stopPropagation()} // prevent closing on inner click
          >
            {previewFile.endsWith(".pdf") ? (
              <iframe src={previewFile} className="w-[80vw] h-[80vh]" />
            ) : (
              <img
                src={previewFile}
                className="max-w-[80vw] max-h-[80vh] object-contain"
              />
            )}

            <Button
              className="mt-5 mb-5 w-full"
              variant="destructive"
              onClick={closePreview}
            >
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
