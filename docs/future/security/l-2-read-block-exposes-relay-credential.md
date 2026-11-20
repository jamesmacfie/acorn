> **Completion note, November 20, 2026.** Fixed on the Acorn side with the doc's first, cheapest fix, on
> branch `phase-l-2-agents-can-t-read-the-relay-credential`. Expiry and key binding, the second and third
> fixes, aren't in this phase.
>
> What landed:
>
> - Remote access records `relay` and `owner` in a new data-root file, `relay.json`, written mode `0600`
>   through `writePrivateAtomic`. `recordNodeRelay` sends `relay` and `owner` there and `previews` to
>   `node.json`. `readNodeRelay` reads `owner` from `relay.json` only, and `relay` from `node.json` first,
>   then `relay.json`.
> - The read block needed no change. Its sandbox denies the whole data folder and opens only listed
>   paths, and its file guard does the same, so `relay.json` is blocked whether it exists at the session's
>   start or is created mid-session.
> - Opening a data root moves a `relay` and `owner` found together in `node.json` into `relay.json`. It
>   writes `relay.json` first, so a crash between the two writes leaves the values in both, not lost.
>   A `relay` with no `owner` is hand-written, and it stays in `node.json`.
> - `DataRoot.relay` is gone. `relaySettings` takes the recorded relay, and the listener and the
>   standalone entry pass it `readNodeRelay(root.dir)`. `readNodeRelay` is exported from the storage
>   barrel for the standalone entry.
> - `scripts/reset/inventory.mjs` lists `relay.json`, so a reset removes it.
> - Docs: `relay.md` § The Node lists the three sources in order and says a hand-written credential in
>   `node.json` is readable by read-blocked agents. `relay/accounts.md`, `managed-agents/read-block.md`,
>   `data-layer/data-root.md`, `account-api.md` (still 200 lines), `authentication.md`,
>   `first-party-plugins.md`, `security/control-plane.md`, and the site's "Where your data lives" page
>   name `relay.json`.
> - Tests: `packages/node-core/src/server/storage/nodeRelay.test.ts` checks that recording relay settings
>   leaves no credential in `node.json` and gives `relay.json` mode `0600`, that a hand-written relay
>   still reads and stays put, and that opening a root moves an older Node's relay out of `node.json`.
>   The first and third cases fail on the old code. `readBlock.test.ts` puts a `relay.json` in its
>   fixture data root and checks that no readable path covers it, that the sandbox denies the data
>   folder, and that the file guard refuses a Read of it.
>
> Decisions and deviations:
>
> - A hand-written relay in `node.json` wins over `relay.json`, so the documented rule that the owner's
>   own relay settings win over Remote access still holds. Remote access refuses to turn on while
>   `node.json` names a relay, so the two meet only if someone edits `node.json` after turning it on.
> - `owner` stays in `nodeIdentitySchema`, because the move on open has to parse it. Nothing writes it
>   to `node.json`.
> - `previews` stays in `node.json`. R-6 put it there because the listener reads it at boot, and it isn't
>   a secret.
> - The live check in `pnpm dev:agent` didn't run. The unit tests cover the sandbox settings and the
>   file guard policy Acorn sends, but not Claude Code applying them. To run it, turn on **Keep agents
>   out of Acorn's data folder**, record a decoy relay, and have a Claude Code session `cat` both files.
>
> Size: the Node service bundle grows by 583 B, from 1,970,905 B to 1,971,488 B.
>
> For later phases: R-6's precondition is met. A read-blocked agent no longer reaches the credential that
> authenticates a preview's DNS challenge, unless the owner hand-wrote it into `node.json`. R-8 and R-9
> should read relay settings through `readNodeRelay` and write them through `recordNodeRelay`. acorn-cloud
> needs nothing for this fix. Its share of fixes 2 and 3, credential expiry with a refresh route and a
> credential bound to a Node key, is still open.

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
- [R-6](./r-6-previews-put-the-cloud-inside-tls.md): the Node's preview code exists at `31ff472da`, so
  the condition above for medium is met once an account service serves previews.
- The Node's remote access findings: [R-1](./r-1-account-website-runs-code-through-a-phone.md),
  [R-2](./r-2-account-service-relays-a-pairing-and-keeps-the-token.md),
  [X-1](./x-1-account-takeover-to-slack-agent-turns.md), [R-4](./r-4-sign-out-leaves-phones-paired.md),
  and [R-5](./r-5-revoke-leaves-proxied-sockets-open.md).
- [The read block](../../managed-agents/read-block.md) and [the relay](../../relay.md).
- [The October 22 security review](../../security/review-2026-10-22.md), finding T7, which made `node.json`
  readable.
