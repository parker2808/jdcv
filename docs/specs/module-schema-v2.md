# JD module schema v2

## Problem and why it matters

The existing interview study pack uses a version 1 shape. A new JD module needs links to shared knowledge and to approved CV claims without breaking that pack or its bilingual reader. For example, a fictional frontend JD may reuse a general accessibility explanation while keeping the original study answer intact.

## Goals and non-goals

Provide a Zod runtime validator and generated JSON Schema for a versioned module, plus a deterministic version 1 to version 2 converter. Preserve all existing entry identifiers, order, English and Vietnamese content, and required fields. Do not migrate personal CV content into Git or replace the existing version 1 reader in this work.

## Design

Version 1 has `{version, requirements[], entries[]}`. Each entry has `{id, section, jdRequirement, tags, title, shortAnswer, keyPoints, detail}` in English and Vietnamese as represented by the existing pack. The implementation must inspect the actual version 1 field nesting before defining the exact Zod types; the converter preserves that nesting rather than guessing a new translation layout. Accept version 1 input through a compatibility parser, convert it to version 2, then validate it with Zod and its generated JSON Schema. Keep the original version 1 data path available, including the `fde/` reader; Phase 1 stores new modules in `<private-content-repo>` under `modules/<jd-slug>.json` with an index, without moving old packs.

Version 2 retains the version 1 fields, sets `version` to `2`, and adds optional `kbRefs` and `embellishmentRefs` arrays to entries. A knowledge reference identifies a canonical topic and section plus a `pending`, `live`, or `rejected` state; the UI must not treat a pending reference as a published link. An embellishment reference identifies an approved-or-pending change in the CV review record; the study entry used to defend that change is referenced by its entry ID. These are identifiers, never CV text. The module can carry archive timestamps and source metadata in the later database model, but defaults for compatibility must not change old answers.

For example, an entry with ID `q-accessibility` keeps its two-language `shortAnswer` and adds `kbRefs: [{slug: "keyboard-navigation", sectionId: "focus", state: "live"}]`. A migrated version 1 entry receives empty reference arrays, not invented links. Define a single canonical schema source and derive JSON Schema from it; check both validators against identical fixtures, including missing translations and dangling IDs. Writing rules apply to generated content: short answer first, then deeper detail and a concrete example.

## Constraints and risks

Only fictional fixtures may be checked into this public repository. References must resolve within the same module or an authorized knowledge index; data from `<private-content-repo>` must not be copied here. Risks include mismatched JSON Schema and Zod behavior, accidentally changing version 1 rendering, and falsely treating pending knowledge as published.

## Acceptance criteria and verification

1. **AC1:** Every required version 1 entry field and both language values survive conversion without changed text, IDs, or order. Check a synthetic bilingual version 1 fixture with deep equality on the preserved fields, then render it through the existing reader.
2. **AC2:** Zod and generated JSON Schema accept the same valid version 2 fixture and reject missing required translations, duplicate entry IDs, and malformed references. Check a shared positive/negative fixture matrix in unit tests.
3. **AC3:** Conversion is deterministic and does not invent references: two runs produce identical output with empty new arrays. Check repeated conversion and snapshot comparison.
4. **AC4:** An old FDE pack remains available unchanged and a version 2 module can be indexed alongside it. Check the old reader and the new index validator in an integration fixture.

## Open questions

Confirm the actual version 1 bilingual field nesting and section enum from the existing pack before freezing JSON Schema. Confirm whether archive metadata belongs in the module document or only in its storage record.
