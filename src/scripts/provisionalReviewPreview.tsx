import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ProvisionalReviewDayList, ProvisionalReviewFilters } from "@/app/(ntg)/payroll/provisional/review-filters";
import { employeeReviewReasons, provisionalCountLabel, summarizeProvisionalView, type ProvisionalView } from "@/lib/payroll/provisionalReview";
import { reviewFixtureRows, reviewFixtureScope } from "./provisionalReviewFixture";

function Preview() {
  const [view, setView] = useState<ProvisionalView>("all"), [query, setQuery] = useState(""), [opened, setOpened] = useState("");
  const rows = reviewFixtureRows.filter(row => `${row.name} ${row.employeeNo}`.toLowerCase().includes(query.toLowerCase()));
  const result = summarizeProvisionalView(rows, view, reviewFixtureScope);
  return <main className="mx-auto max-w-3xl space-y-4 p-3"><header><h1 className="text-xl font-semibold">Provisional filters · fictional verification</h1><p className="text-sm">Actual filter and dated-action components. No attendance or payroll writes.</p></header><label className="block text-xs">Find employee<input className="mt-1 block min-h-11 w-full rounded-lg border px-3" placeholder="Name or employee number" type="search" value={query} onChange={event => setQuery(event.target.value)}/></label><ProvisionalReviewFilters rows={rows} view={view} scope={reviewFixtureScope} onChange={setView}/><p role="status">{opened || provisionalCountLabel(result.employeeCount, result.dayCount)}</p><div className="divide-y rounded-xl border">{result.matches.map(({row}) => <article className="p-3" key={row.employeeId}><h2 className="font-semibold">{row.name}</h2><p className="text-xs">{row.employeeNo} · {row.departmentName}</p>{employeeReviewReasons(row, view, reviewFixtureScope).map(reason => <p key={reason} className="mt-2 text-sm">{reason}</p>)}<ProvisionalReviewDayList row={row} view={view} scope={reviewFixtureScope} onOpen={(date, edit) => setOpened(`Opened ${edit} for ${row.name} on ${date}; ${view} filter retained`)} holdHref={date => `#hold-${date}`}/></article>)}</div>{!result.employeeCount && <p>No employees match this filter and search.</p>}</main>;
}
if (typeof document !== "undefined") createRoot(document.getElementById("root")!).render(<Preview/>);
