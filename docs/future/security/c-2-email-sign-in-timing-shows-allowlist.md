# C-2: The email sign-in page answers slower for an address on the allowlist

Found November 20, 2026, in a read-only security review of `jamesmacfie/acorn` at `90b9e61e3`
and `acorn-cloud` at `19fa594`. Severity: low. Confidence: confirmed from code, with a local
timing measurement. Status: open.

## What goes wrong

`POST /sign-in/email` shows the same page whether or not an address is on the allowlist, so the
page text doesn't say who has access. The time it takes does. An allowlisted address goes through
two or more database writes before the page answers, and any other address goes through one read.
Someone who sends enough requests can tell which addresses are on the list.

## Who can do it

Anyone who can reach `https://account.getacorn.dev`. No account is needed.

## How it goes

1. The attacker posts an address to `POST /sign-in/email` many times, alternating with addresses
   that can't be on the list.
2. For an address that isn't allowlisted, the handler does one `SELECT` in `isAllowed` and answers
   (`acorn-cloud:src/web/website.ts:166-173`, `acorn-cloud:src/allowlist.ts:7-8`).
3. For an allowlisted address, the handler also runs `takeSend`, which deletes an expired marker and
   inserts a new one, before answering (`acorn-cloud:src/web/website.ts:155-164`,
   `acorn-cloud:src/web/website.ts:170`). Once a minute it also awaits Better Auth's
   `sendVerificationOTP`, which writes the code's row (`acorn-cloud:src/web/website.ts:171`).
4. The attacker compares the median response times. On a local copy with SQLite in a temp folder,
   300 pairs gave a median of 0.54 ms for an allowlisted address and 0.40 ms for others. On Fly, each
   write waits for the volume, so the gap is probably wider. The script is at
   `~/.cache/acorn-secreview/enumTiming.mts`, outside the repo.

The comment at `acorn-cloud:src/auth.ts:33-35` says the page answers as fast for an address that gets
a code as for one that doesn't. That holds for the email itself, whose send isn't awaited
(`acorn-cloud:src/auth.ts:38`). It doesn't hold for the database work before it.

## What limits it

- The gap is a fraction of a millisecond, so over the internet it takes many requests to see through
  network noise.
- The allowlist is short, and James's address is in every commit of the open repository, so the most
  valuable address isn't secret anyway.
- Knowing an address is on the list only helps the slow code-guessing attack that is already
  tracked as open issue 1 in `acorn-cloud:docs/open-issues.md`.

## Fix

In `acorn-cloud:src/web/website.ts`, answer first and do the allowlist check, `takeSend`, and the send
after. Start them without awaiting, with a `.catch` that logs, the way `acorn-cloud:src/auth.ts:38`
already treats the email. Then every address costs the same before the page answers. Correct the
comment at `acorn-cloud:src/auth.ts:33-35` to match.

Don't pad responses to a fixed time instead. A fixed delay has to be longer than the slowest write
to work, and it slows every sign-in.

## How to check the fix

- Add a case to `acorn-cloud:test/emailCodes.test.ts`: make the database call behind `isAllowed` or
  `takeSend` wait on a promise the test holds, post an allowlisted address, and expect the page before
  releasing the promise. Then release it and expect the code email, as `askForCode` already waits for.
- The existing cases still pass, because they already wait for the email with `vi.waitFor`.
- Rerun the scratch script against a local copy and expect the two medians to match within noise.

## Related

- [C-3. Email sign-in attempts reset across codes](./c-3-email-code-budget-resets.md)
- [X-1. Cloud account access can authorize Slack turns on the Node](./x-1-account-takeover-to-slack-agent-turns.md)
- [C-1](./c-1-phone-approves-its-own-pairing.md): another account-service finding from the same
  review.
- Open issue 1 in `acorn-cloud:docs/open-issues.md`, the slow code-guessing attack this helps aim.
