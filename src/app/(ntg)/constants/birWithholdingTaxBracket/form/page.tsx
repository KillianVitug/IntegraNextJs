"use client";

import { useCallback, useEffect, useState } from "react";
import { StatutoryVersionSelector } from "@/app/(ntg)/constants/shared/StatutoryVersionSelector";
import type { SelectStatutoryRuleVersionSchemaType } from "@/zod-schemas/statutoryRuleVersion";
import type { SelectBirWithholdingTaxBracketSchemaType } from "@/zod-schemas/birWithholdingTaxBracket";
import BirWithholdingTaxBracketForm from "./BirWithholdingTaxBracketForm";
import BirWithholdingTaxBracketTable from "./BirWithholdingTaxBracketTable";

export default function BirWithholdingTaxBracketPage() {
  const [versions, setVersions] = useState<SelectStatutoryRuleVersionSchemaType[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  const [rows, setRows] = useState<SelectBirWithholdingTaxBracketSchemaType[]>([]);
  const [selectedRow, setSelectedRow] =
    useState<SelectBirWithholdingTaxBracketSchemaType | null>(null);

  const loadVersions = useCallback(async () => {
    const response = await fetch("/api/constants/statutoryRuleVersion?ruleType=TAX");
    const data = await response.json();
    setVersions(data);
  }, []);

  const loadRows = useCallback(async (versionId: number | null) => {
    if (!versionId) {
      setRows([]);
      return;
    }

    const response = await fetch(
      `/api/constants/birWithholdingTaxBracket?versionId=${versionId}`
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
        label="BIR Parent Version"
        versions={versions}
        selectedVersionId={selectedVersionId}
        onChange={setSelectedVersionId}
      />
      <BirWithholdingTaxBracketForm
        selectedVersionId={selectedVersionId}
        selectedRow={selectedRow}
        onResetSelection={() => setSelectedRow(null)}
        onRefresh={() => loadRows(selectedVersionId)}
      />
      <BirWithholdingTaxBracketTable
        rows={rows}
        selectedId={selectedRow?.id ?? null}
        onRowSelect={(row) => setSelectedRow(row)}
      />
    </div>
  );
}
