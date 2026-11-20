# C-1: A phone can approve its own pairing request and get a full device

Found November 20, 2026, in a read-only security review of `jamesmacfie/acorn` at `90b9e61e3`
and `acorn-cloud` at `19fa594`. Severity: medium. Confidence: plausible. Status: open.

## What goes wrong

A phone's device is held to a denylist: it can't open a pairing window, manage devices, install
plugins, or change security settings. It can still answer a pairing request, and nothing stops it
answering one it raised itself. Script running in the phone app can raise an ask with the account
session, approve it with the phone's device token, and claim the result over a connection that
isn't the phone channel. The new device isn't marked `phone`, so it has full owner authority, and
it outlives revoking the phone.

The phone can already open terminals, so this adds no new code execution. It turns a short
foothold in the phone app into a lasting, unrestricted device, which is what the denylist exists
to stop.

## Who can do it

Anyone with script running in the phone app at `https://account.getacorn.dev/app/`. That means an
XSS bug in the app, a changed build, or a breached account service. The script needs only what the
app already holds: the account session cookie and a paired phone's device token.

Someone holding an unlocked phone can do the same by hand. [The phone channel's trust
section](../../relay/phone-channel.md#trust) already accepts that case. It doesn't cover the scripted
version, which needs no person at all.

## How it goes

1. The script asks the account service for an owner assertion with the session cookie and the
   `x-acorn-account` header (`acorn-cloud:src/api.ts:88-94`, `acorn-cloud:src/api.ts:286-297`).
2. Over the phone channel, it raises an ask with `POST /v1/pair/requests` and the assertion. A channel
   is never a loopback peer, so the Node checks the assertion and accepts it
   (`packages/node-core/src/server/routes/pairing.ts:121-146`). The answer carries the claim secret.
3. It approves the ask with the phone's own device token:
   `POST /v1/core/pair/requests/:id {"decision":"allow"}`
   (`packages/node-core/src/server/routes/pairing.ts:180-190`). The phone rules allow this. The only
   pairing pattern they refuse is `^/v1/core/pair(/start)?$`
   (`packages/node-core/src/server/middleware/phoneRules.ts:8-13`). `decide` doesn't look at who is
   deciding (`packages/node-core/src/server/auth/pairingRequests.ts:76-82`).
4. The script fetches a ticket with the cookie (`acorn-cloud:src/api.ts:273-284`) and sends the ticket
   and the claim secret to a machine the attacker controls.
5. That machine opens a `tls` stream through the relay with the ticket and runs TLS to the Node,
   accepting whatever certificate it gets. The stream reaches the Node's HTTPS server as an ordinary
   connection (`packages/node-core/src/server/transport/relayTunnel.ts:83-85`).
6. It calls `POST /v1/pair/requests/claim` with the secret
   (`packages/node-core/src/server/routes/pairing.ts:150-157`). The Node marks a device `phone` only
   when the claim itself arrives over the phone channel
   (`packages/node-core/src/server/routes/pairing.ts:67-70`), so this one gets a full device token.

Step 4 and later aren't needed if the goal is only a second phone device. Claiming over the channel
gives one, still restricted.

## What limits it

- The attacker needs script in the phone app first. The app's policy allows only its own scripts
  (`acorn-cloud:src/phoneApp.ts:13-29`).
- A ticket lasts five minutes and an assertion two, so the claim must happen soon after the theft.
- The Node writes `pairing.request.raised` with the account and assertion IDs, and
  `pairing.request.decided`, to its audit log (`packages/node-core/src/server/routes/pairing.ts:139-143`,
  `packages/node-core/src/server/routes/pairing.ts:185-188`). The new device appears in
  **Settings → Nodes**.

## Fix

In this repo, make a device approved by a phone a phone device, whatever connection claims it.
Record the deciding device's kind on the held request in `pairingRequests.ts`, and pass
`'phone'` to `DEVICES.issue` in `paired()` when either the claim came over the channel or a phone
approved it. That keeps the reason the phone may answer at all: approving a laptop when the phone
is the only device online. The laptop it approves gets the phone's limits until a computer pairs it
properly.

A stricter option is to refuse a phone's decision on a request marked `remote`. That breaks the
one-device-online case, so prefer the first.

Update [the phone channel page](../../relay/phone-channel.md#what-a-phone-device-may-do) to say what
a phone-approved device may do.

## How to check the fix

- Add a case to `packages/node-core/src/server/routes/pairing.test.ts`: raise a remote ask with a valid
  assertion, decide it with a `phone` principal, claim it on a non-channel connection, and expect the
  issued device to have `kind: "phone"`.
- Keep the existing case where a non-phone device approves and the claim gets a full device.
- Add a case to `packages/node-core/src/server/middleware/phoneRules.test.ts` only if you choose the
  stricter option.
- Live check in `pnpm dev:agent` with a phone paired through the channel: approve a laptop's ask from
  the phone, then confirm the laptop gets `403 phone_refused` from `POST /v1/core/pair/start`.

## Related

- [R-1](./r-1-account-website-runs-code-through-a-phone.md) and
  [R-2](./r-2-account-service-relays-a-pairing-and-keeps-the-token.md): the paths by which a breached
  account service reaches a Node. A breached service is one way to get script into the phone app,
  which is this finding's starting point.
- [C-2](./c-2-email-sign-in-timing-shows-allowlist.md): another account-service finding from the
  same review.
- [The phone channel](../../relay/phone-channel.md#what-a-phone-device-may-do).
- [Pairing by approval](../../api-reference/transport.md#pairing-by-approval).
