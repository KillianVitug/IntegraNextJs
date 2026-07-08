"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Plus, RotateCcw, Save, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { saveRecurringEntries } from "@/app/actions/recurrigEntryAction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { SelectEmployeeWithRelationsSchemaType } from "@/zod-schemas/employee";
import type {
  EmployeeRecurringAccountCodeOption,
  EmployeeRecurringEntryFormType,
} from "@/zod-schemas/employeeRecurringEntries";

type Props = {
  employee: SelectEmployeeWithRelationsSchemaType;
  initialEntries: EmployeeRecurringEntryFormType[];
  accountCodeOptions: EmployeeRecurringAccountCodeOption[];
};

type RecurringEntryDraft = {
  localId: string;
  id: number | null;
  accountCode: string;
  amount: string;
  description: string;
};

type SaveRecurringEntriesActionResult = {
  data?: {
    success: boolean;
    message?: string;
    entries: EmployeeRecurringEntryFormType[];
  };
  serverError?: string;
  validationErrors?: unknown;
};

const moneyFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
});

function toNumber(value: string | number | null | undefined) {
  if (value == null || value === "") return 0;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function formatMoney(value: string | number | null | undefined) {
  return moneyFormatter.format(toNumber(value));
}

function formatMoneyInput(value: string | number | null | undefined) {
  return toNumber(value).toFixed(2);
}

function formatDecimalUpTo4(value: string | number | null | undefined) {
  if (value == null || value === "") return "-";

  const normalized = String(value).replace(/,/g, "").trim();
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(normalized)) return String(value);

  const [wholeValue, decimalValue] = normalized.split(".");
  const whole = wholeValue === "" ? "0" : wholeValue;

  if (decimalValue == null || decimalValue === "") return whole;

  return `${whole}.${decimalValue.slice(0, 4)}`;
}

function isValidMoneyInput(value: string) {
  return /^\d{0,9}(\.\d{0,2})?$/.test(value);
}

function isPersistableMoney(value: string) {
  return /^(?:\d+\.?\d*|\.\d+)$/.test(value.trim());
}

function matchesSearchTerm(
  values: Array<string | number | null | undefined>,
  searchTerm: string
) {
  const normalizedSearchTerm = searchTerm.trim().toLowerCase();
  if (!normalizedSearchTerm) return true;

  return values.some((value) =>
    String(value ?? "")
      .toLowerCase()
      .includes(normalizedSearchTerm)
  );
}

function createDrafts(entries: EmployeeRecurringEntryFormType[]) {
  return entries.map((entry) => ({
    localId: `saved-${entry.id}`,
    id: entry.id,
    accountCode: entry.accountCode ?? "",
    amount: formatMoneyInput(entry.amount),
    description: entry.description ?? "",
  }));
}

function cloneDrafts(drafts: RecurringEntryDraft[]) {
  return drafts.map((draft) => ({ ...draft }));
}

function serializeDrafts(drafts: RecurringEntryDraft[]) {
  return drafts.map((draft) => ({
    id: draft.id,
    accountCode: draft.accountCode,
    amount: formatMoneyInput(draft.amount),
    description: draft.description.trim(),
  }));
}

