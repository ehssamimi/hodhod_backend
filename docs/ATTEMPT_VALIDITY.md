# BE-18: attempt validity and rate limits

What the server checks on POST /attempts (all before anything is stored):

- identity: a valid, unrevoked student session; the attempt ID belongs to no other student
- content: published, with a released version; Adventure content must be on the map and unlocked for this student
- access: assignment attempts need a scheduled assignment addressed to the student in their current class
- time: the assignment window is judged by the database clock; receipt time is the database clock
- stars: 0 up to the applicable rule ceiling
- replay: the same attempt ID with the same data returns the stored result, different data is refused
- rate: at most ATTEMPTS_PER_MINUTE (default 30) submissions per account per minute, counted in the
  database (shared by all instances) and including rejected ones; excess gets 429

Rejected submissions store no attempt but write an append-only row to suspicious_events with a
reason code (see GET /admin/suspicious-events, admin only). Accepted attempts that report a passing
result faster than ATTEMPT_MIN_PLAUSIBLE_SECONDS (default 3) are stored and flagged
implausible_duration for review; they are not refused.

## Limit that cannot be removed on the server

The game runs in Unity on the student's device and sends only the final star count and a duration.
The backend cannot verify that the stars were earned by playing. Any modified client that holds a
valid session can submit any star value within the ceiling, at a plausible speed and rate. The checks
above bound and trace abuse; they do not prove performance. Provable results would need data the
game can send for verification (for example a signed play transcript or server-side replay), which
does not exist yet. This limit must be weighed before publishing the ranking (BE-20) publicly.
