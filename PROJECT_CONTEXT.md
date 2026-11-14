# Project context

JDCV Prep helps turn a job description into a tailored CV and interview study pack. It exists to make preparation more useful while keeping experience claims accurate and personal data private.

## Current state

The repository is pre-alpha and contains only a workspace starter. Phase 1 is owner-only: the web view shows results and links to a Telegram conversation. No production service, personal CV, account integration, or deployment exists in this repository yet.

## Planned phases

Phase 1 adds the owner workflow and validation. Phase 2 adds an invitation-only web experience, account linking, and terms and privacy documents. Phase 3 may open both web and Telegram access to the public after privacy and security review. For example, the owner should be able to review proposed CV edits before any document is exported.

## Stack and decisions

The starter uses Node.js 22, pnpm 9, TypeScript, Vitest, ESLint, and Prettier. This is a public repository; examples must be fake and external private integrations must use placeholders. CI runs on free standard GitHub runners. The product name is JDCV Prep.

## Open facts

The production data service and its configuration are not available yet. Later specifications will define storage, worker, and export interfaces before implementation. Licensing and exact attribution for any future reused code must be checked before copying.

## Changelog

- 2026-11-15: Created the public workspace baseline and local/CI gates; implementation remains pre-alpha.
