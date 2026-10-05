/** Display-only matching aids. A suggested employee is never a verified identity. */
export type AttendancePerson = {
  sourceId: string;
  names: string[];
  branches: string[];
  punchCount: number;
  validCount: number;
  lastCapturedAt: string;
};
export type PayrollMatchEmployee = { id: string; employeeNo: string; name: string };
export type EmployeeMatch = { sourceId: string; employeeId: string };
export type MatchSaveResult = { ok: true; data: string } | { ok: false; error: string };

export function searchableName(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function nameKey(value: string) { return searchableName(value).split(/\s+/).sort().join(" "); }
function codeKey(value: string) { return /^\d+$/.test(value.trim()) ? value.trim().replace(/^0+(?=\d)/, "") : value.trim(); }
export function matchesSearch(query: string, ...values: string[]) {
  const haystack = searchableName(values.join(" "));
  return searchableName(query).split(/\s+/).every(word => haystack.includes(word));
}
export function matchHint(person: AttendancePerson, employee: PayrollMatchEmployee) {
  const sameName = person.names.some(name => nameKey(name) && nameKey(name) === nameKey(employee.name));
  const sameCode = codeKey(person.sourceId) === codeKey(employee.employeeNo);
  return sameName && sameCode ? "Name and employee number match. Verify the person." : sameName ? "Same name. Verify the employee number." : sameCode ? "Same employee number. Check the name carefully." : null;
}
export function suggestedEmployees(person: AttendancePerson, employees: PayrollMatchEmployee[]) {
  return employees.map(employee => ({ employee, hint: matchHint(person, employee), score:
    (person.names.some(name => nameKey(name) && nameKey(name) === nameKey(employee.name)) ? 2 : 0) +
    (codeKey(person.sourceId) === codeKey(employee.employeeNo) ? 1 : 0) }))
    .filter(result => result.score > 0).sort((a, b) => b.score - a.score || a.employee.name.localeCompare(b.employee.name)).slice(0, 5);
}
export const verificationMethods = [
  { value: "roster", label: "Checked HR's employee record" },
  { value: "supervisor", label: "Confirmed with the branch supervisor" },
  { value: "employee", label: "Confirmed directly with the employee" },
  { value: "other", label: "Other evidence" },
] as const;
export function verificationReason(method: string, note: string) {
  const selected = verificationMethods.find(item => item.value === method);
  if (!selected || method === "other" && !note.trim()) return null;
  return `${selected.label}.${note.trim() ? ` ${note.trim()}` : ""}`;
}
