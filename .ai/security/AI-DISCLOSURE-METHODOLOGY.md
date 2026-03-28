# Methodology & AI Disclosure

## How This Review Was Conducted

This security assessment was conducted over approximately three days using an AI-assisted research workflow. I want to be transparent about that process — both because it's the right thing to do, and because it affects how you should weight the findings.

---

## The Role of AI in This Review

The review was conducted using Claude (Anthropic) as an active research partner via Claude Code, with access to the codebase, a live test environment, and the ability to run commands, write scripts, and execute tests.

**What the AI did:**

- Read and cross-referenced large volumes of source code (packages, routes, validators, entity definitions) faster than I could manually
- Generated hypotheses about vulnerability patterns based on what it observed in the code
- Wrote the Playwright test scripts, curl PoC commands, and the concurrent race condition tests
- Drafted fix plans and the spec document
- Researched the vm sandbox escape technique and suggested the Promise constructor chain vector

**What I did:**

- Directed the research — decided which surfaces to look at, when to push deeper, when to accept "probably safe"
- Made all judgement calls about severity, exploitability, and scope
- Reviewed each AI hypothesis critically before deciding it was worth pursuing
- Ran the live tests and verified results myself on the actual test box
- Approved every executed command (the AI cannot run anything on a live system without my explicit permission)
- Wrote the disclosure framing, the BYOAI architectural proposal, and the email
- Read the actual vulnerability evidence (Meilisearch access logs, app log excerpts, API responses) and interpreted them

The AI functioned closer to a senior researcher I was pairing with than a tool I was running. It formed opinions, challenged some of my initial framings, and identified things I would likely have missed on a solo review. That's worth being honest about.

---

## Methodology

### Phase 1 — Reconnaissance (Day 1)

Explored the codebase structure, tech stack, dependency versions, and deployment topology before touching the running application. The AI read documentation, AGENTS.md files, spec documents, and RELEASE_NOTES.md to build context. I reviewed the dependency audit output and identified the Next.js CVEs early as a baseline.

### Phase 2 — Static Analysis (Day 1–2)

Systematic review of security-critical code paths:
- Central API router (auth enforcement, tenant scoping)
- All authentication flows (login, reset, magic link, customer portal)
- The full RBAC model across 12+ modules
- 76 API route files across customers, sales, catalog, currencies
- Workflows, integrations, entities, business_rules modules
- Attachment storage, text extraction, shell command usage
- AI assistant and MCP server architecture

For each area the AI proposed hypotheses; I read the actual code and made the call on whether the hypothesis was valid.

### Phase 3 — Dynamic Testing (Day 2–3)

Tested against a self-hosted Docker deployment on an isolated test box (`10.0.64.14`). No production systems were used.

Tests conducted:
- Security headers check via `curl -sI`
- Authentication flows via curl and Playwright
- F01 (SSRF): created real workflow definitions via API, executed instances, verified Meilisearch access logs
- RC1 (TOCTOU): generated a real quote token via `POST /api/sales/quotes/send`, fired 20 concurrent accepts, observed app logs
- A1 (upload): generated a 20MB binary via `dd`, submitted via multipart form, observed HTTP 200
- A3 (unbounded): sent `limit=999999` to workflow instances endpoint, confirmed in response
- vm escape: tested locally using Node.js 22.22.0 with the same sandbox configuration as the app; confirmed `child_process.execSync('id')` executed from within the sandbox context
- JWT forgery: decoded a real JWT, demonstrated the signing key is required, showed the forge technique works in principle

### Phase 4 — Validation and Triage (Day 3)

For each finding, I applied the SECURITY.md scope criteria and the issue #546 checklist before including it. Findings I couldn't confirm with live evidence or code-level certainty are marked accordingly. I explicitly excluded availability findings that didn't meet the SECURITY.md amplification threshold.

---

## My Validation — What I'm Confident In

**High confidence (code + live evidence):**
- F01 SSRF: Meilisearch access log shows the request; workflow context contains the response. This is unambiguous.
- F03 Security headers: `curl -sI` output. No interpretation required.
- RC1 Quote TOCTOU: App log shows two concurrent UniqueConstraintViolationException entries 7ms apart from the same INSERT. The code clearly lacks a transaction.
- A1 Upload OOM: 20MB file accepted HTTP 200. No size check exists before `arrayBuffer()`.
- F08 GitHub Actions: grep output shows mutable tags. Verifiable by anyone.
- F17 Meilisearch: port scan shows 7700 open; key probe confirms response.

**High confidence (code only, not live-testable on this box):**
- NEW-01 vm sandbox escape: tested locally with identical Node.js version and identical sandbox configuration. The escape is confirmed on Node 22.22.0. It was not tested against the production MCP server because OpenCode is not deployed on this test instance. The code ships in v0.4.9.
- F02 Integration credentials: code clearly returns `credentials: values ?? {}` — no live integration was configured to test against, but the code path is unambiguous.
- RC3 Message token race: same TOCTOU pattern as RC1, confirmed by code structure, not by live test.

