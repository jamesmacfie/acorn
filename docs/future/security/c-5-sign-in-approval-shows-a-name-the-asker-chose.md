> **Completion note, November 20, 2026.** Nothing in this repository changes behavior. The fix belongs
> to acorn-cloud, and X-1 already covers this repository's part. Branch
> `phase-c-5-sign-in-approval-shows-who-is-really-asking`.
>
> What landed:
>
> - The comment on `deviceCodeRequestSchema.deviceName` in `packages/protocol/src/device/account.ts`
>   said the name lets a person tell it's their own sign-in. That's the assumption this finding
>   breaks. It now says the name is the asker's own label and proves nothing.
> - `docs/account-api.md` § Sign in says what a service's approval page must do: show the address the
>   code request came from and the code's age beside the name, never present the name as proof, and
>   tell the person not to approve a code someone sent them. It also allows a shorter refresh token for
>   a sign-in that never registered a Node.
>
> Decisions and deviations:
>
> - No code or tests here. The approval page, the address it records, and the refresh token's life are
>   all acorn-cloud's. The conformance suite in `accountContract.test.ts` checks API schemas and can't
>   see a web page, so the page test the finding asks for lives in acorn-cloud.
> - The plugin keeps sending the host name. It's still useful context for an honest owner. The fix is to
>   stop treating it as proof, not to drop it.
> - A shorter refresh token needs nothing here. `providerSteps.ts` already treats a refused refresh
>   (`invalid_grant`) as "sign in again".
> - X-1 is this repository's half. A Slack link counts only after a paired device confirms it, so an
>   account taken this way starts no agent turns. R-2 shows identity words at both ends of a pairing,
>   so an account alone can't pair silently either.
>
> What acorn-cloud needs:
>
> 1. Record the requesting address, and its rough location if the service has one, when it issues a
>    device code. Show it and the code's age on the approval page beside the asked-for name
>    (`src/web/website.ts:411-416`).
> 2. Say plainly on that page that a code someone sent you is never yours to approve.
> 3. Shorten the refresh token's life for a sign-in that has never registered a Node, so a token used
>    only to read and link runs out in days (`src/api.ts:31-32`, `:180-190`).
> 4. Add a website test that the approval page carries the address the device code request came from.
>
> For later phases: nothing depends on this change.

# C-5: The sign-in approval page shows a name the asking computer chose

Found November 20, 2026, in a read-only security review of `jamesmacfie/acorn` at `31ff472da` and
`acorn-cloud` at `19fa594`. Severity: medium, and it needs the owner to approve a code. Confidence:
confirmed from code, not run live. Status: open.

## What goes wrong

A copy of Acorn signs in to an account by showing a code, which the person types on the account website
and approves. The website describes the asker by a name the asker sent. Someone who starts a sign-in on
their own computer and talks the owner into approving its code holds the owner's account for 90 days.
With [X-1](./x-1-account-takeover-to-slack-agent-turns.md) open, an account is enough to start agent
turns on the owner's Node.

## Who can do it

Anyone who can reach the account service and get a message to the owner: a chat message, an email, or a
support request that says "enter this code to finish setup". They need no account of their own.

## How it goes

1. The attacker asks for a device code with any `deviceName`, such as the owner's own computer name. The
   route takes no credential, and the schema allows any 100 characters
   (`packages/protocol/src/device/account.ts:47`, `acorn-cloud:src/api.ts:124-143`). Acorn itself sends
   the computer's host name (`plugins/account/src/server/routes.ts:56`).
2. The owner opens the code on the website. The page says "A device that calls itself
   **NAME** wants to sign in to acorn as **LOGIN**" and asks them to check that Acorn shows the same
   code (`acorn-cloud:src/web/website.ts:411-416`). Nothing on the page comes from the service's own
   knowledge of the asker.
3. The owner approves. The attacker's poll returns an access token and a refresh token that lasts 90
   days and renews on use (`acorn-cloud:src/api.ts:31-32`, `:180-190`).
4. With the token the attacker lists the owner's Nodes, gets relay tickets and pairing assertions, and
   calls the Slack gateway's link route. That is the starting point of X-1.

## What limits it

- The owner has to approve a code they didn't start. The page tells them not to.
- A code lasts 15 minutes.
- The account's activity records the sign-in with the name, and the owner can revoke it on the website.
- An account alone doesn't open a terminal once X-1 is fixed. It raises a pairing dialog on the owner's
  computer, which shows three words the attacker's device also shows and waits for **Allow**.

## Fix

- In `acorn-cloud`, show what the service observed beside the name the asker sent: the asker's network
  address or rough location, and how long ago the code was made. Say plainly that a code someone sent
  you is never yours to approve.
- In `acorn-cloud`, shorten the refresh token's life for a sign-in that has never registered a Node, so
  a token used only to read and link expires in days.
- In this repository, fix X-1 first. The Node must hold its own approval for every remote identity, so
  that an account alone starts nothing.

## How to check the fix

- A website test in `acorn-cloud` that the approval page carries the address the device code request
  came from.
- The checks in X-1: a link that exists only at the service stays inactive on the Node.

## Related

- [C-3](./c-3-email-code-budget-resets.md): the other way to an account, by guessing an email code.
- [X-1](./x-1-account-takeover-to-slack-agent-turns.md): what an account can do to a Node.
- [Sign in](../../account-api.md#sign-in) in the account API.
