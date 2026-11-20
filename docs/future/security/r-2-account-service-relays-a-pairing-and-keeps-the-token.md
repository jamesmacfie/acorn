> **Completion note, November 20, 2026.** Fixed on the Acorn side, on branch
> `phase-r-2-account-service-can-t-relay-a-pairing-and-keep-the`.
>
> What landed:
>
> - `PairingRequest` has an `identity` field on a remote ask: six words for the Node's own key on the
>   connection the ask came over. That's the certificate fingerprint for a TLS stream, and the channel key
>   for an ask through a phone's channel (`askedIdentity` in `routes/pairing.ts`). A request from this
>   computer has none.
> - `askVouchedNode` returns `identity`, the words of the certificate its probe saw. The desktop helper's
>   `node-adopt` and the native host's `node.adopt` pass it on, and `NodeAdoption` and the bridge results
>   carry it. The phone's `pairWithNode` returns the words of the channel key its handshake checked.
> - Every asker shows the identity words beside the phrase: **Settings → Nodes** on the desktop, the
>   extension's **Approve on another device**, and the phone's Nodes screen. The owner's dialog, on the
>   desktop, the phone, and the terminal client, shows the Node's own words. Each says to allow only when
>   the asker shows both.
> - `ownerAssertion` refuses an assertion whose `exp` is more than 120 seconds after its `iat`, and one
>   whose `iat` is more than 60 seconds ahead of the Node's clock.
> - Tests: `pairingAsk.test.ts` checks a remote ask's certificate words, a phone ask's channel key words,
>   no words on a local ask, and the two lifetime refusals. `nodePairing.test.ts` checks that
>   `askVouchedNode` returns the probed certificate's words. `pairFromAnywhere.test.ts` pairs through a
>   real relay and checks that the asker's words equal the ones the Node's dialog shows. The dialog, the
>   terminal confirmation, the phone pairing, the helper, and the bridge tests cover the rest.
> - Docs: `transport.md` § Pairing by approval, `control-plane.md` § The account service,
>   `phone-channel.md` § Trust, `node-providers.md`, `account-api.md`, `security.md`, and the extension's
>   setup and native messaging pages no longer say a vouched fingerprint stands in for the words.
>
> Decisions and deviations:
>
> - I took the finding's simpler form: identity words at both ends, compared by the owner. Nothing in the
>   request body can bind the two ends, because a relay in between rewrites it.
> - The bridge result's `identity` is optional, because the extension and its native host ship apart. An
>   older host sends none, so the extension shows only the phrase. The owner's dialog still shows the
>   Node's words, and an owner who follows it denies. The desktop renderer and its helper ship together,
>   so `NodeAdoption.identity` is required.
> - The clock allowance is 60 seconds, so a Node whose clock runs a little slow still takes honest
>   assertions. An assertion works for at most three minutes of the Node's time.
> - The phone's words protect the phone only as far as the app the account website serves. A breached
>   website can make the phone show any words. That's R-1's trust boundary, and a signed phone app
>   release is what closes it.
> - I didn't run the live check with a stand-in proxy and `pnpm dev:agent`. The relay test covers the
>   honest path end to end, and the unit tests cover a key that differs.
> - No public site page describes pairing with a Node an account lists, so none changed. `stale` lists 14
>   pages that cite the touched files. The ones I read describe local pairing and device tokens, which
>   this doesn't change.
>
> For later phases: C-1 still lets a phone approve a pairing. The phone's dialog shows the identity words
> too, because it uses the shared dialog. A new client that pairs with a listed Node must show
> `identity` beside the phrase, or the owner can't compare.
>
> What acorn-cloud would still need: nothing for this fix. The service should keep signing assertions for
> exactly `ASSERTION_LIFETIME_SECONDS`, or Nodes refuse them. Serving the phone app from a signed release
> would let the phone's words hold against a breached website too.

# R-2: A breached account service relays a pairing and keeps the device token

Found November 20, 2026, in a read-only security review of `jamesmacfie/acorn` at `90b9e61e3`.
Severity: high. Confidence: plausible. Every step is in the code, but nobody built the relay-through.
Status: open.

## What goes wrong

When a computer pairs with a Node its account lists, the client trusts the certificate fingerprint the
account vouches for and skips the owner's comparison of identity words. A breached account service can
list its own server for the Node, pass the pairing request through to the real Node, and show the
client the same three-word phrase the owner's dialog shows. The owner sees matching words and clicks
**Allow**, and the attacker collects a full device token for the real Node. A phone pairing has the same
gap and gives the attacker a phone token.

