# Project context

JDCV Prep helps turn a job description into a tailored CV and interview study pack. It exists to make preparation more useful while keeping experience claims accurate and personal data private.

## Current state

The repository is pre-alpha and contains a workspace starter, a local file job queue, shared module contracts, an injectable module lifecycle, a standalone CV renderer with a fictional sample template, pure prompt templates, quality gates, and a Mac worker with a fake-model dry run. Phase 1 is owner-only: the planned web view will show results and link to a Telegram conversation. No production service, personal CV, account integration, or deployment exists in this repository yet.

The [isolated Phase 1 dry run](docs/e2e-dryrun-gap-report.md) completed one fictional bot-to-worker queue job, but its output could not be used for approved CV export, bot delivery, or the private content schema. An explicit pure mapper now prepares a content document only when reviewed metadata and nonempty key points are supplied; it does not connect the worker to publication. A separate adapted fixture rendered in the local web app; this is not a successful end-to-end CV run. The report lists five integration gaps and no production effects.

The worker now attaches knowledge-base (KB) references to the matching entries after module gates. The default content client makes only a private dry-run plan, never a live content change. A failed KB step records `KB_AUTOFILL_FAILED` without inventing links. A private delivery manifest contract and opt-in writer also exist, but the bot consumer and owner approval interface are not connected. A live client and content PRs in `<private-content-repo>`, its regression, bot integration, the gap 2 consumer, and production lifecycle adapters (gap 5) remain separate.

## Planned phases

Phase 1 adds the owner workflow and validation. Phase 2 adds an invitation-only web experience, account linking, and terms and privacy documents. Phase 3 may open both web and Telegram access to the public after privacy and security review. For example, the owner should be able to review proposed CV edits before any document is exported.

## Stack and decisions

The starter uses Node.js 22, pnpm 9, TypeScript, Vitest, ESLint, and Prettier. The contracts package uses Zod for runtime validation and generated JSON Schema for other languages. For example, a fictional frontend module can be converted from version 1 without changing its bilingual answers. The CV renderer uses docxtemplater core and PizZip to fill an original Word template. Gotenberg converts that DOCX to PDF; CI runs the conversion on a free standard GitHub runner. This is a public repository; examples must be fake and external private integrations must use placeholders. The product name is JDCV Prep.

## Open facts

The production data service and its configuration are not available yet. `JobQueue` defines the storage contract; the database adapter and connected export flow remain later tasks. The Mac worker has not been launched as a service, and a live private runner still needs an operational review. The prompt package expects separate private JD, CV, facts, proposals, transcript, and readability files; the worker currently accepts one input reference and uses an injected prompt builder, so connecting the two requires a separate output and gate migration. The worker must still verify project facts and require per-line CV approval before export. The file queue assumes atomic rename on one local volume and a single Mac host; confirm cross-volume behavior before changing its storage location. The version 2 specification leaves archive dates and job-description IDs for the later storage record, not the module document. A knowledge-base (KB) reference cannot become live until its external target is verified. A trusted caller must obtain approvals from protected storage before rendering. The separate HTML/Chromium fallback, authenticated downloads with 30-day expiry, deployment font provisioning, and free-tier Gotenberg memory measurement remain open; the renderer fails visibly without a verified fallback. Licensing and exact attribution for any future reused code must be checked before copying.

## Changelog

- 2026-11-18: Document Parker’s task-scoped full decision authority in AGENTS.md; all existing gates remain mandatory. No runtime change.

- 2026-11-16: Renamed the fictional version 1 and version 2 contract fixtures to `legacy-pack-v1.json` and `legacy-pack-v2.json`. Updated test references and schema examples to use neutral module names and paths without changing validators or test assertions; no private content was read.
- 2026-11-16: Wired owner-only KB autofill into the gated worker module with an in-memory dry-run content client by default, private plan, fail-closed reason, and fictional worker-to-content reference regression. Live content client and content PRs in `<private-content-repo>`, its regression, bot integration, delivery manifest consumer (gap 2), and production lifecycle adapters (gap 5) remain open; no live content was written.
- 2026-11-16: Added a private version 1 delivery manifest contract, an opt-in writer after owner decisions and approved export gates, and a read-side verifier for protected per-job DOCX/PDF handoff. Fictional tests cover incomplete decisions, changed bytes, missing files, and escaping or linked paths. No live worker or consumer is wired to the writer. The consumer in `<private-bot-repo>`, bot approval interface, the separate live KB client following [PR #14](https://github.com/parker2808/jdcv/pull/14), the content publication and private regression following gap 4, production lifecycle adapters (gap 5), and production PDF sending remain separate reviewed work; PDF sending requires fresh owner authorization. No Dev notice was sent at coordinator direction.

- 2026-11-16: Added a reviewed worker-to-content mapper and fictional regression against mirrored content rules. Separate follow-ups: worker publication and content PRs, private content regression, the live content client following [PR #14](https://github.com/parker2808/jdcv/pull/14), the remaining CV approval interface (gap 1), delivery manifest consumer (gap 2), and lifecycle adapters (gap 5). No site or production data was changed.
- 2026-11-16: Added the owner-only private DOCX-to-proposal stage in the Mac worker. Fictional tests cover paragraph-grounded facts, pending decisions, rejection restoration, and approved DOCX rendering. PDF-only input, a protected decision interface in `<private-bot-repo>`, delivery manifest and handoff (gap 2), knowledge-base autofill adapter (gap 3), content module mapping (gap 4, separate thread), and production lifecycle adapters (gap 5) remain separate work; no real CV or production worker was accessed.

- 2026-11-16: Recorded one isolated, owner-only Phase 1 dry run, its five unresolved integration gaps, and the boundary between a passing fictional fixture and a real CV delivery. No live change or real delivery was made.

- 2026-11-15: Added owner-only module archive, restore, purge, inactivity warning, and a safe CLI with injectable adapters and fictional tests. Production storage and notification adapters, the bot integration, the private data change, and the web button remain separate tasks; Git removal does not erase history.

- 2026-11-15: Added injected knowledge-base topic matching, a duplicate-safe locked PR plan, public-content checks, and verified link transitions. A real content client and shared-lock adapter must be supplied outside this public repository; no content PR or development notice is sent here.
- 2026-11-15: Added an injectable CV/module quality gate with fictional blocking cases and a recorded worker result. The CLI refuses live runs until production private fact and reviewer adapters exist; the fake dry run still works.

- 2026-11-15: Added an owner-only Mac worker with injectable T3 relay, load admission, shared gate lock, and fake end-to-end tests. The prompt package is not wired to the worker yet because its separate private files and independent readability gate require a contract migration.
- 2026-11-15: Added bounded thread prompts, interview and readability gates, and owner/outside-user proposal policy with fictional tests.
- 2026-11-15: Added the fictional CV renderer, guarded export API, and Gotenberg CI integration test; storage and fallback implementation remain separate work.
- 2026-11-15: Added versioned bilingual module contracts, a pure version 1 converter, and generated JSON Schema with fictional fixtures.
- 2026-11-15: Added the Phase 1 local file queue with leased claims, retry limits, and a reusable storage interface.
- 2026-11-15: Created the public workspace baseline and local/CI gates; implementation remains pre-alpha.
