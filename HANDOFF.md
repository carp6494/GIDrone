# HANDOFF.md

Last updated: 2026-09-24. Replace this file at the end of every session.

## Where things stand

- App is at v0.4.0 (released 2026-03-19). No feature work is in flight.
- Backend was found paused on 2026-09-20 and restored. NOTAM pipeline is verified: notam-sync runs every 15 min via pg_cron job `notam-sync-15min` (Vault-backed anon key), table updates within seconds of each tick. Obstruction sync workflow re-enabled on GitHub (it had auto-disabled for inactivity).
- Review Phase A is complete (see `docs/superpowers/reviews/2026-09-22-findings.md`). npm audit is at 0. ESLint added. Two S1 security fixes applied as migration `20260922000000_review_phase_a_security.sql`.
- Two plans exist and are unexecuted beyond Phase A:
  - `docs/superpowers/plans/2026-09-22-code-review.md` (Phases B-E remain)
  - `docs/superpowers/plans/2026-09-22-map-cost-control.md` (nothing started)
- Working tree clean, `main` pushed.

## In progress

Nothing mid-task.

## Blocked

- Mapbox token URL restriction (map cost plan Task 1) needs the owner signed in to the Mapbox dashboard; no API connection exists for Mapbox.
- FAA NOTAM credentials work today but the 2026-05-06 portal migration was never confirmed on the FAA side. If notam-sync starts returning 502 auth errors, that is the first suspect. Contact 9-ait-api-c4e@faa.gov.

## What comes next

1. Code review Phase B: `/code-review medium` per path as listed in the plan, one path per prompt. Log findings into the reviews file with severity.
2. Then Phases C (smoke test in Chrome, 21 rows), D (data spot checks), E (fix S1/S2, tag v0.4.1).
3. Map cost plan, all tasks. Expect about 5 map loads per session to drop to about 1.3.

## Notes for the next session

- Open S1 items still in the findings log: #1 OpenWeatherMap key in bundle, #2 CORS `*`, #3 no JWT/rate limit on Edge Functions, #4 sync tokens unset, #5 shared Supabase project. #9 (prune_notam_feed search_path + anon exec) is a one-line S3 fix.
- Cosmetic: the cron's `net.http_post` has a 5 s default timeout and the function takes ~4.9 s, so `net._http_response` logs timeouts even though syncs succeed. Add `timeout_milliseconds := 30000` when convenient.
- ESLint errors are mostly `react-hooks/set-state-in-effect` (14 sites). The 27 `exhaustive-deps` warnings are the ones worth reading in Phase B.
- Supabase org is on the free plan. Free-tier limits that matter at scale: 2 magic-link emails/hour without custom SMTP, 500k Edge Function calls/month, project pauses after 7 idle days.
- The Windows Terminal "GIDrone" profile background was rebuilt on 2026-09-20; unrelated to the codebase.
