"use server";
import { actionClient } from "@/lib/safe-action";
import { insertEmployeeFileSchema } from "@/zod-schemas/employeeFile";
import { insertEmployeeFolderSchema } from "@/zod-schemas/employeeFolder";
import { currentDocumentActor } from "@/lib/employee-documents/http";
import { archiveFiles, archiveFolder, saveFolder, updateFile } from "@/lib/employee-documents/service";
import { z } from "zod";
import { revalidatePath } from "next/cache";
function refreshDocuments() { revalidatePath("/employeeFiles"); revalidatePath("/employeeFiles/form"); }
export const saveEmployeeFolderAction = actionClient.metadata({ actionName: "saveEmployeeFolderAction" })
  .schema(insertEmployeeFolderSchema).action(async ({ parsedInput }) => {
    const result = await saveFolder(await currentDocumentActor(), parsedInput);
    refreshDocuments(); return { ...result, message: "Folder saved." };
  });
// Only the authenticated upload endpoint may create new content. Paths prove nothing.
export const saveEmployeeFileAction = actionClient.metadata({ actionName: "saveEmployeeFileAction" })
  .schema(insertEmployeeFileSchema).action(async ({ parsedInput }) => {
    const result = await updateFile(await currentDocumentActor(), parsedInput);
    refreshDocuments(); return { ...result, message: "File metadata saved." };
  });
export const deleteEmployeeFileAction = actionClient.metadata({ actionName: "deleteEmployeeFileAction" })
  .schema(z.object({ groupId: z.string().uuid() })).action(async ({ parsedInput }) => {
    const result = await archiveFiles(await currentDocumentActor(), parsedInput);
    refreshDocuments(); return result;
  });
export const deleteSingleEmployeeFileAction = actionClient.metadata({ actionName: "deleteSingleEmployeeFile" })
  .schema(z.object({ id: z.string().uuid() })).action(async ({ parsedInput }) => {
    const result = await archiveFiles(await currentDocumentActor(), parsedInput);
    refreshDocuments(); return result;
  });
export const deleteEmployeeFolderAction = actionClient.metadata({ actionName: "deleteEmployeeFolderAction" })
  .schema(z.object({ groupId: z.string().uuid() })).action(async ({ parsedInput }) => {
    const result = await archiveFolder(await currentDocumentActor(), parsedInput.groupId);
    refreshDocuments(); return result;
  });
export const updateEmployeeFileMetaAction = actionClient.metadata({ actionName: "updateEmployeeFileMetaAction" })
  .schema(z.object({ id: z.string().uuid(), fileName: z.string().trim().min(1).max(255), description: z.string().max(8000).nullable().optional(), remarks: z.string().max(8000).nullable().optional() }))
  .action(async ({ parsedInput }) => {
    const result = await updateFile(await currentDocumentActor(), parsedInput);
    refreshDocuments(); return { ...result, success: true, message: "File metadata saved." };
  });
