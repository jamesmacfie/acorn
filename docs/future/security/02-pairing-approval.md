# Phase 2: stop a raced pairing request landing under the owner's click

## Completion note

Done October 21, 2026, on branch `phase-2-pairing-approval`.

An ask that lands while another is still waiting for an answer now cancels both and gets
`409 pairing_busy` (`pairingRequests.ask` returns `null` for it). The next ask starts clean. An ask after
the held request was answered or expired replaces it, as before. The route still broadcasts the
`pairing:requested` frame on a refusal, because that frame is how the open dialog learns its request is
gone.

`PairingRequestDialog` never changes the request it shows. A frame that brings a different request ID, or
none, closes the dialog and toasts "Another pairing request arrived, so this one was cancelled." A frame
with the same ID is ignored. **Allow** is disabled for one second after the dialog opens.

`POST /v1/pair/requests` has its own ceiling of 6 a minute. The code route keeps its 20. `attemptCeiling`
now takes the limit as an argument.

Decisions and deviations:

- The three clients already treated any non-200 ask as "use a code", so none of them broke on a 409. Each
  now says why. `askToPair` throws `PairingBusyError` on a 409. The terminal client prints the message and
  "Run acorn again, or type a pairing code." The bridge answers `node.ask` with a new `pairing_busy`
  error code. The extension sidebar shows the message above the code form with a **Try again** button
  that asks again. The terminal client has no button, so its "try again" is rerunning `acorn`.
- A client whose own ask was cancelled by someone else's overlap sees the ordinary denied-or-expired
  refusal when it next polls, with no **Try again**. The spec asked for the button only on the 409.
- Not checked live in `pnpm dev:agent`: the service budget is red, so I covered the acceptance with the
  route test, the bridge test against a real TLS fake Node, and the dialog test. The terminal client's
  new message (`packages/custody/src/local/pair.ts`) has no test of its own.

What later phases need to know:

- The Node service graph grew by 152 bytes, from 1,932,051 to 1,932,203. The ceiling is still
  1,931,900, so `pnpm --filter @acorn/node build` stays red by 303 bytes until the coordinator raises it.
- `BridgeErrorCode` gained `pairing_busy`. The native messaging table and the extension doc say so.

Date: October 21, 2026. Status: proposed. Severity: medium.

Pairing by approval lets a client on the Node's computer get a device token when the owner clicks
**Allow**. Any process on that computer can ask, agents included, and the three-word phrase is how the
owner tells their own request apart. The dialog can change its request while it's open, so the words
the owner checked aren't always the words they allow. A device token is full owner access. Read
[the programme](./README.md) first.

## Starting point

Read at `32b2ab6c3`.

- `pairingRequests` in `packages/node-core/src/server/auth/pairingRequests.ts` holds one request. A new
  `ask` replaces it, so a person who restarts `acorn` isn't locked out by their own first attempt.
- `POST /v1/pair/requests` in `packages/node-core/src/server/routes/pairing.ts` takes a loopback caller
  only, shares the code route's ceiling of 20 a minute, and broadcasts a content-free
  `pairing:requested` frame. Its comment says the ceiling is there so "a loop of asks can't keep the
  owner's dialog changing faster than they can read it". Twenty a minute is one every three seconds,
  which is slower than reading but fast enough to land between reading and clicking.
- `PairingRequestDialog` in `packages/client-core/src/host/trust/PairingRequestDialog.tsx` calls
  `show` on every frame. `show` replaces the open request's ID, device name, and phrase in place and
  leaves **Allow** enabled.
- `decide` refuses a stale ID, so an **Allow** sent for the owner's replaced request fails. The race
  that works is the other one: the dialog swaps to the agent's request just before the click, and the
  click allows the request now showing.
- The asker chooses `deviceName`, so the agent's request can read "Chrome", the same as the owner's.
- An agent that keeps asking also spends the code route's ceiling, which blocks pairing by code for
  that minute.

## Changes

### A second ask cancels both

In `pairingRequests.ask`, when a live request that hasn't been allowed already exists, drop it and
refuse the new one with `409 pairing_busy` ("Another client asked at the same moment. Try again.").
Then the next ask, from anyone, starts clean.

- A person who restarts `acorn` within two minutes gets one refusal, then pairs on the next try. Make
  the terminal client, the CLI, and the extension's bridge show `pairing_busy` with **Try again**.
  Check how each handles an unexpected 409 first, because none of them gets one today.
- An agent racing the owner can only cancel the owner's request, never replace it. That turns a
  takeover into a retry.

Keep the replace-on-ask behavior for an ask that arrives after the held request expired or was
answered. Only an overlap cancels.

### The dialog never changes under the cursor

In `PairingRequestDialog`, when a frame arrives while a request is showing:

1. Read the pending request.
2. If it's the same ID, do nothing.
3. If it's a different ID or none, close the dialog and show a toast: "Another pairing request
   arrived, so this one was cancelled." Don't reopen with the new request.

With the Node change above, a different ID means a request arrived after the shown one ended, so
opening it fresh is safe. Still keep **Allow** disabled for one second after the dialog opens, so a
click meant for something else on screen can't land on it.

### Separate the ask ceiling from the code ceiling

Give `POST /v1/pair/requests` its own ceiling of 6 a minute, and leave the code route's 20 for codes.
A loop of asks then can't block someone typing a code from another computer.

## Tests

- `pairingRequests.test.ts`: two asks inside two minutes leave nothing pending, and the second gets
  `pairing_busy`. A third ask succeeds. An ask after expiry or after a decision replaces as before.
- `PairingRequestDialog.test.tsx`: a frame with a new request ID while the dialog is open closes it,
  and **Allow** never sends the new ID. **Allow** is disabled for the first second.
- `routes/pairing.test.ts`: seven asks in a minute
  get 429 on the seventh, and a code submitted in that minute is still checked.

## Acceptance

- In `pnpm dev:agent`, start pairing from the terminal client, then send an ask from a second shell.
  The desktop dialog closes, both clients see the refusal, and a fresh ask pairs.
- [Pairing by approval](../../api-reference/transport.md#pairing-by-approval) describes the overlap rule
  and the separate ceiling, and the route comment no longer claims the ceiling stops a swap.
