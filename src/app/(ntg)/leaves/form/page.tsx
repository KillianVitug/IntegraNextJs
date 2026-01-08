"use client"

import React, { useState } from "react";
import { LeaveForm } from "./LeaveForm";
import { LeaveRecordsTable} from "./LeaveRecordsTable";
import { LeaveRecord } from "./types";

export default function LeavePage() {
  const [reloadFlag, setReloadFlag] = useState(0);
  const [selectedRecord, setSelectedRecord] = useState<LeaveRecord | null>(null);

  // Called after form submit to reload table
  const handleFormSubmit = () => {
    setReloadFlag((f) => f + 1);
    setSelectedRecord(null); // Optionally reset form after submit
  };

  // Called when a row is clicked
  const handleRowClick = (record: LeaveRecord) => {
    setSelectedRecord(record);
  };

  return (
    <div>
      <LeaveForm
        onSubmitSuccess={handleFormSubmit}
        initialData={selectedRecord}
        onCancelEdit={() => setSelectedRecord(null)}
      />
      <LeaveRecordsTable
        reloadFlag={reloadFlag}
        onRowClick={handleRowClick}
      />
    </div>
  );
}