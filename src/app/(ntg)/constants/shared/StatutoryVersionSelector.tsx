"use client";

type VersionOption = {
  id: number;
  code: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  isDefault: boolean;
};

type Props = {
  label: string;
  versions: VersionOption[];
  selectedVersionId: number | null;
  onChange: (value: number | null) => void;
};

export function StatutoryVersionSelector({
  label,
  versions,
  selectedVersionId,
  onChange,
}: Props) {
  return (
    <div className="space-y-2 rounded border p-4">
      <div>
        <h2 className="text-lg font-semibold">{label}</h2>
        <p className="text-sm text-muted-foreground">
          Select the parent statutory version before adding or editing rows.
        </p>
      </div>

      <select
        className="w-full max-w-xl rounded-md border bg-background px-3 py-2 text-sm"
        value={selectedVersionId ?? ""}
        onChange={(event) =>
          onChange(event.target.value ? Number(event.target.value) : null)
        }
      >
        <option value="">Select a version</option>
        {versions.map((version) => (
          <option key={version.id} value={version.id}>
            {version.code} | {version.effectiveFrom}
            {version.effectiveTo ? ` to ${version.effectiveTo}` : " onward"}
            {version.isDefault ? " | Default" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
