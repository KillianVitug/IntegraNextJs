import { useHistoryModalStore } from "./historyModalStore";

export function showRateHistory(employeeId: string) {
  const { openModal } = useHistoryModalStore.getState();
  openModal("RATE", employeeId);
}