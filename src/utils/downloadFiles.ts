export function employeeFileContentUrl(id: string, download = false) {
  return `/api/employee-files/${encodeURIComponent(id)}/content${download ? "?download=1" : ""}`;
}

export async function readFileResponse<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : fallback);
  if (body === null) throw new Error(fallback);
  return body as T;
}

export function assertFileActionResult(result: unknown, fallback: string) {
  const value = result as {
    serverError?: unknown;
    validationErrors?: unknown;
    data?: { success?: boolean; error?: string; message?: string; id?: string };
  } | undefined;
  if (!value?.data || value.serverError || value.validationErrors || value.data.error || value.data.success === false) {
    throw new Error(value?.data?.error || (typeof value?.serverError === "string" ? value.serverError : undefined) || value?.data?.message || fallback);
  }
  return value.data;
}

async function saveResponse(response: Response, fallbackName: string) {
  if (!response.ok) await readFileResponse(response, "Download failed. Please retry.");
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  let fileName = disposition.match(/filename="([^"]+)"/i)?.[1] ?? fallbackName;
  if (encodedName) {
    try { fileName = decodeURIComponent(encodedName); } catch { /* Use the plain filename. */ }
  }
  fileName = fileName.replace(/[\\/\u0000-\u001f\u007f]/g, "_");
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadFiles(fileIds: string[]) {
  for (const id of fileIds) {
    await saveResponse(await fetch(employeeFileContentUrl(id, true), { cache: "no-store" }), "employee-document");
  }
}

export async function downloadZip(fileIds: string[]) {
  if (!fileIds.length || fileIds.length > 20) throw new Error("Choose between 1 and 20 files for a ZIP download.");
  await saveResponse(await fetch("/api/zip", {
    method: "POST",
    body: JSON.stringify({ fileIds }),
    headers: { "Content-Type": "application/json" },
  }), "employee-files.zip");
}

export async function downloadFolderAsZip(groupId: string) {
  const files = await readFileResponse<{ id: string }[]>(await fetch(`/api/get-files?groupId=${encodeURIComponent(groupId)}`, { cache: "no-store" }), "Could not load files for download.");
  if (!Array.isArray(files)) throw new Error("Could not load files for download.");
  await downloadZip(files.map(file => file.id));
}
