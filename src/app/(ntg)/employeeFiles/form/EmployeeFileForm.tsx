"use client";

import { generateUUID } from "@/lib/uuid";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { FormActions, FormGrid, PageHeader } from "@/components/layout/page-layout";
import { InputWithLabel } from "@/components/inputs/InputWithLabel";
import { SelectWithLabel } from "@/components/inputs/SelectWithLabel";
import { InputWithLabelForFiles } from "@/components/inputs/InputWithLabelForFiles";
import { insertEmployeeFolderSchema, type InsertEmployeeFolderSchemaType, type SelectEmployeeFolderSchemaType } from "@/zod-schemas/employeeFolder";
import { useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import { assertFileActionResult, readFileResponse } from "@/utils/downloadFiles";
import { employeeFileTypeEnum } from "@/db/schema";
import { enumToSelectOptions } from "@/utils/enumHelpers";
import { deleteEmployeeFolderAction, saveEmployeeFolderAction } from "@/app/actions/employeeFileAction";
import Image from "next/image";
import { formatEmployeePickerLabel, sortEmployeesByLastName } from "@/utils/employeeDisplay";

const MAX_FILE_BYTES = 3 * 1024 * 1024;
type Props = {
  employeeFolder?: SelectEmployeeFolderSchemaType;
  employees: { id: string; employeeNo: string; employeeType?: string | null; firstName: string; middleName?: string | null; lastName: string }[];
};

export default function FileForm({ employeeFolder, employees }: Props) {
  const router = useRouter();
  const [defaultValues] = useState<InsertEmployeeFolderSchemaType>(() => ({
    id: employeeFolder?.id ?? generateUUID(), employeeId: employeeFolder?.employeeId ?? "",
    description: employeeFolder?.description ?? "", remarks: employeeFolder?.remarks ?? "",
    folderType: employeeFolder?.folderType ?? "Admin", folderName: employeeFolder?.folderName ?? "", files: [],
  }));
  const form = useForm<InsertEmployeeFolderSchemaType>({ mode: "onBlur", resolver: zodResolver(insertEmployeeFolderSchema), defaultValues });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "files", keyName: "fieldKey" });
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const objectUrls = useRef(new Set<string>());
  const saveInFlight = useRef(false);
  const [folderCreated, setFolderCreated] = useState(Boolean(employeeFolder));
  const [creationStarted, setCreationStarted] = useState(Boolean(employeeFolder));
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const confirmedUploads = useRef(new Set<string>());
  const attemptedUploads = useRef(new Set<string>());
  const [preview, setPreview] = useState<{ url: string; name: string; pdf: boolean } | null>(null);
  const employeeOptions = sortEmployeesByLastName(employees).map(emp => ({ id: emp.id, name: formatEmployeePickerLabel(emp) }));
  const locked = busy || deleting;

  useEffect(() => {
    const urls = objectUrls.current;
    return () => { for (const url of urls) URL.revokeObjectURL(url); };
  }, []);

  async function submitForm(data: InsertEmployeeFolderSchemaType) {
    if (saveInFlight.current) return;
    saveInFlight.current = true;
    setBusy(true); setError(null);
    try {
      for (const file of data.files) {
        if (!(file.file instanceof File)) throw new Error("Choose a file before saving.");
        if (file.file.size > MAX_FILE_BYTES) throw new Error(`${file.file.name} exceeds the 3 MiB limit. Remove it and choose a smaller file.`);
      }
      setProgress("Saving folder…");
      if (!folderCreated) {
        setCreationStarted(true);
        const created = await readFileResponse<{ id: string }>(await fetch("/api/employee-folder", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: data.id, employeeId: data.employeeId, folderName: data.folderName, folderType: data.folderType, description: data.description, remarks: data.remarks }),
        }), "Could not confirm the folder save. Retry with this form to keep the same folder.");
        if (created.id !== data.id) throw new Error("Could not confirm this folder. Your files are still selected.");
        setFolderCreated(true);
      }
      // Also persists metadata edits after an interrupted create request is recovered.
      assertFileActionResult(await saveEmployeeFolderAction({
        id: data.id, employeeId: data.employeeId, folderName: data.folderName,
        folderType: data.folderType, description: data.description, remarks: data.remarks,
      }), "Folder details were not saved. Check the fields and retry.");
      for (const [index, file] of data.files.entries()) {
        if (confirmedUploads.current.has(file.id)) continue;
        setProgress(`Saving file ${index + 1} of ${data.files.length}: ${file.fileName}`);
        const body = new FormData();
        body.append("id", file.id); body.append("groupId", data.id);
        body.append("fileName", file.fileName); body.append("description", file.description ?? "");
        body.append("remarks", file.remarks ?? ""); body.append("file", file.file as File);
        attemptedUploads.current.add(file.id);
        const response = await fetch("/api/upload", { method: "POST", body });
        // A rejected request can be corrected; an uncertain save keeps its ID and inputs for replay.
        if ([400, 401, 403, 404, 413, 415, 422].includes(response.status)) attemptedUploads.current.delete(file.id);
        const uploaded = await readFileResponse<{ success: boolean; id: string }>(response, `Could not confirm ${file.fileName}. Retry to check the same upload.`);
        if (!uploaded.success || uploaded.id !== file.id) throw new Error(`Could not confirm ${file.fileName}. Retry with this form.`);
        confirmedUploads.current.add(file.id);
        setSavedIds(new Set(confirmedUploads.current));
      }
      setProgress("Folder and files saved.");
      for (const url of objectUrls.current) URL.revokeObjectURL(url);
      objectUrls.current.clear();
      setPreview(null); form.reset({ ...data, files: [] });
      confirmedUploads.current.clear(); attemptedUploads.current.clear(); setSavedIds(new Set());
      window.dispatchEvent(new Event("employee-files-updated"));
      router.push(`/employeeFiles/form?groupId=${encodeURIComponent(data.id)}`);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Save failed. Your selected files are retained; retry this form.");
      setProgress(confirmedUploads.current.size ? `${confirmedUploads.current.size} file(s) saved. Retry continues the remaining uploads without duplicating saved files.` : "Your selected files are retained. Retry uses the same folder and file IDs.");
    } finally { saveInFlight.current = false; setBusy(false); }
  }

  function removeSelectedFile(index: number) {
    const file = form.getValues(`files.${index}`);
    if (file.previewUrl) { URL.revokeObjectURL(file.previewUrl); objectUrls.current.delete(file.previewUrl); }
    setPreview(null); remove(index);
  }

  function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    const tooLarge = selected.filter(file => file.size > MAX_FILE_BYTES);
    if (tooLarge.length) setError(`${tooLarge.map(file => file.name).join(", ")} exceeds the 3 MiB limit. Choose a smaller file.`);
    else setError(null);
    for (const file of selected.filter(file => file.size <= MAX_FILE_BYTES)) {
      const previewUrl = URL.createObjectURL(file); objectUrls.current.add(previewUrl);
      append({ id: generateUUID(), file, fileName: file.name, description: "", remarks: "", previewUrl });
    }
    event.target.value = "";
  }

  async function archiveFolder() {
    if (locked || !confirm("Remove this folder and its files from the active list? Their history will be retained.")) return;
    setDeleting(true); setError(null);
    try {
      assertFileActionResult(await deleteEmployeeFolderAction({ groupId: defaultValues.id }), "Could not remove the folder. Please retry.");
      router.push("/employeeFiles"); router.refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not remove the folder. Please retry."); }
    finally { setDeleting(false); }
  }

  return <div className="space-y-4">
    <PageHeader title={`${employeeFolder ? "Edit" : "New"} Employee Folder`} />
    {error && <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">{error}</div>}
    {progress && <p role="status" className="text-sm">{progress}</p>}
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submitForm, () => setError("Check the highlighted fields before saving."))} className="space-y-4">
        <fieldset disabled={locked} className="min-w-0 space-y-4">
          <FormGrid columns={3}>
            <div className="min-w-0 space-y-3">
              <SelectWithLabel fieldTitle="Employee" nameInSchema="employeeId" control={form.control} data={employeeOptions} disabled={locked || creationStarted} />
              <InputWithLabel<InsertEmployeeFolderSchemaType> fieldTitle="Description" nameInSchema="description" register={form.register} />
              <InputWithLabel<InsertEmployeeFolderSchemaType> fieldTitle="Remarks" nameInSchema="remarks" register={form.register} />
            </div>
            <div className="min-w-0 space-y-3">
              <InputWithLabel<InsertEmployeeFolderSchemaType> fieldTitle="Folder Name" nameInSchema="folderName" register={form.register} />
              <SelectWithLabel<InsertEmployeeFolderSchemaType> fieldTitle="File Type" nameInSchema="folderType" data={enumToSelectOptions(employeeFileTypeEnum.enumValues)} control={form.control} disabled={locked} />
            </div>
            <div className="min-w-0 space-y-3">
              <input aria-label="Choose employee files" type="file" hidden accept=".pdf,.jpg,.jpeg,.png,.jfif,.webp" ref={fileInputRef} onChange={handleFileSelected} multiple />
              <p className="text-sm text-muted-foreground">PDF or image files, up to 3 MiB each.</p>
              <FormActions align="start" className="pt-0">
                <Button type="submit">{busy ? "Saving…" : error && creationStarted ? "Retry save" : employeeFolder ? "Save changes" : "Save folder"}</Button>
                <Button type="button" variant="secondary" onClick={() => fileInputRef.current?.click()}>Choose files</Button>
                {!creationStarted && <Button type="button" variant="outline" onClick={() => {
                  for (const url of objectUrls.current) URL.revokeObjectURL(url);
                  objectUrls.current.clear(); setPreview(null); form.reset(defaultValues); setError(null); setProgress("");
                }}>Reset</Button>}
              </FormActions>
              {folderCreated && <Button type="button" variant="destructive" onClick={archiveFolder}>{deleting ? "Removing…" : "Remove folder"}</Button>}
            </div>
          </FormGrid>
          {fields.map((item, index) => {
            const started = attemptedUploads.current.has(item.id);
            return <fieldset disabled={locked || started} key={item.fieldKey} className="min-w-0 rounded border p-3">
              <div className="grid min-w-0 gap-3 lg:grid-cols-3">
                <InputWithLabelForFiles<InsertEmployeeFolderSchemaType> fieldTitle="File Name" nameInSchema={`files.${index}.fileName`} register={form.register} control={form.control} />
                <InputWithLabelForFiles<InsertEmployeeFolderSchemaType> fieldTitle="Description" nameInSchema={`files.${index}.description`} register={form.register} control={form.control} />
                <InputWithLabelForFiles<InsertEmployeeFolderSchemaType> fieldTitle="Remarks" nameInSchema={`files.${index}.remarks`} register={form.register} control={form.control} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {item.previewUrl && <Button type="button" variant="secondary" onClick={() => setPreview({ url: item.previewUrl!, name: item.fileName, pdf: (item.file as File)?.type === "application/pdf" || /\.pdf$/i.test((item.file as File)?.name ?? item.fileName) })}>Preview</Button>}
                {!started && <Button type="button" variant="outline" onClick={() => removeSelectedFile(index)}>Remove selected file</Button>}
                {savedIds.has(item.id) ? <p className="text-sm">Saved. Edit its details in the uploaded file viewer.</p> : started ? <p className="text-sm">Awaiting confirmation. Retry save checks this same file.</p> : null}
              </div>
            </fieldset>;
          })}
        </fieldset>
      </form>
    </Form>
    {preview && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3" onClick={() => setPreview(null)}>
      <div role="dialog" aria-modal="true" aria-label={`Preview ${preview.name}`} className="max-h-[90vh] w-full max-w-4xl overflow-auto rounded bg-white p-4" onClick={event => event.stopPropagation()}>
        {preview.pdf ? <iframe title={preview.name} src={preview.url} className="h-[65vh] w-full" /> : <Image src={preview.url} alt={preview.name} width={900} height={900} unoptimized className="max-h-[65vh] w-full object-contain" />}
        <Button type="button" className="mt-3 w-full" onClick={() => setPreview(null)}>Close preview</Button>
      </div>
    </div>}
  </div>;
}
