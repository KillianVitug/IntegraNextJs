import { db } from "@/db";
import { employees, employeeFiles, employeeFolders } from "@/db/schema";
import { ilike, or, eq, sql, isNull, asc } from "drizzle-orm";

export async function getEmployeeFiles() {
    const results = await db.select({
        id: employeeFiles.id,
        employeeNo: employees.employeeNo,
        employeeName: sql<string>`CONCAT(${employees.lastName}, ', ', ${employees.firstName}, ' ', COALESCE(${employees.middleName}, ''))`,
        // fileType: employeeFiles.fileType,
        fileName: employeeFiles.fileName,
        remarks: employeeFiles.remarks,
        description: employeeFiles.description,
        filePath: employeeFiles.filePath,
        fileExtension: employeeFiles.fileExtension,
        mimeType: employeeFiles.mimeType,
        groupId: employeeFiles.groupId,
        createdAt: employeeFiles.createdAt,
        // isArchived: employeeFiles.isArchived,
    })
    .from(employeeFiles)
    .innerJoin(employees, eq(employeeFiles.id, employees.id))
    .where(sql`${employeeFiles.deletedAt} IS NULL`) // ? This is the fix
    .orderBy(asc(employeeFiles.createdAt))
    return results
} 

export async function getEmployeeFile(groupId: string) {
    const employeeFile = await db.query.employeeFiles.findFirst({
        where: eq(employeeFiles.groupId, groupId),
    });
    return employeeFile;
}


export async function getEmployeeFolder(groupId: string) {
    const employeeFolder = await db.query.employeeFolders.findFirst({
        where: eq(employeeFolders.id, groupId),
    });
    return employeeFolder;
}

export async function getFilesByGroup(groupId: string) {
    return db
      .select()
      .from(employeeFiles)
      .where(eq(employeeFiles.groupId, groupId))
      .orderBy(asc(employeeFiles.createdAt));
  }

  
  export async function getAllFoldersWithFiles() {
    const folders = await db.query.employeeFolders.findMany({
      with: {
        files: true,
        employee: {
          columns: {
            employeeNo: true,
            firstName: true,
            middleName: true,
            lastName: true,
          },
        },
      },
      where: isNull(employeeFolders.deletedAt),
      orderBy: asc(employeeFolders.createdAt),
    });
  
    return folders.map(folder => ({
      id: folder.id,
      employeeNo: folder.employee.employeeNo,
      employeeName: `${folder.employee.lastName}, ${folder.employee.firstName} ${
        folder.employee.middleName ?? ""
      }`,
      folderName: folder.folderName,
      folderType: folder.folderType,
      description: folder.description,
      remarks: folder.remarks,
      createdAt: folder.createdAt,
      files: folder.files,   // 👈 list of employeeFiles
    }));
  }
  