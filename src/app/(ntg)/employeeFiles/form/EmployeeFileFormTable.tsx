"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { deleteSingleEmployeeFileAction, updateEmployeeFileMetaAction } from "@/app/actions/employeeFileAction";
import { assertFileActionResult, downloadFiles, downloadZip, employeeFileContentUrl, readFileResponse } from "@/utils/downloadFiles";

type FileRecord = {
  id: string; fileName: string; description: string | null; remarks: string | null;
  fileExtension: string | null; mimeType?: string | null; createdAt?: string;
};

export default function EmployeeFileFormTable({ groupId }: { groupId: string }) {
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState({ fileName: "", description: "", remarks: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ id: string; url: string } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const requestRevision = useRef(0);
  const actionInFlight = useRef(false);
  const index = Math.max(0, files.findIndex(file => file.id === selectedId));
  const current = files[index];
  const extension = current?.fileExtension?.toLowerCase() ?? "";
  const isPdf = extension === "pdf" || current?.mimeType === "application/pdf";
  const isImage = ["jpg", "jpeg", "png", "webp", "jfif"].includes(extension);
  const invalidateRequests = useCallback(() => { requestRevision.current += 1; }, []);

  const loadFiles = useCallback(async () => {
    const revision = ++requestRevision.current;
    setLoading(true); setLoadError(null);
    try {
      const records = await readFileResponse<FileRecord[]>(await fetch(`/api/get-files?groupId=${encodeURIComponent(groupId)}`, { cache: "no-store" }), "Could not load files. Please retry.");
      if (!Array.isArray(records)) throw new Error("Could not load files. Please retry.");
      if (revision !== requestRevision.current) return;
      setFiles(records);
      setSelectedId(old => records.some(file => file.id === old) ? old : records[0]?.id ?? null);
    } catch (failure) {
      if (revision === requestRevision.current) setLoadError(failure instanceof Error ? failure.message : "Could not load files. Please retry.");
    } finally { if (revision === requestRevision.current) setLoading(false); }
  }, [groupId]);

  useEffect(() => {
    void loadFiles();
    const refresh = () => { void loadFiles(); };
    window.addEventListener("employee-files-updated", refresh);
    return () => { invalidateRequests(); window.removeEventListener("employee-files-updated", refresh); };
  }, [loadFiles, invalidateRequests]);

  useEffect(() => {
    if (current) setEditValues({ fileName: current.fileName, description: current.description ?? "", remarks: current.remarks ?? "" });
  }, [current]);

  useEffect(() => {
    setPreview(null); setPreviewError(null);
    if (!current || (!isImage && !isPdf)) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    void (async () => {
      try {
        const response = await fetch(employeeFileContentUrl(current.id), { cache: "no-store", signal: controller.signal });
        if (!response.ok) await readFileResponse(response, "Preview unavailable. Retry or download the file.");
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setPreview({ id: current.id, url: objectUrl });
      } catch (failure) {
        if (!controller.signal.aborted) setPreviewError(failure instanceof Error ? failure.message : "Preview unavailable. Retry or download the file.");
      }
    })();
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [current, isImage, isPdf, previewAttempt]);

  async function runAction(label: string, operation: () => Promise<void>) {
    if (actionInFlight.current) return;
    actionInFlight.current = true; setBusy(label); setError(null); setMessage(null);
    try { await operation(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : `${label} failed. Please retry.`); }
    finally { actionInFlight.current = false; setBusy(null); }
  }

  return <section className="mx-auto mt-8 max-w-6xl space-y-4" aria-label="Uploaded files">
    <h2 className="text-xl font-semibold">Uploaded files</h2>
    {message && <p role="status" className="text-sm">{message}</p>}
    {error && <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">{error}</p>}
    {loadError && <div role="alert" className="space-y-2 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">
      <p>{loadError}</p><Button type="button" variant="outline" disabled={loading} onClick={() => void loadFiles()}>Retry loading files</Button>
    </div>}
    {loading && <p role="status" className="text-sm">Loading files…</p>}
    {!loading && !loadError && !current && <p>No active files in this folder.</p>}
    {!loading && !loadError && current && <>
      <div className="grid min-w-0 grid-cols-1 gap-4 rounded border p-3 md:grid-cols-2 md:p-5">
        <div className="flex min-w-0 flex-col items-center justify-center gap-3 rounded border bg-white p-2 text-gray-900">
          {previewError ? <><p role="alert" className="text-sm">{previewError}</p><Button type="button" variant="outline" onClick={() => setPreviewAttempt(value => value + 1)}>Retry preview</Button></> : (isImage || isPdf) && preview?.id !== current.id ? <p role="status">Loading preview…</p> : null}
          {preview?.id === current.id && isImage && <Image src={preview.url} alt={current.fileName} width={900} height={900} unoptimized className="max-h-[65vh] w-full object-contain" onError={() => setPreviewError("This image could not be displayed. Retry or download it.")} />}
          {preview?.id === current.id && isPdf && <iframe title={`Preview ${current.fileName}`} src={preview.url} className="h-[65vh] w-full rounded border" />}
          {!isImage && !isPdf && <p className="text-sm">Preview is unavailable for this file type. Use Download file.</p>}
        </div>
        <div className="min-w-0 space-y-3">
          <fieldset disabled={Boolean(busy)} className="space-y-3">
            <div><label htmlFor="uploaded-file-name" className="text-sm font-medium">File name</label><input id="uploaded-file-name" className="mt-1 w-full rounded border p-2" value={editValues.fileName} onChange={event => setEditValues(old => ({ ...old, fileName: event.target.value }))} /></div>
            <div><label htmlFor="uploaded-file-description" className="text-sm font-medium">Description</label><textarea id="uploaded-file-description" rows={3} className="mt-1 w-full rounded border p-2" value={editValues.description} onChange={event => setEditValues(old => ({ ...old, description: event.target.value }))} /></div>
            <div><label htmlFor="uploaded-file-remarks" className="text-sm font-medium">Remarks</label><textarea id="uploaded-file-remarks" rows={3} className="mt-1 w-full rounded border p-2" value={editValues.remarks} onChange={event => setEditValues(old => ({ ...old, remarks: event.target.value }))} /></div>
            <Button type="button" disabled={!editValues.fileName.trim()} onClick={() => void runAction("Save details", async () => {
              const result = assertFileActionResult(await updateEmployeeFileMetaAction({ id: current.id, ...editValues }), "File details were not saved. Check the fields and retry.");
              setFiles(old => old.map(file => file.id === current.id ? { ...file, ...editValues } : file));
              setMessage(result.message ?? "File details saved.");
            })}>{busy === "Save details" ? "Saving…" : "Save file details"}</Button>
          </fieldset>
          <p className="break-words text-xs text-muted-foreground">{extension.toUpperCase()}{current.createdAt ? ` · Uploaded ${new Date(current.createdAt).toLocaleString()}` : ""}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" disabled={Boolean(busy)} onClick={() => void runAction("Download", () => downloadFiles([current.id]))}>{busy === "Download" ? "Downloading…" : "Download file"}</Button>
            <Button type="button" variant="destructive" disabled={Boolean(busy)} onClick={() => {
              if (confirm("Remove this file from the active folder? Its history will be retained.")) void runAction("Remove", async () => {
                assertFileActionResult(await deleteSingleEmployeeFileAction({ id: current.id }), "Could not remove the file. Please retry.");
                setFiles(old => old.filter(file => file.id !== current.id)); setSelectedId(null);
                setMessage("File removed from the active folder. Its history is retained.");
              });
            }}>{busy === "Remove" ? "Removing…" : "Remove file"}</Button>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" disabled={Boolean(busy) || index === 0} onClick={() => { setSelectedId(files[index - 1].id); setError(null); setMessage(null); }}>Previous</Button>
          <span className="text-sm">{index + 1} / {files.length}</span>
          <Button type="button" variant="outline" disabled={Boolean(busy) || index >= files.length - 1} onClick={() => { setSelectedId(files[index + 1].id); setError(null); setMessage(null); }}>Next</Button>
        </div>
        <div>
          <Button type="button" variant="outline" disabled={Boolean(busy) || files.length > 20} onClick={() => void runAction("Download ZIP", () => downloadZip(files.map(file => file.id)))}>{busy === "Download ZIP" ? "Preparing ZIP…" : "Download folder ZIP"}</Button>
          <p className="mt-1 text-xs text-muted-foreground">Up to 20 files and 3 MiB total per ZIP.</p>
          {files.length > 20 && <p className="mt-1 text-xs text-muted-foreground">ZIP downloads support up to 20 files. Download these files individually.</p>}
        </div>
      </div>
    </>}
  </section>;
}
