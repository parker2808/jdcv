# File job queue implementation

Phase 1 keeps job metadata in a configurable directory outside the public repository. A worker reads only opaque references to private input and output; for example, a fictional job can point to a protected file without putting its contents in the queue. This implements the queue portion of the system's job queue and Mac worker specification; the worker, database adapter, and delivery flow are later tasks.

The adapter serializes transitions with an exclusive file lock and writes each record through a temporary file and rename on the same volume. A claim issues a new lease token so a timed-out worker cannot finish another worker's attempt. The first claim and two retries give a default maximum of three attempts. A job reaches its 45-minute deadline even if it is still waiting in the queue.

## Acceptance criteria

1. Two adapters claiming the same directory concurrently receive each pending job at most once, including after lease expiry.
2. Repeating an intake key for the same owner returns the same job, and repeating completion does not change its result.
3. A failed claim retries with increasing delay and becomes failed with its last error after three attempts; an expired lease becomes claimable again before the job deadline.
4. Jobs older than 45 minutes fail without being claimed. The queue writes only references, never private document bodies, to its files.
5. Unit tests use a controlled clock and temporary directories; `scripts/check.sh` passes before the branch is pushed.
