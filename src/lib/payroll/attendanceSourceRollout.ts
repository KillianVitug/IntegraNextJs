import { PayrollValidationError } from "./validation";

/** An optional deployment cutoff protects payroll prepared before API cutover. */
export function attendanceSourceStartDate(value = process.env.ATTENDANCE_SOURCE_START_DATE) {
  const date = value?.trim();
  if (!date) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
    throw new PayrollValidationError("Attendance connection start date is invalid. Ask the administrator to correct the deployment configuration.");
  }
  return date;
}

export function assertAttendanceSourcePeriodAllowed(periodStart: string, startDate = attendanceSourceStartDate()) {
  if (startDate && periodStart < startDate) {
    throw new PayrollValidationError(`Attendance API syncing starts with periods beginning ${startDate}. This earlier period retains its existing payroll input.`);
  }
}
