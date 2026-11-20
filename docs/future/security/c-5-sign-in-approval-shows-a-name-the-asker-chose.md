# C-5: The sign-in approval page shows a name the asking computer chose

Found November 20, 2026, in a read-only security review of `jamesmacfie/acorn` at `31ff472da` and
`acorn-cloud` at `19fa594`. Severity: medium, and it needs the owner to approve a code. Confidence:
confirmed from code, not run live. Status: the fix belongs to `acorn-cloud` and is open.

The Acorn side is done, as [the November 20 review](../../security/review-2026-11-20.md) records. A
Slack link counts only after a paired device confirms it, and a remote pairing shows identity words at
both ends, so an account alone starts no agent turns and pairs nothing silently.
[What an approval page must show](../../account-api/sign-in.md) is the contract the service has to meet.

## What goes wrong

A copy of Acorn signs in to an account by showing a code, which the person types on the account website
and approves. The website describes the asker by a name the asker sent. Someone who starts a sign-in on
their own computer and talks the owner into approving its code holds the owner's account for 90 days.

## Who can do it

Anyone who can reach the account service and get a message to the owner: a chat message, an email, or a
support request that says "enter this code to finish setup". They need no account of their own.

## How it goes

1. The attacker asks for a device code with any `deviceName`, such as the owner's own computer name. The
   route takes no credential, and the schema allows any 100 characters
   (`packages/protocol/src/device/account.ts`, `acorn-cloud:src/api.ts:124-143`).
2. The owner opens the code on the website. The page says "A device that calls itself
   **NAME** wants to sign in to acorn as **LOGIN**" and asks them to check that Acorn shows the same
   code (`acorn-cloud:src/web/website.ts:411-416`). Nothing on the page comes from the service's own
   knowledge of the asker.
3. The owner approves. The attacker's poll returns an access token and a refresh token that lasts 90
   days and renews on use (`acorn-cloud:src/api.ts:31-32`, `:180-190`).
4. With the token the attacker lists the owner's Nodes, gets relay tickets and pairing assertions, and
   calls the Slack gateway's link route.

## What limits it

- The owner has to approve a code they didn't start. The page tells them not to.
- A code lasts 15 minutes.
- The account's activity records the sign-in with the name, and the owner can revoke it on the website.
- On the Node, a Slack link waits for a paired device to confirm it, and a pairing waits for the owner
  to compare identity words and click **Allow**.

## Fix

In `acorn-cloud`:

1. Record the requesting address, and its rough location if the service has one, when it issues a
   device code. Show it and the code's age on the approval page beside the asked-for name
   (`src/web/website.ts:411-416`).
2. Say plainly on that page that a code someone sent you is never yours to approve.
3. Shorten the refresh token's life for a sign-in that has never registered a Node, so a token used
   only to read and link runs out in days (`src/api.ts:31-32`, `:180-190`). Acorn already treats a
   refused refresh as "sign in again".

## How to check the fix

Add a website test in `acorn-cloud` that the approval page carries the address the device code request
came from.

## Related

- [C-3](./c-3-email-code-budget-resets.md): the other way to an account, by guessing an email code.
- [Sign in](../../account-api.md#sign-in) in the account API.
