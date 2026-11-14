# Job queue and Mac worker

## Problem and why it matters

Web and Telegram requests must not call a personal Mac directly. A durable queue lets the Mac pull owner jobs outbound and lets the same intake flow later route outside-user jobs to a cloud worker. For example, retrying a fictional JD after a worker restart should not produce two published modules.

## Goals and non-goals

Phase 1 uses a local file queue with atomic claim, bounded retries, and timeout. Phase 2 replaces storage with a database-backed queue behind the same interface. The Mac worker handles only the owner's jobs through t3-lil.parker; outside users use a cloud worker and API providers. No inbound Mac port, subscription sharing, or paid runner is required.

## Design and data shape

Both adapters expose `enqueue`, `claim`, `heartbeat`, `complete`, `fail`, `cancel`, and `get` with idempotent transitions. A job record carries an opaque ID, workspace/owner ID, stage, route (`mac` or `cloud`), status, attempt count, claim lease and expiry, timestamps, and opaque pointers to private input/output. Do not store CV or JD bodies in a queue filename, log, or notification. Phase 1 writes job records atomically and uses a file lock when claiming or updating; expired claims can be reclaimed only after the lease expires. Phase 2 uses conditional database claims and a workspace-scoped concurrency limit. A stable intake idempotency key prevents a web or Telegram retry from creating another job.

The worker polls outbound: local files in Phase 1, authenticated HTTPS in Phase 2. Telegram `/jd` is the Phase 1 intake and delivers approval prompts and files; the Phase 1 web page displays results and opens Telegram. In Phase 2 both web and a linked Telegram account call the API to enqueue and receive status/results. The Mac never accepts an inbound connection. A private per-job worktree holds input and intermediate files, not the public repository; delete it after seven days.

For owner jobs, run model admission before starting a new turn, then use the approved T3 runner on t3-lil.parker. Keep Generator, Interviewer, and Examiner threads distinct; the worker relays output via CLI `send --wait` and `show`, rather than assuming CLI thread spawning. The Interviewer probes every mandatory JD requirement and every CV embellishment; the Examiner scores each answer, and the Generator revises failing content at most twice. Each turn's instructions stay at or below 6,144 bytes; pass larger data by files in the private job workspace. Record environment, thread, provider, and switches without prompt contents. Fail or request review when average score is below 4.0/5, mandatory requirement coverage below 100%, any embellishment defence below 4/5, or any critical finding remains. A separate readability review scores every study entry at least 4/5 before publication.

Before each new T3 turn or heavy gate, read the first number from `sysctl -n vm.loadavg`. Below 25 permits new work; 25 through 40 permits only light work or continuing an existing turn; above 40 starts nothing new and retries admission after two minutes. A job times out after 45 minutes and may retry a failed stage at most twice without duplicating published output. Limit JD-CV to three active threads, reserving two slots for a live owner job. Run every heavy local gate under the shared `~/.t3/locks/lilp-e2e.lock` `flock` (or `lockf` fallback); prefer standard free GitHub Actions runners for rendering, browser tests, and containers.

## Constraints and risks

Never persist secrets or personal inputs in Git, telemetry, or alert text. Notify channels by job ID and authenticated link only. Lease expiry, process crashes, quota pauses, and a lock shared by unrelated tasks can cause duplicates or delays unless completion is idempotent. The Phase 2 cloud path cannot use the Mac's personal subscription.

## Acceptance criteria and verification

1. **AC1:** Two simultaneous workers claim a queued job at most once, and a crashed claimant is reclaimable after lease expiry. Check concurrent adapter tests with a controlled clock for both backends.
2. **AC2:** A repeated intake key returns the same job and completion is idempotent; failure retries stop after two revisions per stage and a job over 45 minutes times out. Check transition and clock-driven tests.
3. **AC3:** A synthetic JD passes through Generator, Interviewer, Examiner, and result delivery only when all four score/coverage gates and per-entry readability pass. Check a mocked CLI end-to-end test with failing and passing rubrics.
4. **AC4:** At load 24, 25, 40, and 41, new heavy work is admitted only at 24; no job is started above 40. Check a stubbed load reader and shared-lock contention test without actually loading the Mac.
5. **AC5:** The Mac exposes no inbound job endpoint; outside-user jobs never select the Mac route. Check route authorization tests and network configuration review.

## Open questions

Set the poll interval, lease renewal interval, and owner-job priority after measuring actual queue latency. Confirm a safe cross-filesystem atomic-write strategy before placing the Phase 1 queue on a different volume.
