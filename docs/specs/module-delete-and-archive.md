# Module deletion and archiving

## Problem and why it matters

A user needs to remove a job-description (JD) module without losing it to an accidental tap or erasing reusable interview knowledge. For example, archiving a fictional application hides it immediately but allows a seven-day undo before its private documents are purged.

## Goals and non-goals

Only a module owner can archive, restore, or hard-delete their module. Offer an undo window and optional inactivity-based archiving with advance notice. Never delete shared knowledge-base (KB) entries when deleting a module. Do not treat deleting a module as permission to delete another owner's data.

## Design and data shape

Phase 1 Telegram `/jd_delete <slug>` requires confirmation. The Phase 1 web delete button is visible only in edit mode and opens the bot for confirmation; `/jd_restore <slug>` restores it. Phase 2 web mutations derive owner and workspace from the authenticated session, not request fields. Other users receive HTTP 403. Set `archivedAt` and `purgeAfter = archivedAt + 7 days`; hide archived modules from default dashboard and search while making restore available to the owner until purge. A direct hard-delete request must first archive the module and confirm the purge separately.

Purge cancels in-flight jobs before deleting Module, ModuleEntry, KbLink, TestRun, tailored CV versions, embellishments, exports, raw JD objects, and private Mac job workspace files. In Phase 1, remove `modules/<slug>.json` and its index row through a reviewed PR in `<private-content-repo>`; never commit JD or CV contents to this public repo. Keep KB entries and pending content PRs, but remove module links and decrement usage counts only once. `KbEntryUsage.refCount` counts live module links; zero-count entries remain discoverable. An audit record keeps actor ID, module ID, action, and time, but no content or personal data. Repeated operations are idempotent, including a partial purge retried after a storage failure.

Optional workspace-level auto-archive defaults to 60 days since `lastOpenedAt`. Notify the owner three days before the threshold via bot and, in Phase 2, web. A “Keep” action resets the inactivity clock; absent a response, archive normally, then allow the same seven-day restore. The feature is opt-in and cannot skip the notice.

## Constraints and risks

Deleting from a private Git repository may leave historical commits; do not promise erasure from Git history. A manual review of retention and backup policy is required before writing personal module content there. Partial object-storage failures require retryable tombstones rather than reporting a successful purge. Do not cancel unrelated jobs.

## Acceptance criteria and verification

1. **AC1:** A non-owner cannot archive, restore, or purge through either channel and receives HTTP 403 from Phase 2 mutations. Check cross-workspace authorization tests and mocked bot commands.
2. **AC2:** Archive hides a module immediately; restore succeeds before day seven and fails after purge. Check a clock-controlled lifecycle test and dashboard/search queries.
3. **AC3:** Purge removes all module-owned records and files from database, object storage, and Mac workspace, cancels its jobs, and retains KB entries with correct counts. Check a seeded integration fixture and post-purge inventory.
4. **AC4:** Repeating archive, restore, or purge does not double-decrement counts or delete unrelated files. Check retry and injected-storage-failure tests.
5. **AC5:** With default 60-day inactivity, notice arrives on day 57; “Keep” prevents archive, and no response archives on day 60. Check controlled-clock scheduler tests.

## Open questions

Document the backup and Git-history erasure limitations in user-facing privacy copy. Decide whether Phase 1 private module files can avoid Git entirely for content with personal details.
