# Controlled CV embellishment

## Problem and why it matters

A plausible-sounding detail can still misrepresent an applicant and cost them an offer. Every proposed change to a curriculum vitae (CV) must be traceable, checked, and accepted before export. For example, rephrasing a real project's keyboard-navigation work is safer than inventing a new certification.

## Goals and non-goals

Allow careful wording or plausible detail within a real project, with line-by-line approval and interview preparation. Do not invent an employer, project, title, degree, certificate, date, or years of experience. Do not automatically submit a CV or apply this exception to study knowledge, product copy, or reporting.

## Design and data shape

Allowed proposals are keyword-aware rewording of established facts, details consistent with the real project's role and stack, and explicitly authorized, flagged estimates within a reasonable range. Never allow an out-of-period technology or a technology outside the known stack without an explicit flag and review; unverifiable core credentials and timeline changes are blocked outright. Compare each claim to private CV facts: project dates, available technology at that time, role, and team scope. If support is absent, mark it as unverified rather than asserting a fact.

Store one `Embellishment` per changed line with `cvVersionId`, JSON `path`, `before`, `after`, `reason`, `requirementId`, `risk` (`low`, `medium`, `high`), source/fact reference, `status` (`proposed`, `approved`, `rejected`), and `defenseEntryId`. Show the original and revised line with its reason and risk in web or Telegram. Rejecting restores the original line. Approving a line requires an explicit user action, not acceptance of the whole CV. Before export, create a linked study-pack defence entry containing a probing question, 30-second answer, technical detail, and a truthful way to clarify uncertainty; the Interviewer must probe it, and the Examiner must score the answer at least 4/5. Any critical finding blocks publication, regardless of average score.

Outside users start with embellishment off. Enabling it requires a separate opt-in and acceptance of the current Terms of Service (ToS), which explains that users are responsible for CV accuracy. Removing opt-in prevents new proposals; existing pending proposals remain blocked until explicitly resolved. Private proposal text and decisions stay in database or private storage, never in the public study module or logs; public module references carry opaque IDs only.

## Constraints and risks

Plausibility is not proof. A user can approve an unsupported claim; the interface must show this risk rather than presenting AI output as verified. A defence answer does not make a false claim true. Keep all real CV material and employer identities out of fixtures.

## Acceptance criteria and verification

1. **AC1:** The forbidden employer, title, credential, and date mutations are rejected, while a supported wording edit can be proposed with one diff, risk, reason, and requirement ID. Check table-driven synthetic fact tests.
2. **AC2:** Each changed line needs its own approval; rejection restores the original, and one pending line blocks both DOCX and PDF exports. Check approval-state and export-gate tests.
3. **AC3:** Every approved embellishment has exactly one linked defence entry, receives an Interviewer question, and scores at least 4/5 with zero critical findings before export. Check a mocked interview trace and failing-score fixtures.
4. **AC4:** An outside user without opt-in and current ToS consent cannot create proposals; enabling requires both actions. Check authorization and consent tests.

## Open questions

The owner-only worker now stores a version 1 private proposal with pending decisions and an exact source-paragraph citation. It does not replace the later web or bot decision interface: for example, accepting one Example Labs line does not accept any sibling line. The export helper requires a passing defence record, full quality gate, and real extracted DOCX/PDF text before returning both documents.

Define how estimated metrics are bounded and documented for each project type. Decide how an owner can revoke approval after a previous export without silently rewriting already downloaded files.
