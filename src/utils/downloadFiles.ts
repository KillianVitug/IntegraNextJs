export function downloadFiles(filePaths: string[]) {
  filePaths.forEach((path) => {
    const link = document.createElement("a");
    link.href = path;
    link.download = path.split("/").pop() || "file";
    link.target = "_blank";
    document.body.appendChild(link);
    link.click();
    link.remove();
  });
}

export async function downloadZip(filePaths: string[]) {
  const res = await fetch("/api/zip", {
  method: "POST",
  body: JSON.stringify({ files: filePaths }),
  headers: {
  "Content-Type": "application/json",
  },
  });
  
  if (!res.ok) {
  alert("Failed to download ZIP.");
  return;
  }
  
  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  
  const link = document.createElement("a");
  link.href = url;
  link.download = "files.zip";
  document.body.appendChild(link);
  link.click();
  link.remove();
  }

export async function downloadFolderAsZip(groupId: string) {
if (!groupId) {
  alert("No folder selected.");
  return;
}

const res = await fetch(`/api/files-by-folder/${groupId}`);

if (!res.ok) {
  alert("Failed to fetch files for ZIP download.");
  return;
}

const files = await res.json(); // array of { filePath: string }

if (!files.length) {
  alert("No files available to download for this folder.");
  return;
}

const filePaths = files.map((f: { filePath: string }) => f.filePath);

downloadZip(filePaths);
}

  