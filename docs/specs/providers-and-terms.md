# Provider routing and usage terms

## Problem and why it matters

Personal AI subscriptions must not quietly serve someone else's job. Provider selection must protect private curriculum vitae (CV) data and keep spending at zero until a budget is approved. For example, an invited user with a CV must bring their own API key rather than run through the owner's T3 account.

## Goals and non-goals

Route owner jobs to the owner's Mac and T3 subscriptions; route outside users through a cloud worker using their own API key for CV steps. Allow free Gemini only for work proven free of personally identifiable information (PII). Do not resell subscriptions, route outside jobs to a personal account, or enable a paid platform key before budget approval.

## Design and data shape

After authenticating the actor and checking quota, choose `mac-owner` only for the owner. Its worker uses t3-lil.parker for owner-only jobs. For invited/public users choose `cloud-byok` for any CV/JD step carrying personal data: bring-your-own-key (BYOK) credentials are encrypted at rest, scoped to the owning workspace/user, never returned to the browser after saving, and used only by that user's job. The cloud worker calls provider APIs without filesystem tools or another tenant's inputs. A separate `cloud-free-non-pii` path may use free Gemini for a general topic after redaction and a positive non-PII classification; when in doubt reject or route to authorized BYOK instead. Never send raw CV or identifying JD text to the free path.

A route decision records job ID, actor/workspace, stage, chosen route, provider, consent version, and a non-sensitive reason. Enforce per-user monthly and platform-wide spending limits for any future platform-paid API route. Decision D1 keeps that route disabled until the owner approves a budget. If a user's key is missing, invalid, or over quota, return an actionable error rather than fall back to the owner's subscription or a paid key. Free offerings and provider terms can change; review current provider data terms before public launch and document third-party processing in the Privacy Policy.

## Constraints and risks

Redaction can miss names in raw JD text. Subscription and API data terms differ and may change; do not promise legal compliance based solely on this design. Key storage requires encryption and rotation, while alerts and usage records must not contain raw keys or document text.

## Acceptance criteria and verification

1. **AC1:** An outside user's job can never select `mac-owner`, even when a BYOK key is absent or invalid. Check route-policy table tests for owner, invited, and public identities.
2. **AC2:** Any step containing CV or other PII uses authorized BYOK for outside users; the free Gemini route accepts only a positive non-PII classification. Check synthetic PII, redacted, and uncertain-input cases with a mocked provider client.
3. **AC3:** No platform-paid provider call succeeds before explicit budget configuration; quota exhaustion fails closed. Check provider-factory and budget-limit tests with a disabled paid route.
4. **AC4:** Keys are encrypted in storage, never logged or returned in full, and cannot be used by another workspace. Check storage, log-scan, and cross-tenant tests.

## Open questions

Recheck current API and subscription terms before outside-user launch. Set explicit monthly user and platform-wide limits only if a future paid budget is approved.
