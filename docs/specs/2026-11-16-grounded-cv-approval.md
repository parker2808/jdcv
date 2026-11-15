# Grounded owner CV proposals (gap 1)

## Purpose

The Mac worker must read the owner's general curriculum vitae (CV) before it can offer tailored lines. A module-only result is not an approved CV. For example, a fictional Example Labs bullet may be reworded for a job description (JD), but the original remains in the export until its owner approves the replacement.

## Boundary

Only a DOCX general CV in the configured private directory may be read. Missing, ambiguous, linked, or repository-contained sources fail closed. A model proposes structured facts and edits through an injected relay; each fact must point to an exact source paragraph, and every original bullet must match that paragraph. A model's citation is not evidence if its quoted text is absent. A PDF-only source is not supported in this increment.

Proposals are versioned private objects, never public module entries. Every line starts pending. An owner decision changes only the named line. Approval of an unsupported detail requires a passing interview defence; rejection restores the original line. No export is requested while any decision is pending. A separate private delivery adapter and approval interface are later work.

## Acceptance criteria

1. **AC1:** A missing, empty, ambiguous, linked, or repository-contained private CV directory returns a stable error without reading another file. Test with temporary directories only.
2. **AC2:** A DOCX fixture yields numbered source paragraphs. Fact citations and original lines must match those paragraphs; fabricated facts and missing citations fail.
3. **AC3:** An injected relay supplies the versioned proposal, with one pending decision for each edit, a JD requirement, risk, and truthful defence. Implausible core-fact changes fail.
4. **AC4:** A pending line prevents both formats; rejected lines restore originals; approved lines enter the CV and remain in the approval record. Test only fictional bytes.

## Follow-ups

The owner approval interface in `<private-bot-repo>`, delivery manifest and handoff (gap 2), knowledge-base adapter (gap 3), content mapping (gap 4), and production lifecycle adapters (gap 5) are separate changes.
