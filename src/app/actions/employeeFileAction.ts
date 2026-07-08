"use server";

import { db } from "@/db";
import { employeeFiles, employeeFolders } from "@/db/schema";
import { eq } from "drizzle-orm";
import { insertEmployeeFileSchema } from "@/zod-schemas/employeeFile";
import { insertEmployeeFolderSchema } from "@/zod-schemas/employeeFolder";
import { actionClient } from "@/lib/safe-action";
// import { flattenValidationErrors } from "next-safe-action";
import fs from "fs";
import path from "path";
import { z } from "zod";
import { requireAdminActor } from "@/lib/admin";

export const saveEmployeeFolderAction = actionClient
  .metadata({ actionName: "saveEmployeeFolderAction" })
  .schema(insertEmployeeFolderSchema)
  .action(async ({ parsedInput }) => {
    await requireAdminActor();
    const { id, /*employeeId,*/ folderName, description, remarks, folderType } =
      parsedInput;

    // Check if folder exists
    const existing = await db.query.employeeFolders.findFirst({
      where: eq(employeeFolders.id, id),
    });

    if (existing) {
      await db
        .update(employeeFolders)
        .set({ folderName, description, remarks, folderType })
        .where(eq(employeeFolders.id, id));

      return { message: "Folder updated", id };
    }

    const result = await db
      .insert(employeeFolders)
      .values(parsedInput)
      .returning({ id: employeeFolders.id });

    return { message: "Folder created", id: result[0].id };
  });

export const saveEmployeeFileAction = actionClient
  .metadata({ actionName: "saveEmployeeFileAction" })
  .schema(insertEmployeeFileSchema)
  .action(async ({ parsedInput }) => {
    await requireAdminActor();
    try {
      // If this is a NEW FILE
      if (parsedInput.filePath && parsedInput.filePath !== "") {
        const result = await db
          .insert(employeeFiles)
          .values({
            id: parsedInput.id,
            groupId: parsedInput.groupId!,
            fileName: parsedInput.fileName,
            description: parsedInput.description,
            remarks: parsedInput.remarks,
            filePath: parsedInput.filePath,
            fileExtension: parsedInput.fileExtension,
            mimeType: parsedInput.mimeType,
            fileSize: parsedInput.fileSize,
            createdAt: parsedInput.createdAt,
          })
          .returning({ id: employeeFiles.id });

        return {
          message: "✔ File uploaded",
          id: result[0].id,
        };
      }

      // If this is metadata update for existing file
      const result = await db
        .update(employeeFiles)
        .set({
          fileName: parsedInput.fileName,
          description: parsedInput.description,
          remarks: parsedInput.remarks,
        })
        .where(eq(employeeFiles.id, parsedInput.id))
        .returning({ id: employeeFiles.id });

      return {
        message: "✔ File metadata updated",
        id: result[0].id,
      };
    } catch (error) {
      console.error(error);
      return { error: "Unexpected error while saving file" };
    }
  });

export const deleteEmployeeFileAction = actionClient
  .metadata({ actionName: "deleteEmployeeFileAction" })
  .schema(
    z.object({
      groupId: z.string(),
    })
  )
  .action(async ({ parsedInput }) => {
    await requireAdminActor();
    try {
      const filesToDelete = await db
        .select()
        .from(employeeFiles)
        .where(eq(employeeFiles.groupId, parsedInput.groupId));

      // delete rows
      const result = await db
        .delete(employeeFiles)
        .where(eq(employeeFiles.groupId, parsedInput.groupId))
        .returning({ deletedId: employeeFiles.id });

      // delete files from disk
      for (const f of filesToDelete) {
        const filePath = path.join(process.cwd(), "public", f.filePath);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }

      return {
        message: `🗑️ Deleted ${result.length} records and files.`,
      };
    } catch (error) {
      console.error(error);
      return { error: "❌ Unexpected error deleting files." };
    }
  });

export const deleteSingleEmployeeFileAction = actionClient
  .metadata({ actionName: "deleteSingleEmployeeFile" }) // <-- REQUIRED
  .schema(
    z.object({
      id: z.string().uuid(),
    })
  )
  .action(async ({ parsedInput }) => {
    await requireAdminActor();
    const fileRecord = await db.query.employeeFiles.findFirst({
      where: eq(employeeFiles.id, parsedInput.id),
    });

    if (!fileRecord) {
      return { success: false, message: "File not found" };
    }

    try {
      const filePath = path.join(process.cwd(), "public", fileRecord.filePath);

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      await db
        .delete(employeeFiles)
        .where(eq(employeeFiles.id, parsedInput.id));

      return { success: true, message: "File deleted" };
    } catch (err) {
      console.error(err);
      return { success: false, message: "Delete failed" };
    }
  });

export const deleteEmployeeFolderAction = actionClient
  .metadata({ actionName: "deleteEmployeeFolderAction" })
  .schema(
    z.object({
      groupId: z.string().uuid(),
    })
  )
  .action(async ({ parsedInput }) => {
    await requireAdminActor();
    const { groupId } = parsedInput;

    try {
      // 1. Get all related files
      const files = await db
        .select()
        .from(employeeFiles)
        .where(eq(employeeFiles.groupId, groupId));

      // 2. Remove physical files from /public/uploads
      for (const f of files) {
        const filePath = path.join(process.cwd(), "public", f.filePath);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }

      // 3. Delete file records
      await db.delete(employeeFiles).where(eq(employeeFiles.groupId, groupId));

      // 4. Delete the folder entry
      await db.delete(employeeFolders).where(eq(employeeFolders.id, groupId));

      return {
        success: true,
        message: "Folder and all related files deleted.",
      };
    } catch (error) {
      console.error(error);
      return {
        success: false,
        message: "Unexpected error deleting folder.",
      };
    }
  });

// UPDATE ONLY FILE METADATA (NO UPLOAD)
export const updateEmployeeFileMetaAction = actionClient
  .metadata({ actionName: "updateEmployeeFileMetaAction" })
  .schema(
    z.object({
      id: z.string(),
      fileName: z.string(),
      description: z.string().optional().nullable(),
      remarks: z.string().optional().nullable(),
    })
  )
  .action(async ({ parsedInput }) => {
    await requireAdminActor();
    const { id, fileName, description, remarks } = parsedInput;

    try {
      await db
        .update(employeeFiles)
        .set({ fileName, description, remarks })
        .where(eq(employeeFiles.id, id));

      return { success: true, message: "✔ File metadata updated" };
    } catch (err) {
      console.error(err);
      return { success: false, message: "Unexpected error updating metadata" };
    }
  });
