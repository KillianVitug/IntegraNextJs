"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAction } from "next-safe-action/hooks";
import { deleteSingleEmployeeFileAction, updateEmployeeFileMetaAction } from "@/app/actions/employeeFileAction";

type Props = {
  groupId: string;
};

type FileRecord = {
  id: string;
  fileName: string;
  description: string;
  remarks: string;
  filePath: string;
  fileExtension: string | null;
  mimeType?: string;
  createdAt?: string
};

export default function EmployeeFileFormTable({ groupId }: Props) {
  const [fileData, setFileData] = useState<FileRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [editValues, setEditValues] = useState({
    fileName: "",
    description: "",
    remarks: "",
  });
  // const [showViewer, setShowViewer] = useState(false);

  const deleteFile = useAction(deleteSingleEmployeeFileAction, {
    onSuccess: (res) => {
      if (res.data?.success) {
        alert(res.data.message);
        loadFile();
        setCurrentIndex(0);
      } else {
        alert(res.data?.message);
      }
    },
  });
  const updateMeta = useAction(updateEmployeeFileMetaAction, {
    onSuccess: (res) => {
      if (res?.data?.success) {
        alert(res.data.message);
        loadFile(); // reload updated meta
      }
    },
  });

  async function loadFile() {
    const res = await fetch(`/api/get-files?groupId=${groupId}`);
    const records: FileRecord[] = await res.json();
    setFileData(records || []);
    setLoading(false);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const { name, value } = e.target;
    setEditValues((prev) => ({ ...prev, [name]: value }));
  }

  useEffect(() => {
    loadFile();
  }, [groupId]); // eslint-disable-line react-hooks/exhaustive-deps


    // Update state on slide change
    useEffect(() => {
      if (fileData.length > 0) {
        const current = fileData[currentIndex];
        setEditValues({
          fileName: current.fileName,
          description: current.description || "",
          remarks: current.remarks || "",
        });
      }
    }, [currentIndex, fileData]);

    
  if (loading)
    return <p className="mt-6 text-gray-500 italic">Loading files...</p>;

  if (fileData.length === 0)
    return (
      <p className="mt-6 text-red-600 font-semibold">
        No files found for this record.
      </p>
    );


  const current = fileData[currentIndex];
  const ext =
    (current.fileExtension || current.filePath.split(".").pop())
      ?.toLowerCase() || "";
  const isImage = ["jpg", "jpeg", "png", "webp", "jfif"].includes(ext);
  const isPDF = ext === "pdf";

  function next() {
    if (currentIndex < fileData.length - 1)
      setCurrentIndex((i) => i + 1);
  }
  function prev() {
    if (currentIndex > 0)
      setCurrentIndex((i) => i - 1);
  }

  return (
    <div className="mt-10 flex flex-col items-center gap-6 max-w-6xl mx-auto">
  
      {/* Title */}
      <h3 className="text-xl font-bold">Uploaded File Viewer</h3>
  
      {/* CONTENT WRAPPER */}
      <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-6 border rounded-xl p-6">
  
        {/* LEFT SIDE — FILE PREVIEW */}
        <div className="flex items-center justify-center border rounded-lg p-2 bg-white">
          {isImage && (
            <Image
              src={current.filePath}
              alt={current.fileName}
              width={900}
              height={900}
              className="object-contain h-[70vh] rounded-lg"
              unoptimized
            />
          )}
  
          {isPDF && (
            <iframe
              src={current.filePath}
              className="w-full h-[70vh] rounded-lg border"
            />
          )}
  
          {!isImage && !isPDF && (
            <p className="italic text-gray-600">No preview available.</p>
          )}
        </div>
  
        {/* RIGHT SIDE — DETAILS + INPUTS */}
        <div className="flex flex-col gap-3 text-sm text-gray-800">
  
          <div>
            <label className="font-semibold">File Name:</label>
            <input
              name="fileName"
              className="border p-2 rounded w-full mt-1"
              value={editValues.fileName}
              onChange={handleChange}
            />
          </div>
  
          <div>
            <label className="font-semibold">Description:</label>
            <textarea
              name="description"
              className="border p-2 rounded w-full mt-1"
              rows={3}
              value={editValues.description}
              onChange={handleChange}
            />
          </div>
  
          <div>
            <label className="font-semibold">Remarks:</label>
            <textarea
              name="remarks"
              className="border p-2 rounded w-full mt-1"
              rows={3}
              value={editValues.remarks}
              onChange={handleChange}
            />
          </div>
  
          {/* Save */}
          <Button
            className="w-fit mt-2"
            variant="default"
            onClick={() =>
              updateMeta.execute({
                id: current.id,
                fileName: editValues.fileName,
                description: editValues.description,
                remarks: editValues.remarks,
              })
            }
          >
            Save Metadata
          </Button>
  
          {/* Meta info */}
          <div className="mt-3 text-xs text-gray-600 border-t pt-3">
            <p><strong>Extension:</strong> {ext}</p>
            <p><strong>Uploaded At:</strong> {current.createdAt}</p>
            {current.mimeType && (
              <p><strong>MIME Type:</strong> {current.mimeType}</p>
            )}
          </div>
  
          {/* Download / Delete */}
          <div className="flex gap-3 mt-2">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => {
                const link = document.createElement("a");
                link.href = current.filePath;
                link.download = current.filePath;
                link.target = "_blank";
                document.body.appendChild(link);
                link.click();
                link.remove();
              }}
            >
              Download
            </Button>
  
            <Button
              variant="destructive"
              className="flex-1"
              onClick={() => {
                if (!confirm("Delete this file?")) return;
                deleteFile.execute({ id: current.id });
              }}
            >
              Delete
            </Button>
          </div>
        </div>
      </div>
  
      {/* SLIDER NAVIGATION (Fixed to Bottom Middle) */}
      <div className="flex items-center gap-4 bottom-10 bg-background p-2 rounded-lg shadow-md">
        <Button
          variant="outline"
          disabled={currentIndex === 0}
          onClick={prev}
        >
          ◀ Previous
        </Button>
  
        <span className="text-sm text-gray-600 min-w-[80px] text-center">
          {currentIndex + 1} / {fileData.length}
        </span>
  
        <Button
          variant="outline"
          disabled={currentIndex === fileData.length - 1}
          onClick={next}
        >
          Next ▶
        </Button>
      </div>
    </div>
  );
  
}
