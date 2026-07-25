---
name: security-hardening
description: Run a practical application security hardening pass on a software repo. Use when the user asks for appsec review, security audit, auth/session risk review, secrets handling, dependency security, SSRF/upload risks, CORS/CSRF, rate limits, input validation, unsafe logging, permission bypasses, security headers, or production security readiness.
---

# Security Hardening

Use this skill for pragmatic appsec work that produces prioritized fixes and residual-risk notes. Do not turn it into a compliance theater exercise.

## Workflow

1. **Map the attack surface**
   - Identify auth/session model, roles/permissions, API routes, webhooks, file upload/download, provider calls, database access, background jobs, admin tools, client storage, and deploy config.
   - Locate secrets, environment variables, token storage, logging, dependency entrypoints, and network egress.

2. **Build a risk-ranked plan**
   - Prioritize exploitable paths over theoretical issues.
   - Separate must-fix before release, should-fix soon, and accepted/deferred risks.
   - Preserve product behavior unless the vulnerability requires a behavior change.

3. **Harden the highest-risk paths**
   - Add or tighten authorization checks at server/action boundaries.
   - Validate untrusted input at external/API/provider boundaries.
   - Protect secrets and redact sensitive logs.
   - Add rate limits, origin controls, CSRF/CORS policy, SSRF protections, upload constraints, and security headers where appropriate.
   - Audit dependencies and package scripts for known risk and upgrade path.

4. **Prove the fixes**
   - Add focused tests for permission bypasses, input rejection, dangerous URL/file cases, auth/session edge cases, and safe error/log payloads.
   - Run dependency/security tools available in the repo ecosystem.
   - Document what could not be verified.

5. **Report residual risk**
   - List fixed issues with evidence.
   - List remaining risks with severity, exploit sketch, and recommended next action.
   - Avoid claiming the app is "secure"; state the reviewed scope.

## Quality Bar

- Every meaningful server mutation has an authorization story.
- Secrets are not exposed in logs, client bundles, fixtures, or generated artifacts.
- External inputs are validated before side effects.
- Dangerous network/file operations have allowlists, size limits, and protocol checks.
- Security tests prove at least the top bypass/failure cases.

For the audit checklist, read [checklist.md](references/checklist.md).
