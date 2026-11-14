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
```

`pnpm check` runs formatting, lint, type checking, a generated JSON Schema freshness check, unit tests, and a build. Generate schemas only after changing the contract. `scripts/check.sh` runs the local pull-request gate, including a secrets scan when gitleaks is installed and a whitespace check. For example, run the script before opening a pull request for a new parser, even if its unit tests pass.

The CV renderer accepts validated JSON and an approval snapshot. It fills the original `ats-classic` Word template, then optionally sends those same DOCX bytes to Gotenberg to produce a PDF. For example, `packages/cv-render/fixtures/alex-example.json` contains only fictional experience and tests both English and Vietnamese text. The package never writes generated CVs to disk.

To run its DOCX-only tests locally, use `pnpm exec vitest run packages/cv-render/src/index.test.ts`. Set `GOTENBERG_URL` to an existing Gotenberg endpoint to enable the PDF test; continuous integration (CI) supplies a free service container, so do not start Docker on the Mac. Import `renderDocx`, `renderPdf`, and `cvSchema` from `@jdcv/cv-render`; provide a trusted `ExportApproval` snapshot with the approved CV version and all line decisions. `renderPdf` returns the PDF bytes and a route name. On conversion, layout validation, or text mismatch, it throws unless a caller-provided fallback returns a PDF that passes the same text and optional layout checks. A caller can supply `validateLayout` once a measurable layout policy exists. The separate HTML fallback, private file storage, and 30-day download expiry are not implemented here.

## Repository layout

`packages/shared` contains a small TypeScript starter package and its test. `packages/queue` contains the Phase 1 local file queue and a storage-independent `JobQueue` interface. [`packages/contracts`](packages/contracts/README.md) provides versioned bilingual module validators, a version 1 converter, fixtures, and JSON Schema for workers that do not use TypeScript. `packages/cv-render` contains the CV schema, renderers, original Word template, fictional fixture, and tests. [`packages/prompts`](packages/prompts/README.md) renders bounded instructions and checks interview scores and proposed CV edits; it does not read files or call models. Future application packages go in `apps/` and reusable packages in `packages/`. `docs/README.md` indexes documentation. The [system specifications](docs/specs/README.md) describe the planned data contracts, worker, CV workflow, user experience, and privacy safeguards before implementation. `PROJECT_CONTEXT.md` records the current scope and unanswered questions, and `AGENTS.md` explains contributor rules.

## Local job queue usage

The queue stores job metadata on the Mac, not in this repository. By default it uses `~/.jdcv/queue`; set `JDCV_QUEUE_DIR` to an absolute private directory or pass `{ directory }` to `new FileJobQueue(...)` to change it. For example, a local worker can use a protected directory for a fictional job's input reference while keeping the document itself elsewhere.

Call `enqueue` with a stage (`type`), owner ID, `mac` or `cloud` route, and a private `payload.inputRef` pointer. Pass a stable `idempotencyKey` for intake retries. A worker calls `claim(route, leaseMs)`, keeps the returned `leaseToken`, calls `heartbeat` before its lease expires, then calls `complete` with an output pointer or `fail` with an error. `get`, `list`, and `cancel` support status views. Only pass opaque pointers, not document text, as `inputRef` or `outputRef`; do not put personal information in error strings. The default is one attempt plus two retries with increasing delay; jobs expire after 45 minutes. The Mac worker and database adapter are not implemented yet.

Only fake sample data belongs in this public repository. Do not add real CVs, contact details, credentials, or private source code.

## Prompt package usage

Import `generatorPrompt`, `interviewerPrompt`, `examinerPrompt`, and `readabilityPrompt` from `@jdcv/prompts` in a future worker. Supply the `JobFiles` paths for a private fictional job and an `Audience` for the owner or an outside user; each call returns instruction text, not file contents. For example, point `files.jd` to `/private/jobs/alex-example/jd.txt`, not to the JD text itself. A prompt rejects invalid or oversized paths and turns over 6,144 UTF-8 bytes. The worker must validate outputs and enforce review and publication gates separately. Run `pnpm exec vitest run packages/prompts/src/index.test.ts` for focused tests; see [package usage](packages/prompts/README.md) for the typed gate inputs.
