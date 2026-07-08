import { create } from "zustand";

export type HistoryModalType = "RATE" | "CUSTOM_PAYROLL" | null;

type HistoryModalState = {
  open: boolean;
  type: HistoryModalType;
  employeeId?: string;
  openModal: (type: HistoryModalType, employeeId: string) => void;
  closeModal: () => void;
};

export const useHistoryModalStore = create<HistoryModalState>((set) => ({
  open: false,
  type: null,
  employeeId: undefined,
  openModal: (type, employeeId) =>
    set({ open: true, type, employeeId }),
  closeModal: () =>
    set({ open: false, type: null, employeeId: undefined }),
}));