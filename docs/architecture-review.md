# Architecture review

Review of `master` at `d07e0cf` (pull request #22). No production data was read. Effort is the size of the change, not a calendar estimate.

Production already runs the normalized store. The storage switch is `normalized`. The stages 預演, 正賽, and 11月社內賽 were merged into competition `8b01f0c3-dc13-4a5f-9178-cae97fdf5b44`. The operator steps are `docs/storage-migration.md`. Legacy mode is still in the code and must keep today’s behavior; it is not what production reads.

GitHub numbers below are the open follow-ups. GitHub #2 is the PBN vulnerability follow-up. GitHub #9 is this review. GitHub #4 removes `publishBoards`. GitHub #5, #6, and #8 are the access-code, player, and agent slices. Adjusted scores are still not on `master`.

## 1. Stage settings, board rows, and result rows

**What.** `createNeonRepository` (`lib/storage/neon.ts` 216–222) reads `bridge_storage_switch` and dispatches. In `normalized` mode a stage is not one `bridge_events` document. Settings and the cached projection sit on `bridge_stages`. Each board is one `bridge_boards.document_json` text value. Each score is one `bridge_results` row keyed by event, assignment, and board, with its own `written_at_event_revision`. Participants, assignments, penalties, audit, and request ids are their own tables (`lib/storage/schema.ts`, `lib/storage/rows.ts`). A score, a ruling, a cleared cell, or a split contract conflicts only when that same assignment and board has moved (`lib/storage/cell-write.ts` 9–27, `lib/storage/rows.ts` 139–145). Any other command still requires the stage revision. The normalized path passes `durableRequests` so request ids are not cut at 500 (`lib/storage/normalized.ts` 231, `lib/mutations/apply.ts` 160–162).

Legacy mode is the old path. `lib/storage/neon.ts` 109–113 still writes `JSON.stringify(next)` into `bridge_events` when `revision` matches. `lib/storage/local.ts` does the same replace under an in-process lock. Both still keep only the last 500 request ids. `lib/club-submit.ts` 19 retries only when the conflict code is `stage-revision` and the cell timestamp is unchanged.

**Risk.** Medium for live scoring. Two tables entering different boards no longer lose one write to a single document revision; the loser retries, up to six attempts (`lib/storage/normalized.ts` 227). The same table and board still conflict, which is the intended rule. A score save still deletes and reinserts every board, participant, assignment, penalty, and audit row in that transaction (`lib/storage/rows.ts` 66–97), so the write is larger than the one result cell. Settings, movement, and roster edits still collide on the stage revision. If the switch is `legacy`, the whole-document collision and the 500-id cap are unchanged.

**Effort.** The table split has landed. What remains is smaller: stop rewriting untouched board and audit rows on a score, and decide whether non-score commands need a narrower lock. Do not start that by putting new fields back into `bridge_events`.

**Fix.** Keep new persisted fields in additive, idempotent tables or columns, with a step in `scripts/migrate.ts` and the same field in `migrate-data` and `restore-legacy` when the legacy document must round-trip. Leave the 15 deals of event `58f461bf-e3df-4dab-b5ac-88ba69025f2d` untouched. Do not drop `bridge_events` until a later, explicit operator step. That drop is not in any script.

## 2. Capacity limits and read amplification

**What.** A competition can hold at most 32 stages in normalized mode (`lib/storage/normalized.ts` 279), in legacy Neon (`lib/storage/neon.ts` 178), and in local mode (`lib/storage/local.ts` 173–174). Both database modes reject a 51st competition (`lib/storage/normalized.ts` 204, `lib/storage/local.ts` 110). Public and admin reads send `Cache-Control: no-store` (`app/api/events/[id]/route.ts` 16 and 33). Every successful command still rebuilds the projection with `project(e)` (`lib/mutations/apply.ts` 163) and stores that cache on the stage row. The normalized index reads `bridge_stages` plus participant and board-number lists (`lib/storage/normalized.ts` 116–120). The legacy index is still one large `jsonb_build_object` over `bridge_events` (`lib/storage/neon.ts` 48).

**Risk.** Medium for spectator load. High only if a season puts many organizers on the 50-competition cap or a congress hits 32 stages. The 32-stage cap was kept on purpose: one organizer’s archive should not fill a global limit before tenants exist. The normalized index no longer parses every board’s cards to build the admin list. Public JSON is still uncached, which matches the migration note that live scores stay out of the CDN.

**Effort.** Medium to cache the public projection with a watermark and a short `s-maxage` plus `stale-while-revalidate`. Small to raise the caps once a tenant id exists. The in-play board filter is `lib/public-event.ts` 10–16 and already has tests.

**Fix.** Do not turn on CDN caching of the public JSON until that filter is part of the cache key. Do not raise the 32-stage cap in a follow-up that only adds columns.

## 3. Auth and sessions

**What.** Two environment passwords cover the whole site. The session is a stateless HMAC. Logout deletes the cookie and does not record a revocation. Login limiting is per IP and counts failures only.

**Evidence.** `lib/auth.ts` 7–33. `lib/session-token.ts` 11–12 (payload is `role:expiry:mac`). `app/api/session/route.ts` 33–38 counts a failure, 38 clears it on success, 55–60 deletes the cookie. `lib/login-limit.ts` 9–17 keys the limiter by hashed client IP.

**Risk.** High for nationwide use. A shared director password cannot be scoped to one organizer or revoked for one browser. A copied cookie works until it expires or the password changes. The IP limiter is correct for the current login form and should stay failure-only.

**Effort.** Large, and already started as GitHub #5 (codes and audit), #6 (players), #8 (agent API). Replacing `app/api/session/route.ts` is the cutover, not part of #5. Those slices were written against the old document. New secrets and audit rows need their own tables, not new keys inside `bridge_events`.

**Fix.** Land the code model and its schema step before switching the live login. Keep `ADMIN_PASSWORD` / `DIRECTOR_PASSWORD` working until the owner decides whether today’s staff password becomes the site admin (the open question in #5). Hash-only storage stays. Do not copy the staff password into the new codes.

## 4. API shape and errors

**What.** Mutations are one discriminated union posted to a stage. Domain errors have an optional `code`, but the HTTP body returns only the Chinese string. There is no OpenAPI document and no dry-run on `master`.

**Evidence.** `lib/model.ts` mutation union (the `action` literals from line 237). `lib/domain-error.ts` 1–8. `lib/http.ts` 53–56 omits `error.code`. `lib/mutations/apply.ts` 20 uses `stage-revision`, which clients must match by importing the class, not by reading JSON.

**Risk.** Medium now, high once agents call the API. A retry cannot tell `REVISION_CONFLICT` from a settled table if it only sees the message. In normalized mode that conflict is either the stage revision or one result cell; the HTTP body still does not say which.

**Effort.** Small to add `code` to `errorResponse`. Medium to add the agent routes described in GitHub #8. The library functions in #8 should not be mounted until event codes from #5 can authorize them.

**Fix.** Put the machine code on every `DomainError` response before the agent routes exist. Map `stage-revision` to `REVISION_CONFLICT` at that boundary.

## 5. Audit and idempotency

**What.** Normalized mode stores audit lines in `bridge_audit` and request ids in `bridge_requests` (competition metadata uses `bridge_competition_requests`). Neither list is capped at 500. Each save still deletes and rewrites the audit rows, and drops request ids that are no longer on the in-memory list (`lib/storage/rows.ts` 92–104). Legacy mode and local mode still append inside the document and keep the last 500 ids (`lib/mutations/apply.ts` 162, `lib/competition-record.ts` 65–67). The normalized competition update passes `durableRequests` and does not slice.

**Risk.** Medium. The live store will not forget a request id after 500 later writes, so a retry of an old score stays idempotent. The audit table is not append-only: a save replaces the set, and a bug that drops an entry from the hydrated event would delete that row. Large `changes` arrays still sit inside each audit document. There is still no actor-code column and no `viaAgent` flag.

**Effort.** Medium, with the access audit in GitHub #5. Do not cap `bridge_audit` or `bridge_requests` at 500. A new access-audit table should be insert-only.

**Fix.** Add the access audit as its own table. Keep the scoring audit in `bridge_audit` until that design is explicit. Legacy documents must still round-trip the same audit entries through `migrate-data` and `restore-legacy`.

## 6. Legacy publication flag

**What.** A board is public when `board.published` is set, otherwise when the event-level `publishBoards` flag is set. Normalized storage did not remove that fallback. The flag lives on the stage settings JSON. Each board’s `published` bit, when present, lives inside `bridge_boards.document_json`.

**Evidence.** `lib/public-event.ts` 5. The same fallback is in `lib/discussion.ts` 35, `lib/board-publication-ready.ts` 40, `lib/read-models/public-event.ts` 118, `lib/mutations/deals.ts` 15 and 63, and `components/admin/PublicationPanel.tsx` 147.

**Risk.** Medium. Two sources of truth. A migration that drops the flag without copying it onto each board would hide or reveal deals. The 11月社內賽 deals must not be rewritten while that flag is removed. Production is already on normalized rows, so a script that only rewrites a local `events.json` does not change the live boards.

**Effort.** Small. GitHub #4 already copies the flag in the document model and checks the public view. It still has to write the same bit into `bridge_boards.document_json` for normalized mode and into the legacy document for legacy mode, without changing card text.

**Fix.** Materialize `published` on each board in both stores. Compare the effective flag and the card strings before and after. Do not open production from the script. Do not fold the rewrite into the data migration that already ran.

## 7. Adjusted scores

**What.** `average` is not a scoring state. Import rejects it. Anything still stored as `average` is treated as cancelled.

**Evidence.** `lib/imports.ts` rejects the CSV token (covered by `tests/results-import.test.ts`). `lib/result-status.ts` 3–10 maps `average` to `cancelled` on normalize.

**Risk.** Medium for law-compliant adjusted scores (A+ / A / A−). Low for events already stored, because the import no longer silently stores a fake cancellation.

**Effort.** Medium. Per-board result rows now exist, so this no longer has to wait for a new table. It still must not change the meaning of an old `average` document during `migrate-data` or `restore-legacy`.

**Fix.** Add the new status on `bridge_results.document` and on the legacy result object together. Leave `normalizeResults` alone until that status is explicit, or old documents will change meaning.

## 8. Tests and CI

**What.** Unit tests are broad (93 `tests/*.test.ts` files) and CI runs them, plus a production build, `npm audit`, a secret scan, a smoke script, and `tsc`. CI has no Postgres service, no ESLint, and no browser job. Storage tests use PGlite over the HTTP-shaped `neon()` client (`tests/helpers/sql.ts`, `tests/storage-rows.test.ts`, `tests/repository-contract.test.ts`). They cover legacy documents and normalized rows. They do not open a network database.

**Evidence.** `.github/workflows/check.yml` 8–21. `package.json` has no `lint` script.

**Risk.** Medium. PGlite will not catch a Neon HTTP transaction limit or a deadlock that only appears on the hosted service. Two concurrent score writers are retried in process, not against two real sessions. Visual tests exist (`test:visual`) but are not in this workflow.

**Effort.** Medium to add a concurrency test with two overlapping result writes on the normalized repository. Small to add ESLint once the rule set is chosen. A GitHub Postgres service is optional while PGlite already runs the schema.

**Fix.** Extend the PGlite tests when a follow-up adds columns. Do not point those tests at production. Add ESLint in the lint/vendor change, not in this review.

## 9. Dependencies and vendor tarballs

**What.** `package.json` depends on `vendor/valet-deal-viewer-1.3.11.tgz`. Thirteen older tarballs are still in `vendor/`. There is no ESLint config. `package-lock.json` is present and CI uses `npm ci`.

**Evidence.** `package.json` dependency `@valet/deal-viewer`. `vendor/` contains `1.1.0`, `1.2.0`, and `1.3.0` through `1.3.11`. `next.config.ts` 16–27 sets `nosniff`, `Referrer-Policy`, and `X-Frame-Options`, and does not set `Content-Security-Policy`.

**Risk.** Low for the extra tarballs (confusion and review noise, not a runtime bug). Medium for CSP: `app/layout.tsx` 26–35 loads `/theme.js` and an inline font script, and the deal viewer plus the DDS worker (`public/dds-worker.js`) need `worker-src` and `wasm-unsafe-eval` or the enforced policy will blank the page.

**Effort.** Small to delete the unused tarballs and add ESLint. Medium to ship a nonce-based CSP without forcing every page to be dynamic, because Google fonts and inline styles are still in `app/layout.tsx` 6–35.

**Fix.** Land lint and the tarball deletion together. Start CSP as Report-Only until the deal viewer and the font script are verified.

## 10. Migrations

**What.** `scripts/migrate.ts` is idempotent and additive. It creates `bridge_events`, the login-limit table, the discussion table, and the normalized tables, and it leaves the switch on `legacy` (`ON CONFLICT DO NOTHING` on `bridge_storage_switch`). It does not version rows and it has no down migration. Data copy, the stage merge, and the restore to legacy are separate scripts. Each refuses to write unless its own environment flag is set: `VALET_DATA_MIGRATION`, `VALET_MERGE_STAGES`, `VALET_RESTORE_LEGACY`.

**Evidence.** `scripts/migrate.ts` 8–13. `lib/storage/schema.ts` 1–14. `docs/storage-migration.md`.

**Risk.** Low for the schema script: running it again does not flip the switch and does not rewrite deals. Medium for any later follow-up that adds a column and forgets one of the three paths (normalized write, legacy document, restore). Production has already flipped to `normalized` and merged the three club stages. A second data copy must refuse to overwrite the live normalized store, which the current script does.

**Effort.** Small to add `schema_migrations` if the operator wants a version row. Each new persisted field still needs its own `CREATE TABLE IF NOT EXISTS` or `ADD COLUMN IF NOT EXISTS` inside `normalizedSchemaStatements`, plus matching read and write in `lib/storage/rows.ts` and a round-trip in `migrate-data` / `restore-legacy` when legacy mode must keep the field.

**Fix.** Do not fold GitHub #4 or #5 data rewrites into `scripts/migrate.ts`. Keep those scripts refused unless the operator passes a flag, and do not give them a production URL from CI. Do not `ALTER` or regenerate existing deal JSON.

## 11. Observability

**What.** Failures log an error name. There is no request id, no structured log, and no metrics.

**Evidence.** `lib/http.ts` 58. Smoke scripts use `console.log` / `console.error` only.

**Risk.** Medium once many events are live. A 409 storm or a slow public read will not be attributable to an event or a table. The storage switch itself is not in that log line, so a `storage-split` 503 looks like any other failure.

**Effort.** Small to log `event id`, status, and `DomainError.code` without logging passwords, tokens, or deal cards. Larger if an external collector is added.

**Fix.** Do this before the agent API is exposed. Do not log access-code secrets, email addresses, or `document_json`.

## 12. Accessibility and language

**What.** The UI is Traditional Chinese only. Interactive controls often have names. There is no locale switch and no documented screen-reader pass of the scoreboard.

**Evidence.** `app/layout.tsx` 16 (`lang="zh-Hant"`). Strings throughout `components/` are Chinese literals. `components/competition-hub.tsx` and `app/club/page.tsx` set `aria-label` on some controls. `tests/scoreboard-views.test.ts` checks a few `aria-checked` values.

**Risk.** Low for a Taiwan-only product. Medium if a later English or screen-reader requirement appears, because copy is not in a catalog. Nationwide use does not require a second language.

**Effort.** Large to internationalize. Small to keep new access-code screens on the same `aria-label` pattern.

**Fix.** Do not start an i18n project. Require labels on the new code and QR screens in #5. Keep new user-facing copy in Traditional Chinese (Taiwan).

## 13. Code shape

**What.** Domain logic is testable and split by mutation. Persistence is now three repositories behind one interface: local JSON, legacy Neon documents, and normalized rows. `lib/storage/neon.ts` (237 lines) only chooses. `lib/storage/normalized.ts` (309 lines) and `lib/storage/rows.ts` own the new writes. `lib/storage/local.ts` (194 lines) stays on the document so the club laptop path does not need Postgres. `lib/model.ts` is 740 lines and holds every mutation schema. `components/scoreboard.tsx` is 811 lines. The legacy index SQL (`lib/storage/neon.ts` 48) still duplicates the TypeScript event shape. `lib/result-status.ts` 3–10 and `lib/public-event.ts` 5 are intentional compatibility branches. `lib/domain/demo-events.ts` still sets `publishBoards` for the demo.

**Risk.** Medium. A new field has to be threaded through normalized rows, the legacy document, local JSON, and both migration directions, or one mode drifts. The legacy index SQL will not be updated when a field is added to the list UI; the normalized index is a separate query and can drift the other way.

**Effort.** Medium to share the write rules. Not a prerequisite for the open follow-ups. Database code stays on `neon()` over HTTPS. Do not add `pg` or port 5432.

**Fix.** Put new tables in `lib/storage/schema.ts` and the writes in `lib/storage/rows.ts`. Keep `createNeonRepository` as the switch. Keep local mode on the JSON document.

## Priority

1. **Keep both storage modes correct.** Production is `normalized`. Legacy Neon and local JSON must keep today’s behavior. New fields are additive tables or columns, idempotent in `scripts/migrate.ts`, and round-tripped by `migrate-data` / `restore-legacy` when the legacy document carries them. No follow-up may rewrite the 15 deals of `58f461bf-e3df-4dab-b5ac-88ba69025f2d`.
2. **GitHub #4 (publishBoards) on the rows that are live.** Copy the flag onto each board’s `document_json` and onto the legacy document. Verify cards and the public flag. Do not run it against production from CI.
3. **Access codes (GitHub #5, then #6, then #8) as new tables.** Required for multi-tenant use. Do not switch the live password login until the owner answers the staff-versus-admin question. Do not mount the agent routes before event codes can authorize them. Do not store raw codes.
4. **Return `error.code` from `lib/http.ts`.** Small, and #8’s machine codes depend on it.
5. **Lint and vendor tarballs.** Independent. Do it before CSP so the config is already in CI.
6. **CSP, Report-Only first.** Depends on fonts, `/theme.js`, and the DDS worker. Not related to scoring correctness.
7. **Adjusted scores.** Result rows exist, so this no longer waits on a new table. Leave `normalizeResults` alone until the new status is stored on both the result row and the legacy document.
8. **Request logging of ids and codes.** Before agent traffic. Not a substitute for the audit table. Never log deal text or secrets.
9. **i18n.** Not needed for this product.

The storage switch stays `normalized` in production. None of the follow-ups should be merged until the owner chooses to, and none of them should be run against event `58f461bf-e3df-4dab-b5ac-88ba69025f2d`.
