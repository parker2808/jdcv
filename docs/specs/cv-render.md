# CV renderer (R7)

## Purpose

An approved curriculum vitae (CV) should have the same readable claims in Word and PDF. For example, a fictional `Kỹ năng` heading must keep its accents after conversion.

This implementation follows the open CV-export specification. It accepts structured CV JSON, fills one tagged Word template, converts the resulting DOCX through Gotenberg's LibreOffice route, and verifies extracted PDF text before returning it. The separately specified HTML/Chromium fallback is represented by an optional adapter: if conversion or text verification fails and no verified adapter is provided, export fails visibly.

## Boundary

The caller supplies the approved version and all line decisions, including pending proposals that are not in the rendered CV. Export refuses a mismatched version, a pending proposal, a rejected proposal still referenced in the CV, or an approved proposal without a passing defence. A rejected proposal restored to the original line does not block export. The caller must load these decisions from protected storage rather than accepting client assertions. File retention and authenticated download expiry belong to a later storage service; this package neither stores nor serves files, so it cannot implement the 30-day expiry rule.

The sample template is original and uses Noto Sans as a declared font. Deployments must provision that Open Font License font in the LibreOffice container; no font binaries or private CVs are included.

## Acceptance criteria

1. **AC1:** A fictional bilingual fixture validates and renders into a parseable DOCX, and CI converts those exact bytes to a PDF with a Gotenberg service.
2. **AC2:** Extracted DOCX and PDF text includes every rendered section and claim in order, including Vietnamese diacritics; the PDF path rejects text that differs.
3. **AC3:** A failed conversion or mismatched extraction invokes an injected fallback only if its output passes the same text check; otherwise it throws a visible error.
4. **AC4 (export boundary):** An unapproved version, a pending change, a rejected change still used in the CV, or a change without a passing defence blocks both formats. Expiry/download testing waits for the separate private storage service.

Local tests skip PDF conversion without `GOTENBERG_URL`; CI runs it with a service container. No local Docker or PDF rendering is needed.
