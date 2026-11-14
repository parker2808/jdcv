# JD module experience

## Problem and why it matters

One study pack is easy to browse, but several job-description (JD) modules are not. A dashboard, focused module tabs, and search let a user find the right answer without losing the familiar bilingual reading flow. For example, someone revisiting a fictional frontend JD can find its keyboard-navigation answer from the global search page.

## Goals and non-goals

Provide a mobile-first JD dashboard, module page, comparison, global search, and an “Open in Telegram” handoff. Preserve the existing pack's accent-insensitive English/Vietnamese search and short-answer-first display. Phase 1 web shows results, not a chat interface; Phase 2 can add CV review and export for authenticated users.

## Design

`/jd` displays cards with an organization alias, role, level, date, tags, status, and test score. Filter by status, tag, and date, and group by organization alias or role. Archived cards are hidden by default; an owner can restore within seven days. A delete control appears only in edit mode and hands Phase 1 confirmation to Telegram.

`/jd/<slug>` has JD map, Concepts, Questions and Answers, CV defence, Cheat sheet, and Test results tabs; Phase 2 adds a CV diff/export tab. Show a 30-second answer before deeper detail. Shared KB entries have a “general knowledge” label and a live link to their source; pending links are visibly pending and not clickable as live content. `/jd/<slug>/cheatsheet` offers a focused reading view, `/jd/compare` aligns two JDs by requirement, and `/search` searches across accessible modules. `/` and Cmd+K focus search; the search field stays reachable on mobile and handles missing accents in English and Vietnamese.

Each Phase 1 card has an “Open in Telegram” button using a short-lived opaque `start` token. The bot resolves the token to an authorized module, not a JD or CV embedded in the URL. In Phase 2, a linked Telegram account uses the same authorized API flow. All module routes declare `noindex` and do not leak private content in page metadata or cached responses. Design and test first at 430×932 pixels without horizontal scrolling or clipped controls.

## Constraints and risks

An opaque token is still a bearer capability until redeemed; expiry, single use, and owner checks limit leakage. Never put raw job descriptions, applicant details, or real employer names in URLs or public fixtures. Global search must honor workspace boundaries and exclude archived modules by default.

## Acceptance criteria and verification

1. **AC1:** Dashboard filters and groups synthetic modules correctly, hides archived ones by default, and shows test scores. Check component and query tests with mixed statuses.
2. **AC2:** Every specified tab and route renders a bilingual synthetic module; short answers precede details and pending KB links are not presented as live. Check route and accessibility tests.
3. **AC3:** Search across accessible modules is accent-insensitive in English and Vietnamese; `/` and Cmd+K focus it. Check keyboard and search fixtures, including a cross-workspace denial.
4. **AC4:** At 430×932, the dashboard, tabs, search, and Telegram button have no horizontal overflow and remain usable by touch. Check Playwright screenshots and overflow assertions on a standard free CI runner.
5. **AC5:** Every module route is `noindex`; an expired or wrong-owner deep link cannot reveal a module or personal content. Check rendered metadata and token authorization tests.

## Open questions

Choose the exact token lifetime and whether a user may regenerate a link after expiry. Confirm the final tab labels with a small-screen readability review.
