# Security Fix Plans — Index

Each file is a standalone implementation plan. Cross-references ensure nothing duplicates
SPEC-030a (rate limiting), SPEC-057 (webhooks), SPEC-061 (strategy), or SPEC-ENT-001 (enterprise MFA).

## Priority Order

| File | Finding | Severity | Effort | Existing spec overlap |
|------|---------|----------|--------|-----------------------|
| `F01-ssrf-call-webhook.md` | SSRF via CALL_WEBHOOK | **Critical** | 30 min | None — SPEC-057 is inbound webhooks only |
| `A1-upload-oom.md` | File upload OOM | **High** | 15 min | None |
| `F03-security-headers.md` | Missing security headers | Medium | 10 min | None |
| `RC1-quote-toctou.md` | Quote TOCTOU race | Medium | 1 hr | None — SPEC-018 is flush ordering, not concurrent requests |
| `RC2-session-token-index.md` | Session token table scan | Medium | 1 hr | Extends SPEC-030a (don't re-implement rate limiter) |
| `A7-sse-connection-limit.md` | SSE no per-user limit | Medium | 45 min | None |
| `F02-credentials-masking.md` | Credentials in GET response | Medium | 2 hrs | SPEC-061 H3 (strategy already written) |
| `F08-github-actions-pinning.md` | Unpinned CI/CD actions | Medium | 30 min | None |
| `F17-meilisearch-exposure.md` | Meilisearch port open | Medium | 5 min | None — infra fix |
| `A2-A4-A8-rate-limits.md` | Missing rate limits (3 endpoints) | Low-Medium | 1 hr | Extends SPEC-030a (metadata declarations only) |
| `A3-A5-A6-pagination-caps.md` | Unbounded queries (3 endpoints) | Low-Medium | 30 min | None |
| `RC3-message-token-race.md` | Message token TOCTOU | Low | 45 min | Same pattern as RC1 |
| `NOT-ACTIONABLE.md` | Everything else | Various | — | Various |

## What's Already Covered — Do Not Create Parallel Plans

| Topic | Already in | Action |
|-------|-----------|--------|
| Rate limiting infrastructure | SPEC-030a (implemented) | Extend via metadata only |
| Webhooks module | SPEC-057 (draft) | F01 is outbound SSRF, separate concern |
| Security headers strategy | SPEC-061 H1 | Implemented by F03 plan |
| SSRF strategy | SPEC-061 H2 | Implemented by F01 plan |
| Credentials strategy | SPEC-061 H3 | Implemented by F02 plan |
| GitHub Actions strategy | SPEC-061 H4 | Implemented by F08 plan |
| Enterprise MFA | SPEC-ENT-001 | Password policy covered there |
| flush ordering (single-request) | SPEC-018 | Different from RC1/RC3 race conditions |
