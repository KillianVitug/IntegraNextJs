export type AppRole = "ADMIN" | "EMPLOYEE" | "MANAGER" | null;

export function getAppRoleFromConfidentialityLevel(
  level: "Rank and File" | "Supervisory" | "Managerial" | null | undefined,
): AppRole {
  if (level === "Rank and File") return "EMPLOYEE";
  if (level === "Supervisory" || level === "Managerial") return "ADMIN";
  return null;
}
