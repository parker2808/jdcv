# Prompt templates and review gates

## Purpose

The Mac worker needs small, repeatable instructions for each thread without putting a curriculum vitae (CV) or job description (JD) in a prompt. For example, a fictional job for Alex Example can point the Generator to private files, while a test checks the instructions without reading those files.

## Design

`@jdcv/prompts` renders Generator, Interviewer, Examiner, and separate readability-review turns from typed private file references. The Generator writes a version 2 module that passes `@jdcv/contracts` validation. The Interviewer asks about each mandatory JD requirement and each proposed CV edit; the Examiner scores each answer from one to five and marks critical findings. The reviewer scores every study entry from one to five and requests revision below four. The worker owns the private workspace, thread relay, iteration limit, validation, and publication; this package performs no input/output or model calls.

Every rendered turn stays within 6,144 UTF-8 bytes. Large input and output bodies remain in private files. The worker must not treat prompt instructions as proof of factual support or as authorization to publish a CV. The evaluation gate checks answer scores, full mandatory coverage, every embellishment defence at four or above, and zero critical findings. A separate readability gate checks every entry at four or above.

An owner may request proposed embellishments by default. Outside users must explicitly opt in and accept the current terms first. Only additions to existing projects supported by project facts can be proposed; employer, title, date, project, and credential inventions are forbidden. Every proposal requires a source, risk, line-by-line approval, and a short answer followed by a deeper defence. None of these checks approves a change for export.

## Acceptance criteria

1. **AC1:** Render all four turns with long fictional file paths and maximal realistic identifiers; each UTF-8 result is at most 6,144 bytes. Reject oversized or unsafe references rather than truncating them.
2. **AC2:** Pass a complete result at an average of four. Fail separately for low average, missing mandatory coverage, a low embellishment defence, a critical finding, or a malformed score.
3. **AC3:** The owner defaults on; outside users require both explicit opt-in and current terms acceptance. Reject forbidden claim changes and unsupported project details in synthetic fact tests.
4. **AC4:** Both Generator and reviewer state the full clear-writing rules. A readability result passes only when every expected entry scores at least four.

## Open questions

The worker must decide the concrete private file format for interview turns and independently verify the generated module and proposal records before presenting them for review. Estimated metric ranges need a domain-specific policy before any estimate can be approved.
