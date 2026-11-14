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

`packages/shared` contains a small TypeScript starter package and its test. Future application packages go in `apps/` and reusable packages in `packages/`. `docs/README.md` indexes documentation. The [system specifications](docs/specs/README.md) describe the planned data contracts, worker, CV workflow, user experience, and privacy safeguards before implementation. `PROJECT_CONTEXT.md` records the current scope and unanswered questions, and `AGENTS.md` explains contributor rules.

Only fake sample data belongs in this public repository. Do not add real CVs, contact details, credentials, or private source code.
