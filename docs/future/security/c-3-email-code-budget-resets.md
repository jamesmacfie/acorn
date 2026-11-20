# C-3. Email sign-in attempts reset across codes

Found November 20, 2026, in `acorn-cloud` at `19fa594`. Severity is high. The missing cumulative
limit is confirmed from source. Status is open.

## Evidence and impact

The website limits code issuance per email, and Better Auth enforces an atomic attempt limit on each
six-digit code. The service has no failed-attempt budget that survives issuance of a fresh code.
Repeated issuance makes sustained guessing against an allowlisted account possible and sends email to
the account owner each time. The reviewed code is in `acorn-cloud/src/web/website.ts` and
`acorn-cloud/src/auth.ts`. The cloud repository tracks the fix as
[security issue 1](https://github.com/jamesmacfie/acorn-cloud/blob/19fa594/docs/open-issues.md#security).

The account session was the first boundary in X-1, which [the November 20 review](../../security/review-2026-11-20.md) records as fixed.
The review checked the implementation and existing sign-in tests. It did not measure production abuse
controls or attempt an account takeover.

## Fix and verification

Add a durable verification budget keyed by canonical email across issuances. Keep responses uniform
and account for abuse of the send path. Require stronger authentication for remote-access grants.
Add a cloud test that exhausts the cumulative budget across multiple code issuances, checks concurrent
verification, and verifies that a fresh code does not reset the account's budget.
