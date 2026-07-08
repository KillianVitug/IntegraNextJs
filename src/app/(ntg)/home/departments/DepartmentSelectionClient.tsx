"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { HomeDepartmentCardData } from "@/lib/queries/home";
import {
  formatEmployeeNoDisplay,
  getEmployeeTypeDisplay,
} from "@/utils/employeeDisplay";

type Props = {
  cards: HomeDepartmentCardData[];
};

function getEmptyMessage(card: HomeDepartmentCardData) {
  if (card.isUnassigned) {
    return "No employees are currently waiting for department assignment.";
  }

  return "No employees are currently assigned to this department.";
}

export function DepartmentSelectionClient({ cards }: Props) {
  const [selectedKey, setSelectedKey] = useState<string | null>(
    cards[0]?.selectionKey ?? null
  );

  useEffect(() => {
    if (cards.length === 0) {
      setSelectedKey(null);
      return;
    }

    if (!cards.some((card) => card.selectionKey === selectedKey)) {
      setSelectedKey(cards[0]?.selectionKey ?? null);
    }
  }, [cards, selectedKey]);

  const selectedCard =
    cards.find((card) => card.selectionKey === selectedKey) ?? cards[0] ?? null;

  if (cards.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No department cards are available yet. Add departments or employee
          records to populate this view.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => {
          const isSelected = card.selectionKey === selectedCard?.selectionKey;

          return (
            <button
              key={card.selectionKey}
              type="button"
              onClick={() => setSelectedKey(card.selectionKey)}
              aria-pressed={isSelected}
              className="h-full w-full text-left"
            >
              <Card
                className={cn(
                  "h-full transition hover:-translate-y-1 hover:shadow-md",
                  isSelected &&
                    "border-sky-500 bg-sky-50/80 shadow-md dark:border-sky-400 dark:bg-sky-950/20",
                  card.isUnassigned &&
                    !isSelected &&
                    "border-amber-300 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/20"
                )}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <CardTitle>{card.name}</CardTitle>
                      <CardDescription>
                        {card.isUnassigned
                          ? "Employees without a department assignment"
                          : `Department code: ${card.code}`}
                      </CardDescription>
                    </div>
                    <span
                      className={cn(
                        "rounded-full px-3 py-1 text-xs font-medium",
                        isSelected
                          ? "bg-sky-600 text-white dark:bg-sky-500"
                          : "bg-secondary text-secondary-foreground"
                      )}
                    >
                      {isSelected
                        ? "Selected"
                        : card.isUnassigned
                          ? "Needs attention"
                          : card.code}
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Assigned employees
                  </p>
                  <p className="text-4xl font-semibold tracking-tight">
                    {card.employeeCount}
                  </p>
                </CardContent>
              </Card>
            </button>
          );
        })}
      </div>

      {selectedCard && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>
              {selectedCard.isUnassigned
                ? "Unassigned Employees"
                : `Employees in ${selectedCard.name}`}
            </CardTitle>
            <CardDescription>
              {selectedCard.isUnassigned
                ? "Employees without a department assignment, including their current positions."
                : `${selectedCard.employeeCount} employee${
                    selectedCard.employeeCount === 1 ? "" : "s"
                  } currently assigned to this department.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee No.</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Employee Name</TableHead>
                  <TableHead>Current Position</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {selectedCard.employees.map((employee) => (
                  <TableRow key={employee.employeeId}>
                    <TableCell>
                      {formatEmployeeNoDisplay(employee.employeeNo) || "-"}
                    </TableCell>
                    <TableCell>
                      {getEmployeeTypeDisplay({
                        employeeType: employee.employeeType,
                        employeeNo: employee.employeeNo,
                      }) || "-"}
                    </TableCell>
                    <TableCell className="font-medium">
                      {employee.fullName}
                    </TableCell>
                    <TableCell>{employee.position ?? "-"}</TableCell>
                  </TableRow>
                ))}

                {selectedCard.employees.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="py-10 text-center text-muted-foreground"
                    >
                      {getEmptyMessage(selectedCard)}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
