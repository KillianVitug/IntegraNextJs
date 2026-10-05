/** API v2 transport. It accepts a server-provided credential; it never reads browser storage. */
export type SourcePunch = {
  eventId: string; branchId: string; employeeId: string; employeeName: string;
  originalEmployeeId: string; originalEmployeeName: string; type: "IN" | "OUT";
  capturedAt: string; receivedAt: string; updatedAt: string; status: "VALID" | "VOID";
  originalType?: "IN" | "OUT"; originalCapturedAt?: string; effectiveRevision?: string; unifiedRevision?:string; clockVerified?: boolean; inRequestedWindow?: boolean;
  correctionVersion?: string; deviceId?: string; duplicateExcluded?: boolean; duplicateGroupId?: string; clockFlag: boolean; reviewFlags: string[]; reviewResolved: boolean;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const code = /^[A-Za-z0-9_-]{1,64}$/;
const instant = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(s) && Number.isFinite(Date.parse(s));
export function assertDateRange(from: string, through: string) {
  for (const d of [from, through]) if (!/^\d{4}-\d\d-\d\d$/.test(d) || !Number.isFinite(Date.parse(d)) || new Date(d).toISOString().slice(0, 10) !== d) throw Error("Invalid attendance date range");
  if (from > through || Date.parse(through) - Date.parse(from) > 365 * 86400000) throw Error("Attendance date range exceeds 366 days");
}
export function manilaWallTime(instant: string) {
  const wall = new Date(Date.parse(instant) + 8 * 3600000).toISOString();
  return { date: wall.slice(0, 10), time: wall.slice(11, 23), timestamp: wall.slice(0, 23).replace("T", " ") };
}
export const sourceDayOffset = (date: string, days: number) => new Date(Date.parse(date + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
export async function pullAttendanceSource(options: { origin: string; token: string; from: string; through: string; fetcher?: typeof fetch; version?: 2 | 3 }) {
  assertDateRange(options.from, options.through);
  const origin = new URL(options.origin);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") throw Error("Configure an HTTPS attendance origin");
  if (options.token.length < 32) throw Error("Attendance server credential is missing");
  const records: SourcePunch[] = []; let cursor: string | null = null; let lastId = "";
  for (let page = 0; page < 250; page++) {
    const url = new URL("/v1/payroll/attendance", origin);
    url.search = new URLSearchParams({ version: String(options.version??2), from: options.from, through: options.through, limit: "500", ...(cursor ? { cursor } : {}) }).toString();
    const response = await (options.fetcher ?? fetch)(url, { headers: { Authorization: `Bearer ${options.token}` }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw Error(`Attendance server returned ${response.status}`);
    if (!response.headers.get("content-type")?.includes("application/json")) throw Error("Attendance server did not return JSON");
    const reader = response.body?.getReader(); if (!reader) throw Error("Attendance response is empty");
    const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 2000000) { await reader.cancel(); throw Error("Attendance page is too large"); } chunks.push(part.value); } } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let at = 0; for (const part of chunks) { bytes.set(part, at); at += part.length; }
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (data.schemaVersion !== (options.version??2) || data.timeZone !== "Asia/Manila" || data.from !== options.from || data.through !== options.through || !Array.isArray(data.records) || data.records.length > 500) throw Error("Attendance response contract changed");
    for (const value of data.records) {
      const r = value as SourcePunch;
      if (!r || !uuid.test(r.eventId) || r.eventId <= lastId || !code.test(r.employeeId) || !code.test(r.originalEmployeeId) || !code.test(r.branchId) || !["IN", "OUT"].includes(r.type) || !["VALID", "VOID"].includes(r.status) || !instant(r.capturedAt) || !instant(r.receivedAt) || !instant(r.updatedAt) || typeof r.employeeName !== "string" || r.employeeName.length > 100 || typeof r.originalEmployeeName !== "string" || r.originalEmployeeName.length > 100 || typeof r.clockFlag !== "boolean" || typeof r.reviewResolved !== "boolean" || !Array.isArray(r.reviewFlags) || r.reviewFlags.length > 20 || r.reviewFlags.some(f => typeof f !== "string" || f.length > 100)) throw Error("Invalid or duplicated source attendance event");
      if (r.correctionVersion !== undefined && r.correctionVersion !== "original" && !uuid.test(r.correctionVersion)) throw Error("Invalid source correction version");
      if (r.deviceId !== undefined && !uuid.test(r.deviceId)) throw Error("Invalid source device");
      if (r.duplicateExcluded !== undefined && typeof r.duplicateExcluded !== "boolean") throw Error("Invalid duplicate exception");
      if (r.duplicateGroupId !== undefined && !uuid.test(r.duplicateGroupId)) throw Error("Invalid duplicate group");
      if(options.version===3&&(!instant(r.originalCapturedAt)||!["IN","OUT"].includes(r.originalType??"")||typeof r.clockVerified!=="boolean"||typeof r.inRequestedWindow!=="boolean"||r.effectiveRevision!=="original"&&!uuid.test(r.effectiveRevision??"")))throw Error("Invalid source correction evidence");
      if(options.version===3&&!/^[0-9a-f]{64}$/.test(r.unifiedRevision??""))throw Error("Invalid unified source revision");
      const day = manilaWallTime(r.capturedAt).date;
      if(options.version===3&&r.inRequestedWindow!==(day>=options.from&&day<=options.through))throw Error("Source date-window evidence is inconsistent");
      if ((day < options.from || day > options.through) && !(options.version===3&&r.inRequestedWindow===false)) throw Error("Source event falls outside the requested period");
      // Date-window membership belongs to this response, not the global capture.
      // Persisting it would make adjacent period pulls invalidate each other.
      const stored={...r};delete stored.inRequestedWindow;
      records.push(stored); lastId = r.eventId;
    }
    if (records.length > 100000) throw Error("Split attendance reconciliation into smaller periods");
    if (data.nextCursor === null) return records;
    if (!uuid.test(data.nextCursor) || data.nextCursor !== lastId || !data.records.length || data.nextCursor === cursor) throw Error("Invalid attendance pagination cursor");
    cursor = data.nextCursor;
  }
  throw Error("Attendance pagination did not finish");
}
