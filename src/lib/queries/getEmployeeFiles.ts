import "server-only";
import { db } from "@/db";
import { employees, employeeFiles, employeeFolders } from "@/db/schema";
import { eq, isNull, asc, and, inArray } from "drizzle-orm";
import { sortEmployeesByLastName } from "@/utils/employeeDisplay";
import { currentDocumentActor } from "@/lib/employee-documents/http";
import { listFiles, readFolder } from "@/lib/employee-documents/service";
import { DocumentError, protectedDocumentUrl } from "@/lib/employee-documents/model";

export async function getEmployeeFiles() {
  const folders = await getAllFoldersWithFiles();
  return folders.flatMap(folder => folder.files.map(file => ({
    ...file, employeeNo: folder.employeeNo, employeeType: folder.employeeType, employeeName: folder.employeeName,
  })));
}
export async function getEmployeeFile(groupId: string) {
  return (await listFiles(await currentDocumentActor(), groupId))[0];
}
export async function getEmployeeFolder(groupId: string) {
  const actor = await currentDocumentActor();
  try { return await readFolder(actor, groupId); }
  catch (error) { if (error instanceof DocumentError && error.status === 404) return undefined; throw error; }
}
export async function getFilesByGroup(groupId: string) {
  return listFiles(await currentDocumentActor(), groupId);
}
export async function getAllFoldersWithFiles(searchText = "") {
  await currentDocumentActor();
  const folders = await db.select({ folder: employeeFolders, employee: employees }).from(employeeFolders)
    .innerJoin(employees, eq(employeeFolders.employeeId, employees.id))
    .where(and(isNull(employeeFolders.deletedAt), isNull(employees.deletedAt)))
    .orderBy(asc(employeeFolders.createdAt));
  const search = searchText.trim().toLowerCase();
  const selected = folders.filter(({ folder, employee }) => !search ||
    [employee.employeeNo, employee.employeeType, employee.firstName, employee.middleName, employee.lastName, folder.folderName]
      .filter(Boolean).join(" ").toLowerCase().includes(search));
  const ids = selected.map(row => row.folder.id);
  const files = ids.length ? await db.select({ file: employeeFiles }).from(employeeFiles)
    .innerJoin(employeeFolders, eq(employeeFiles.groupId, employeeFolders.id))
    .innerJoin(employees, eq(employeeFolders.employeeId, employees.id))
    .where(and(inArray(employeeFiles.groupId, ids), isNull(employeeFiles.deletedAt), isNull(employeeFolders.deletedAt), isNull(employees.deletedAt)))
    .orderBy(asc(employeeFiles.createdAt)) : [];
  return sortEmployeesByLastName(selected.map(({ folder, employee }) => ({
    id: folder.id, employeeNo: employee.employeeNo, employeeType: employee.employeeType,
    employeeName: [employee.lastName + ",", employee.firstName, employee.middleName].filter(Boolean).join(" "),
    folderName: folder.folderName, folderType: folder.folderType, description: folder.description,
    remarks: folder.remarks, createdAt: folder.createdAt,
    files: files.filter(row => row.file.groupId === folder.id).map(({ file }) => ({ ...file, filePath: protectedDocumentUrl(file.id) })),
  })));
}
