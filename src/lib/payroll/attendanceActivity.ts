export type AttendanceActivityKind="Phone sync"|"Uploaded file"|"Admin correction";
export function attendanceActivityKind(sourceFormat:string,fileName:string):AttendanceActivityKind {
  if(fileName.startsWith("admin-decision:")||fileName.startsWith("manual-dtr:")||fileName.startsWith("attendance-resolution:"))return "Admin correction";
  return sourceFormat==="API"?"Phone sync":"Uploaded file";
}
export function attendanceActivityCounts(kind:AttendanceActivityKind,counts:{received?:number;changed?:number;projected?:number;matchedRows?:number;unmatchedRows?:number}) {
  if(kind==="Admin correction")return "Approved local attendance; original phone captures retained";
  if(kind==="Phone sync")return `${counts.received??0} captures checked · ${counts.changed??0} source changes · ${counts.projected??0} payroll input updates`;
  return `${counts.matchedRows??0} matched · ${counts.unmatchedRows??0} unmatched rows`;
}
