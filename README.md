# JDCV Prep

JDCV Prep will turn a job description into a tailored curriculum vitae (CV) and an interview study pack. The goal is to help a candidate prepare without inventing experience or publishing personal data.

The project is **pre-alpha**. Phase 1 is owner-only: the web view will show results and offer a link to continue the conversation in Telegram. It is not a public CV service yet.

## Help / usage

Install Node.js 22 (see `.nvmrc`) and pnpm 9, then run these commands from the repository root:

```sh
pnpm install
pnpm check
scripts/check.sh
```

`pnpm check` runs formatting, lint, type checking, unit tests, and a build. `scripts/check.sh` runs the local pull-request gate, including a secrets scan when gitleaks is installed and a whitespace check. For example, run the script before opening a pull request for a new parser, even if its unit tests pass.

## Repository layout

`packages/shared` contains a small TypeScript starter package and its test. `packages/queue` contains the Phase 1 local file queue and a storage-independent `JobQueue` interface. Future application packages go in `apps/` and reusable packages in `packages/`. `docs/README.md` indexes documentation. The [system specifications](docs/specs/README.md) describe the planned data contracts, worker, CV workflow, user experience, and privacy safeguards before implementation. `PROJECT_CONTEXT.md` records the current scope and unanswered questions, and `AGENTS.md` explains contributor rules.

## Local job queue usage

The queue stores job metadata on the Mac, not in this repository. By default it uses `~/.jdcv/queue`; set `JDCV_QUEUE_DIR` to an absolute private directory or pass `{ directory }` to `new FileJobQueue(...)` to change it. For example, a local worker can use a protected directory for a fictional job's input reference while keeping the document itself elsewhere.

Call `enqueue` with a stage (`type`), owner ID, `mac` or `cloud` route, and a private `payload.inputRef` pointer. Pass a stable `idempotencyKey` for intake retries. A worker calls `claim(route, leaseMs)`, keeps the returned `leaseToken`, calls `heartbeat` before its lease expires, then calls `complete` with an output pointer or `fail` with an error. `get`, `list`, and `cancel` support status views. Only pass opaque pointers, not document text, as `inputRef` or `outputRef`; do not put personal information in error strings. The default is one attempt plus two retries with increasing delay; jobs expire after 45 minutes. The Mac worker and database adapter are not implemented yet.

Only fake sample data belongs in this public repository. Do not add real CVs, contact details, credentials, or private source code.
