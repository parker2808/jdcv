# JDCV Prep

JDCV Prep will turn a job description into a tailored curriculum vitae (CV) and an interview study pack. The goal is to help a candidate prepare without inventing experience or publishing personal data.

The project is **pre-alpha**. Phase 1 is owner-only: the web view will show results and offer a link to continue the conversation in Telegram. It is not a public CV service yet.

## Help / usage

Install Node.js 22 (see `.nvmrc`) and pnpm 9, then run these commands from the repository root:

```sh
pnpm install
pnpm --filter @jdcv/contracts schema:generate
pnpm check
scripts/check.sh
pnpm --filter @jdcv/mac-worker start -- --help
```

`pnpm check` runs formatting, lint, type checking, a generated JSON Schema freshness check, unit tests, and a build. Generate schemas only after changing the contract. `scripts/check.sh` runs the local pull-request gate, including a secrets scan when gitleaks is installed and a whitespace check. For example, run the script before opening a pull request for a new parser, even if its unit tests pass.

The CV renderer accepts validated JSON and an approval snapshot. It fills the original `ats-classic` Word template, then optionally sends those same DOCX bytes to Gotenberg to produce a PDF. For example, `packages/cv-render/fixtures/alex-example.json` contains only fictional experience and tests both English and Vietnamese text. The package never writes generated CVs to disk.

To run its DOCX-only tests locally, use `pnpm exec vitest run packages/cv-render/src/index.test.ts`. Set `GOTENBERG_URL` to an existing Gotenberg endpoint to enable the PDF test; continuous integration (CI) supplies a free service container, so do not start Docker on the Mac. Import `renderDocx`, `renderPdf`, and `cvSchema` from `@jdcv/cv-render`; provide a trusted `ExportApproval` snapshot with the approved CV version and all line decisions. `renderPdf` returns the PDF bytes and a route name. On conversion, layout validation, or text mismatch, it throws unless a caller-provided fallback returns a PDF that passes the same text and optional layout checks. A caller can supply `validateLayout` once a measurable layout policy exists. The separate HTML fallback, private file storage, and 30-day download expiry are not implemented here.

## Repository layout

`packages/gates` checks a CV or module before export or publication. Pass private CV facts, per-line approvals and defenses, extracted document text, and an independent readability reviewer to `runGates`. For example, a fictional Vue project from 2023 fails if a proposed technology appeared in 2024. The result names the field and reason for every failure. The Mac worker records an injected quality result and refuses completion when it fails; the fake dry run does not load private facts. Run `pnpm exec vitest run packages/gates/src/index.test.ts` for synthetic examples.

`packages/gates` provides a quality gate before export or publication. Supply private CV facts, each line's approval and defense, a module, extracted document text, and an independent readability reviewer to `runGates`. For example, a fictional project using Vue in 2023 fails if its proposed technology did not exist until 2024. The result lists a field and reason for each failure; the Mac worker can record it through its injected `qualityGate` adapter and refuses completion when it fails. A production caller must provide the private facts and reviewer; the dry run does not load them automatically. Run `pnpm exec vitest run packages/gates/src/index.test.ts` for fictional cases.

`packages/shared` contains a small TypeScript starter package and its test. `packages/queue` contains the Phase 1 local file queue and a storage-independent `JobQueue` interface. [`packages/contracts`](packages/contracts/README.md) provides versioned bilingual module validators, a version 1 converter, fixtures, and JSON Schema for workers that do not use TypeScript. `packages/cv-render` contains the CV schema, renderers, original Word template, fictional fixture, and tests. [`packages/prompts`](packages/prompts/README.md) renders bounded instructions and checks interview scores and proposed CV edits; it does not read files or call models. `packages/mac-worker` consumes owner jobs, relays three separate threads, and includes a fake-model dry run. Future application packages go in `apps/` and reusable packages in `packages/`. `docs/README.md` indexes documentation. The [system specifications](docs/specs/README.md) describe the planned data contracts, worker, CV workflow, user experience, and privacy safeguards before implementation. `PROJECT_CONTEXT.md` records the current scope and unanswered questions, and `AGENTS.md` explains contributor rules.

## Local job queue usage

The queue stores job metadata on the Mac, not in this repository. By default it uses `~/.jdcv/queue`; set `JDCV_QUEUE_DIR` to an absolute private directory or pass `{ directory }` to `new FileJobQueue(...)` to change it. For example, a local worker can use a protected directory for a fictional job's input reference while keeping the document itself elsewhere.

Call `enqueue` with a stage (`type`), owner ID, `mac` or `cloud` route, and a private `payload.inputRef` pointer. Pass a stable `idempotencyKey` for intake retries. A worker calls `claim(route, leaseMs)`, keeps the returned `leaseToken`, calls `heartbeat` before its lease expires, then calls `complete` with an output pointer or `fail` with an error. `get`, `list`, and `cancel` support status views. Only pass opaque pointers, not document text, as `inputRef` or `outputRef`; do not put personal information in error strings. The default is one attempt plus two retries with increasing delay; jobs expire after 45 minutes. The database adapter is not implemented yet.

## Mac worker

The Phase 1 worker polls the local queue for the configured owner's Mac jobs. Set `JDCV_OWNER_ID` to the owner ID and keep `JDCV_QUEUE_DIR` and `JDCV_JOB_DIR` in private absolute directories outside this repository. An input reference must be an absolute path to a private file. For example, enqueue a fictional `Alex Example` job with `maxAttempts: 1` when a failed quality review should be terminal rather than retried by the queue.

Run `pnpm --filter @jdcv/mac-worker start -- --dry-run --once` to process one queued job with fake model output. This still checks Mac load, but never starts a T3 thread. Live CLI runs are disabled until a private quality-gate adapter supplies CV facts, line approvals, extracted text, and an independent reviewer. The existing T3 relay adapter expects `JDCV_T3_REPO` to point to a private local Git repository under the home directory; it starts distinct Generator, Interviewer, and Examiner threads without opening a server port. Do not start a live worker until the private runner, job directory, and quality-gate adapter have been reviewed.

The worker writes intermediate files with private permissions, checks mandatory requirements and defended claims, then publishes a module pointer only after the D9 score thresholds and per-entry readability pass. A failed stage gets at most two revisions. Queue leases are renewed during processing and expire no later than the 45-minute deadline. Any future heavy local gate should use the exported `SharedGateLock.command` helper; it uses the shared `~/.t3/locks/lilp-e2e.lock` through `flock` or macOS `lockf`. Generated content still requires human review before delivery.

Only fake sample data belongs in this public repository. Do not add real CVs, contact details, credentials, or private source code.

## Prompt package usage

Import `generatorPrompt`, `interviewerPrompt`, `examinerPrompt`, and `readabilityPrompt` from `@jdcv/prompts` when a caller can supply separate private `JobFiles` and an `Audience`; each call returns instruction text, not file contents. For example, point `files.jd` to `/private/jobs/alex-example/jd.txt`, not to the JD text itself. A prompt rejects invalid or oversized paths and turns over 6,144 UTF-8 bytes. The Mac worker still uses an injected builder because its current single-input file and three-result gate differ from the prompt package's separate input, proposal, transcript, examination, and independent readability files. Connecting them requires migrating those private file contracts and gate checks together; do not assume the stand-in already applies the prompt package's policy. Run `pnpm exec vitest run packages/prompts/src/index.test.ts` for focused tests; see [package usage](packages/prompts/README.md) for the typed gate inputs.
