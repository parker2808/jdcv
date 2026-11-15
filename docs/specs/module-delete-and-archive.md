# Module deletion and archiving

## Problem and why it matters

A user needs to remove a job-description (JD) module without losing it to an accidental tap or erasing reusable interview knowledge. For example, archiving a fictional application hides it immediately but allows a seven-day undo before its private documents are purged.

## Goals and non-goals

Only a module owner can archive, restore, or hard-delete their module. Offer an undo window and optional inactivity-based archiving with advance notice. Never delete shared knowledge-base (KB) entries when deleting a module. Do not treat deleting a module as permission to delete another owner's data.

## Design and data shape

Phase 1 Telegram `/jd_delete <slug>` requires confirmation. The Phase 1 web delete button is visible only in edit mode and opens the bot for confirmation; `/jd_restore <slug>` restores it. Phase 2 web mutations derive owner and workspace from the authenticated session, not request fields. Other users receive HTTP 403. Set `archivedAt` and `purgeAfter = archivedAt + 7 days`; hide archived modules from default dashboard and search while making restore available to the owner until purge. A direct hard-delete request is refused until the module is archived; the owner can then confirm a separate immediate purge.

Purge cancels in-flight jobs before deleting Module, ModuleEntry, KbLink, TestRun, tailored CV versions, embellishments, exports, raw JD objects, and private Mac job workspace files. In Phase 1, remove `modules/<slug>.json` and its index row through a reviewed PR in `<private-content-repo>`; never commit JD or CV contents to this public repo. Keep KB entries and pending content PRs, but remove module links and decrement usage counts only once. `KbEntryUsage.refCount` counts live module links; zero-count entries remain discoverable. An audit record keeps actor ID, module ID, action, and time, but no content or personal data. Repeated operations are idempotent, including a partial purge retried after a storage failure.

Optional workspace-level auto-archive defaults to 60 days since `lastOpenedAt`. Notify the owner three days before the threshold via bot and, in Phase 2, web. A “Keep” action resets the inactivity clock; absent a response, archive normally, then allow the same seven-day restore. The feature is opt-in and cannot skip the notice.

## Constraints and risks

Deleting from a private Git repository may leave historical commits; do not promise erasure from Git history. A manual review of retention and backup policy is required before writing personal module content there. Partial object-storage failures require retryable tombstones rather than reporting a successful purge. Do not cancel unrelated jobs.

## Acceptance criteria and verification

1. **AC1:** A non-owner cannot archive, restore, purge, or keep through either caller. The HTTP-style result has code `FORBIDDEN` and status 403; the command-line interface (CLI) returns a refusal without changing a store. Check `index.test.ts` authorization and `cli.test.ts`.
2. **AC2:** Archive hides a module from default list and search at once. Restore succeeds on day six and fails with `PURGED` after purge. Check the clock-controlled lifecycle and query tests in `index.test.ts`.
3. **AC3:** Purge refuses an active module with `NOT_ARCHIVED`. An owner can purge an archived module now; `purgeDue(now)` only purges archived modules at or past `purgeAfter`. Check `index.test.ts`.
4. **AC4:** After purge, the module record and owned rows, objects and job workspaces are absent; another module remains intact. Check the seeded temporary-directory inventory in `index.test.ts`.
5. **AC5:** KB entries and pending general-content PRs survive. Each live link is removed with one atomic usage decrement, pending links without a decrement, and zero-count entries remain searchable. Check `index.test.ts`.
6. **AC6:** Cancel only this module's pending or leased jobs through `JobQueue` before deleting anything. Check call ordering and unrelated jobs in `index.test.ts`.
7. **AC7:** Repeating archive, restore, purge, or keep succeeds without a second decrement. A failed deletion leaves a retryable tombstone and returns `PURGE_INCOMPLETE`; the next call finishes. Check `index.test.ts`.
8. **AC8:** Workspace auto-archive is off by default. With the default 60 days, warn on day 57, keep on day 58 resets the clock, and no response archives on day 60 only after a notice. Check the controlled-clock scheduler tests in `index.test.ts`.
9. **AC9:** Each mutation attempt and automatic action appends one audit record with actor ID, action, module ID, time, and result only. Check the record shape and run the `runGates` personal-data scan against serialized audit output in `index.test.ts`.
10. **AC10:** A fake Phase 1 module tree yields a proposed PR removing exactly `modules/<slug>.json` and its index entry; repeating the plan after removal is a no-op. Check a mocked client, branch and title in `git-plan.test.ts`. Git history is not erased.
11. **AC11:** The CLI prints exactly one JSON line for each command. Check every command, refusal and exit code in `cli.test.ts`.
12. **AC12:** The spec, README, CLI help, and project context agree. Run `scripts/check.sh`, GitHub CI, `git diff --check`, and gitleaks before merge; no real service, private repository, or personal sample data is used.

## Public package interface

`createModuleLifecycle(dependencies)` returns `archive(context, slug)`, `restore(context, slug)`, `purge(context, slug)`, `keep(context, slug)`, `status(context, slug)`, `list(context)`, `search(context, query)`, `purgeDue(now)`, and `autoArchive(now)`. Mutations return `{ok, state, code, message, httpStatus}`; `FORBIDDEN` maps to 403, `NOT_ARCHIVED` and `PURGE_INCOMPLETE` to 409, `PURGED` to 410, and success to 200. `context` is an authenticated `{actorId, workspaceId}` from the caller, never a request body. Phase 1 also checks `ownerId` against a configured owner. The storage adapter owns per-module exclusive locking and atomic link removal with usage decrement. A separate tombstone survives deletion for retry and idempotent status. A `JobQueue` adapter and object/workspace deletion adapters perform the remaining effects. `autoArchive` uses an injected clock and notifier and never delivers a real message from this package.

`planPhase1Removal(slug, client)` reads a validated module index and proposes a change to an injected client, never opening a PR itself. The client receives `chore/module-delete-<slug>` and a reviewable PR title. Git retains past commits, so removing a current file does not erase its history.

`pnpm --filter @jdcv/module-lifecycle cli archive|restore|purge|keep|status --slug <slug> --actor <id>` uses a trusted caller-provided adapter module and workspace context. It prints one JSON object with `ok`, `state`, `code`, and `message`. Exit 0 means success, 2 means refused or invalid input, and 1 means an incomplete purge or adapter failure. Without an adapter it fails closed. A bot must authenticate the caller before passing `--actor`; command flags are not a remote authorization mechanism.

## Open questions

Document the backup and Git-history erasure limitations in user-facing privacy copy. Decide whether Phase 1 private module files can avoid Git entirely for content with personal details.
