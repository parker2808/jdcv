# Repository rules

JDCV Prep is public. Read `PROJECT_CONTEXT.md` and `docs/LESSONS.md` before making changes. Check `git status` and open pull requests; preserve other work. For a large change, write a specification with measurable acceptance criteria in `docs/specs/` first.

## Workflow

- Use one task, one branch, and one pull request. Update `README.md` and `PROJECT_CONTEXT.md` in the same pull request. Run `scripts/check.sh` before opening it; continuous integration (CI) must be green before a human merges it. Never merge or deploy without explicit owner approval.
- Keep secrets, personal information, real CVs, and private repository names out of this public repository. Use placeholders such as `<private-content-repo>` and fake sample data such as "Alex Example". Review the entire diff for accidental disclosure.
- Use Node.js 22 and pnpm 9. Source goes in `apps/` or `packages/`; tests live beside the source. Data from users belongs in protected storage, not tracked files.
- Before a full test suite, build, browser run, Docker job, or PDF render on the Mac, read the first number from `sysctl -n vm.loadavg`. Below 25, proceed; from 25 to 40, do light work only; above 40, wait two minutes and check again. Run every heavy gate with `flock ~/.t3/locks/lilp-e2e.lock <command>`, or `lockf` when `flock` is unavailable. Let free CI runners handle heavy checks when possible.
- Stay on the assigned model. If the same bug has been fixed twice and still fails, stop and report `ESCALATE: <one-line bug summary>` for the coordinator to handle.

## Writing rules

Task 3b will expand this section with examples and a readability gate. Apply these seven rules now:

1. Write for someone new to the topic.
2. Say the main point and why it matters first, then give details.
3. Use full sentences and simple words. Explain a term or acronym the first time it appears.
4. Give each concept a concrete example from a real situation.
5. Avoid clipped bullets, label walls, keyword stuffing, and filler. Use bullets only for genuinely parallel ideas.
6. Keep paragraphs short. Give a 30-second answer first for interview questions, then a deeper answer.
7. Write Vietnamese naturally rather than translating word by word; keep familiar English technical terms.
