# L-2: An agent in the read block can read the Node's relay credential

Found November 20, 2026, in a read-only security review of `jamesmacfie/acorn` at `90b9e61e3` and
`acorn-cloud` at `19fa594`. Severity: low. Confidence: confirmed from code. Status: open.

## What goes wrong

Turning on **Remote access** writes the Node's relay credential into the data root's `node.json`. The read
block, the sandbox meant to keep agents out of Acorn's data folder, leaves `node.json` readable so the task
CLI can find the Node's port. A prompt-injected agent can read the credential from its shell and use it to
take over the Node's route at the relay, which cuts the owner off from their Node until it restarts. The
credential never expires.

## Who can do it

An agent in a read-block session that read hostile text and now acts for whoever wrote it. Every managed
session in an untrusted project runs in the read block, so this is the agent that a cloned repository's
prompt injection controls. It needs the shell tool, which the read block allows inside its sandbox, and a
way to send the value out, such as a web fetch. The owner must have turned on **Remote access**. Without
the read block, an agent can read the whole data root anyway, which is an owner decision recorded in
[the October 22 review](../../security/review-2026-10-22.md).

## How it goes

1. The owner turns on **Remote access**. The account plugin records the relay settings
   (`plugins/account/src/server/remoteAccess.ts:52`) into `node.json`
   (`packages/node-core/src/server/storage/nodeRelay.ts:16-18`). The field is
   `"relay": { "url": ..., "credential": ... }` (`docs/relay.md:44`).
2. The read block lists `node.json` with the files the task CLI reads, so the sandbox allows reading it.
   Only the file tools hide it (`plugins/agents/src/server/drivers/readBlock.ts:104-114`).
3. The agent runs `cat "$ACORN_DATA_DIR/node.json"` in its shell and reads the credential.
4. The attacker dials the relay with the credential for the Node's route. The relay closes the Node's
   connection with code 4000 (`apps/relay/src/relay.ts:119-126`), and the Node treats 4000 as final and
   stops dialing until it restarts (`packages/node-core/src/server/transport/relayTunnel.ts:124-128`).
5. The credential has no expiry (`packages/protocol/src/device/account.ts:323`), so the attacker can do
   this again after each restart until the owner turns **Remote access** off and on.

## What limits it

- The credential can't mint relay tickets (`acorn-cloud:src/api.ts:88-94`, `acorn-cloud:src/api.ts:258-284`)
  or register new Node keys (`acorn-cloud:src/api.ts:57-66`, `acorn-cloud:src/api.ts:198-200`).
- It can't impersonate the Node. A paired phone pins the Node's channel key
  (`packages/channel/src/secure.ts:143-147`), and a laptop pins its TLS fingerprint
  (`packages/custody/src/broker/nodeBroker.ts:710-719`). A client that reaches the attacker fails the pin.
- So the impact today is denial of service and a stolen route, not reading or running anything.

This becomes medium if the preview routes are built as
[previews in the account API](../../account-api/previews.md) describes
(`docs/account-api/previews.md:25-27`). There, the relay credential alone authenticates the DNS-01 challenge,
so a holder could get a certificate for the Node's preview names. The Node already sends the credential for
that purpose (`packages/node-core/src/server/transport/preview/start.ts:20-37`).

## Fix

In order of cost, cheapest first:

1. In `jamesmacfie/acorn`, keep `relay` out of what the read block can read. Move `relay` and `owner` out
   of `node.json` into a separate file under the data root, mode `0600`, that the read block doesn't
   list. `recordNodeRelay` and `readNodeRelay` (`packages/node-core/src/server/storage/nodeRelay.ts`) and
   `relaySettings` (`packages/node-core/src/server/transport/relaySettings.ts`) are the only readers and
   writers. Keep reading a hand-written `relay` from `node.json` for self-hosted setups, and document that
   it's visible to read-block agents there.
2. In `acorn-cloud` and `jamesmacfie/acorn`, give relay credentials an expiry and have the Node refresh
   them, so a stolen one stops working.
3. Bind the credential to a key only the Node holds, so the relay and the account service check a
   signature rather than a bearer value.

Do the first one before the preview routes ship.

## How to check the fix

- In `plugins/agents/src/server/drivers/readBlock.test.ts`, extend the case that keeps `node.json`
  readable (around line 52) to assert that the file holding the relay settings is denied.
- Add a storage test beside `packages/node-core/src/server/storage/nodeRelay.ts`. Check that writing
  relay settings leaves no credential in `node.json` and gives the credential file mode `0600`.
- Live check in `pnpm dev:agent`: turn on **Keep agents out of Acorn's data folder**, record relay settings
  with a decoy credential, start a Claude Code session, and have it `cat` `node.json` and the new file. The
  first must show no credential and the second must fail with `Operation not permitted`.

## Related

- [L-1](./l-1-loaded-plugin-makes-trusted-projects.md), the other local finding.
- The Node's remote access findings: [R-1](./r-1-account-website-runs-code-through-a-phone.md),
  [R-2](./r-2-account-service-relays-a-pairing-and-keeps-the-token.md),
  [X-1](./x-1-account-takeover-to-slack-agent-turns.md), [R-4](./r-4-sign-out-leaves-phones-paired.md),
  and [R-5](./r-5-revoke-leaves-proxied-sockets-open.md).
- [The read block](../../managed-agents/read-block.md) and [the relay](../../relay.md).
- [The October 22 security review](../../security/review-2026-10-22.md), finding T7, which made `node.json`
  readable.