## Who can do it

The account service's operator, or anyone holding its signing key and able to change what its node list
returns. The owner must pair a computer or a phone through the account while the breach lasts. No
device token or local access is needed beforehand.

## How it goes

1. The service lists the Node with a relay URL and a certificate fingerprint of its choosing. The
   account plugin builds the client's endpoint from the listing's `relayUrl` and passes the listed
   fingerprint through (`plugins/account/src/server/nodes.ts:17-27`).
2. The client probes that endpoint and checks the certificate only against the vouched fingerprint, in
   place of the identity words (`packages/custody/src/broker/vouchedNode.ts:9-21`). The attacker's TLS
   server presents the certificate it listed, so the check passes.
3. The attacker signs a relay ticket, opens a real stream to the real Node, and forwards the client's
   `POST /v1/pair/requests` with the owner assertion the service also signs. The Node accepts a remote
   ask that carries a valid assertion
   (`packages/node-core/src/server/routes/pairing.ts:121-146`,
   `packages/node-core/src/server/auth/pairingAssertion.ts:11-21`).
4. The Node makes a random phrase and secret and returns both
   (`packages/node-core/src/server/auth/pairingRequests.ts:56-68`). The attacker forwards them, so the
   client prints the same phrase the owner's dialog shows. The phrase tells two requests apart. It isn't
   tied to the TLS session the client checked.
5. The owner sees matching words and clicks **Allow**
   (`packages/node-core/src/server/routes/pairing.ts:180-191`).
6. The attacker claims with the secret it saw and receives a device token that isn't a phone's, because
   the request came through a TLS stream and not a phone channel
   (`packages/node-core/src/server/routes/pairing.ts:150-158`, `:67-76`). It can hand the client a copy,
   so nothing looks wrong, and keep one.

The phone variant: the phone takes the Node's channel key from the account's list and pins it at its
first pairing (`docs/relay/phone-channel.md:37-40`). A listed key of the attacker's lets it run the same
relay-through on the channel and keep a phone token.

## What limits it

- The owner must pair during the breach and approve the dialog.
- A device already paired isn't affected, because its pin doesn't change with the listing.
- The Node writes `pairing.request.raised` with the assertion's ID and `pairing.request.decided` to the
  audit log, so the event is recorded after the fact.

## Fix

Bind what the owner compares to the certificate the client actually checked. The attacker sees and can
rewrite the plaintext, so nothing in the request body can do this. Only a person comparing values from
both ends can.

In this repository:

- For a remote ask, show the Node's own certificate identity words in the approval dialog, beside the
  phrase. The dialog's data is `PairingRequest` from `GET /v1/core/pair/requests`.
- In `askVouchedNode` (`packages/custody/src/broker/vouchedNode.ts`), return the identity words of the
  certificate the probe saw, and have each client show them beside the phrase.
- Tell the owner to approve only when both sets of words match.

Showing identity words for vouched Nodes again, as an unlisted Node already does, is the simpler form of
the same fix. The phone needs the same words for its channel key.

Enforce the pairing assertion's intended 120-second lifetime at the Node in
`packages/node-core/src/server/auth/pairingAssertion.ts`. This bounds stale assertions independently
of the proof that the client reached the intended Node.

## How to check the fix

- Unit: a custody test that probes a fake Node whose certificate matches the vouched fingerprint and
  checks that the result carries that certificate's identity words.
- Unit: a node-core test that a remote ask's `PairingRequest` carries the Node's own identity words.
- Live: run a stand-in account service that lists a proxy's fingerprint for a `pnpm dev:agent` Node, pair
  a CLI through it, and confirm the dialog's words and the CLI's words differ.

## Related

- [R-1](./r-1-account-website-runs-code-through-a-phone.md): a breached account website gets a phone's authority with no pairing at all.
- [C-1](./c-1-phone-approves-its-own-pairing.md): a phone can approve its own pairing request and mint a device that isn't a phone.
- Docs that make a claim this finding contradicts:
  - [The account service](../../security/control-plane.md#the-account-service) says the service can't
    "get a device token", and treats a breach as sending the person to an impostor that only collects
    their work (`docs/security/control-plane.md:49-55`).
  - [Trust](../../relay/phone-channel.md#trust) says an impostor's key "still couldn't get into the real
    Node" (`docs/relay/phone-channel.md:175-176`).
  - [Node providers](../../plugins/node-providers.md) describes the vouched fingerprint as standing in
    for the identity words (`docs/plugins/node-providers.md:39`, `:53`).
