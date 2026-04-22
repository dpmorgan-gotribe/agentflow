# security-checklist-grounding

**Deferred from**: investigate-002-build-tier-readiness-gap §Additional consideration (e).

## The concern

Reviewer agent's security dimension (per refactor-005's `reviewer-playbook.md`) needs a concrete source rather than AI-judgment. Vague "security check" produces vague audits. Real reviewer needs a grounded checklist.

## Proposed grounding

**For web (react-next, svelte-kit, etc.)** — **OWASP ASVS Level 1** (Application Security Verification Standard):

- ~80 verifiable requirements
- Coverage: authentication, session management, access control, input validation, output encoding, cryptography, error handling, data protection, HTTP security, business logic
- Reviewer iterates each ASVS item against generated code + flags pass / fail / not-applicable

**For mobile (expo-rn, flutter, native-\*)** — **OWASP Mobile Top 10** + **MASVS Level 1**:

- Improper credential usage, insecure communication, insufficient cryptography, insecure authentication/authorization, insufficient input/output validation, data storage insecurity, binary protection, platform misuse
- Reviewer checks each against the built app

**For backend (any framework)** — **OWASP Top 10 2021** + relevant ASVS sections (input-validation, session, access-control):

- Injection, broken access control, cryptographic failures, SSRF, authn/authz failures, security logging

## Why deferred

Reviewer agent implementation (feat-009) ships with a starter security checklist — roughly 15-20 items covering the most common real-world failures (SQL injection, XSS, auth bypass, CSRF, rate limiting, secret leakage). Full ASVS L1 is 80 items; that's upgrade territory, not MVP. Reviewer MVP ships with the top-20; this plan extends to the full-80.

## Rough shape when it's time

Extend reviewer's playbook:

1. Author `docs/security-playbooks/web-asvs-l1.md` + `docs/security-playbooks/mobile-masvs-l1.md` + `docs/security-playbooks/backend-owasp-top10.md` — machine-readable checklists
2. Update reviewer agent to load the appropriate playbook based on `architecture.yaml.tooling.stack.*`
3. Reviewer walks each checklist item systematically; output is a per-item pass/fail/N-A with citation to offending code on fail
4. Gate 6 (human PR review) sees the full checklist result; dismissal of N violations requires explicit human override

Estimated size: medium plan. ~400 LOC — mostly the checklist content in the three playbook files, less in reviewer logic.

## When to revisit

After reviewer ships + first autonomous run produces actual review output. If the top-20 starter checklist catches most real issues, the 80-item upgrade is lower priority. If it misses issues that later bite, upgrade faster.

## Related

- Pairs with `mutation-testing-policy.md` — coverage depth on the test side; checklist depth on the review side
- `app-store-compliance.md` reuses some security-checklist items (data handling, cryptography)
