"use client";

import { useCallback, useEffect, useState } from "react";
import { StatutoryVersionSelector } from "@/app/(ntg)/constants/shared/StatutoryVersionSelector";
import type { SelectStatutoryRuleVersionSchemaType } from "@/zod-schemas/statutoryRuleVersion";
import type { SelectPagibigContributionRateSchemaType } from "@/zod-schemas/pagibigContributionRate";
import PagibigContributionRateForm from "./PagibigContributionRateForm";
import PagibigContributionRateTable from "./PagibigContributionRateTable";

export default function PagibigContributionRatePage() {
  const [versions, setVersions] = useState<SelectStatutoryRuleVersionSchemaType[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  const [rows, setRows] = useState<SelectPagibigContributionRateSchemaType[]>([]);
  const [selectedRow, setSelectedRow] =
    useState<SelectPagibigContributionRateSchemaType | null>(null);

  const loadVersions = useCallback(async () => {
    const response = await fetch("/api/constants/statutoryRuleVersion?ruleType=PAGIBIG");
    const data = await response.json();
    setVersions(data);
  }, []);

  const loadRows = useCallback(async (versionId: number | null) => {
    if (!versionId) {
      setRows([]);
      return;
    }

    const response = await fetch(
      `/api/constants/pagibigContributionRate?versionId=${versionId}`
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
        label="Pag-IBIG Parent Version"
        versions={versions}
        selectedVersionId={selectedVersionId}
        onChange={setSelectedVersionId}
      />
      <PagibigContributionRateForm
        selectedVersionId={selectedVersionId}
        selectedRow={selectedRow}
        onResetSelection={() => setSelectedRow(null)}
        onRefresh={() => loadRows(selectedVersionId)}
      />
      <PagibigContributionRateTable
        rows={rows}
        selectedId={selectedRow?.id ?? null}
        onRowSelect={(row) => setSelectedRow(row)}
      />
    </div>
  );
}
