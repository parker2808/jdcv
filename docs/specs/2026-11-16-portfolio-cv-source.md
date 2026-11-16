# Published portfolio as an owner CV source (R10)

## Purpose and boundary

The owner can read published career facts without keeping a second Word CV in sync. The worker reads only unauthenticated, public HTTP endpoints and writes a numbered evidence snapshot in its protected job workspace. For example, a fictional Example Labs highlight becomes a cited paragraph, not an automatically approved CV edit.

The default remains the private DOCX source. A job selects exactly one source before the proposal relay starts; an unavailable portfolio never triggers a DOCX fallback. Both languages are requested so a bilingual baseline can cite published text. If the public endpoint falls back to English, its `lang` value identifies the actual source language. Public data must still be treated as private job data after retrieval. Neither a CMS package nor an administrator endpoint is a dependency.

## Acceptance criteria

1. **AC1:** A configured portfolio source reads public site, experience, education, grouped skills, all project-list pages, and each project detail using HTTP GET with a bounded timeout and validates consumed fields. No request carries credentials.
2. **AC2:** Each retained field or highlight has a stable public-path pointer and numbered paragraph reference. The existing proposal grounding, pending decisions, gates, and exports receive the same paragraph-based input as a DOCX job.
3. **AC3:** Invalid configuration, non-success HTTP status, network failure, timeout, malformed schema, incomplete pagination, or missing essential career data returns a content-free `CV_SOURCE_*` code. The worker does not read a second source.
4. **AC4:** A fictional DOCX and equivalent public responses give the stub relay equivalent grounded facts and version 1 proposal shape. Tests make no live network calls and cover the failures in AC3.

No live approval interface, multi-user data source, CMS rendering, or production rollout is included.
