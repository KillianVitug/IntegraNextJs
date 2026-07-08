"use client";

import { useCallback, useEffect, useState } from "react";
import { StatutoryVersionSelector } from "@/app/(ntg)/constants/shared/StatutoryVersionSelector";
import type { SelectStatutoryRuleVersionSchemaType } from "@/zod-schemas/statutoryRuleVersion";
import type { SelectSssContributionBracketSchemaType } from "@/zod-schemas/sssContributionBracket";
import SssContributionBracketForm from "./SssContributionBracketForm";
import SssContributionBracketTable from "./SssContributionBracketTable";

export default function SssContributionBracketPage() {
  const [versions, setVersions] = useState<SelectStatutoryRuleVersionSchemaType[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  const [rows, setRows] = useState<SelectSssContributionBracketSchemaType[]>([]);
  const [selectedRow, setSelectedRow] =
    useState<SelectSssContributionBracketSchemaType | null>(null);

  const loadVersions = useCallback(async () => {
    const response = await fetch("/api/constants/statutoryRuleVersion?ruleType=SSS");
    const data = await response.json();
    setVersions(data);
  }, []);

  const loadRows = useCallback(async (versionId: number | null) => {
    if (!versionId) {
      setRows([]);
      return;
    }

    const response = await fetch(
      `/api/constants/sssContributionBracket?versionId=${versionId}`
    );
    const data = await response.json();
    setRows(data);
  }, []);

  useEffect(() => {
    loadVersions();
  }, [loadVersions]);

  useEffect(() => {
    if (versions.length === 0) {
      setSelectedVersionId(null);
      return;
    }

    setSelectedVersionId((current) =>
      current && versions.some((version) => version.id === current)
        ? current
        : versions[0].id
    );
  }, [versions]);

  useEffect(() => {
    setSelectedRow(null);
    loadRows(selectedVersionId);
  }, [loadRows, selectedVersionId]);

  return (
    <div className="flex flex-col gap-4">
      <StatutoryVersionSelector
        label="SSS Parent Version"
        versions={versions}
        selectedVersionId={selectedVersionId}
        onChange={setSelectedVersionId}
      />
      <SssContributionBracketForm
        selectedVersionId={selectedVersionId}
        selectedRow={selectedRow}
        onResetSelection={() => setSelectedRow(null)}
        onRefresh={() => loadRows(selectedVersionId)}
      />
      <SssContributionBracketTable
        rows={rows}
        selectedId={selectedRow?.id ?? null}
        onRowSelect={(row) => setSelectedRow(row)}
      />
    </div>
  );
}
