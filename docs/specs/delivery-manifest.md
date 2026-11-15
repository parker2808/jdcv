# Private delivery manifest (gap 2, JDCV side)

## Purpose

An approved curriculum vitae (CV) must be handed to a private consumer without guessing which files belong to a job. A version 1 manifest is a final, private inventory: it appears only after every proposed line has an owner decision, the export gates pass, and both document files are present. It does not send a message or authorize production PDF delivery.

## Contract

| Field                                                     | Meaning and fictional example                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`, `jobId`, `cvVersionId`, `ownerId`, `createdAt` | Contract version `1`, opaque job and CV IDs such as `example-job` and `example-version`, an owner ID such as `example-owner`, and an ISO timestamp.                                                                                                                                                                                          |
| `diff`                                                    | The complete proposed lines, including `id`, `path`, `before`, `after`, `reason`, `requirementId`, `sourceRef`, `risk`, `riskNote`, `interviewAnswer`, `defenseEntryId`, `change`, `embellishment`, `defenseScore`, `criticalFindings`, and the final `decision`. A fictional Example Labs line may be rejected, but may not remain pending. |
| `approval`                                                | The export approval snapshot for this CV version. Each decision must match its entry by ID and status; approved lines require passing defence, while rejected lines preserve the original text.                                                                                                                                              |
| `docx`, `pdf`                                             | Each contains a relative `fileName`, `size` in bytes, and lowercase SHA-256 `sha256`. For example, `approved.docx` names a file in this job's private result directory, never a path elsewhere.                                                                                                                                              |

The JSON Schema checks structure. The writer and reader also check file confinement, regular-file type, byte size, digest, and the relationship between approvals and diff entries. Consumers must implement both levels of checks; JSON Schema alone cannot detect linked or changed files.

## Acceptance criteria

1. **AC1:** Version 1 JSON and generated JSON Schema reject unknown fields, pending decisions, absolute or traversing names, and incomplete approval records. Check with fictional contract tests.
2. **AC2:** Given a resolved Example Labs proposal and bytes returned by a gate-passing `exportApprovedCv`, the writer creates a mode 0700 private job directory, mode 0600 documents, and an atomic mode 0600 manifest last. It does not approve or send anything. Check in a temporary directory.
3. **AC3:** A pending proposal, mismatched approval, invalid export, existing manifest, unsafe destination, or failed file verification leaves no newly published manifest. Check injected and temporary-file failures.
4. **AC4:** The reader rejects changed or missing documents, size/hash mismatches, absolute or escaping paths, links, and changed approval data. Check fictional handoff tests.

## Separate follow-ups

The consumer in `<private-bot-repo>` must adapt its existing review and send flow to this versioned format and verify the manifest independently. Its approval interface, knowledge-base autofill (gap 3), content mapping (gap 4), production lifecycle adapters (gap 5), and any production PDF send need separate review and authorization.
