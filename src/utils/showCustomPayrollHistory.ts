import { useHistoryModalStore } from "./historyModalStore";

export function showCustomPayrollHistory(employeeId: string) {
  const { openModal } = useHistoryModalStore.getState();
  openModal("CUSTOM_PAYROLL", employeeId);
}