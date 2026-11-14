# Project context

JDCV Prep helps turn a job description into a tailored CV and interview study pack. It exists to make preparation more useful while keeping experience claims accurate and personal data private.

## Current state

The repository is pre-alpha and contains a workspace starter, a local file job queue, shared module contracts, and a standalone CV renderer with a fictional sample template. Phase 1 is owner-only: the planned web view will show results and link to a Telegram conversation. No production service, personal CV, account integration, worker, or deployment exists in this repository yet.

## Planned phases

Phase 1 adds the owner workflow and validation. Phase 2 adds an invitation-only web experience, account linking, and terms and privacy documents. Phase 3 may open both web and Telegram access to the public after privacy and security review. For example, the owner should be able to review proposed CV edits before any document is exported.

## Stack and decisions

The starter uses Node.js 22, pnpm 9, TypeScript, Vitest, ESLint, and Prettier. The contracts package uses Zod for runtime validation and generated JSON Schema for other languages. For example, a fictional frontend module can be converted from version 1 without changing its bilingual answers. The CV renderer uses docxtemplater core and PizZip to fill an original Word template. Gotenberg converts that DOCX to PDF; CI runs the conversion on a free standard GitHub runner. This is a public repository; examples must be fake and external private integrations must use placeholders. The product name is JDCV Prep.

## Open facts

The production data service and its configuration are not available yet. `JobQueue` defines the storage contract; the database adapter, worker process, and connected export flow remain later tasks. The file queue assumes atomic rename on one local volume and a single Mac host; confirm cross-volume behavior before changing its storage location. The version 2 specification leaves archive dates and job-description IDs for the later storage record, not the module document. A knowledge-base (KB) reference cannot become live until its external target is verified. A trusted caller must obtain approvals from protected storage before rendering. The separate HTML/Chromium fallback, authenticated downloads with 30-day expiry, deployment font provisioning, and free-tier Gotenberg memory measurement remain open; the renderer fails visibly without a verified fallback. Licensing and exact attribution for any future reused code must be checked before copying.

## Changelog

- 2026-11-15: Added the fictional CV renderer, guarded export API, and Gotenberg CI integration test; storage and fallback implementation remain separate work.
- 2026-11-15: Added versioned bilingual module contracts, a pure version 1 converter, and generated JSON Schema with fictional fixtures.
- 2026-11-15: Added the Phase 1 local file queue with leased claims, retry limits, and a reusable storage interface.
- 2026-11-15: Created the public workspace baseline and local/CI gates; implementation remains pre-alpha.
