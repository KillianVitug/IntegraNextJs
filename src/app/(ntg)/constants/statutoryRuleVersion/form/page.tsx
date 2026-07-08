"use client";

import { useCallback, useEffect, useState } from "react";
import type { SelectStatutoryRuleVersionSchemaType } from "@/zod-schemas/statutoryRuleVersion";
import StatutoryRuleVersionForm from "./StatutoryRuleVersionForm";
import StatutoryRuleVersionTable from "./StatutoryRuleVersionTable";

export default function StatutoryRuleVersionPage() {
  const [versions, setVersions] = useState<SelectStatutoryRuleVersionSchemaType[]>([]);
  const [selectedVersion, setSelectedVersion] =
    useState<SelectStatutoryRuleVersionSchemaType | null>(null);

  const loadVersions = useCallback(async () => {
    const response = await fetch("/api/constants/statutoryRuleVersion");
    const data = await response.json();
    setVersions(data);
  }, []);

  useEffect(() => {
    loadVersions();
  }, [loadVersions]);

  return (
    <div className="flex flex-col gap-4">
      <StatutoryRuleVersionForm
        selectedVersion={selectedVersion}
        onResetSelection={() => setSelectedVersion(null)}
        onRefresh={loadVersions}
      />
      <StatutoryRuleVersionTable
        versions={versions}
        selectedId={selectedVersion?.id ?? null}
        onRowSelect={(row) => setSelectedVersion(row)}
      />
    </div>
  );
}