**Reasonable confidence (code review, plausible):**
- NEW-02 chown privilege escalation: the sudoers entry is confirmed present (`omuser ALL=(root) NOPASSWD: /bin/chown`). The escalation path (own sudoers → full sudo) is standard and well-documented. I did not execute it against the running container, which was running as uid=0 anyway (dev image misconfiguration).
- F12 Password minimum: confirmed user created with 6-char password. The risk assessment (bcrypt + rate limiting mitigates) is my interpretation.

---

## Gaps in My Validation

**I want to be direct about where this review has limitations.**

**1. The vm sandbox escape was not demonstrated through the application UI.**

I confirmed the escape works on Node.js 22.22.0 using the identical sandbox configuration from `sandbox.ts`. But I did not demonstrate it end-to-end through the Open Mercato AI Code Mode, because OpenCode was not deployed on the test box.

What I can say: the sandbox code is in the shipped package, the escape works on the Node.js version the project requires, and the AI Code Mode UI was visible and accessible in the browser screenshots. What I cannot say: I sat there and watched a chat session return `DATABASE_URL`. Anyone with a full deployment can reproduce this in under two minutes.

**2. The business rules cross-tenant check was not verified.**

I identified that `POST /api/business-rules/execute/:ruleId` does not pre-verify the rule belongs to the requesting tenant before calling `executeRuleById()`. I could not confirm whether `executeRuleById()` itself enforces the tenant filter internally — that would require reading the rule engine internals and a live test with a cross-tenant rule ID. I disclosed this as "likely safe based on codebase patterns" but flagged it for verification.

**3. The JWT forgery was demonstrated in concept, not end-to-end.**

I showed the forge technique in Python. I decoded a real JWT and confirmed the structure. I did not complete a full forged-token → API-call chain in the live test due to a JWT encoding whitespace issue in the Bash script. The technique is correct; the specific PoC script needs one-line cleanup.

**4. The Meilisearch finding applies to a different host.**

The exposed Meilisearch (port 7700) was on `10.0.63.14`, not the app box `10.0.64.14`. The app box's Meilisearch is correctly internal-only. The finding is real — that host's Meilisearch is accessible — but I cannot confirm it is the same Meilisearch instance used by the Open Mercato deployment on `10.0.64.14`. If it is a separate instance, the finding stands for that host. If it is the same instance accessed via a different network interface, it stands more strongly.

**5. I did not test the enterprise security module.**

The enterprise package is commercial and not part of the OSS distribution I reviewed. SPEC-ENT-001 (MFA, sudo challenge) likely addresses some of the password policy and session management concerns in the base platform. I cannot comment on the enterprise security module's implementation.

**6. The AI assistant surface area is larger in a full deployment.**

The MCP server exposes 14 tools on this instance (confirmed from health check). A full deployment with all modules enabled would expose more. My assessment of the tool surface is based on what I could read in the code; I did not enumerate all tools available on a maximally-configured deployment.

---

## My Concerns About This Type of Review

I want to flag something broader, because it's relevant to how you interpret this report.

**AI-assisted security review is faster and in some ways more thorough** — the AI read more code than I could have in the same time, made connections across files I might have missed, and kept track of a large number of threads simultaneously. That is genuinely useful.

**But AI-assisted review has specific failure modes:**

The AI is pattern-matching on training data. It is good at finding things that look like known vulnerability patterns and is less reliable at finding novel vulnerabilities that don't resemble existing patterns. It may also have blind spots for complex, multi-step logic flows where the vulnerability emerges from the interaction of multiple components rather than a single bad function call.

More significantly: I trusted the AI's code reading more than I would trust my own reading in some areas, because I could not independently read 76 route files in two days. That means some of the "not vulnerable" calls in this report are the AI's assessment more than mine. I reviewed the AI's reasoning and agreed with it, but I did not independently verify every conclusion.

For the highest-severity findings — the ones that matter — I did verify independently. For the "verified not vulnerable" section, I am relying substantially on the AI's analysis checked against my own reading of the relevant code sections.

You should treat the "not vulnerable" assessments as "not obviously vulnerable based on AI-assisted code review, with spot-check verification by a human" rather than as a clean bill of health from an experienced security engineer who read every line. They are materially better than nothing, and the findings that are in here are real — but the absence of a finding in this report is weaker evidence of safety than the presence of a finding is evidence of a problem.

---

## On Using AI for Security Research Generally

The vm sandbox escape finding is an interesting case. I asked the AI to investigate whether `node:vm` was being used safely. It correctly identified that `node:vm` is not a security boundary, generated the `Promise.resolve().constructor.constructor()` escape vector, and I tested it. I would not have found this finding as quickly or as confidently without the AI's input.

The AI also correctly identified that the codebase is generally well-written from a security perspective — consistent tenant scoping, good auth patterns, no SQL injection. That's a harder thing to confirm than finding vulnerabilities, and I think the AI's ability to read a lot of code and pattern-match on "this looks like it's doing things right" is actually quite useful for a platform security review where you want to give the team signal about what is working, not just what is broken.

I think this kind of review — human directing, AI reading and hypothesising, human validating and deciding — is probably where the field is going. It feels worth being transparent about that, especially when submitting to a project that is itself building AI-assisted tooling.