function AccountCodePicker({
  value,
  options,
  onChange,
  disabled,
  isLegacy,
}: {
  value: string;
  options: EmployeeRecurringAccountCodeOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  isLegacy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [accountCodeSearch, setAccountCodeSearch] = useState("");

  useEffect(() => {
    if (!open) {
      setAccountCodeSearch("");
    }
  }, [open]);

  const selectedOption =
    options.find((option) => option.code === value) ?? null;
  const hasLegacyValue = Boolean(isLegacy) && !selectedOption;
  const legacyDisplayValue = value.trim() || "No account code";
  const filteredOptions = options.filter((option) =>
    matchesSearchTerm(
      [option.code, option.accountType, option.description],
      accountCodeSearch
    )
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-auto min-h-9 w-full min-w-[240px] justify-between whitespace-normal px-3 py-2 text-left"
          aria-label="Search recurring entry account codes"
          aria-expanded={open}
          disabled={disabled}
        >
          <span className="min-w-0 flex-1">
            {selectedOption ? (
              <>
                <span className="block truncate">{selectedOption.code}</span>
                <span className="block truncate text-xs font-normal text-muted-foreground">
                  {[selectedOption.accountType, selectedOption.description]
                    .filter((item): item is string => Boolean(item))
                    .join(" - ")}
                </span>
              </>
            ) : hasLegacyValue ? (
              <>
                <span className="block truncate">{legacyDisplayValue}</span>
                <span className="block truncate text-xs font-normal text-muted-foreground">
                  Legacy saved row
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">Select account code</span>
            )}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[340px] p-0"
      >
        <div className="border-b p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={accountCodeSearch}
              onChange={(event) => setAccountCodeSearch(event.target.value)}
              placeholder="Search account code, type, or description..."
              aria-label="Search recurring entry account codes"
              className="pl-8"
            />
          </div>
        </div>
        <div className="max-h-72 overflow-auto p-1">
          {hasLegacyValue ? (
            <button
              type="button"
              className="flex w-full items-start gap-2 rounded-sm px-2 py-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
              onClick={() => setOpen(false)}
            >
              <Check className="mt-0.5 h-4 w-4 shrink-0 opacity-100" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {legacyDisplayValue}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  Legacy saved row
                </span>
              </span>
            </button>
          ) : null}

          {filteredOptions.map((option) => {
            const selected = option.code === value;

            return (
              <button
                key={option.id}
                type="button"
                className="flex w-full items-start gap-2 rounded-sm px-2 py-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                onClick={() => {
                  onChange(option.code);
                  setOpen(false);
                }}
              >
                <Check
                  className={cn(
                    "mt-0.5 h-4 w-4 shrink-0",
                    selected ? "opacity-100" : "opacity-0"
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{option.code}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[option.accountType, option.description]
                      .filter((item): item is string => Boolean(item))
                      .join(" - ")}
                  </span>
                </span>
              </button>
            );
          })}

          {filteredOptions.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              No account codes found.
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function RecurringEntriesTab({
  employee,
  initialEntries,
  accountCodeOptions,
}: Props) {
  const router = useRouter();
  const [savedDrafts, setSavedDrafts] = useState<RecurringEntryDraft[]>(() =>
    createDrafts(initialEntries)
  );
  const [drafts, setDrafts] = useState<RecurringEntryDraft[]>(() =>
    createDrafts(initialEntries)
  );
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const nextDrafts = createDrafts(initialEntries);
    setSavedDrafts(nextDrafts);
    setDrafts(cloneDrafts(nextDrafts));
  }, [initialEntries]);

  const accountCodeByCode = useMemo(
    () => new Map(accountCodeOptions.map((option) => [option.code, option])),
    [accountCodeOptions]
  );

  const draftErrors = useMemo(
    () => {
      const errors = new Map<string, string>();

      for (const draft of drafts) {
        const selectedAccount = accountCodeByCode.get(draft.accountCode) ?? null;
        const isLegacy = draft.id != null && !selectedAccount;

        if (isLegacy) continue;
        if (!selectedAccount) {
          errors.set(
            draft.localId,
            "Select an Other Income or Other Deduction account code."
          );
          continue;
        }
        if (!isPersistableMoney(draft.amount)) {
          errors.set(draft.localId, "Enter a valid amount.");
        }
      }

      return errors;
    },
    [accountCodeByCode, drafts]
  );

  const hasDraftErrors = draftErrors.size > 0;
  const draftDirty =
    JSON.stringify(serializeDrafts(drafts)) !==
    JSON.stringify(serializeDrafts(savedDrafts));

  function updateDraft(localId: string, updates: Partial<RecurringEntryDraft>) {
    setDrafts((current) =>
      current.map((draft) =>
        draft.localId === localId ? { ...draft, ...updates } : draft
      )
    );
  }

  function handleAddRecurringEntry() {
    const option = accountCodeOptions[0] ?? null;
    if (!option) {
      toast.error("Create an Other Income or Other Deduction account code first.");
      return;
    }

    setDrafts((current) => [
      ...current,
      {
        localId: `new-${Date.now()}-${current.length}`,
        id: null,
        accountCode: option.code,
        amount: "0.00",
        description: "",
      },
    ]);
  }

  function handleDeleteDraft(localId: string) {
    setDrafts((current) => current.filter((draft) => draft.localId !== localId));
  }

  function handleDiscardChanges() {
    setDrafts(cloneDrafts(savedDrafts));
  }

  async function handleSaveRecurringEntries() {
    if (hasDraftErrors) {
      toast.error("Resolve recurring entry row issues before saving.");
      return;
    }

    try {
      setIsSaving(true);
      const result = (await saveRecurringEntries({
        employeeId: employee.id,
        entries: drafts.map((draft) => ({
          id: draft.id,
          accountCode: draft.accountCode,
          amount: formatMoneyInput(draft.amount),
          description: draft.description,
        })),
      })) as SaveRecurringEntriesActionResult;

      if (result?.serverError) {
        throw new Error(result.serverError);
      }
      if (result?.validationErrors) {
        throw new Error("Unable to save recurring entries. Check the table values.");
      }
      if (!result?.data?.success) {
        throw new Error("Unable to save recurring entries.");
      }

      const nextDrafts = createDrafts(result.data.entries);
      setSavedDrafts(nextDrafts);
      setDrafts(cloneDrafts(nextDrafts));
      toast.success(result.data.message ?? "Recurring entries saved.");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to save recurring entries."
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="text-sm text-muted-foreground">
          {drafts.length} recurring entr{drafts.length === 1 ? "y" : "ies"}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleAddRecurringEntry}
          disabled={isSaving || accountCodeOptions.length === 0}
        >
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          Add Recurring Entry
        </Button>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account Code</TableHead>
              <TableHead>Daily Rate</TableHead>
              <TableHead>Monthly Rate</TableHead>
              <TableHead>Computed Preview</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Remarks</TableHead>
              <TableHead className="text-right">Delete</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {drafts.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  No recurring entries found.
                </TableCell>
              </TableRow>
            ) : (
              drafts.map((draft) => {
                const selectedAccount =
                  accountCodeByCode.get(draft.accountCode) ?? null;
                const isLegacy = draft.id != null && !selectedAccount;
                const draftError = draftErrors.get(draft.localId) ?? null;
                const lineType =
                  selectedAccount?.accountType === "Other Deduction"
                    ? "Deduction"
                    : "Earning";

                return (
                  <TableRow key={draft.localId}>
                    <TableCell>
                      <AccountCodePicker
                        value={draft.accountCode}
                        options={accountCodeOptions}
                        onChange={(accountCode) =>
                          updateDraft(draft.localId, { accountCode })
                        }
                        isLegacy={isLegacy}
                        disabled={isSaving}
                      />
                      {draftError ? (
                        <div className="mt-1 text-xs text-rose-700 dark:text-rose-300">
                          {draftError}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {formatDecimalUpTo4(selectedAccount?.dailyRate)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {formatDecimalUpTo4(selectedAccount?.monthlyRate)}
                    </TableCell>
                    <TableCell className="min-w-[170px] text-sm">
                      {isLegacy ? (
                        <div>
                          <div className="text-muted-foreground">Legacy row</div>
                          <div className="text-xs text-muted-foreground">
                            Select an allowed account code to edit.
                          </div>
                        </div>
                      ) : selectedAccount ? (
                        <div>
                          <div>{formatMoney(draft.amount)}</div>
                          <div className="text-xs text-muted-foreground">
                            {lineType} - {selectedAccount.accountType}
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Input
                        value={draft.amount}
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          if (!isValidMoneyInput(nextValue)) return;
                          updateDraft(draft.localId, { amount: nextValue });
                        }}
                        onBlur={() => {
                          if (!isPersistableMoney(draft.amount)) return;
                          updateDraft(draft.localId, {
                            amount: formatMoneyInput(draft.amount),
                          });
                        }}
                        inputMode="decimal"
                        aria-label={`Recurring amount for ${draft.accountCode || "row"}`}
                        className="w-32 text-right"
                        placeholder="0.00"
                        disabled={isSaving || isLegacy}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={draft.description}
                        onChange={(event) =>
                          updateDraft(draft.localId, {
                            description: event.target.value,
                          })
                        }
                        aria-label={`Recurring remarks for ${draft.accountCode || "row"}`}
                        className="min-w-[220px]"
                        disabled={isSaving || isLegacy}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleDeleteDraft(draft.localId)}
                        disabled={isSaving}
                      >
                        <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-3 border-t pt-3 text-sm md:flex-row md:items-center md:justify-between">
        <div className="text-muted-foreground">
          {draftDirty ? "Unsaved recurring entry changes" : "No unsaved changes"}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleDiscardChanges}
            disabled={!draftDirty || isSaving}
          >
            <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
            Discard Changes
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSaveRecurringEntries}
            disabled={!draftDirty || isSaving || hasDraftErrors}
          >
            <Save className="mr-2 h-4 w-4" aria-hidden="true" />
            {isSaving ? "Saving..." : "Save Recurring Entries"}
          </Button>
        </div>
      </div>
    </div>
  );
}
