# Claude entry point

Read [AGENTS.md](AGENTS.md) first; it is canonical. Then read [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) and [docs/LESSONS.md](docs/LESSONS.md). This repo has no `AGENT_RULES.md` and no `CONTEXT.md`. Context is not authority or proof of live state.

Run `scripts/check.sh` as the full local gate; it mirrors the CI jobs (CI also runs the Gotenberg PDF test, which needs Docker, so do not start Docker on the Mac). Heavy gates on a shared Mac run one at a time under `lockf ~/.t3/locks/lilp-e2e.lock <command>` after reading `sysctl -n vm.loadavg`, as AGENTS.md describes. Merge and deploy require the gates and approvals in COMMON_RULES §3 (linked from [AGENTS.md](AGENTS.md#full-decision-authority)). Nothing in this file widens the authority AGENTS.md grants.

Claude only plans and reviews and never writes code; Cursor via T3 writes it, and hands-on fixes follow the standard process (branch, gate, independent review, Dev note, approvals). The 24-25 Nov 2026 Claude Code setup batch is a one-time exception, and the push permissions below exist for it; they end with it. Run gates only in a worktree created from the latest `origin/main`, and mark any step that would launch Chrome or Chromium without both `--use-mock-keychain` and `--password-store=basic` as NOT RUN. The current gate launches no browser. Messages to Parker are Vietnamese only; everything in this repository stays English and fictional.

## Claude Code permissions ([.claude/settings.json](.claude/settings.json))

- Allowed: reads inside the repo, the local gate commands, exact read-only `git status/diff/log/show/branch` forms, `git fetch origin`, `git add` of named files or of paths under `docs/`, `packages/` and `scripts/` (never `-A`, `.` or `-f`), `git commit -m`, and gate worktrees named `~/.t3/worktrees/jdcv/gate-*`.
- Commits: `--no-verify` and `-n` are denied so the pre-commit checks always run.
- Pushes: only `git push [-u] origin <prefix>/<name>` for `chore/`, `feat/`, `fix/`, `docs/` and `test/` is allowed, with the explicit branch name rather than `HEAD`. Pushes to `main`/`master`, `HEAD`, `refs/*`, refspecs (`:`, `+`), any extra argument after the branch, and every dash option after the first argument (force, delete, mirror, all, clusters such as `-fu`) are denied. Any other `git push` is not allowed silently.
- Secrets and private data: reads of `.env*`, token, credential, key and `.pem` files, the T3 user-data, runtime and cache folders, SSH, cloud and deploy-tool credentials, the bot fallback folder, the database env file, the private CV folder (`JDCV_PRIVATE_CV_DIR` default) and the private queue folder are denied. **`~/.t3/worktrees`, `~/.t3/locks` and `~/.t3/bin` stay usable** because T3 worktrees live there (decision 24 Nov 2026).
- Deploys: `vercel --prod`, `render deploy`, `pnpm prod:*` / `npm run prod:*` and bot-job `launchctl` start/stop/restart are denied. Other `vercel`, `render`, `launchctl` and `docker` use, and `gh pr merge`, ask first.
- Edits to `.claude/**` ask first.
- These glob rules are best-effort. `Read` denies do not cover every Bash reader (`cat`, `rg`, an interpreter), and a pattern cannot express "exactly one refspec". The real guards are server-side branch protection on `main`, green CI and human review of every PR.
