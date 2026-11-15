# Documentation

Start with the [project context](../PROJECT_CONTEXT.md) for the current product scope, then read [lessons](LESSONS.md) before changing code. The [system specifications](specs/README.md) explain how the planned features fit together and give a reading order. For example, the export spec defines how a fictional CV becomes both a Word document and a PDF, with checks for readable Vietnamese text.

The [file queue implementation plan](specs/file-job-queue.md) adds measurable race and retry checks for the first local adapter.

The [Phase 1 end-to-end dry-run gap report](e2e-dryrun-gap-report.md) explains why a fictional bot-to-worker job is not yet a safe, complete CV delivery. For example, the worker's module JSON cannot be sent as an approved CV.

The [owner CV proposal implementation specification](specs/2026-11-16-grounded-cv-approval.md) describes the private DOCX source, source citations, pending decisions, and export boundary. For example, a proposed line for Example Labs must be approved individually; a module-only dry run is not approval.

The specifications cover:

- [JD module schema v2](specs/module-schema-v2.md), including compatibility with existing bilingual study packs.
- [Job queue and Mac worker](specs/job-queue-and-mac-worker.md), including retries and outbound polling.
- [CV export](specs/cv-export.md), including Word and PDF output from approved data.
- [Controlled CV embellishment](specs/cv-embellishment.md), including line-by-line approval.
- [Interview knowledge-base autofill](specs/kb-autofill.md), including topic matching and pending links.
- [Module deletion and archiving](specs/module-delete-and-archive.md), including undo and retention of shared knowledge.
- [JD module experience](specs/jd-module-ux.md), including mobile search and Telegram handoff.
- [Multi-user access and privacy](specs/multi-user-and-privacy.md), including workspace isolation and consent.
- [Provider routing and usage terms](specs/providers-and-terms.md), including restrictions on personal subscriptions.
