# Multi-user access and privacy

## Problem and why it matters

Job descriptions and curricula vitae (CVs) can identify people and expose private career details. An owner-only flow must become invite-only and then public without letting one workspace read another's files. For example, an invited fictional user must not see `Alex Example`'s private exports by guessing a job ID.

## Goals and non-goals

Keep personal input in private database/object storage or the owner's private Mac workspace, not Git. Support owner, admin, and member roles with workspace isolation; start outside access by invitation and open public registration only after legal review and abuse controls. Do not reuse an existing single-user passcode, personal bot subscription, or production database as a multi-tenant shortcut.

## Design and data shape

Phase 1 serves the owner only. Phase 2 uses GitHub and Google OAuth (delegated sign-in) with HttpOnly cookies and refresh-token rotation, an invitation gate, and a separate TiDB Starter free instance. Phase 3 permits public signup only after terms, privacy, quota, and abuse checks. `User`, `Workspace`, and `Membership(role)` bind identities to workspaces. Every `JD`, `Module`, `CVProfile`, `CVVersion`, `Embellishment`, `Job`, and `ExportFile` has a `workspaceId`; server code derives it from the session and checks per-resource ownership. Reject unauthenticated private routes and foreign-origin cross-origin resource sharing (CORS) requests. Limit jobs per day, concurrent jobs to one per workspace, and API spending where applicable.

Raw JD, CV, and bring-your-own-key (BYOK) data belong only in the database and private object storage, with encrypted sensitive fields and keys encrypted at the application layer. Store private raw objects, never public URLs. Phase 1 owner CV outputs remain in a private job workspace, never Git. Retain Mac job workspaces for seven days and exports for 30 days, then delete; account deletion removes owned private records and objects subject to the published retention policy. Logs, notifications, and audit records use opaque IDs and actions, never document bodies. A separate read-only KB mirror contains only general content.

`Consent` records user ID, legal document type, version, and acceptance time. Phase 2 drafts versioned Terms of Service (ToS) and Privacy Policy, requires consent before the first job and again when required by a new version, and records separate CV embellishment and AI-processing consent. ToS explains AI errors and user responsibility for CV claims. The privacy page identifies processors, purposes, retention, and access/export/delete rights, with a placeholder contact channel. Label generated modules and CV export review screens as AI-generated and requiring human review. Before Phase 3 public access, run a checklist against applicable Vietnamese personal-data law; the draft is not legal advice.

## Constraints and risks

Provisioning the separate database is an external Phase 2 dependency; do not expose its connection settings. Free-tier quota exhaustion must fail closed rather than share a different application's instance. Auth provider identity alone does not prove workspace permission. Backup and Git history may outlive application deletion; disclose and resolve any conflict with deletion promises before launch.

## Acceptance criteria and verification

1. **AC1:** Every private endpoint denies anonymous access and denies a second workspace's resource even with a valid ID. Check a cross-tenant matrix over jobs, modules, CVs, exports, and mutations.
2. **AC2:** Invitation-gated sign-in supports GitHub and Google OAuth with rotated HttpOnly sessions; public signup remains disabled until Phase 3 gates. Check mocked callback, rotation, and signup tests.
3. **AC3:** No personal input or key enters Git or logs, and foreign origins are rejected. Check fixture-based log scans, Git diff scans, storage integration tests, and CORS tests.
4. **AC4:** A job cannot start without current required consent; every result has the human-review label. Check consent-version and rendered-screen tests.
5. **AC5:** Cleanup removes Mac workspaces after seven days and exports after 30 days; account deletion removes its private records and objects without deleting general KB topics. Check controlled-clock and seeded deletion tests.

## Open questions

Confirm instance availability and free quota before Phase 2. Complete and review the Vietnamese legal checklist, processor disclosures, and backup deletion wording before public signup.
