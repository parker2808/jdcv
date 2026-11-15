# Interview knowledge-base autofill

## Problem and why it matters

New job descriptions (JDs) often ask about concepts already covered by the shared interview knowledge base (KB). Reusing a topic avoids duplicate or conflicting explanations; missing general concepts can be added without leaking an applicant's JD. For example, a fictional role asking about keyboard focus should link to an existing accessibility topic rather than copy a company-specific question.

## Goals and non-goals

After each JD/CV run, link covered topics and propose at most five missing topics in one content pull request (PR). Do not publish private JD text, company names, CV facts, or unreviewed knowledge directly. Never assume a pending PR is live content.

## Design and data shape

Extract one to three normalized topics per requirement. Match in three tiers: normalized slug and alias dictionary; accent-insensitive fuzzy search over titles, tags, and headings; then a language-model judgment of the top three candidates as full, partial, or no match. A full match creates a `kbRef` to its topic and section. A partial match proposes a new section in the existing topic. A missing match generates a general explanation, with a clear first answer and concrete example, using the knowledge repository's schema and validators. Do not create a new topic if an alias or partial match can be extended.

For example, `keyboard-navigation` may map to an existing `focus-management` section. The link record has `moduleId`, `kbSlug`, `sectionId`, `matchType`, `prUrl`, and `state` (`pending`, `live`, `rejected`). A run creates one PR in `<private-content-repo>` with up to five new topics plus partial-section additions; excess topics remain queued for review rather than silently dropped. Before opening it, run its validator, index sync, secret scan, and personal-data scan, and send the required development notice. Merge only under the separate content-repository authorization; this spec does not authorize a merge. A merged PR promotes its links to `live` after verifying the target exists; a closed unmerged PR removes or rejects pending links. Phase 2 mirrors merged KB content into a read-only database view so public users cannot access the private repository.

## Constraints and risks

The content repository remains private and must be named only by its placeholder here. Do not copy raw JD passages into generated topics. False fuzzy matches can mislead learners, and race conditions between runs can open duplicate PRs; recheck canonical slugs under a lock before proposing content.

## Acceptance criteria and verification

1. **AC1:** A run extracts one to three topics for each synthetic requirement and links an existing alias without creating a duplicate. Check fixture-based extraction and alias tests.
2. **AC2:** A partial match proposes a section; a true miss proposes no more than five new topics in exactly one PR per job. Check mocked repository operations with six misses and a second identical run.
3. **AC3:** Pending links cannot resolve as public links; merge makes verified links live and closing an unmerged PR rejects/removes them. Check state-transition tests and the module renderer.
4. **AC4:** The proposed content passes schema, index, secret, and personal-data checks without a fictional JD's company alias or original sentence. Check content fixtures and the PR gate before creation.

## Open questions

Choose fuzzy-match thresholds and a review owner based on a labelled set of topics. Define how to reconcile a PR merged after its module was deleted without resurrecting the module link.

## Worker integration (gap 3)

After the module's interview, score, readability, and injected quality gates pass, the owner-only worker calls autofill once for the entries. It uses an injected content client for topic lookup, section lookup, and proposed changes. Without an injected client it uses an in-memory dry-run client: even a proposed new topic creates only a private review plan, never a network call or content write. For example, a fictional `example-topic` alias can produce a live reference for the matching entry, while an uncreated topic stays pending. A live client belongs in a separate reviewed `<private-content-repo>` change.

A future live client must supply its own matcher and pass real `companyNames` and `privateNames` to `autofill`; the worker's empty lists and placeholder matcher are safe only with its dry-run client.

The worker stores only the contract's slug, section ID, and state in each matching entry's `kbRefs`. It writes the dry-run plan to the protected job workspace with mode 0600 before publishing the module pointer. If autofill fails, it stores `KB_AUTOFILL_FAILED` privately and completes the already-gated module without new references. It does not turn a pending reference into a live one. The module-only command-line dry run still never reads a real CV.

1. **AC5:** An alias and a proposed topic attach only to their source entries; a pending proposal stays pending. Check a fictional multi-entry worker job.
2. **AC6:** With no client injected, the worker records a private dry-run plan and performs no real content or network write. Check the plan mode and a temporary workspace fixture.
3. **AC7:** An autofill error records `KB_AUTOFILL_FAILED`, keeps the gate result, and publishes no invented reference. Check a failing injected client after the quality gate.
4. **AC8:** The persisted references survive `toContentModule` unchanged and pass the mirrored content rules with reviewed metadata. Check a fictional mapped module; do not change either validator.

Live content PRs and regression tests in `<private-content-repo>`, bot delivery, the gap 2 manifest, and production lifecycle adapters remain separate work.
