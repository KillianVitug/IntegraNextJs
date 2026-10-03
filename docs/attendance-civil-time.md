# Attendance civil-clock correction

Day and overnight attendance must produce the same minutes on servers running
in UTC, Manila or another timezone. Calculations now use the canonical Manila
`logDate` and `logTime`; source timestamps remain unchanged for storage and audit.
This includes sorting, overnight assignment, night minutes and approved missing-out
corrections. A day from 08:00 to 17:00 with a 60-minute break and an overnight
22:00 to 06:00 both produce 480 minutes.

This change is independent of the attendance API connector. It adds no schema,
credentials, API route, scheduler, dependency or feature flag. It affects existing
CSV/TXT imports and subsequent DTR refreshes; it does not rewrite stored summaries
or posted payroll. Review affected open-period summaries before recomputation.

Run `npm run verify:attendance-parser` and `npm run verify:attendance-civil-time`.
The second command checks 45 file/database timestamp cases across three host
timezones, DST boundaries, overnight grouping, timestamp preservation and approved
corrections. It needs no live database or attendance service. These are attendance
calculation checks, not statutory-payroll certification.
