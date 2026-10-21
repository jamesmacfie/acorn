# Phase 3: end phone sessions nobody uses

Date: October 22, 2026. Status: proposed. Severity: medium.

A phone session can do anything the gateway's device can, minus its blocked list. That includes
opening a terminal and starting an agent in a mode that doesn't ask. Today a session never ends unless
someone revokes it, so a phone left in a drawer, sold, or stolen keeps that power. This phase ends a
session after 30 days without use. Read [the programme](./README.md) first.

## Starting point

Read at `47287b67c`.

- `signIn` in `apps/mobile/src/gateway/gateway.ts` sets the cookie with a 400-day `Max-Age`, the
  longest a browser keeps one.
- `sessionStore` in `apps/mobile/src/gateway/sessions.ts` keeps one file per session, named by the
  hash of its ID. `use` sets the file's modification time to now on every request and on the socket
  upgrade, so the time records when the phone last used it. `isLive` checks only that the file exists.
- The running gateway checks open sockets with `isLive` every 500 milliseconds and closes a revoked
  phone's socket with code `4401`, which the phone reads as signed out.
- [The mobile gateway](../../security/mobile-gateway.md#limits) says sessions don't expire and a
  stolen cookie gives owner access until someone revokes it.

## Changes

1. In `sessionStore`, add a constant `IDLE_LIMIT_MS` of 30 days. In `use`, read the file's
   modification time before touching it. If it's older than the limit, delete the file and return
   null, as a missing file does. The phone then gets `401 signed_out` and shows the sign-in screen.
2. Make `isLive` apply the same test, so a socket that stays open past the limit closes with `4401`.
   A socket in use keeps its session fresh only through requests, so also call `use` from the
   gateway when a phone sends a socket message, at most once a minute per phone.
3. In `list`, leave out a session past the limit, so `gateway sessions` shows what still works.
   Delete it at the same time.
4. Lower the cookie's `Max-Age` to the same 30 days, and have `signIn`'s cookie line read the
   constant. A browser then drops a cookie the gateway would refuse anyway.
5. In [the mobile gateway](../../security/mobile-gateway.md), change **Keep sessions** and **Limits**:
   a session ends after 30 days without use, and a stolen cookie works until then or until someone
   revokes it.

Why 30 days without use and no limit on a session in use: the phone is the owner's, and someone who
checks on agents every week shouldn't have to sign in again. A session nobody uses is the one most
likely to be on a lost phone.

Why the file's time and no new field: it already records the last use, and `revoke` in another
process deletes the file, which a touch can't undo. Keep that property. Don't rewrite the file to
store a time.

Don't add an option for the limit. Add one when someone asks.

## Tests

In `apps/mobile/src/gateway/sessions.test.ts`, with the file's time set back by `utimesSync`:

- `use` on a session 31 days idle returns null and the file is gone.
- `use` on a session 29 days idle returns its hash and moves the time to now.
- `isLive` is false past the limit, and `list` leaves the session out.

In `apps/mobile/src/gateway/gateway.test.ts`, an idle session's `/node` request answers
`401 signed_out`, and its open socket closes with `4401`.

## Acceptance

With `pnpm dev:mobile:gateway`, sign in with `curl`, set the session file's time back 31 days with
`touch -t`, and check that the next `/node` request answers `401 signed_out`.
