# Architecture review

Read-only review of `master` at `d8f486b` (merge of pull request #1) for long-term, nationwide, multi-tenant use. No production data was read. Effort is the size of the change, not a calendar estimate.

GitHub numbers below are the open follow-ups. “Planned storage refactor” and “planned adjusted scores” are the owner’s PR 2 and PR 3 and are not those GitHub numbers. GitHub #2 is the PBN vulnerability follow-up. GitHub #4 removes `publishBoards`. GitHub #5–#6 and #8 are the access-code, player, and agent slices.

## 1. One section document and one revision

**What.** Every stage is one `jsonb` document. A score, a confirmation, a setting, and a roster edit all read the document, run `applyMutation`, and write the whole document back if `revision` still matches.

**Evidence.** `lib/storage/neon.ts` 102–111 writes `JSON.stringify(next)` with `WHERE revision = command.revision`. `lib/mutations/apply.ts` 13–16 rejects any other revision with `stage-revision`, then 156–157 keeps only the last 500 request ids. `lib/storage/local.ts` 122–124 does the same replace under an in-process lock. `lib/club-submit.ts` 10–19 retries only when the conflict code is `stage-revision` and the cell timestamp is unchanged.

**Risk.** High. Two tables scoring at once on a 100-table event collide on one row. The phone retry avoids rewriting a cell another table already changed, but it does not remove the conflict. Idempotency is lost after 500 later requests.

**Effort.** Large: new result rows, a request table, and round locks. That is the planned storage refactor, not a patch on the current write.

**Fix.** Keep the section document for settings, movement, and roster. Give each `(section, assignment, board)` its own revision. Store idempotency outside the document. Do not start adjusted scores until that row exists.

## 2. Capacity limits and read amplification

**What.** A competition can hold at most 32 stages. Local mode rejects a 51st competition. Public and admin reads send `Cache-Control: no-store`. Every mutation rebuilds the projection from the full result map.

**Evidence.** `lib/storage/neon.ts` 170–171 (`< 32`). `lib/storage/local.ts` 102–105 (`最多 50 場賽事`). `app/api/events/[id]/route.ts` 14–16. `lib/mutations/apply.ts` 157 calls `project(e)` on every successful command. `lib/storage/neon.ts` 41 builds the event index with one large `jsonb` expression per row.

**Risk.** High for spectator load and for a season with many organizers. Medium for the 32-stage cap (a long congress can hit it). The index query is a single point of CPU on every admin list.

**Effort.** Medium once result rows exist: cache the public projection with a watermark, and set a short `s-maxage` plus `stale-while-revalidate`. The stage cap is a small constant change but should wait until tenants exist, or one organizer’s archive will fill a global limit.

**Fix.** Do the cache with the storage refactor. Do not turn on CDN caching of the public JSON before the in-play board filter (`lib/public-event.ts` 10–16) is covered by tests, which it now is.

## 3. Auth and sessions

**What.** Two environment passwords cover the whole site. The session is a stateless HMAC. Logout deletes the cookie and does not record a revocation. Login limiting is per IP and counts failures only.

**Evidence.** `lib/auth.ts` 5–31 and 39–48. `lib/session-token.ts` 10–12 (payload is `role:expiry:mac`). `app/api/session/route.ts` 33–38 counts a failure, 38 clears it on success, 55–60 deletes the cookie. `lib/login-limit.ts` 9–17 keys the limiter by hashed client IP.

**Risk.** High for nationwide use. A shared director password cannot be scoped to one organizer or revoked for one browser. A copied cookie works until it expires or the password changes. The IP limiter is correct for the current login form and should stay failure-only.

**Effort.** Large, and already started as GitHub #5 (codes and audit), #6 (players), #8 (agent API). Replacing `app/api/session/route.ts` is the cutover, not part of #5.

**Fix.** Land the code model and the migration script before switching the live login. Keep `ADMIN_PASSWORD` / `DIRECTOR_PASSWORD` working until the owner decides whether today’s staff password becomes the site admin (the open question in #5).

## 4. API shape and errors

**What.** Mutations are one discriminated union posted to a stage. Domain errors have an optional `code`, but the HTTP body returns only the Chinese string. There is no OpenAPI document and no dry-run on `master`.

**Evidence.** `lib/model.ts` mutation union (the `action` literals from about line 237). `lib/domain-error.ts` 1–8. `lib/http.ts` 53–56 omits `error.code`. `lib/mutations/apply.ts` 16 uses `stage-revision`, which clients must match by importing the class, not by reading JSON.

**Risk.** Medium now, high once agents call the API. A retry cannot tell `REVISION_CONFLICT` from a settled table if it only sees the message.

**Effort.** Small to add `code` to `errorResponse`. Medium to add the agent routes described in GitHub #8. The library functions in #8 should not be mounted until event codes from #5 can authorize them.

**Fix.** Put the machine code on every `DomainError` response before the agent routes exist. Map `stage-revision` to `REVISION_CONFLICT` at that boundary.

## 5. Audit and idempotency inside the document

**What.** The audit log and the request-id list are arrays on the stage document. Both are capped.

**Evidence.** `lib/mutations/apply.ts` 109–157 pushes an audit entry that may include full before/after results, then `requests.slice(-500)`. `lib/competition-record.ts` 53 and 61 do the same for competition metadata.

**Risk.** Medium. A long event drops old request ids and can apply a retry twice. Large `changes` arrays make every score write heavier. Organizers cannot get an append-only log scoped to their tenant because the log is inside the scoring document.

**Effort.** Medium, and it belongs with the storage refactor (a `result_events` table) plus the access audit in GitHub #5. Do not cap the new tables at 500.

**Fix.** Append-only audit keyed by actor code, with `viaAgent`. Keep the JSON audit only until that table is backfilled.

## 6. Legacy publication flag

**What.** A board is public when `board.published` is set, otherwise when the event-level `publishBoards` flag is set.

**Evidence.** `lib/public-event.ts` 5. The same fallback is in `lib/discussion.ts`, `lib/board-publication-ready.ts`, `lib/mutations/deals.ts`, and `components/admin/PublicationPanel.tsx`.

**Risk.** Medium. Two sources of truth. A migration that drops the flag without copying it onto each board would hide or reveal deals. The 11月社內賽 deals must not be rewritten while that flag is removed.

**Effort.** Small. GitHub #4 already does the copy, verifies the public view, and refuses to open a database.

**Fix.** Merge #4 before any storage backfill that rewrites documents, and run its script on a copy, not on production.

## 7. Adjusted scores

**What.** `average` is not a scoring state. Import rejects it. Anything still stored as `average` is treated as cancelled.

**Evidence.** `lib/imports.ts` rejects the CSV token (covered by `tests/results-import.test.ts`). `lib/result-status.ts` 3–10 maps `average` to `cancelled` on normalize.

**Risk.** Medium for law-compliant adjusted scores (A+ / A / A−). Low for tonight, because the import no longer silently stores a fake cancellation.

**Effort.** Medium, and it should wait for per-board rows so the new status is not another field inside the contended document.

**Fix.** Planned adjusted-score work after the storage refactor. Do not change `normalizeResults` until the new status exists, or old documents will change meaning.

## 8. Tests and CI

**What.** Unit tests are broad (88 `tests/*.test.ts` files) and CI runs them, plus a production build, `npm audit`, a secret scan, and one smoke script. CI has no Postgres service, no ESLint, and no browser job.

**Evidence.** `.github/workflows/check.yml` 8–21. `package.json` has no `lint` script. Concurrency coverage is the phone-retry helper and in-memory locks, not many database connections.

**Risk.** Medium. A row-level storage design can pass unit tests and still deadlock or lose updates under real sessions. Visual tests exist (`test:visual`) but are not in this workflow.

**Effort.** Medium to add a Postgres service and a concurrency test. Small to add ESLint once the rule set is chosen.

**Fix.** Add the database service in the storage-refactor PR, not before, or the job has nothing new to run. Add ESLint in the lint/vendor PR.

## 9. Dependencies and vendor tarballs

**What.** `package.json` depends on `vendor/valet-deal-viewer-1.3.11.tgz`. Thirteen older tarballs are still in `vendor/`. There is no ESLint config. `package-lock.json` is present and CI uses `npm ci`.

**Evidence.** `package.json` dependency `@valet/deal-viewer`. `vendor/` contains `1.1.0`, `1.2.0`, and `1.3.0` through `1.3.11`. `next.config.ts` 16–27 sets `nosniff`, `Referrer-Policy`, and `X-Frame-Options`, and does not set `Content-Security-Policy`.

**Risk.** Low for the extra tarballs (confusion and review noise, not a runtime bug). Medium for CSP: `app/layout.tsx` 26–35 loads `/theme.js` and an inline font script, and the deal viewer plus the DDS worker (`public/dds-worker.js`) need `worker-src` and `wasm-unsafe-eval` or the enforced policy will blank the page.

**Effort.** Small to delete the unused tarballs and add ESLint. Medium to ship a nonce-based CSP without forcing every page to be dynamic, because Google fonts and inline styles are still in `app/layout.tsx` 6–35.

**Fix.** Land lint and the tarball deletion together. Start CSP as Report-Only until the deal viewer and the font script are verified.

## 10. Migrations

**What.** Schema setup is one idempotent script. There is no version table and no down migration.

**Evidence.** `scripts/migrate.ts` 7–11 creates `bridge_events`, `bridge_login_limits`, and the discussion table with `CREATE TABLE IF NOT EXISTS`.

**Risk.** Medium. The next real schema (result rows, access codes) cannot be distinguished from “script has been run”. Running it is safe today. Pointing a later data rewrite at production without a copy is not.

**Effort.** Small to add `schema_migrations`. The data moves (publication flags, access codes, result rows) must each be a separate script that refuses `DATABASE_URL` unless an operator passes an explicit flag.

**Fix.** Keep #4 and #5 scripts local-file-only until an operator schedules them. Do not fold them into `scripts/migrate.ts`.

## 11. Observability

**What.** Failures log an error name. There is no request id, no structured log, and no metrics.

**Evidence.** `lib/http.ts` 58. Smoke scripts use `console.log` / `console.error` only.

**Risk.** Medium once many events are live. A 409 storm or a slow public read will not be attributable to an event or a table.

**Effort.** Small to log `event id`, status, and `DomainError.code` without logging passwords, tokens, or deal cards. Larger if an external collector is added.

**Fix.** Do this before the agent API is exposed. Do not log access-code secrets or email addresses.

## 12. Accessibility and language

**What.** The UI is Traditional Chinese only. Interactive controls often have names. There is no locale switch and no documented screen-reader pass of the scoreboard.

**Evidence.** `app/layout.tsx` 16 (`lang="zh-Hant"`). Strings throughout `components/` are Chinese literals. `components/competition-hub.tsx` and `app/club/page.tsx` set `aria-label` on some controls. `tests/scoreboard-views.test.ts` checks a few `aria-checked` values.

**Risk.** Low for a Taiwan-only product. Medium if a later English or screen-reader requirement appears, because copy is not in a catalog. Nationwide use does not require a second language.

**Effort.** Large to internationalize. Small to keep new access-code screens on the same `aria-label` pattern.

**Fix.** Do not start an i18n project. Require labels on the new code and QR screens in #5.

## 13. Code shape

**What.** Domain logic is testable and split by mutation. The two repositories and a few UI files are long and repeated. Some “legacy” branches remain on purpose.

**Evidence.** `lib/storage/neon.ts` (207 lines) and `lib/storage/local.ts` (187 lines) both implement the same repository, including the 32-stage and revision checks. `lib/model.ts` is 733 lines and holds every mutation schema. `components/scoreboard.tsx` is 811 lines. `lib/storage/neon.ts` 41 is a single SQL statement that duplicates the TypeScript event shape. `lib/result-status.ts` 3–10 and `lib/public-event.ts` 5 are intentional compatibility branches, not unused code. `lib/domain/demo-events.ts` still sets `publishBoards` for the demo.

**Risk.** Medium. A storage change has to be made twice (Neon and local) or local mode drifts. The giant index SQL will not be updated when a field is added to the list UI.

**Effort.** Medium to share the write rules. Not a prerequisite for the storage refactor; the new path should be Neon-only and local mode can stay on the document.

**Fix.** Let the planned storage refactor add the new tables only in `neon.ts`. Keep local mode on the JSON document so the club laptop path does not need Postgres.

## Priority

1. **Storage refactor (planned PR 2).** Highest risk. Unblocks adjusted scores, a real idempotency log, and public caching. Include a Postgres concurrency test in CI.
2. **Keep GitHub #4 (publishBoards) ahead of that backfill.** Small, and it removes a second source of truth before documents are copied into new tables.
3. **Access codes (GitHub #5, then #6, then #8).** Required for multi-tenant use. Do not switch the live password login until the owner answers the staff-versus-admin question. Do not mount the agent routes before event codes can authorize them.
4. **Return `error.code` from `lib/http.ts`.** Small, and #8’s machine codes depend on it.
5. **Lint and vendor tarballs.** Independent. Do it before CSP so the config is already in CI.
6. **CSP, Report-Only first.** Depends on fonts, `/theme.js`, and the DDS worker. Not related to scoring correctness.
7. **Adjusted scores (planned PR 3).** After result rows. Leave `normalizeResults` alone until then.
8. **Request logging of ids and codes.** Before agent traffic. Not a substitute for the audit table.
9. **i18n.** Not needed for this product.

Tonight’s event stays on the current document store and the current two passwords. None of the follow-ups should be merged for that session, and none of them should be run against event `58f461bf-e3df-4dab-b5ac-88ba69025f2d`.
